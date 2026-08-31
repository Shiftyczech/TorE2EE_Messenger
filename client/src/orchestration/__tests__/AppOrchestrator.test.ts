import { IdentityManager } from '../../identity/IdentityManager';
import { IncomingMessagePayload, TorConfig } from '../../network/types';
import { StoredMessage } from '../../storage/types';
import { AppOrchestrator } from '../AppOrchestrator';
import { ContactExchange } from '../ContactExchange';

describe('AppOrchestrator Integration', () => {
  let aliceOrchestrator: AppOrchestrator;
  let bobOrchestrator: AppOrchestrator;

  const mockTorConfig: TorConfig = {
    socksProxyHost: '127.0.0.1',
    socksProxyPort: 9050,
    targetHost: '127.0.0.1',
    targetPort: 8080,
    devMode: true,
  };

  beforeEach(async () => {
    const aliceIdentity = await IdentityManager.generateIdentity();
    const bobIdentity = await IdentityManager.generateIdentity();

    aliceOrchestrator = new AppOrchestrator(aliceIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await aliceOrchestrator.initialize();

    bobOrchestrator = new AppOrchestrator(bobIdentity, {
      torConfig: mockTorConfig,
      databaseConfig: { isMemory: true },
    });
    await bobOrchestrator.initialize();
  });

  afterEach(async () => {
    await aliceOrchestrator.stop();
    await bobOrchestrator.stop();
  });

  describe('Full E2EE Message Flow and Event Orchestration', () => {
    it('exchanges messages, persists history in SQLite, and emits UI events', async () => {
      // 1. Bob generates & exports contact bundle (e.g. shows QR code on screen)
      const bobBundle = await bobOrchestrator.generatePreKeyBundle(10);
      const bobUri = ContactExchange.exportContactUri(bobBundle, 'Bob User');

      // 2. Alice scans Bob's QR code and imports contact (initiating X3DH session on Alice's side)
      const aliceBobContact = await ContactExchange.importContact(
        bobUri,
        aliceOrchestrator.getContactRepository(),
        aliceOrchestrator.getCryptoEngine()
      );

      // Track received messages via UI event listeners
      const aliceReceived: StoredMessage[] = [];
      const bobReceived: StoredMessage[] = [];

      aliceOrchestrator.setEvents({
        onMessageReceived: (msg) => aliceReceived.push(msg),
      });

      bobOrchestrator.setEvents({
        onMessageReceived: (msg) => bobReceived.push(msg),
      });

      // 3. Alice encrypts outbound message to Bob
      const plaintext1 = 'Hello Bob! This message passed through full orchestration.';
      const aliceEncrypted = await aliceOrchestrator.getCryptoEngine().encrypt(
        aliceBobContact.identityPubkeyHex,
        plaintext1,
        { oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId }
      );

      // 4. Bob receives incoming raw payload (simulating WebSocket stream message)
      const incomingPayloadToBob: IncomingMessagePayload = {
        encrypted_payload: JSON.stringify(aliceEncrypted),
        nonce: aliceEncrypted.nonce,
        created_at: Math.floor(Date.now() / 1000),
      };

      const bobDecryptedMessage = await bobOrchestrator.handleIncomingMessage(
        incomingPayloadToBob
      );

      expect(bobDecryptedMessage).not.toBeNull();
      expect(bobDecryptedMessage?.body).toBe(plaintext1);
      expect(bobDecryptedMessage?.isOutgoing).toBe(false);
      expect(bobDecryptedMessage?.isRead).toBe(false);
      expect(bobReceived).toHaveLength(1);
      expect(bobReceived[0].body).toBe(plaintext1);

      // Verify Bob's SQLite message repository has the message
      const bobHistory = await bobOrchestrator
        .getMessageRepository()
        .getMessagesForContact(bobDecryptedMessage!.contactPubkeyHash);
      expect(bobHistory).toHaveLength(1);
      expect(bobHistory[0].body).toBe(plaintext1);

      // 5. Bob replies to Alice (Asymmetric DH Ratchet step)
      const aliceIdentity = aliceOrchestrator.getIdentity();
      const plaintext2 = 'Hi Alice! Received and decrypted in SQLite.';
      const bobEncryptedReply = await bobOrchestrator.getCryptoEngine().encrypt(
        aliceIdentity.encryptionKey.publicKeyHex,
        plaintext2
      );

      // 6. Alice receives incoming raw payload from Bob
      const incomingPayloadToAlice: IncomingMessagePayload = {
        encrypted_payload: JSON.stringify(bobEncryptedReply),
        nonce: bobEncryptedReply.nonce,
        created_at: Math.floor(Date.now() / 1000),
      };

      const aliceDecryptedMessage = await aliceOrchestrator.handleIncomingMessage(
        incomingPayloadToAlice
      );

      expect(aliceDecryptedMessage).not.toBeNull();
      expect(aliceDecryptedMessage?.body).toBe(plaintext2);
      expect(aliceReceived).toHaveLength(1);
      expect(aliceReceived[0].body).toBe(plaintext2);

      // Verify Alice's SQLite message repository has the message
      const aliceHistory = await aliceOrchestrator
        .getMessageRepository()
        .getMessagesForContact(aliceBobContact.recipientPubkeyHash);
      expect(aliceHistory).toHaveLength(1);
      expect(aliceHistory[0].body).toBe(plaintext2);
    });

    it('gracefully handles corrupted messages without crashing orchestrator', async () => {
      let capturedError: Error | null = null;
      bobOrchestrator.setEvents({
        onError: (err) => {
          capturedError = err;
        },
      });

      const corruptedPayload: IncomingMessagePayload = {
        encrypted_payload: 'invalid-non-json',
        nonce: 'invalid',
        created_at: 1000,
      };

      const result = await bobOrchestrator.handleIncomingMessage(corruptedPayload);
      expect(result).toBeNull();
      expect(capturedError).not.toBeNull();
    });
  });
});

