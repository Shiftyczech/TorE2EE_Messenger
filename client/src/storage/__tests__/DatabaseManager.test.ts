import { DatabaseManager } from '../DatabaseManager';
import { ContactRepository } from '../ContactRepository';
import { MessageRepository } from '../MessageRepository';

describe('DatabaseManager & Repositories', () => {
  let db: DatabaseManager;
  let contactRepo: ContactRepository;
  let messageRepo: MessageRepository;

  beforeEach(async () => {
    db = new DatabaseManager({ isMemory: true });
    await db.initialize();
    contactRepo = new ContactRepository(db);
    messageRepo = new MessageRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Database Initialization & Migrations', () => {
    it('creates tables and schema migrations up to version 2', async () => {
      const migrationRow = await db.queryOne<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_migrations;'
      );
      expect(migrationRow?.version).toBe(2);

      // Verify tables exist
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table';"
      );
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('contacts');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('signed_prekeys');
      expect(tableNames).toContain('one_time_prekeys');
      expect(tableNames).toContain('messages');
      expect(tableNames).toContain('own_linked_devices');
    });

    it('generates a 256-bit encryption key when requested', async () => {
      const key = await DatabaseManager.getOrCreateDatabaseKey();
      expect(key).toHaveLength(64); // 32 bytes hex
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('ContactRepository', () => {
    it('saves, retrieves, updates alias and deletes contacts with multi-device support', async () => {
      const contact = {
        recipientPubkeyHash: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
        identityPubkeyHex: 'aabbccddeeff11223344556677889900aabbccddeeff11223344556677889900',
        signingPubkeyHex: 'ddeeff11223344556677889900aabbccddeeff11223344556677889900aabbcc',
        alias: 'Alice',
        createdAt: 1234567890,
        linkedDevices: [
          {
            deviceId: 1,
            recipientPubkeyHash: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
            identityPubkeyHex: 'aabbccddeeff11223344556677889900aabbccddeeff11223344556677889900',
            deviceName: 'Alice Phone',
            createdAt: 1234567890,
          },
        ],
      };

      await contactRepo.saveContact(contact);

      const byHash = await contactRepo.getContactByHash(contact.recipientPubkeyHash);
      expect(byHash).not.toBeNull();
      expect(byHash?.alias).toBe('Alice');
      expect(byHash?.linkedDevices).toHaveLength(1);

      const byIdKey = await contactRepo.getContactByIdentityKey(contact.identityPubkeyHex);
      expect(byIdKey).not.toBeNull();
      expect(byIdKey?.alias).toBe('Alice');

      await contactRepo.updateAlias(contact.recipientPubkeyHash, 'Alice Secure');
      const updated = await contactRepo.getContactByHash(contact.recipientPubkeyHash);
      expect(updated?.alias).toBe('Alice Secure');

      // Test adding a secondary linked device
      await contactRepo.addLinkedDevice(contact.recipientPubkeyHash, {
        deviceId: 2,
        recipientPubkeyHash: '223344556677889900aabbccddeeff11223344556677889900aabbccddeeff11',
        identityPubkeyHex: 'bbccddeeff11223344556677889900aabbccddeeff11223344556677889900aa',
        deviceName: 'Alice Laptop',
        createdAt: 1234567899,
      });

      const devices = await contactRepo.getLinkedDevices(contact.recipientPubkeyHash);
      expect(devices).toHaveLength(2);

      // Test own linked devices
      await contactRepo.saveOwnLinkedDevice({
        deviceId: 2,
        deviceName: 'My Desktop',
        recipientPubkeyHash: 'my_pc_hash',
        identityPubkeyHex: 'my_pc_key',
        createdAt: 1000,
      });

      const ownDevices = await contactRepo.listOwnLinkedDevices();
      expect(ownDevices).toHaveLength(1);
      expect(ownDevices[0].deviceName).toBe('My Desktop');

      await contactRepo.deleteOwnLinkedDevice(2);
      expect(await contactRepo.listOwnLinkedDevices()).toHaveLength(0);

      const list = await contactRepo.listContacts();
      expect(list).toHaveLength(1);

      await contactRepo.deleteContact(contact.recipientPubkeyHash);
      const afterDelete = await contactRepo.getContactByHash(contact.recipientPubkeyHash);
      expect(afterDelete).toBeNull();
    });
  });

  describe('MessageRepository', () => {
    it('saves, queries, updates read status and delivery status', async () => {
      const contactHash = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

      // Insert contact first (foreign key constraint)
      await contactRepo.saveContact({
        recipientPubkeyHash: contactHash,
        identityPubkeyHex: 'aabbccddeeff11223344556677889900aabbccddeeff11223344556677889900',
        signingPubkeyHex: 'ddeeff11223344556677889900aabbccddeeff11223344556677889900aabbcc',
        alias: 'Bob',
        createdAt: 1000,
      });

      await messageRepo.saveMessage({
        id: 'msg-1',
        contactPubkeyHash: contactHash,
        senderIdentityHex: 'alice-key',
        recipientIdentityHex: 'bob-key',
        body: 'Hello Bob!',
        timestamp: 1001,
        isOutgoing: true,
        isRead: true,
        deliveryStatus: 'delivered',
      });

      await messageRepo.saveMessage({
        id: 'msg-2',
        contactPubkeyHash: contactHash,
        senderIdentityHex: 'bob-key',
        recipientIdentityHex: 'alice-key',
        body: 'Hi Alice!',
        timestamp: 1002,
        isOutgoing: false,
        isRead: false,
        deliveryStatus: 'delivered',
      });

      const unreadCount = await messageRepo.getUnreadCount(contactHash);
      expect(unreadCount).toBe(1);

      const conversation = await messageRepo.getMessagesForContact(contactHash);
      expect(conversation).toHaveLength(2);
      expect(conversation[0].body).toBe('Hello Bob!');
      expect(conversation[1].body).toBe('Hi Alice!');

      await messageRepo.markMessagesAsRead(contactHash);
      const unreadAfter = await messageRepo.getUnreadCount(contactHash);
      expect(unreadAfter).toBe(0);

      await messageRepo.deleteMessage('msg-1');
      const messagesAfterDelete = await messageRepo.getMessagesForContact(contactHash);
      expect(messagesAfterDelete).toHaveLength(1);
    });
  });
});
