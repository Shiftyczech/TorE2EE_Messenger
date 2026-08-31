/**
 * Keypair used for Ed25519 cryptographic signatures and Relay Server authentication.
 */
export interface Ed25519KeyPair {
  /** 32-byte public key */
  publicKey: Uint8Array;
  /** 64-byte secret/signing key (tweetnacl format: 32B seed + 32B public key) */
  secretKey: Uint8Array;
  /** Hex-encoded 32-byte public key */
  publicKeyHex: string;
}

/**
 * Keypair used for Curve25519 / X25519 Diffie-Hellman and Signal Protocol E2EE.
 */
export interface Curve25519KeyPair {
  /** 32-byte public key */
  publicKey: Uint8Array;
  /** 32-byte private key */
  secretKey: Uint8Array;
  /** Hex-encoded 32-byte public key */
  publicKeyHex: string;
}

/**
 * Full User Identity derived deterministically from a BIP-39 seed phrase.
 */
export interface UserIdentity {
  /** 12 or 24 word mnemonic phrase */
  mnemonic: string;
  /** Ed25519 keypair for identity, challenge-response auth and signing */
  signingKey: Ed25519KeyPair;
  /** Curve25519/X25519 keypair for E2EE box encryption */
  encryptionKey: Curve25519KeyPair;
  /** 64-character SHA-256 hash of the Ed25519 public key (Mailbox ID on Relay) */
  recipientPubkeyHash: string;
}

/**
 * Public portion of user identity shareable with contacts / QR codes.
 */
export interface PublicIdentity {
  signingPublicKeyHex: string;
  encryptionPublicKeyHex: string;
  recipientPubkeyHash: string;
}

/**
 * Configuration options for Keychain storage operations.
 */
export interface KeychainOptions {
  service?: string;
  accessControl?: string;
  accessible?: string;
}

