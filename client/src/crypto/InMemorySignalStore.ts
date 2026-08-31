import { UserIdentity } from '../identity/types';
import { ISignalStore } from './ISignalStore';
import { OneTimePreKey, SessionRecord, SignedPreKey } from './types';

export class InMemorySignalStore implements ISignalStore {
  private identity: UserIdentity;
  private signedPreKeys: Map<number, SignedPreKey> = new Map();
  private oneTimePreKeys: Map<number, OneTimePreKey> = new Map();
  private sessions: Map<string, SessionRecord> = new Map();

  constructor(identity: UserIdentity) {
    this.identity = identity;
  }

  public async getIdentity(): Promise<UserIdentity> {
    return this.identity;
  }

  public async saveSignedPreKey(keyId: number, preKey: SignedPreKey): Promise<void> {
    this.signedPreKeys.set(keyId, preKey);
  }

  public async getSignedPreKey(keyId: number): Promise<SignedPreKey | null> {
    return this.signedPreKeys.get(keyId) || null;
  }

  public async getLatestSignedPreKey(): Promise<SignedPreKey | null> {
    let latest: SignedPreKey | null = null;
    for (const key of Array.from(this.signedPreKeys.values())) {
      if (!latest || key.createdAt > latest.createdAt) {
        latest = key;
      }
    }
    return latest;
  }

  public async saveOneTimePreKey(keyId: number, preKey: OneTimePreKey): Promise<void> {
    this.oneTimePreKeys.set(keyId, preKey);
  }

  public async getOneTimePreKey(keyId: number): Promise<OneTimePreKey | null> {
    return this.oneTimePreKeys.get(keyId) || null;
  }

  public async removeOneTimePreKey(keyId: number): Promise<void> {
    this.oneTimePreKeys.delete(keyId);
  }

  public async countOneTimePreKeys(): Promise<number> {
    return this.oneTimePreKeys.size;
  }

  public async saveSession(
    recipientIdentityKeyHex: string,
    session: SessionRecord
  ): Promise<void> {
    this.sessions.set(recipientIdentityKeyHex.toLowerCase(), session);
  }

  public async getSession(
    recipientIdentityKeyHex: string
  ): Promise<SessionRecord | null> {
    return this.sessions.get(recipientIdentityKeyHex.toLowerCase()) || null;
  }

  public async hasSession(recipientIdentityKeyHex: string): Promise<boolean> {
    return this.sessions.has(recipientIdentityKeyHex.toLowerCase());
  }

  public async removeSession(recipientIdentityKeyHex: string): Promise<void> {
    this.sessions.delete(recipientIdentityKeyHex.toLowerCase());
  }
}

