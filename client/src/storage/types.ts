/**
 * Contact record stored in the encrypted SQLite database.
 */
export interface ContactRecord {
  /** SHA-256 hash of contact's Ed25519 public key (Mailbox ID) */
  recipientPubkeyHash: string;
  /** Contact's Curve25519 Identity Public Key (Hex) */
  identityPubkeyHex: string;
  /** Contact's Ed25519 Signing Public Key (Hex) */
  signingPubkeyHex: string;
  /** User-assigned display alias or nickname */
  alias: string | null;
  /** Timestamp when contact was added */
  createdAt: number;
}

/**
 * Message record stored in decrypted form within the SQLCipher database.
 */
export interface StoredMessage {
  /** Unique message UUID */
  id: string;
  /** Recipient Pubkey Hash of the conversation thread */
  contactPubkeyHash: string;
  /** Sender's Curve25519 Identity Key (Hex) */
  senderIdentityHex: string;
  /** Recipient's Curve25519 Identity Key (Hex) */
  recipientIdentityHex: string;
  /** Decrypted plaintext message body */
  body: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Whether the message was sent by the local user */
  isOutgoing: boolean;
  /** Whether the incoming message has been read by the user */
  isRead: boolean;
  /** Delivery status of outgoing message */
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed';
}

/**
 * Configuration options for DatabaseManager.
 */
export interface DatabaseConfig {
  /** File name of the SQLite database (default: 'tore2ee_vault.db') */
  name?: string;
  /** 256-bit encryption key (Hex string) */
  encryptionKey?: string;
  /** In-memory database flag (primarily for testing) */
  isMemory?: boolean;
}

/**
 * Common interface for SQLite drivers (better-sqlite3, op-sqlite, quick-sqlite).
 */
export interface IDatabaseDriver {
  execute(sql: string, params?: any[]): Promise<void>;
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: any[]): Promise<T | null>;
  close(): Promise<void>;
}

