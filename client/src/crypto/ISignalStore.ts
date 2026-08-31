import { UserIdentity } from '../identity/types';
import { OneTimePreKey, SessionRecord, SignedPreKey } from './types';

/**
 * Storage adapter interface for Signal Protocol / Double Ratchet state.
 * Enables interchangeable storage engines (InMemory for tests, SQLCipher for production).
 */
export interface ISignalStore {
  /**
   * Retrieves the current user's full identity (Identity Key & Signing Key).
   */
  getIdentity(): Promise<UserIdentity>;

  /**
   * Saves a Signed Pre-Key.
   */
  saveSignedPreKey(keyId: number, preKey: SignedPreKey): Promise<void>;

  /**
   * Loads a Signed Pre-Key by its ID.
   */
  getSignedPreKey(keyId: number): Promise<SignedPreKey | null>;

  /**
   * Gets the latest active Signed Pre-Key.
   */
  getLatestSignedPreKey(): Promise<SignedPreKey | null>;

  /**
   * Saves a One-Time Pre-Key.
   */
  saveOneTimePreKey(keyId: number, preKey: OneTimePreKey): Promise<void>;

  /**
   * Loads a One-Time Pre-Key by its ID.
   */
  getOneTimePreKey(keyId: number): Promise<OneTimePreKey | null>;

  /**
   * Removes a used One-Time Pre-Key (ensures forward secrecy after X3DH).
   */
  removeOneTimePreKey(keyId: number): Promise<void>;

  /**
   * Counts remaining One-Time Pre-Keys.
   */
  countOneTimePreKeys(): Promise<number>;

  /**
   * Saves or updates a session record for a given peer's Curve25519 identity key.
   */
  saveSession(recipientIdentityKeyHex: string, session: SessionRecord): Promise<void>;

  /**
   * Loads an existing session record for a given peer.
   */
  getSession(recipientIdentityKeyHex: string): Promise<SessionRecord | null>;

  /**
   * Checks if an established session exists for a given peer.
   */
  hasSession(recipientIdentityKeyHex: string): Promise<boolean>;

  /**
   * Removes a session.
   */
  removeSession(recipientIdentityKeyHex: string): Promise<void>;
}

