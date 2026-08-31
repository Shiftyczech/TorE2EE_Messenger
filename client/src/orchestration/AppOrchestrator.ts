import nacl from 'tweetnacl';
import { bytesToHex } from '@noble/hashes/utils';
import { CryptoEngine } from '../crypto/CryptoEngine';
import { EncryptedMessage, PreKeyBundle } from '../crypto/types';
import { DeviceSyncPayload } from '../devices/types';
import { UserIdentity } from '../identity/types';
import { TorHttpClient } from '../network/TorHttpClient';
import { TorManager } from '../network/TorManager';
import { TorWebSocketClient } from '../network/TorWebSocketClient';
import {
  IncomingMessagePayload,
  OutgoingMessageEnvelope,
  TorStatus,
  WsClientState,
} from '../network/types';
import { ContactRepository } from '../storage/ContactRepository';
import { DatabaseManager } from '../storage/DatabaseManager';
import { MessageRepository } from '../storage/MessageRepository';
import { SqliteSignalStore } from '../storage/SqliteSignalStore';
import { ContactRecord, DeviceRecord, StoredMessage } from '../storage/types';
import { AppOrchestratorConfig, OrchestratorEvents } from './types';

export class AppOrchestrator {
  private identity: UserIdentity;
  private config: AppOrchestratorConfig;
  private events: OrchestratorEvents;

  private dbManager: DatabaseManager;
  private signalStore: SqliteSignalStore;
  private contactRepo: ContactRepository;
  private messageRepo: MessageRepository;
  private cryptoEngine: CryptoEngine;

  private torManager: TorManager;
  private httpClient: TorHttpClient;
  private wsClient: TorWebSocketClient;

  constructor(identity: UserIdentity, config: AppOrchestratorConfig) {
    this.identity = identity;
    this.config = config;
    this.events = config.events || {};

    // 1. Storage & Crypto
    this.dbManager = new DatabaseManager(config.databaseConfig);
    this.signalStore = new SqliteSignalStore(this.identity, this.dbManager);
    this.contactRepo = new ContactRepository(this.dbManager);
    this.messageRepo = new MessageRepository(this.dbManager);
    this.cryptoEngine = new CryptoEngine(this.signalStore);

    // 2. Networking
    this.torManager = TorManager.getInstance(config.torConfig);
    this.httpClient = new TorHttpClient(config.torConfig);
    this.wsClient = new TorWebSocketClient(config.torConfig, this.identity, {
      onAuthenticated: (_pubkeyHash) => {
        // Stream authenticated
      },
      onMessage: (rawMsg) => {
        this.handleIncomingMessage(rawMsg).catch((err) => {
          if (this.events.onError) {
            this.events.onError(err);
          }
        });
      },
      onStateChange: (state) => {
        if (this.events.onWsStateChanged) {
          this.events.onWsStateChanged(state);
        }
      },
      onError: (err) => {
        if (this.events.onError) {
          this.events.onError(err);
        }
      },
    });
  }

  public static async create(
    identity: UserIdentity,
    config: AppOrchestratorConfig
  ): Promise<AppOrchestrator> {
    const orchestrator = new AppOrchestrator(identity, config);
    await orchestrator.initialize();
    return orchestrator;
  }

  public async initialize(): Promise<void> {
    await this.dbManager.initialize();
  }

  /**
   * Starts Tor daemon and connects the live message WebSocket stream.
   */
  public async start(): Promise<void> {
    await this.torManager.startTor((progress) => {
      if (this.events.onTorStatusChanged) {
        this.events.onTorStatusChanged(
          progress.isReady ? TorStatus.READY : TorStatus.BOOTSTRAPPING
        );
      }
    });

    await this.wsClient.connect();
  }

  /**
   * Disconnects live socket and closes database connection cleanly.
   */
  public async stop(): Promise<void> {
    this.wsClient.disconnect();
    await this.dbManager.close();
  }

  public setEvents(events: OrchestratorEvents): void {
    this.events = { ...this.events, ...events };
  }

  public getIdentity(): UserIdentity {
    return this.identity;
  }

  public getContactRepository(): ContactRepository {
    return this.contactRepo;
  }

  public getMessageRepository(): MessageRepository {
    return this.messageRepo;
  }

  public getCryptoEngine(): CryptoEngine {
    return this.cryptoEngine;
  }

  public getDatabaseManager(): DatabaseManager {
    return this.dbManager;
  }

  public getHttpClient(): TorHttpClient {
    return this.httpClient;
  }

  /**
   * Generates a PreKeyBundle for sharing via QR code or manual contact adding.
   */
  public async generatePreKeyBundle(count: number = 20): Promise<PreKeyBundle> {
    return this.cryptoEngine.generatePreKeyBundle(count);
  }

  /**
   * Encrypts, persists, and transmits an outbound message across all linked recipient devices
   * and dispatches self-sync messages to all own linked secondary devices.
   */
  public async sendOutboundMessage(
    contactPubkeyHash: string,
    plaintext: string
  ): Promise<StoredMessage> {
    const contact = await this.contactRepo.getContactByHash(contactPubkeyHash);
    if (!contact) {
      throw new Error(`Contact not found for hash: ${contactPubkeyHash}`);
    }

    const messageId = bytesToHex(nacl.randomBytes(16));
    const now = Date.now();

    // 1. Determine all recipient devices (multi-device support)
    const targetDevices: DeviceRecord[] =
      contact.linkedDevices && contact.linkedDevices.length > 0
        ? contact.linkedDevices
        : [
            {
              deviceId: 1,
              recipientPubkeyHash: contact.recipientPubkeyHash,
              identityPubkeyHex: contact.identityPubkeyHex,
              createdAt: contact.createdAt,
            },
          ];

    // 2. Encrypt and dispatch envelopes to each recipient device
    let deliveredAtLeastOnce = false;
    for (const device of targetDevices) {
      try {
        const encryptedMsg = await this.cryptoEngine.encrypt(
          device.identityPubkeyHex,
          plaintext
        );

        const envelope: OutgoingMessageEnvelope = {
          recipient_pubkey_hash: device.recipientPubkeyHash,
          encrypted_payload: JSON.stringify(encryptedMsg),
          nonce: encryptedMsg.nonce,
        };

        const resp = await this.httpClient.sendMessage(envelope);
        if (resp.delivered_live) {
          deliveredAtLeastOnce = true;
        }
      } catch {
        // Continue delivering to remaining devices if one fails
      }
    }

    // 3. Dispatch Self-Sync messages to all own linked devices (e.g. PC / Tablet)
    const ownDevices = await this.contactRepo.listOwnLinkedDevices();
    for (const ownDev of ownDevices) {
      try {
        const syncPayload: DeviceSyncPayload = {
          isSyncMessage: true,
          originalRecipientHash: contact.recipientPubkeyHash,
          body: plaintext,
          timestamp: now,
          messageId,
        };

        const encSyncMsg = await this.cryptoEngine.encrypt(
          ownDev.identityPubkeyHex,
          JSON.stringify(syncPayload)
        );

        const syncEnvelope: OutgoingMessageEnvelope = {
          recipient_pubkey_hash: ownDev.recipientPubkeyHash,
          encrypted_payload: JSON.stringify(encSyncMsg),
          nonce: encSyncMsg.nonce,
        };

        await this.httpClient.sendMessage(syncEnvelope);
      } catch {
        // Ignore self-sync delivery error
      }
    }

    // 4. Persist in local SQLite database
    const deliveryStatus = deliveredAtLeastOnce ? 'delivered' : 'sent';
    const storedMsg: StoredMessage = {
      id: messageId,
      contactPubkeyHash: contact.recipientPubkeyHash,
      senderIdentityHex: this.identity.encryptionKey.publicKeyHex,
      recipientIdentityHex: contact.identityPubkeyHex,
      body: plaintext,
      timestamp: now,
      isOutgoing: true,
      isRead: true,
      deliveryStatus,
    };

    await this.messageRepo.saveMessage(storedMsg);
    if (this.events.onMessageSent) {
      this.events.onMessageSent(storedMsg);
    }

    return storedMsg;
  }

  /**
   * Processes an incoming encrypted envelope received over the WebSocket stream.
   * Handles both normal contact messages and Self-Sync messages from own linked devices.
   */
  public async handleIncomingMessage(
    payload: IncomingMessagePayload
  ): Promise<StoredMessage | null> {
    try {
      const encryptedMsg: EncryptedMessage = JSON.parse(payload.encrypted_payload);

      let senderIdentityHex: string | null = null;
      let contact: ContactRecord | null = null;

      // 1. Determine Sender Identity Key
      if (encryptedMsg.initialIdentityKeyHex) {
        senderIdentityHex = encryptedMsg.initialIdentityKeyHex.toLowerCase();
        contact = await this.contactRepo.getContactByIdentityKey(senderIdentityHex);

        if (!contact) {
          contact = {
            recipientPubkeyHash: senderIdentityHex,
            identityPubkeyHex: senderIdentityHex,
            signingPubkeyHex: '',
            alias: 'Unknown Contact',
            createdAt: Date.now(),
          };
          await this.contactRepo.saveContact(contact);
        }
      } else {
        // Find matching contact from existing active sessions
        const contacts = await this.contactRepo.listContacts();
        for (const c of contacts) {
          const has = await this.signalStore.hasSession(c.identityPubkeyHex);
          if (has) {
            senderIdentityHex = c.identityPubkeyHex.toLowerCase();
            contact = c;
            break;
          }
        }
      }

      if (!senderIdentityHex || !contact) {
        throw new Error('Could not resolve sender identity for incoming message');
      }

      // 2. Decrypt Plaintext via CryptoEngine
      const rawDecrypted = await this.cryptoEngine.decrypt(
        senderIdentityHex,
        encryptedMsg
      );

      // 3. Check for Self-Sync Message
      let isSync = false;
      let messageBody = rawDecrypted;
      let targetContactHash = contact.recipientPubkeyHash;
      let messageId = bytesToHex(nacl.randomBytes(16));

      try {
        const parsedSync: DeviceSyncPayload = JSON.parse(rawDecrypted);
        if (parsedSync.isSyncMessage) {
          isSync = true;
          messageBody = parsedSync.body;
          targetContactHash = parsedSync.originalRecipientHash;
          if (parsedSync.messageId) messageId = parsedSync.messageId;

          // Ensure conversation contact exists on secondary device
          let targetContact = await this.contactRepo.getContactByHash(targetContactHash);
          if (!targetContact) {
            targetContact = {
              recipientPubkeyHash: targetContactHash,
              identityPubkeyHex: targetContactHash,
              signingPubkeyHex: '',
              alias: 'Synced Conversation',
              createdAt: Date.now(),
            };
            await this.contactRepo.saveContact(targetContact);
          }
        }
      } catch {
        // Regular plaintext message
      }

      // 4. Store message in SQLite
      const storedMsg: StoredMessage = {
        id: messageId,
        contactPubkeyHash: targetContactHash,
        senderIdentityHex: senderIdentityHex,
        recipientIdentityHex: this.identity.encryptionKey.publicKeyHex,
        body: messageBody,
        timestamp: payload.created_at ? payload.created_at * 1000 : Date.now(),
        isOutgoing: isSync,
        isRead: isSync,
        deliveryStatus: 'delivered',
        isSyncMessage: isSync,
      };

      await this.messageRepo.saveMessage(storedMsg);

      // 5. Emit event for reactive UI
      if (isSync) {
        if (this.events.onMessageSent) {
          this.events.onMessageSent(storedMsg);
        }
      } else {
        if (this.events.onMessageReceived) {
          this.events.onMessageReceived(storedMsg);
        }
      }

      return storedMsg;
    } catch (err) {
      if (this.events.onError) {
        this.events.onError(err as Error);
      }
      return null;
    }
  }
}
