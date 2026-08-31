import { IdentityManager } from '../../identity/IdentityManager';
import { IncomingMessagePayload, OutgoingMessageEnvelope, SendMessageResponse, TorConfig } from '../../network/types';
import { AppOrchestrator } from '../../orchestration/AppOrchestrator';
import { ContactRecord, DeviceRecord } from '../../storage/types';

describe('Multi-Device Messaging & Self-Sync', () => {
  let aliceMobile: AppOrchestrator;
  let alicePC: AppOrchestrator;
  let bobMobile: AppOrchestrator;
  let bobPC: AppOrchestrator;

  const mockTorConfig: TorConfig = {
    socksProxyHost: '127.0.0.1',
    socksProxyPort: 9050,
    targetHost: '127.0.0.1',
    targetPort: 8080,
    devMode: true,
  };

  beforeEach(async () => {
    // Identities
    const aliceMobileIdentity = await IdentityManager.generateIdentity();
    const alicePCIdentity = await IdentityManager.generateIdentity();
    const bobMobileIdentity = await IdentityManager.generateIdentity();
    const bobPCIdentity = await IdentityManager.generateIdentity();

    // Orchestrators (in-memory SQLite)
    aliceMobile = new AppOrchestrator(aliceMobileIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await aliceMobile.initialize();

    alicePC = new AppOrchestrator(alicePCIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await alicePC.initialize();

    bobMobile = new AppOrchestrator(bobMobileIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await bobMobile.initialize();

    bobPC = new AppOrchestrator(bobPCIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await bobPC.initialize();
  });

  afterEach(async () => {
    await aliceMobile.stop();
    await alicePC.stop();
    await bobMobile.stop();
    await bobPC.stop();
  });

  it('delivers outbound message to both recipient devices and syncs to own secondary device', async () => {
    // 1. Bob generates PreKey bundles for Bob-Mobile and Bob-PC
    const bobMobileBundle = await bobMobile.generatePreKeyBundle(5);
    const bobPCBundle = await bobPC.generatePreKeyBundle(5);

    // 2. Alice registers Bob in her contacts with 2 linked devices
    const bobMobileDevice: DeviceRecord = {
      deviceId: 1,
      recipientPubkeyHash: bobMobile.getIdentity().recipientPubkeyHash,
      identityPubkeyHex: bobMobile.getIdentity().encryptionKey.publicKeyHex,
      deviceName: 'Bob Phone',
      createdAt: Date.now(),
    };

    const bobPCDevice: DeviceRecord = {
      deviceId: 2,
      recipientPubkeyHash: bobPC.getIdentity().recipientPubkeyHash,
      identityPubkeyHex: bobPC.getIdentity().encryptionKey.publicKeyHex,
      deviceName: 'Bob Laptop',
      createdAt: Date.now(),
    };

    const bobContact: ContactRecord = {
      recipientPubkeyHash: bobMobile.getIdentity().recipientPubkeyHash,
      identityPubkeyHex: bobMobile.getIdentity().encryptionKey.publicKeyHex,
      signingPubkeyHex: bobMobile.getIdentity().signingKey.publicKeyHex,
      alias: 'Bob Full Account',
      createdAt: Date.now(),
      linkedDevices: [bobMobileDevice, bobPCDevice],
    };

    await aliceMobile.getContactRepository().saveContact(bobContact);

    // Alice initiates Double Ratchet sessions with both of Bob's devices
    await aliceMobile
      .getCryptoEngine()
      .initiateSession(bobMobileDevice.identityPubkeyHex, bobMobileBundle);
    await aliceMobile
      .getCryptoEngine()
      .initiateSession(bobPCDevice.identityPubkeyHex, bobPCBundle);

    // 3. Alice registers her own linked PC in own_linked_devices
    const alicePCBundle = await alicePC.generatePreKeyBundle(5);
    await aliceMobile.getContactRepository().saveOwnLinkedDevice({
      deviceId: 2,
      deviceName: 'Alice Desktop',
      recipientPubkeyHash: alicePC.getIdentity().recipientPubkeyHash,
      identityPubkeyHex: alicePC.getIdentity().encryptionKey.publicKeyHex,
      createdAt: Date.now(),
    });

    // Alice-Mobile initiates Double Ratchet session with Alice-PC for self-sync
    await aliceMobile
      .getCryptoEngine()
      .initiateSession(alicePC.getIdentity().encryptionKey.publicKeyHex, alicePCBundle);

    // 4. Intercept HTTP dispatches from Alice-Mobile
    const dispatchedEnvelopes: OutgoingMessageEnvelope[] = [];
    jest.spyOn(aliceMobile.getHttpClient(), 'sendMessage').mockImplementation(
      async (env: OutgoingMessageEnvelope): Promise<SendMessageResponse> => {
        dispatchedEnvelopes.push(env);
        return { status: 'accepted', delivered_live: false };
      }
    );

    // 5. Alice-Mobile sends message to Bob
    const messageText = 'Hello Bob! This message is sent to all your devices and synced to my PC.';
    const storedOutMsg = await aliceMobile.sendOutboundMessage(
      bobContact.recipientPubkeyHash,
      messageText
    );

    expect(storedOutMsg.isOutgoing).toBe(true);
    expect(storedOutMsg.body).toBe(messageText);

    // Verify 3 envelopes were dispatched: Bob-Mobile, Bob-PC, Alice-PC Self-Sync
    expect(dispatchedEnvelopes).toHaveLength(3);

    const bobMobileEnvelope = dispatchedEnvelopes.find(
      (e) => e.recipient_pubkey_hash === bobMobile.getIdentity().recipientPubkeyHash
    );
    const bobPCEnvelope = dispatchedEnvelopes.find(
      (e) => e.recipient_pubkey_hash === bobPC.getIdentity().recipientPubkeyHash
    );
    const alicePCEnvelope = dispatchedEnvelopes.find(
      (e) => e.recipient_pubkey_hash === alicePC.getIdentity().recipientPubkeyHash
    );

    expect(bobMobileEnvelope).toBeDefined();
    expect(bobPCEnvelope).toBeDefined();
    expect(alicePCEnvelope).toBeDefined();

    // 6. Bob-Mobile receives Envelope 1
    const bobMobileIncoming: IncomingMessagePayload = {
      encrypted_payload: bobMobileEnvelope!.encrypted_payload,
      nonce: bobMobileEnvelope!.nonce,
      created_at: Math.floor(Date.now() / 1000),
    };
    const bobMobileDecrypted = await bobMobile.handleIncomingMessage(bobMobileIncoming);
    expect(bobMobileDecrypted).not.toBeNull();
    expect(bobMobileDecrypted?.body).toBe(messageText);
    expect(bobMobileDecrypted?.isOutgoing).toBe(false);

    // 7. Bob-PC receives Envelope 2
    const bobPCIncoming: IncomingMessagePayload = {
      encrypted_payload: bobPCEnvelope!.encrypted_payload,
      nonce: bobPCEnvelope!.nonce,
      created_at: Math.floor(Date.now() / 1000),
    };
    const bobPCDecrypted = await bobPC.handleIncomingMessage(bobPCIncoming);
    expect(bobPCDecrypted).not.toBeNull();
    expect(bobPCDecrypted?.body).toBe(messageText);
    expect(bobPCDecrypted?.isOutgoing).toBe(false);

    // 8. Alice-PC receives Envelope 3 (Self-Sync Message)
    const alicePCIncoming: IncomingMessagePayload = {
      encrypted_payload: alicePCEnvelope!.encrypted_payload,
      nonce: alicePCEnvelope!.nonce,
      created_at: Math.floor(Date.now() / 1000),
    };
    const alicePCDecrypted = await alicePC.handleIncomingMessage(alicePCIncoming);
    expect(alicePCDecrypted).not.toBeNull();
    expect(alicePCDecrypted?.body).toBe(messageText);
    expect(alicePCDecrypted?.isOutgoing).toBe(true); // Self-Sync is tagged as outgoing
    expect(alicePCDecrypted?.isSyncMessage).toBe(true);
  });
});

