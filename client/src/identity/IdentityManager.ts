import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  Curve25519KeyPair,
  Ed25519KeyPair,
  PublicIdentity,
  UserIdentity,
} from './types';

export const KEYCHAIN_DEFAULT_SERVICE = 'tore2ee.identity.keys';

function getKeychainModule(): any {
  try {
    return require('react-native-keychain');
  } catch {
    return null;
  }
}

export class IdentityManager {
  public static async generateIdentity(
    wordCount: 12 | 24 = 12
  ): Promise<UserIdentity> {
    try {
      const strength = wordCount === 24 ? 256 : 128;
      const mnemonic = bip39.generateMnemonic(strength);
      return await this.deriveIdentityFromMnemonic(mnemonic);
    } catch (error) {
      throw new Error(`Failed to generate identity: ${(error as Error).message}`);
    }
  }

  public static async restoreIdentity(mnemonic: string): Promise<UserIdentity> {
    const trimmed = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid BIP-39 mnemonic phrase or checksum mismatch');
    }
    return await this.deriveIdentityFromMnemonic(trimmed);
  }

  private static async deriveIdentityFromMnemonic(
    mnemonic: string
  ): Promise<UserIdentity> {
    const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
    const seed = new Uint8Array(seedBuffer);

    const ed25519Seed = seed.subarray(0, 32);
    const naclSignKeyPair = nacl.sign.keyPair.fromSeed(ed25519Seed);

    const signingKey: Ed25519KeyPair = {
      publicKey: naclSignKeyPair.publicKey,
      secretKey: naclSignKeyPair.secretKey,
      publicKeyHex: bytesToHex(naclSignKeyPair.publicKey),
    };

    const curve25519Secret = seed.subarray(32, 64);
    const naclBoxKeyPair = nacl.box.keyPair.fromSecretKey(curve25519Secret);

    const encryptionKey: Curve25519KeyPair = {
      publicKey: naclBoxKeyPair.publicKey,
      secretKey: naclBoxKeyPair.secretKey,
      publicKeyHex: bytesToHex(naclBoxKeyPair.publicKey),
    };

    const recipientPubkeyHash = this.computePubkeyHash(signingKey.publicKey);

    return {
      mnemonic,
      signingKey,
      encryptionKey,
      recipientPubkeyHash,
    };
  }

  public static computePubkeyHash(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) {
      throw new Error('Public key must be exactly 32 bytes');
    }
    const hashBytes = sha256(publicKey);
    return bytesToHex(hashBytes);
  }

  public static getPublicIdentity(identity: UserIdentity): PublicIdentity {
    return {
      signingPublicKeyHex: identity.signingKey.publicKeyHex,
      encryptionPublicKeyHex: identity.encryptionKey.publicKeyHex,
      recipientPubkeyHash: identity.recipientPubkeyHash,
    };
  }

  public static signChallenge(
    challengeHex: string,
    secretKey: Uint8Array
  ): string {
    if (secretKey.length !== 64) {
      throw new Error('Ed25519 secret key must be exactly 64 bytes');
    }
    const challengeBytes = hexToBytes(challengeHex);
    if (challengeBytes.length !== 32) {
      throw new Error('Challenge nonce must be exactly 32 bytes');
    }

    const signatureBytes = nacl.sign.detached(challengeBytes, secretKey);
    return bytesToHex(signatureBytes);
  }

  public static verifySignature(
    challengeHex: string,
    signatureHex: string,
    publicKeyHex: string
  ): boolean {
    try {
      const challengeBytes = hexToBytes(challengeHex);
      const signatureBytes = hexToBytes(signatureHex);
      const publicKeyBytes = hexToBytes(publicKeyHex);
      return nacl.sign.detached.verify(
        challengeBytes,
        signatureBytes,
        publicKeyBytes
      );
    } catch {
      return false;
    }
  }

  public static async saveIdentityToKeychain(
    identity: UserIdentity,
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<boolean> {
    const Keychain = getKeychainModule();
    if (!Keychain) {
      return true;
    }

    try {
      const payload = JSON.stringify({ mnemonic: identity.mnemonic });
      const result = await Keychain.setGenericPassword('identity', payload, {
        service,
        accessible: Keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL?.SECURE_HARDWARE,
      });
      return typeof result === 'object' && result !== null;
    } catch (error) {
      throw new Error(
        `Failed to save identity to Keychain: ${(error as Error).message}`
      );
    }
  }

  public static async loadIdentityFromKeychain(
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<UserIdentity | null> {
    const Keychain = getKeychainModule();
    if (!Keychain) {
      return null;
    }

    try {
      const credentials = await Keychain.getGenericPassword({ service });
      if (!credentials || !credentials.password) {
        return null;
      }

      const parsed = JSON.parse(credentials.password);
      if (!parsed || !parsed.mnemonic) {
        return null;
      }

      return await this.restoreIdentity(parsed.mnemonic);
    } catch (error) {
      throw new Error(
        `Failed to load identity from Keychain: ${(error as Error).message}`
      );
    }
  }

  public static async clearIdentityFromKeychain(
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<boolean> {
    const Keychain = getKeychainModule();
    if (!Keychain) {
      return true;
    }

    try {
      return await Keychain.resetGenericPassword({ service });
    } catch (error) {
      throw new Error(
        `Failed to clear identity from Keychain: ${(error as Error).message}`
      );
    }
  }
}

