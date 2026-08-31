import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { ISignalStore } from '../crypto/ISignalStore';
import {
  OneTimePreKey,
  SessionRecord,
  SignedPreKey,
} from '../crypto/types';
import { Curve25519KeyPair, UserIdentity } from '../identity/types';
import { DatabaseManager } from './DatabaseManager';

export class SqliteSignalStore implements ISignalStore {
  private identity: UserIdentity;
  private db: DatabaseManager;

  constructor(identity: UserIdentity, db: DatabaseManager) {
    this.identity = identity;
    this.db = db;
  }

  public async getIdentity(): Promise<UserIdentity> {
    return this.identity;
  }

  public async saveSignedPreKey(
    keyId: number,
    preKey: SignedPreKey
  ): Promise<void> {
    const serialized = this.serializeSignedPreKey(preKey);
    await this.db.execute(
      `INSERT INTO signed_prekeys (key_id, key_data, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key_id) DO UPDATE SET key_data = excluded.key_data, created_at = excluded.created_at;`,
      [keyId, JSON.stringify(serialized), preKey.createdAt]
    );
  }

  public async getSignedPreKey(keyId: number): Promise<SignedPreKey | null> {
    const row = await this.db.queryOne<{ key_data: string }>(
      'SELECT key_data FROM signed_prekeys WHERE key_id = ?;',
      [keyId]
    );
    if (!row) return null;
    return this.deserializeSignedPreKey(JSON.parse(row.key_data));
  }

  public async getLatestSignedPreKey(): Promise<SignedPreKey | null> {
    const row = await this.db.queryOne<{ key_data: string }>(
      'SELECT key_data FROM signed_prekeys ORDER BY created_at DESC LIMIT 1;'
    );
    if (!row) return null;
    return this.deserializeSignedPreKey(JSON.parse(row.key_data));
  }

  public async saveOneTimePreKey(
    keyId: number,
    preKey: OneTimePreKey
  ): Promise<void> {
    const serialized = this.serializeOneTimePreKey(preKey);
    await this.db.execute(
      `INSERT INTO one_time_prekeys (key_id, key_data)
       VALUES (?, ?)
       ON CONFLICT(key_id) DO UPDATE SET key_data = excluded.key_data;`,
      [keyId, JSON.stringify(serialized)]
    );
  }

  public async getOneTimePreKey(keyId: number): Promise<OneTimePreKey | null> {
    const row = await this.db.queryOne<{ key_data: string }>(
      'SELECT key_data FROM one_time_prekeys WHERE key_id = ?;',
      [keyId]
    );
    if (!row) return null;
    return this.deserializeOneTimePreKey(JSON.parse(row.key_data));
  }

  public async removeOneTimePreKey(keyId: number): Promise<void> {
    await this.db.execute('DELETE FROM one_time_prekeys WHERE key_id = ?;', [
      keyId,
    ]);
  }

  public async countOneTimePreKeys(): Promise<number> {
    const row = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM one_time_prekeys;'
    );
    return row?.count || 0;
  }

  public async saveSession(
    recipientIdentityKeyHex: string,
    session: SessionRecord
  ): Promise<void> {
    const normalizedKey = recipientIdentityKeyHex.toLowerCase();
    const serialized = this.serializeSession(session);
    await this.db.execute(
      `INSERT INTO sessions (recipient_identity_pubkey_hex, session_data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(recipient_identity_pubkey_hex) DO UPDATE SET session_data = excluded.session_data, updated_at = excluded.updated_at;`,
      [normalizedKey, JSON.stringify(serialized), session.updatedAt]
    );
  }

  public async getSession(
    recipientIdentityKeyHex: string
  ): Promise<SessionRecord | null> {
    const normalizedKey = recipientIdentityKeyHex.toLowerCase();
    const row = await this.db.queryOne<{ session_data: string }>(
      'SELECT session_data FROM sessions WHERE recipient_identity_pubkey_hex = ?;',
      [normalizedKey]
    );
    if (!row) return null;
    return this.deserializeSession(JSON.parse(row.session_data));
  }

  public async hasSession(recipientIdentityKeyHex: string): Promise<boolean> {
    const normalizedKey = recipientIdentityKeyHex.toLowerCase();
    const row = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM sessions WHERE recipient_identity_pubkey_hex = ?;',
      [normalizedKey]
    );
    return (row?.count || 0) > 0;
  }

  public async removeSession(recipientIdentityKeyHex: string): Promise<void> {
    const normalizedKey = recipientIdentityKeyHex.toLowerCase();
    await this.db.execute(
      'DELETE FROM sessions WHERE recipient_identity_pubkey_hex = ?;',
      [normalizedKey]
    );
  }

  // --- Serialization & Deserialization Helpers ---

  private serializeKeyPair(keyPair: Curve25519KeyPair): any {
    return {
      publicKeyHex: keyPair.publicKeyHex,
      secretKeyHex: bytesToHex(keyPair.secretKey),
    };
  }

  private deserializeKeyPair(data: any): Curve25519KeyPair {
    return {
      publicKeyHex: data.publicKeyHex,
      publicKey: hexToBytes(data.publicKeyHex),
      secretKey: hexToBytes(data.secretKeyHex),
    };
  }

  private serializeSignedPreKey(key: SignedPreKey): any {
    return {
      keyId: key.keyId,
      keyPair: this.serializeKeyPair(key.keyPair),
      signatureHex: key.signatureHex,
      createdAt: key.createdAt,
    };
  }

  private deserializeSignedPreKey(data: any): SignedPreKey {
    return {
      keyId: data.keyId,
      keyPair: this.deserializeKeyPair(data.keyPair),
      signatureHex: data.signatureHex,
      createdAt: data.createdAt,
    };
  }

  private serializeOneTimePreKey(key: OneTimePreKey): any {
    return {
      keyId: key.keyId,
      keyPair: this.serializeKeyPair(key.keyPair),
    };
  }

  private deserializeOneTimePreKey(data: any): OneTimePreKey {
    return {
      keyId: data.keyId,
      keyPair: this.deserializeKeyPair(data.keyPair),
    };
  }

  private serializeSession(session: SessionRecord): any {
    return {
      ...session,
      localDhKeyPair: this.serializeKeyPair(session.localDhKeyPair),
    };
  }

  private deserializeSession(data: any): SessionRecord {
    return {
      ...data,
      localDhKeyPair: this.deserializeKeyPair(data.localDhKeyPair),
    };
  }
}

