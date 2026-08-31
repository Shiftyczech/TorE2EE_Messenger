export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyHex: string;
}

export interface Curve25519KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyHex: string;
}

export interface UserIdentity {
  mnemonic: string;
  signingKey: Ed25519KeyPair;
  encryptionKey: Curve25519KeyPair;
  recipientPubkeyHash: string;
}

export interface PublicIdentity {
  signingPublicKeyHex: string;
  encryptionPublicKeyHex: string;
  recipientPubkeyHash: string;
}

export interface KeychainOptions {
  service?: string;
  accessControl?: string;
  accessible?: string;
}

