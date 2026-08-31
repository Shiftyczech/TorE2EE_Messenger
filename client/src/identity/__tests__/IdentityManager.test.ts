import { IdentityManager } from '../IdentityManager';

describe('IdentityManager', () => {
  describe('generateIdentity', () => {
    it('generates a valid 12-word identity by default', async () => {
      const identity = await IdentityManager.generateIdentity();

      expect(identity.mnemonic.split(' ')).toHaveLength(12);
      expect(identity.signingKey.publicKey).toHaveLength(32);
      expect(identity.signingKey.secretKey).toHaveLength(64);
      expect(identity.signingKey.publicKeyHex).toHaveLength(64);

      expect(identity.encryptionKey.publicKey).toHaveLength(32);
      expect(identity.encryptionKey.secretKey).toHaveLength(32);
      expect(identity.encryptionKey.publicKeyHex).toHaveLength(64);

      expect(identity.recipientPubkeyHash).toHaveLength(64);
      expect(identity.recipientPubkeyHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates a valid 24-word identity when requested', async () => {
      const identity = await IdentityManager.generateIdentity(24);
      expect(identity.mnemonic.split(' ')).toHaveLength(24);
    });
  });

  describe('restoreIdentity', () => {
    it('deterministically recovers the exact same keypairs and hash from mnemonic', async () => {
      const original = await IdentityManager.generateIdentity();
      const restored = await IdentityManager.restoreIdentity(original.mnemonic);

      expect(restored.mnemonic).toEqual(original.mnemonic);
      expect(restored.signingKey.publicKeyHex).toEqual(original.signingKey.publicKeyHex);
      expect(restored.encryptionKey.publicKeyHex).toEqual(original.encryptionKey.publicKeyHex);
      expect(restored.recipientPubkeyHash).toEqual(original.recipientPubkeyHash);
    });

    it('rejects invalid mnemonic words or corrupted checksums', async () => {
      const invalidMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon invalidword';
      await expect(IdentityManager.restoreIdentity(invalidMnemonic)).rejects.toThrow(
        'Invalid BIP-39 mnemonic phrase'
      );
    });
  });

  describe('signChallenge and verifySignature', () => {
    it('correctly signs a 32-byte server challenge and verifies it', async () => {
      const identity = await IdentityManager.generateIdentity();
      const fakeChallengeHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const signatureHex = IdentityManager.signChallenge(
        fakeChallengeHex,
        identity.signingKey.secretKey
      );

      expect(signatureHex).toHaveLength(128);
      expect(signatureHex).toMatch(/^[0-9a-f]{128}$/);

      const isValid = IdentityManager.verifySignature(
        fakeChallengeHex,
        signatureHex,
        identity.signingKey.publicKeyHex
      );
      expect(isValid).toBe(true);

      const wrongChallengeHex = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      const isInvalid = IdentityManager.verifySignature(
        wrongChallengeHex,
        signatureHex,
        identity.signingKey.publicKeyHex
      );
      expect(isInvalid).toBe(false);
    });
  });

  describe('Keychain operations', () => {
    it('saves, loads, and clears identity from Keychain correctly', async () => {
      const identity = await IdentityManager.generateIdentity();

      const saved = await IdentityManager.saveIdentityToKeychain(identity);
      expect(saved).toBe(true);

      const loaded = await IdentityManager.loadIdentityFromKeychain();
      if (loaded) {
        expect(loaded.mnemonic).toEqual(identity.mnemonic);
        expect(loaded.recipientPubkeyHash).toEqual(identity.recipientPubkeyHash);
      }

      const cleared = await IdentityManager.clearIdentityFromKeychain();
      expect(cleared).toBe(true);
    });
  });

  describe('getPublicIdentity', () => {
    it('returns only public properties', async () => {
      const identity = await IdentityManager.generateIdentity();
      const pub = IdentityManager.getPublicIdentity(identity);

      expect(pub).toEqual({
        signingPublicKeyHex: identity.signingKey.publicKeyHex,
        encryptionPublicKeyHex: identity.encryptionKey.publicKeyHex,
        recipientPubkeyHash: identity.recipientPubkeyHash,
      });
    });
  });
});

