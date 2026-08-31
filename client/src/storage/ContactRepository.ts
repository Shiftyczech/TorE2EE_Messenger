import { DatabaseManager } from './DatabaseManager';
import { ContactRecord, DeviceRecord, OwnDeviceRecord } from './types';

export class ContactRepository {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public async saveContact(contact: ContactRecord): Promise<void> {
    const linkedDevicesJson = JSON.stringify(contact.linkedDevices || []);

    await this.db.execute(
      `INSERT INTO contacts (recipient_pubkey_hash, identity_pubkey_hex, signing_pubkey_hex, alias, created_at, linked_devices)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recipient_pubkey_hash) DO UPDATE SET
         identity_pubkey_hex = excluded.identity_pubkey_hex,
         signing_pubkey_hex = excluded.signing_pubkey_hex,
         alias = excluded.alias,
         linked_devices = excluded.linked_devices;`,
      [
        contact.recipientPubkeyHash.toLowerCase(),
        contact.identityPubkeyHex.toLowerCase(),
        contact.signingPubkeyHex.toLowerCase(),
        contact.alias,
        contact.createdAt,
        linkedDevicesJson,
      ]
    );
  }

  public async getContactByHash(
    recipientPubkeyHash: string
  ): Promise<ContactRecord | null> {
    const row = await this.db.queryOne<{
      recipient_pubkey_hash: string;
      identity_pubkey_hex: string;
      signing_pubkey_hex: string;
      alias: string | null;
      created_at: number;
      linked_devices?: string;
    }>(
      'SELECT * FROM contacts WHERE recipient_pubkey_hash = ?;',
      [recipientPubkeyHash.toLowerCase()]
    );
    if (!row) return null;

    return this.mapRowToContact(row);
  }

  public async getContactByIdentityKey(
    identityPubkeyHex: string
  ): Promise<ContactRecord | null> {
    const row = await this.db.queryOne<{
      recipient_pubkey_hash: string;
      identity_pubkey_hex: string;
      signing_pubkey_hex: string;
      alias: string | null;
      created_at: number;
      linked_devices?: string;
    }>(
      'SELECT * FROM contacts WHERE identity_pubkey_hex = ?;',
      [identityPubkeyHex.toLowerCase()]
    );
    if (!row) return null;

    return this.mapRowToContact(row);
  }

  public async listContacts(): Promise<ContactRecord[]> {
    const rows = await this.db.query<{
      recipient_pubkey_hash: string;
      identity_pubkey_hex: string;
      signing_pubkey_hex: string;
      alias: string | null;
      created_at: number;
      linked_devices?: string;
    }>('SELECT * FROM contacts ORDER BY created_at DESC;');

    return rows.map((row) => this.mapRowToContact(row));
  }

  public async addLinkedDevice(
    recipientPubkeyHash: string,
    device: DeviceRecord
  ): Promise<void> {
    const contact = await this.getContactByHash(recipientPubkeyHash);
    if (!contact) {
      throw new Error(`Contact not found for hash: ${recipientPubkeyHash}`);
    }

    const currentDevices = contact.linkedDevices || [];
    const filtered = currentDevices.filter((d) => d.deviceId !== device.deviceId);
    filtered.push(device);
    contact.linkedDevices = filtered;

    await this.saveContact(contact);
  }

  public async getLinkedDevices(
    recipientPubkeyHash: string
  ): Promise<DeviceRecord[]> {
    const contact = await this.getContactByHash(recipientPubkeyHash);
    if (!contact) return [];
    return contact.linkedDevices || [];
  }

  public async updateAlias(
    recipientPubkeyHash: string,
    alias: string | null
  ): Promise<void> {
    await this.db.execute(
      'UPDATE contacts SET alias = ? WHERE recipient_pubkey_hash = ?;',
      [alias, recipientPubkeyHash.toLowerCase()]
    );
  }

  public async deleteContact(recipientPubkeyHash: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM contacts WHERE recipient_pubkey_hash = ?;',
      [recipientPubkeyHash.toLowerCase()]
    );
  }

  // --- Own Linked Devices (Self-devices like PC, Tablet) ---

  public async saveOwnLinkedDevice(device: OwnDeviceRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO own_linked_devices (device_id, device_name, recipient_pubkey_hash, identity_pubkey_hex, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         device_name = excluded.device_name,
         recipient_pubkey_hash = excluded.recipient_pubkey_hash,
         identity_pubkey_hex = excluded.identity_pubkey_hex;`,
      [
        device.deviceId,
        device.deviceName,
        device.recipientPubkeyHash.toLowerCase(),
        device.identityPubkeyHex.toLowerCase(),
        device.createdAt,
      ]
    );
  }

  public async listOwnLinkedDevices(): Promise<OwnDeviceRecord[]> {
    const rows = await this.db.query<{
      device_id: number;
      device_name: string;
      recipient_pubkey_hash: string;
      identity_pubkey_hex: string;
      created_at: number;
    }>('SELECT * FROM own_linked_devices ORDER BY device_id ASC;');

    return rows.map((r) => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      recipientPubkeyHash: r.recipient_pubkey_hash,
      identityPubkeyHex: r.identity_pubkey_hex,
      createdAt: r.created_at,
    }));
  }

  public async deleteOwnLinkedDevice(deviceId: number): Promise<void> {
    await this.db.execute('DELETE FROM own_linked_devices WHERE device_id = ?;', [deviceId]);
  }

  private mapRowToContact(row: any): ContactRecord {
    let devices: DeviceRecord[] = [];
    if (row.linked_devices) {
      try {
        devices = JSON.parse(row.linked_devices);
      } catch {
        devices = [];
      }
    }

    // Default primary device if list is empty
    if (devices.length === 0) {
      devices = [
        {
          deviceId: 1,
          recipientPubkeyHash: row.recipient_pubkey_hash,
          identityPubkeyHex: row.identity_pubkey_hex,
          deviceName: 'Primary Device',
          createdAt: row.created_at,
        },
      ];
    }

    return {
      recipientPubkeyHash: row.recipient_pubkey_hash,
      identityPubkeyHex: row.identity_pubkey_hex,
      signingPubkeyHex: row.signing_pubkey_hex,
      alias: row.alias,
      createdAt: row.created_at,
      linkedDevices: devices,
    };
  }
}
