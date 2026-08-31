import nacl from 'tweetnacl';
import { bytesToHex } from '@noble/hashes/utils';
import { DatabaseConfig, IDatabaseDriver } from './types';

export const KEYCHAIN_DB_KEY_SERVICE = 'tore2ee.database.key';

function getKeychainModule(): any {
  try {
    return require('react-native-keychain');
  } catch {
    return null;
  }
}

export class BetterSqliteDriver implements IDatabaseDriver {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  public async execute(sql: string, params: any[] = []): Promise<void> {
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  public async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  public async queryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params);
    return (row as T) || null;
  }

  public async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}

export class DatabaseManager {
  private driver: IDatabaseDriver | null = null;
  private config: DatabaseConfig;
  private isInitialized: boolean = false;

  constructor(config: DatabaseConfig = {}) {
    this.config = {
      name: config.name || 'tore2ee_vault.db',
      encryptionKey: config.encryptionKey,
      isMemory: config.isMemory ?? false,
    };
  }

  /**
   * Generates or retrieves the 256-bit database encryption key from hardware-backed Keychain.
   */
  public static async getOrCreateDatabaseKey(
    service: string = KEYCHAIN_DB_KEY_SERVICE
  ): Promise<string> {
    const Keychain = getKeychainModule();
    if (Keychain) {
      try {
        const credentials = await Keychain.getGenericPassword({ service });
        if (credentials && credentials.password) {
          return credentials.password;
        }

        // Generate 256-bit random key
        const newKeyBytes = nacl.randomBytes(32);
        const newKeyHex = bytesToHex(newKeyBytes);

        await Keychain.setGenericPassword('db_key', newKeyHex, {
          service,
          accessible: Keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          securityLevel: Keychain.SECURITY_LEVEL?.SECURE_HARDWARE,
        });

        return newKeyHex;
      } catch {
        // Fallback if keychain is unavailable
      }
    }

    // Fallback key generation
    const keyBytes = nacl.randomBytes(32);
    return bytesToHex(keyBytes);
  }

  /**
   * Initializes the encrypted database connection and runs pending migrations.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    let key = this.config.encryptionKey;
    if (!key && !this.config.isMemory) {
      key = await DatabaseManager.getOrCreateDatabaseKey();
      this.config.encryptionKey = key;
    }

    if (this.config.isMemory) {
      const Database = require('better-sqlite3');
      const db = new Database(':memory:');
      this.driver = new BetterSqliteDriver(db);
    } else {
      // Try better-sqlite3 or native SQLCipher driver
      try {
        const Database = require('better-sqlite3');
        const db = new Database(this.config.name);
        if (key) {
          try {
            db.pragma(`key = "x'${key}'"`);
          } catch {
            db.pragma(`key = '${key}'`);
          }
        }
        this.driver = new BetterSqliteDriver(db);
      } catch {
        // In React Native environment, quick-sqlite / op-sqlite will be bound here
        throw new Error('SQLite driver initialization failed');
      }
    }

    // Configure pragmas
    await this.driver.execute('PRAGMA foreign_keys = ON;');
    await this.driver.execute('PRAGMA journal_mode = WAL;');

    // Run schema migrations
    await this.runMigrations();
    this.isInitialized = true;
  }

  public getDriver(): IDatabaseDriver {
    if (!this.driver || !this.isInitialized) {
      throw new Error('DatabaseManager has not been initialized. Call initialize() first.');
    }
    return this.driver;
  }

  public async execute(sql: string, params: any[] = []): Promise<void> {
    return this.getDriver().execute(sql, params);
  }

  public async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return this.getDriver().query<T>(sql, params);
  }

  public async queryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
    return this.getDriver().queryOne<T>(sql, params);
  }

  private async runMigrations(): Promise<void> {
    if (!this.driver) return;

    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const currentVersionRow = await this.driver.queryOne<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_migrations;'
    );
    const currentVersion = currentVersionRow?.version || 0;

    if (currentVersion < 1) {
      await this.applyMigrationV1();
    }
  }

  private async applyMigrationV1(): Promise<void> {
    if (!this.driver) return;

    // 1. Contacts
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        recipient_pubkey_hash TEXT PRIMARY KEY,
        identity_pubkey_hex TEXT NOT NULL,
        signing_pubkey_hex TEXT NOT NULL,
        alias TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // 2. Double Ratchet Sessions
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        recipient_identity_pubkey_hex TEXT PRIMARY KEY,
        session_data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // 3. Signed PreKeys
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS signed_prekeys (
        key_id INTEGER PRIMARY KEY,
        key_data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // 4. One-Time PreKeys
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS one_time_prekeys (
        key_id INTEGER PRIMARY KEY,
        key_data TEXT NOT NULL
      );
    `);

    // 5. Encrypted / Stored Messages
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        contact_pubkey_hash TEXT NOT NULL,
        sender_identity_hex TEXT NOT NULL,
        recipient_identity_hex TEXT NOT NULL,
        body TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        is_outgoing INTEGER NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        delivery_status TEXT NOT NULL DEFAULT 'delivered',
        FOREIGN KEY (contact_pubkey_hash) REFERENCES contacts(recipient_pubkey_hash)
      );
    `);

    await this.driver.execute(`
      CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_pubkey_hash, timestamp);
    `);

    await this.driver.execute(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);',
      [1, Date.now()]
    );
  }

  public async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.isInitialized = false;
    }
  }
}

