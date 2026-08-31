import { DatabaseManager } from './DatabaseManager';
import { ContactRecord } from './types';

export class ContactRepository {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public async saveContact(contact: ContactRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO contacts (recipient_pubkey_hash, identity_pubkey_hex, signing_pubkey_hex, alias, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(recipient_pubkey_hash) DO UPDATE SET
         identity_pubkey_hex = excluded.identity_pubkey_hex,
         signing_pubkey_hex = excluded.signing_pubkey_hex,
         alias = excluded.alias;`,
      [
        contact.recipientPubkeyHash.toLowerCase(),
        contact.identityPubkeyHex.toLowerCase(),
        contact.signingPubkeyHex.toLowerCase(),
        contact.alias,
        contact.createdAt,
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
    }>(
      'SELECT * FROM contacts WHERE recipient_pubkey_hash = ?;',
      [recipientPubkeyHash.toLowerCase()]
    );
    if (!row) return null;
    return {
      recipientPubkeyHash: row.recipient_pubkey_hash,
      identityPubkeyHex: row.identity_pubkey_hex,
      signingPubkeyHex: row.signing_pubkey_hex,
      alias: row.alias,
      createdAt: row.created_at,
    };
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
    }>(
      'SELECT * FROM contacts WHERE identity_pubkey_hex = ?;',
      [identityPubkeyHex.toLowerCase()]
    );
    if (!row) return null;
    return {
      recipientPubkeyHash: row.recipient_pubkey_hash,
      identityPubkeyHex: row.identity_pubkey_hex,
      signingPubkeyHex: row.signing_pubkey_hex,
      alias: row.alias,
      createdAt: row.created_at,
    };
  }

  public async listContacts(): Promise<ContactRecord[]> {
    const rows = await this.db.query<{
      recipient_pubkey_hash: string;
      identity_pubkey_hex: string;
      signing_pubkey_hex: string;
      alias: string | null;
      created_at: number;
    }>('SELECT * FROM contacts ORDER BY created_at DESC;');

    return rows.map((row) => ({
      recipientPubkeyHash: row.recipient_pubkey_hash,
      identityPubkeyHex: row.identity_pubkey_hex,
      signingPubkeyHex: row.signing_pubkey_hex,
      alias: row.alias,
      createdAt: row.created_at,
    }));
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
}

