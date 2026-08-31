import * as bip39 from 'bip39';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as Keychain from 'react-native-keychain';
import {
  Curve25519KeyPair,
  Ed25519KeyPair,
  PublicIdentity,
  UserIdentity,
} from './types';

export const KEYCHAIN_DEFAULT_SERVICE = 'tore2ee.identity.keys';

export class IdentityManager {
  /**
   * Generates a brand new UserIdentity from a randomly generated BIP-39 mnemonic.
   * @param wordCount Number of words in the seed phrase (default: 12 words / 128-bit entropy)
   */
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

  /**
   * Restores an existing UserIdentity deterministically from a BIP-39 mnemonic.
   * @param mnemonic 12 or 24 word mnemonic phrase
   */
  public static async restoreIdentity(mnemonic: string): Promise<UserIdentity> {
    const trimmed = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!bip39.validateMnemonic(trimmed)) {
      throw new Error('Invalid BIP-39 mnemonic phrase or checksum mismatch');
    }
    return await this.deriveIdentityFromMnemonic(trimmed);
  }

  /**
   * Derives Ed25519 (auth/signing) and Curve25519 (E2EE) keypairs deterministically from a mnemonic.
   */
  private static async deriveIdentityFromMnemonic(
    mnemonic: string
  ): Promise<UserIdentity> {
    // 1. Derive 64-byte seed from mnemonic (BIP-39 standard PBKDF2)
    const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
    const seed = new Uint8Array(seedBuffer);

    // 2. Derive Ed25519 KeyPair from first 32 bytes of the seed
    const ed25519Seed = seed.subarray(0, 32);
    const naclSignKeyPair = nacl.sign.keyPair.fromSeed(ed25519Seed);

    const signingKey: Ed25519KeyPair = {
      publicKey: naclSignKeyPair.publicKey,
      secretKey: naclSignKeyPair.secretKey,
      publicKeyHex: bytesToHex(naclSignKeyPair.publicKey),
    };

    // 3. Derive Curve25519/X25519 KeyPair from next 32 bytes of the seed
    const curve25519Secret = seed.subarray(32, 64);
    const naclBoxKeyPair = nacl.box.keyPair.fromSecretKey(curve25519Secret);

    const encryptionKey: Curve25519KeyPair = {
      publicKey: naclBoxKeyPair.publicKey,
      secretKey: naclBoxKeyPair.secretKey,
      publicKeyHex: bytesToHex(naclBoxKeyPair.publicKey),
    };

    // 4. Compute SHA-256 hash of Ed25519 public key (Mailbox ID on Rust Relay)
    const recipientPubkeyHash = this.computePubkeyHash(signingKey.publicKey);

    return {
      mnemonic,
      signingKey,
      encryptionKey,
      recipientPubkeyHash,
    };
  }

  /**
   * Computes the 64-char hex SHA-256 hash of an Ed25519 public key.
   * Matches the Relay Server's mailbox indexing logic.
   */
  public static computePubkeyHash(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) {
      throw new Error('Public key must be exactly 32 bytes');
    }
    const hashBytes = sha256(publicKey);
    return bytesToHex(hashBytes);
  }

  /**
   * Extracts the public, shareable portion of an identity.
   */
  public static getPublicIdentity(identity: UserIdentity): PublicIdentity {
    return {
      signingPublicKeyHex: identity.signingKey.publicKeyHex,
      encryptionPublicKeyHex: identity.encryptionKey.publicKeyHex,
      recipientPubkeyHash: identity.recipientPubkeyHash,
    };
  }

  /**
   * Signs a server challenge nonce (hex string) using the Ed25519 secret key.
   * Produces a 64-byte detached signature as a 128-char hex string.
   */
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

  /**
   * Verifies an Ed25519 detached signature for a challenge.
   */
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

  /**
   * Securely saves the identity mnemonic into hardware-backed Keychain / Keystore.
   */
  public static async saveIdentityToKeychain(
    identity: UserIdentity,
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<boolean> {
    try {
      const payload = JSON.stringify({ mnemonic: identity.mnemonic });
      const result = await Keychain.setGenericPassword('identity', payload, {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
      });
      return typeof result === 'object' && result !== null;
    } catch (error) {
      throw new Error(
        `Failed to save identity to Keychain: ${(error as Error).message}`
      );
    }
  }

  /**
   * Loads the identity from Keychain / Keystore and reconstructs the full UserIdentity.
   * Returns null if no identity is saved.
   */
  public static async loadIdentityFromKeychain(
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<UserIdentity | null> {
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

  /**
   * Clears any saved identity from the Keychain / Keystore (for logout / secure wipe).
   */
  public static async clearIdentityFromKeychain(
    service: string = KEYCHAIN_DEFAULT_SERVICE
  ): Promise<boolean> {
    try {
      return await Keychain.resetGenericPassword({ service });
    } catch (error) {
      throw new Error(
        `Failed to clear identity from Keychain: ${(error as Error).message}`
      );
    }
  }
}

