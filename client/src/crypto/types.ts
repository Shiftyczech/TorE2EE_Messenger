import { Curve25519KeyPair, Ed25519KeyPair } from '../identity/types';

/**
 * A Signed Pre-Key for X3DH key agreement.
 */
export interface SignedPreKey {
  keyId: number;
  keyPair: Curve25519KeyPair;
  signatureHex: string;
  createdAt: number;
}

/**
 * A One-Time Pre-Key for X3DH key agreement.
 */
export interface OneTimePreKey {
  keyId: number;
  keyPair: Curve25519KeyPair;
}

/**
 * Public bundle published/shared for initiating an X3DH E2EE session.
 */
export interface PreKeyBundle {
  /** Sender's Curve25519 Identity Public Key (Hex) */
  identityKeyHex: string;
  /** Sender's Ed25519 Signing Public Key (Hex) */
  signingKeyHex: string;
  /** Signed Pre-Key information */
  signedPreKey: {
    keyId: number;
    publicKeyHex: string;
    signatureHex: string;
  };
  /** Optional One-Time Pre-Key information */
  oneTimePreKey?: {
    keyId: number;
    publicKeyHex: string;
  };
}

/**
 * An encrypted message payload produced by the Double Ratchet.
 */
export interface EncryptedMessage {
  /** Ephemeral DH Ratchet public key (Hex) */
  ephemeralPublicKeyHex: string;
  /** Message sequence number within the current symmetric chain (Ns) */
  sequenceNumber: number;
  /** Length of the previous sending chain (Pn) for skipped key indexing */
  previousChainLength: number;
  /** Encrypted ciphertext payload (Base64) */
  ciphertext: string;
  /** 24-byte crypto nonce (Hex) */
  nonce: string;
  /** ID of the One-Time PreKey used (present in initial X3DH message) */
  oneTimePreKeyId?: number;
  /** Sender's Curve25519 Identity Key (present in initial X3DH message) */
  initialIdentityKeyHex?: string;
  /** Sender's ephemeral key used in initial X3DH */
  initialEphemeralKeyHex?: string;
}

/**
 * Serialized Double Ratchet session state.
 */
export interface SessionRecord {
  /** The recipient's Curve25519 Identity Key (Hex) */
  recipientIdentityKeyHex: string;
  /** Master 32-byte root key (Hex) */
  rootKeyHex: string;
  /** Current 32-byte sending chain key (Hex) */
  sendChainKeyHex: string | null;
  /** Current 32-byte receiving chain key (Hex) */
  receiveChainKeyHex: string | null;
  /** Local current DH Ratchet keypair */
  localDhKeyPair: Curve25519KeyPair;
  /** Remote current DH Ratchet public key (Hex) */
  remoteDhPublicKeyHex: string | null;
  /** Number of messages sent in current chain */
  sendSequenceNumber: number;
  /** Number of messages received in current chain */
  receiveSequenceNumber: number;
  /** Length of previous sending chain */
  previousChainLength: number;
  /** Map of skipped message keys: "remoteDhPubHex:sequenceNum" -> messageKeyHex */
  skippedMessageKeys: Record<string, string>;
  /** Timestamp when session was established */
  createdAt: number;
  /** Timestamp when session was last active */
  updatedAt: number;
}

