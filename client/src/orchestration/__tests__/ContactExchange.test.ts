import { CryptoEngine } from '../../crypto/CryptoEngine';
import { InMemorySignalStore } from '../../crypto/InMemorySignalStore';
import { IdentityManager } from '../../identity/IdentityManager';
import { ContactRepository } from '../../storage/ContactRepository';
import { DatabaseManager } from '../../storage/DatabaseManager';
import { ContactExchange } from '../ContactExchange';

describe('ContactExchange (QR Code / URI)', () => {
  let aliceStore: InMemorySignalStore;
  let aliceEngine: CryptoEngine;
  let bobDb: DatabaseManager;
  let bobContactRepo: ContactRepository;
  let bobEngine: CryptoEngine;

  beforeEach(async () => {
    const aliceIdentity = await IdentityManager.generateIdentity();
    aliceStore = new InMemorySignalStore(aliceIdentity);
    aliceEngine = new CryptoEngine(aliceStore);

    bobDb = new DatabaseManager({ isMemory: true });
    await bobDb.initialize();
    bobContactRepo = new ContactRepository(bobDb);

    const bobIdentity = await IdentityManager.generateIdentity();
    const bobStore = new InMemorySignalStore(bobIdentity);
    bobEngine = new CryptoEngine(bobStore);
  });

  afterEach(async () => {
    await bobDb.close();
  });

  describe('Export and Parse URI', () => {
    it('exports a valid contact URI and parses it successfully with Ed25519 signature check', async () => {
      const aliceBundle = await aliceEngine.generatePreKeyBundle(10);
      const uri = ContactExchange.exportContactUri(aliceBundle, 'Alice');

      expect(uri).toContain('tore2ee://contact?v=1&d=');

      const parsed = ContactExchange.parseContactUri(uri);
      expect(parsed.payload.alias).toBe('Alice');
      expect(parsed.payload.identityKeyHex).toBe(aliceBundle.identityKeyHex);
      expect(parsed.payload.signingKeyHex).toBe(aliceBundle.signingKeyHex);
      expect(parsed.bundle.signedPreKey.publicKeyHex).toBe(aliceBundle.signedPreKey.publicKeyHex);
      expect(parsed.recipientPubkeyHash).toHaveLength(64);
    });

    it('rejects contact URI if Signed PreKey signature is tampered with', async () => {
      const aliceBundle = await aliceEngine.generatePreKeyBundle(10);

      // Tamper with SPK signature
      const tamperedBundle = {
        ...aliceBundle,
        signedPreKey: {
          ...aliceBundle.signedPreKey,
          signatureHex: 'ff'.repeat(64),
        },
      };

      const uri = ContactExchange.exportContactUri(tamperedBundle, 'Alice');

      expect(() => ContactExchange.parseContactUri(uri)).toThrow(
        'Cryptographic verification failed: Signed PreKey signature does not match Signing Key'
      );
    });
  });

  describe('Import Contact', () => {
    it('imports contact into ContactRepository and initiates Double Ratchet session', async () => {
      const aliceBundle = await aliceEngine.generatePreKeyBundle(10);
      const uri = ContactExchange.exportContactUri(aliceBundle, 'Alice In Wonderland');

      const importedContact = await ContactExchange.importContact(
        uri,
        bobContactRepo,
        bobEngine
      );

      expect(importedContact.alias).toBe('Alice In Wonderland');
      expect(importedContact.identityPubkeyHex).toBe(aliceBundle.identityKeyHex);

      const savedContact = await bobContactRepo.getContactByHash(
        importedContact.recipientPubkeyHash
      );
      expect(savedContact).not.toBeNull();
      expect(savedContact?.alias).toBe('Alice In Wonderland');
    });
  });
});

