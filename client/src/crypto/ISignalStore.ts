import { UserIdentity } from '../identity/types';
import { OneTimePreKey, SessionRecord, SignedPreKey } from './types';

export interface ISignalStore {
  getIdentity(): Promise<UserIdentity>;
  saveSignedPreKey(keyId: number, preKey: SignedPreKey): Promise<void>;
  getSignedPreKey(keyId: number): Promise<SignedPreKey | null>;
  getLatestSignedPreKey(): Promise<SignedPreKey | null>;
  saveOneTimePreKey(keyId: number, preKey: OneTimePreKey): Promise<void>;
  getOneTimePreKey(keyId: number): Promise<OneTimePreKey | null>;
  removeOneTimePreKey(keyId: number): Promise<void>;
  countOneTimePreKeys(): Promise<number>;
  saveSession(recipientIdentityKeyHex: string, session: SessionRecord): Promise<void>;
  getSession(recipientIdentityKeyHex: string): Promise<SessionRecord | null>;
  hasSession(recipientIdentityKeyHex: string): Promise<boolean>;
  removeSession(recipientIdentityKeyHex: string): Promise<void>;
}

