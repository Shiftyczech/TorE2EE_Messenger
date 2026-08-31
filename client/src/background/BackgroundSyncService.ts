import nacl from 'tweetnacl';
import { bytesToHex } from '@noble/hashes/utils';
import { CryptoEngine } from '../crypto/CryptoEngine';
import { EncryptedMessage } from '../crypto/types';
import { IdentityManager } from '../identity/IdentityManager';
import { TorManager } from '../network/TorManager';
import { TorWebSocketClient } from '../network/TorWebSocketClient';
import { IncomingMessagePayload, TorConfig } from '../network/types';
import { NotificationManager } from '../notifications/NotificationManager';
import { ContactRepository } from '../storage/ContactRepository';
import { DatabaseManager } from '../storage/DatabaseManager';
import { MessageRepository } from '../storage/MessageRepository';
import { SqliteSignalStore } from '../storage/SqliteSignalStore';
import { ContactRecord, StoredMessage } from '../storage/types';
import { BackgroundSyncConfig, BackgroundSyncResult } from './types';

export class BackgroundSyncService {
  private static isRunning: boolean = false;

  /**
   * Executes a headless background sync cycle under strict execution time limits.
   */
  public static async executeSync(
    config?: BackgroundSyncConfig
  ): Promise<BackgroundSyncResult> {
    if (this.isRunning) {
      return {
        status: 'NO_DATA',
        messagesReceived: 0,
        durationMs: 0,
        error: 'Background sync is already in progress',
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const bootstrapTimeoutMs = config?.bootstrapTimeoutMs ?? 20000;
    const drainTimeoutMs = config?.drainTimeoutMs ?? 3000;
    const privacyMode = config?.privacyMode ?? false;

    let dbManager: DatabaseManager | null = null;
    let wsClientInstance: TorWebSocketClient | null = null;
    let torManagerInstance: TorManager | null = null;
    let messagesReceivedCount = 0;

    try {
      // 1. Load UserIdentity from Hardware Keychain
      const identity = await IdentityManager.loadIdentityFromKeychain();
      if (!identity) {
        return {
          status: 'SKIPPED_NO_IDENTITY',
          messagesReceived: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Unlock SQLite Database & Signal Store
      const dbConfig = config?.databaseConfig || {
        name: `tore2ee_${identity.recipientPubkeyHash.substring(0, 8)}.db`,
      };
      dbManager = new DatabaseManager(dbConfig);
      await dbManager.initialize();

      const signalStore = new SqliteSignalStore(identity, dbManager);
      const contactRepo = new ContactRepository(dbManager);
      const messageRepo = new MessageRepository(dbManager);
      const cryptoEngine = new CryptoEngine(signalStore);
      const notifManager = NotificationManager.getInstance();
      await notifManager.initialize();

      // 3. Start Tor Manager with strict Promise.race timeout (max 20s)
      const torConfig: TorConfig = {
        socksProxyHost: config?.torConfig?.socksProxyHost || '127.0.0.1',
        socksProxyPort: config?.torConfig?.socksProxyPort || 9050,
        targetHost: config?.torConfig?.targetHost || '127.0.0.1',
        targetPort: config?.torConfig?.targetPort || 8080,
        devMode: config?.torConfig?.devMode ?? false,
      };

      torManagerInstance = TorManager.getInstance(torConfig);

      const torBootstrapPromise = torManagerInstance.startTor();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tor bootstrap timed out after ${bootstrapTimeoutMs}ms`)),
          bootstrapTimeoutMs
        )
      );

      await Promise.race([torBootstrapPromise, timeoutPromise]);

      // 4. Connect Tor WebSocket Client and Drain Queued Messages
      await new Promise<void>((resolve, reject) => {
        let drainTimer: NodeJS.Timeout | null = null;

        const cleanupAndFinish = () => {
          if (drainTimer) clearTimeout(drainTimer);
          resolve();
        };

        const client = new TorWebSocketClient(torConfig, identity, {
          onAuthenticated: () => {
            drainTimer = setTimeout(() => {
              cleanupAndFinish();
            }, drainTimeoutMs);
          },
          onMessage: async (payload: IncomingMessagePayload) => {
            try {
              await this.processIncomingEnvelope(
                payload,
                identity.encryptionKey.publicKeyHex,
                contactRepo,
                signalStore,
                cryptoEngine,
                messageRepo,
                notifManager,
                privacyMode
              );
              messagesReceivedCount++;

              if (drainTimer) {
                clearTimeout(drainTimer);
                drainTimer = setTimeout(() => {
                  cleanupAndFinish();
                }, drainTimeoutMs);
              }
            } catch {
              // Ignore individual processing failure
            }
          },
          onError: (err) => {
            if (drainTimer) clearTimeout(drainTimer);
            reject(err);
          },
          onDisconnect: () => {
            cleanupAndFinish();
          },
        });

        wsClientInstance = client;
        client.connect().catch(reject);
      });

      const durationMs = Date.now() - startTime;
      return {
        status: messagesReceivedCount > 0 ? 'NEW_DATA' : 'NO_DATA',
        messagesReceived: messagesReceivedCount,
        durationMs,
      };
    } catch (error) {
      const errMsg = (error as Error).message;
      return {
        status: 'FAILED',
        messagesReceived: messagesReceivedCount,
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
    } finally {
      // 5. Cleanup resources and suspend Tor to save battery
      if (wsClientInstance) {
        (wsClientInstance as TorWebSocketClient).disconnect();
      }
      if (torManagerInstance && !config?.torConfig?.devMode) {
        try {
          await (torManagerInstance as TorManager).stopTor();
        } catch {}
      }
      if (dbManager) {
        try {
          await (dbManager as DatabaseManager).close();
        } catch {}
      }
      this.isRunning = false;
    }
  }

  private static async processIncomingEnvelope(
    payload: IncomingMessagePayload,
    localIdentityKeyHex: string,
    contactRepo: ContactRepository,
    signalStore: SqliteSignalStore,
    cryptoEngine: CryptoEngine,
    messageRepo: MessageRepository,
    notifManager: NotificationManager,
    privacyMode: boolean
  ): Promise<void> {
    const encryptedMsg: EncryptedMessage = JSON.parse(payload.encrypted_payload);

    let senderIdentityHex: string | null = null;
    let contact: ContactRecord | null = null;

    if (encryptedMsg.initialIdentityKeyHex) {
      senderIdentityHex = encryptedMsg.initialIdentityKeyHex.toLowerCase();
      contact = await contactRepo.getContactByIdentityKey(senderIdentityHex);

      if (!contact) {
        contact = {
          recipientPubkeyHash: senderIdentityHex,
          identityPubkeyHex: senderIdentityHex,
          signingPubkeyHex: '',
          alias: 'Neznámý kontakt',
          createdAt: Date.now(),
        };
        await contactRepo.saveContact(contact);
      }
    } else {
      const contacts = await contactRepo.listContacts();
      for (const c of contacts) {
        const has = await signalStore.hasSession(c.identityPubkeyHex);
        if (has) {
          senderIdentityHex = c.identityPubkeyHex.toLowerCase();
          contact = c;
          break;
        }
      }
    }

    if (!senderIdentityHex || !contact) {
      throw new Error('Sender identity cannot be resolved');
    }

    // Decrypt Double Ratchet message
    const plaintext = await cryptoEngine.decrypt(senderIdentityHex, encryptedMsg);

    // Save to SQLite
    const messageId = bytesToHex(nacl.randomBytes(16));
    const storedMsg: StoredMessage = {
      id: messageId,
      contactPubkeyHash: contact.recipientPubkeyHash,
      senderIdentityHex: senderIdentityHex,
      recipientIdentityHex: localIdentityKeyHex,
      body: plaintext,
      timestamp: payload.created_at ? payload.created_at * 1000 : Date.now(),
      isOutgoing: false,
      isRead: false,
      deliveryStatus: 'delivered',
    };

    await messageRepo.saveMessage(storedMsg);

    // Trigger local push notification
    const senderTitle = contact.alias || 'TorE2EE Kontakt';
    await notifManager.displayMessageNotification(
      senderTitle,
      plaintext,
      contact.recipientPubkeyHash,
      privacyMode
    );
  }
}

