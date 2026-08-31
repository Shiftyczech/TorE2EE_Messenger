import { Curve25519KeyPair } from '../identity/types';

export interface SignedPreKey {
  keyId: number;
  keyPair: Curve25519KeyPair;
  signatureHex: string;
  createdAt: number;
}

export interface OneTimePreKey {
  keyId: number;
  keyPair: Curve25519KeyPair;
}

export interface PreKeyBundle {
  identityKeyHex: string;
  signingKeyHex: string;
  signedPreKey: {
    keyId: number;
    publicKeyHex: string;
    signatureHex: string;
  };
  oneTimePreKey?: {
    keyId: number;
    publicKeyHex: string;
  };
}

export interface EncryptedMessage {
  ephemeralPublicKeyHex: string;
  sequenceNumber: number;
  previousChainLength: number;
  ciphertext: string;
  nonce: string;
  oneTimePreKeyId?: number;
  initialIdentityKeyHex?: string;
  initialEphemeralKeyHex?: string;
}

export interface SessionRecord {
  recipientIdentityKeyHex: string;
  rootKeyHex: string;
  sendChainKeyHex: string | null;
  receiveChainKeyHex: string | null;
  localDhKeyPair: Curve25519KeyPair;
  remoteDhPublicKeyHex: string | null;
  sendSequenceNumber: number;
  receiveSequenceNumber: number;
  previousChainLength: number;
  skippedMessageKeys: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

