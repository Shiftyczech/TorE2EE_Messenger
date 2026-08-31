import { DatabaseManager } from './DatabaseManager';
import { StoredMessage } from './types';

export class MessageRepository {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public async saveMessage(message: StoredMessage): Promise<void> {
    await this.db.execute(
      `INSERT INTO messages (
        id, contact_pubkey_hash, sender_identity_hex, recipient_identity_hex,
        body, timestamp, is_outgoing, is_read, delivery_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        body = excluded.body,
        is_read = excluded.is_read,
        delivery_status = excluded.delivery_status;`,
      [
        message.id,
        message.contactPubkeyHash.toLowerCase(),
        message.senderIdentityHex.toLowerCase(),
        message.recipientIdentityHex.toLowerCase(),
        message.body,
        message.timestamp,
        message.isOutgoing ? 1 : 0,
        message.isRead ? 1 : 0,
        message.deliveryStatus,
      ]
    );
  }

  public async getMessageById(id: string): Promise<StoredMessage | null> {
    const row = await this.db.queryOne<{
      id: string;
      contact_pubkey_hash: string;
      sender_identity_hex: string;
      recipient_identity_hex: string;
      body: string;
      timestamp: number;
      is_outgoing: number;
      is_read: number;
      delivery_status: StoredMessage['deliveryStatus'];
    }>('SELECT * FROM messages WHERE id = ?;', [id]);

    if (!row) return null;
    return this.mapRowToMessage(row);
  }

  public async getMessagesForContact(
    contactPubkeyHash: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<StoredMessage[]> {
    const rows = await this.db.query<{
      id: string;
      contact_pubkey_hash: string;
      sender_identity_hex: string;
      recipient_identity_hex: string;
      body: string;
      timestamp: number;
      is_outgoing: number;
      is_read: number;
      delivery_status: StoredMessage['deliveryStatus'];
    }>(
      `SELECT * FROM messages
       WHERE contact_pubkey_hash = ?
       ORDER BY timestamp ASC
       LIMIT ? OFFSET ?;`,
      [contactPubkeyHash.toLowerCase(), limit, offset]
    );

    return rows.map((row) => this.mapRowToMessage(row));
  }

  public async markMessagesAsRead(contactPubkeyHash: string): Promise<void> {
    await this.db.execute(
      'UPDATE messages SET is_read = 1 WHERE contact_pubkey_hash = ? AND is_outgoing = 0;',
      [contactPubkeyHash.toLowerCase()]
    );
  }

  public async getUnreadCount(contactPubkeyHash?: string): Promise<number> {
    if (contactPubkeyHash) {
      const row = await this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE contact_pubkey_hash = ? AND is_read = 0 AND is_outgoing = 0;',
        [contactPubkeyHash.toLowerCase()]
      );
      return row?.count || 0;
    } else {
      const row = await this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE is_read = 0 AND is_outgoing = 0;'
      );
      return row?.count || 0;
    }
  }

  public async updateDeliveryStatus(
    id: string,
    status: StoredMessage['deliveryStatus']
  ): Promise<void> {
    await this.db.execute(
      'UPDATE messages SET delivery_status = ? WHERE id = ?;',
      [status, id]
    );
  }

  public async deleteMessage(id: string): Promise<void> {
    await this.db.execute('DELETE FROM messages WHERE id = ?;', [id]);
  }

  public async clearConversation(contactPubkeyHash: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM messages WHERE contact_pubkey_hash = ?;',
      [contactPubkeyHash.toLowerCase()]
    );
  }

  private mapRowToMessage(row: any): StoredMessage {
    return {
      id: row.id,
      contactPubkeyHash: row.contact_pubkey_hash,
      senderIdentityHex: row.sender_identity_hex,
      recipientIdentityHex: row.recipient_identity_hex,
      body: row.body,
      timestamp: row.timestamp,
      isOutgoing: row.is_outgoing === 1,
      isRead: row.is_read === 1,
      deliveryStatus: row.delivery_status,
    };
  }
}

