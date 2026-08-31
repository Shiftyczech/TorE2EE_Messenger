import { IdentityManager } from '../../identity/IdentityManager';
import { CryptoEngine } from '../CryptoEngine';
import { InMemorySignalStore } from '../InMemorySignalStore';

describe('CryptoEngine (Double Ratchet + X3DH)', () => {
  let aliceStore: InMemorySignalStore;
  let bobStore: InMemorySignalStore;
  let aliceEngine: CryptoEngine;
  let bobEngine: CryptoEngine;

  beforeEach(async () => {
    const aliceIdentity = await IdentityManager.generateIdentity();
    const bobIdentity = await IdentityManager.generateIdentity();

    aliceStore = new InMemorySignalStore(aliceIdentity);
    bobStore = new InMemorySignalStore(bobIdentity);

    aliceEngine = new CryptoEngine(aliceStore);
    bobEngine = new CryptoEngine(bobStore);
  });

  describe('PreKeyBundle generation', () => {
    it('generates valid Signed PreKey and One-Time PreKeys', async () => {
      const bundle = await bobEngine.generatePreKeyBundle(10);

      expect(bundle.identityKeyHex).toHaveLength(64);
      expect(bundle.signingKeyHex).toHaveLength(64);
      expect(bundle.signedPreKey.publicKeyHex).toHaveLength(64);
      expect(bundle.signedPreKey.signatureHex).toHaveLength(128);

      // Verify Ed25519 signature over SPK
      const isValid = IdentityManager.verifySignature(
        bundle.signedPreKey.publicKeyHex,
        bundle.signedPreKey.signatureHex,
        bundle.signingKeyHex
      );
      expect(isValid).toBe(true);

      const otkCount = await bobStore.countOneTimePreKeys();
      expect(otkCount).toBe(10);
    });
  });

  describe('X3DH Session Initiation and Two-Way Conversation', () => {
    it('establishes session and exchanges messages between Alice and Bob', async () => {
      // 1. Bob publishes PreKeyBundle
      const bobBundle = await bobEngine.generatePreKeyBundle(5);

      // 2. Alice initiates session using Bob's bundle
      await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);

      // 3. Alice encrypts initial message
      const plaintext1 = 'Hello Bob! This is message 1.';
      const encryptedMsg1 = await aliceEngine.encrypt(
        bobBundle.identityKeyHex,
        plaintext1,
        {
          oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId,
        }
      );

      expect(encryptedMsg1.sequenceNumber).toBe(0);
      expect(encryptedMsg1.ciphertext).toBeDefined();

      // 4. Bob receives and decrypts initial message (X3DH Bob side + Double Ratchet init)
      const aliceIdentity = await aliceStore.getIdentity();
      const aliceIdentityKeyHex = aliceIdentity.encryptionKey.publicKeyHex;

      const decrypted1 = await bobEngine.decrypt(aliceIdentityKeyHex, encryptedMsg1);
      expect(decrypted1).toBe(plaintext1);

      // Verify Bob used and removed the One-Time PreKey (Forward Secrecy)
      const remainingOtks = await bobStore.countOneTimePreKeys();
      expect(remainingOtks).toBe(4);

      // 5. Bob replies to Alice (triggers Asymmetric DH Ratchet step)
      const plaintext2 = 'Hi Alice! Received your message. Here is message 2.';
      const encryptedMsg2 = await bobEngine.encrypt(aliceIdentityKeyHex, plaintext2);
      expect(encryptedMsg2.sequenceNumber).toBe(0);

      // 6. Alice decrypts Bob's reply
      const decrypted2 = await aliceEngine.decrypt(bobBundle.identityKeyHex, encryptedMsg2);
      expect(decrypted2).toBe(plaintext2);

      // 7. Alice sends message 3
      const plaintext3 = 'Awesome! Double Ratchet is working seamlessly.';
      const encryptedMsg3 = await aliceEngine.encrypt(bobBundle.identityKeyHex, plaintext3);
      const decrypted3 = await bobEngine.decrypt(aliceIdentityKeyHex, encryptedMsg3);
      expect(decrypted3).toBe(plaintext3);
    });

    it('supports multiple sequential messages in the same direction (Symmetric chain)', async () => {
      const bobBundle = await bobEngine.generatePreKeyBundle(5);
      await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);

      const aliceIdentity = await aliceStore.getIdentity();
      const aliceIdentityKeyHex = aliceIdentity.encryptionKey.publicKeyHex;

      // Alice sends 4 messages in a row
      const msg1 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Sequential Msg 1', {
        oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId,
      });
      const msg2 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Sequential Msg 2');
      const msg3 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Sequential Msg 3');
      const msg4 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Sequential Msg 4');

      expect(msg1.sequenceNumber).toBe(0);
      expect(msg2.sequenceNumber).toBe(1);
      expect(msg3.sequenceNumber).toBe(2);
      expect(msg4.sequenceNumber).toBe(3);

      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg1)).toBe('Sequential Msg 1');
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg2)).toBe('Sequential Msg 2');
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg3)).toBe('Sequential Msg 3');
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg4)).toBe('Sequential Msg 4');
    });
  });

  describe('Out-of-order message delivery (Skipped Keys)', () => {
    it('correctly handles messages received out of order', async () => {
      const bobBundle = await bobEngine.generatePreKeyBundle(5);
      await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);

      const aliceIdentity = await aliceStore.getIdentity();
      const aliceIdentityKeyHex = aliceIdentity.encryptionKey.publicKeyHex;

      const msg1 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'First Message', {
        oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId,
      });
      const msg2 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Second Message');
      const msg3 = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Third Message');

      // Bob decrypts msg1 first (initializes session)
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg1)).toBe('First Message');

      // Bob receives msg3 BEFORE msg2 (out of order)
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg3)).toBe('Third Message');

      // Bob receives msg2 later
      expect(await bobEngine.decrypt(aliceIdentityKeyHex, msg2)).toBe('Second Message');
    });
  });

  describe('Tamper Resistance & Security', () => {
    it('fails decryption if ciphertext or nonce is modified', async () => {
      const bobBundle = await bobEngine.generatePreKeyBundle(5);
      await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);

      const aliceIdentity = await aliceStore.getIdentity();
      const aliceIdentityKeyHex = aliceIdentity.encryptionKey.publicKeyHex;

      const msg = await aliceEngine.encrypt(bobBundle.identityKeyHex, 'Top secret payload', {
        oneTimePreKeyId: bobBundle.oneTimePreKey?.keyId,
      });

      // Tamper with ciphertext
      const tamperedBytes = Buffer.from(msg.ciphertext, 'base64');
      tamperedBytes[tamperedBytes.length - 1] ^= 0x01; // flip 1 bit
      const tamperedMsg = {
        ...msg,
        ciphertext: tamperedBytes.toString('base64'),
      };

      await expect(bobEngine.decrypt(aliceIdentityKeyHex, tamperedMsg)).rejects.toThrow(
        'Decryption failed or message corrupted / tampered with'
      );
    });
  });
});

