import { IdentityManager } from '../../identity/IdentityManager';
import { CryptoEngine } from '../../crypto/CryptoEngine';
import { DatabaseManager } from '../DatabaseManager';
import { SqliteSignalStore } from '../SqliteSignalStore';

describe('SqliteSignalStore & CryptoEngine Persistence', () => {
  let dbAlice: DatabaseManager;
  let dbBob: DatabaseManager;
  let aliceStore: SqliteSignalStore;
  let bobStore: SqliteSignalStore;

  beforeEach(async () => {
    dbAlice = new DatabaseManager({ isMemory: true });
    await dbAlice.initialize();

    dbBob = new DatabaseManager({ isMemory: true });
    await dbBob.initialize();

    const aliceIdentity = await IdentityManager.generateIdentity();
    const bobIdentity = await IdentityManager.generateIdentity();

    aliceStore = new SqliteSignalStore(aliceIdentity, dbAlice);
    bobStore = new SqliteSignalStore(bobIdentity, dbBob);
  });

  afterEach(async () => {
    await dbAlice.close();
    await dbBob.close();
  });

  describe('SqliteSignalStore Direct Operations', () => {
    it('stores, retrieves and counts One-Time PreKeys', async () => {
      const dummyOtk = {
        keyId: 101,
        keyPair: {
          publicKey: new Uint8Array(32).fill(1),
          secretKey: new Uint8Array(32).fill(2),
          publicKeyHex: '01'.repeat(32),
        },
      };

      await aliceStore.saveOneTimePreKey(101, dummyOtk);
      expect(await aliceStore.countOneTimePreKeys()).toBe(1);

      const loaded = await aliceStore.getOneTimePreKey(101);
      expect(loaded).not.toBeNull();
      expect(loaded?.keyId).toBe(101);
      expect(loaded?.keyPair.publicKeyHex).toBe('01'.repeat(32));
      expect(loaded?.keyPair.publicKey).toEqual(dummyOtk.keyPair.publicKey);
      expect(loaded?.keyPair.secretKey).toEqual(dummyOtk.keyPair.secretKey);

      await aliceStore.removeOneTimePreKey(101);
      expect(await aliceStore.countOneTimePreKeys()).toBe(0);
    });

    it('stores and retrieves Signed PreKeys', async () => {
      const dummySpk = {
        keyId: 202,
        keyPair: {
          publicKey: new Uint8Array(32).fill(3),
          secretKey: new Uint8Array(32).fill(4),
          publicKeyHex: '03'.repeat(32),
        },
        signatureHex: '05'.repeat(64),
        createdAt: 1000,
      };

      await aliceStore.saveSignedPreKey(202, dummySpk);

      const loaded = await aliceStore.getSignedPreKey(202);
      expect(loaded).not.toBeNull();
      expect(loaded?.keyId).toBe(202);
      expect(loaded?.signatureHex).toBe('05'.repeat(64));

      const latest = await aliceStore.getLatestSignedPreKey();
      expect(latest?.keyId).toBe(202);
    });
  });

  describe('Full Double Ratchet Conversation with SqliteSignalStore', () => {
    it('executes complete X3DH and Double Ratchet messaging persisted in SQLite', async () => {
      const aliceEngine = new CryptoEngine(aliceStore);
      const bobEngine = new CryptoEngine(bobStore);

      // 1. Bob generates PreKeyBundle (persisted to Bob's SQLite)
      const bobBundle = await bobEngine.generatePreKeyBundle(10);
      expect(await bobStore.countOneTimePreKeys()).toBe(10);

      // 2. Alice initiates session (persisted to Alice's SQLite)
      await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);
      expect(await aliceStore.hasSession(bobBundle.identityKeyHex)).toBe(true);

      // 3. Alice encrypts Message 1
      const plaintext1 = 'Hello Bob! Stored in SQLite.';
      const msg1 = await aliceEngine.encrypt(bobBundle.identityKeyHex, plaintext1, {
        oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId,
      });

      // 4. Bob decrypts Message 1 (persists Bob's session and removes used OTK)
      const aliceIdentity = await aliceStore.getIdentity();
      const aliceIdentityKeyHex = aliceIdentity.encryptionKey.publicKeyHex;

      const decrypted1 = await bobEngine.decrypt(aliceIdentityKeyHex, msg1);
      expect(decrypted1).toBe(plaintext1);
      expect(await bobStore.hasSession(aliceIdentityKeyHex)).toBe(true);
      expect(await bobStore.countOneTimePreKeys()).toBe(9);

      // 5. Bob replies with Message 2 (Asymmetric DH Ratchet step)
      const plaintext2 = 'Hi Alice! Received and stored in my SQLite.';
      const msg2 = await bobEngine.encrypt(aliceIdentityKeyHex, plaintext2);

      // 6. Alice decrypts Message 2
      const decrypted2 = await aliceEngine.decrypt(bobBundle.identityKeyHex, msg2);
      expect(decrypted2).toBe(plaintext2);

      // 7. Alice sends Message 3
      const plaintext3 = 'Double Ratchet + SQLite persistence 100% functional.';
      const msg3 = await aliceEngine.encrypt(bobBundle.identityKeyHex, plaintext3);
      const decrypted3 = await bobEngine.decrypt(aliceIdentityKeyHex, msg3);
      expect(decrypted3).toBe(plaintext3);

      // Verify sessions exist in both databases
      const finalAliceSession = await aliceStore.getSession(bobBundle.identityKeyHex);
      const finalBobSession = await bobStore.getSession(aliceIdentityKeyHex);
      expect(finalAliceSession).not.toBeNull();
      expect(finalBobSession).not.toBeNull();
    });
  });
});

