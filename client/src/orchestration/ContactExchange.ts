import { hexToBytes } from '@noble/hashes/utils';
import { CryptoEngine } from '../crypto/CryptoEngine';
import { PreKeyBundle } from '../crypto/types';
import { IdentityManager } from '../identity/IdentityManager';
import { ContactRepository } from '../storage/ContactRepository';
import { ContactRecord } from '../storage/types';
import { ContactExportPayload } from './types';

export const CONTACT_URI_SCHEME = 'tore2ee://contact';

export class ContactExchange {
  /**
   * Generates a compact, URL-safe contact URI for QR code generation.
   */
  public static exportContactUri(
    bundle: PreKeyBundle,
    alias?: string
  ): string {
    const payload: ContactExportPayload = {
      signingKeyHex: bundle.signingKeyHex,
      identityKeyHex: bundle.identityKeyHex,
      signedPreKey: bundle.signedPreKey,
      oneTimePreKey: bundle.oneTimePreKey,
      alias,
    };

    const jsonStr = JSON.stringify(payload);
    const base64Data = Buffer.from(jsonStr, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `${CONTACT_URI_SCHEME}?v=1&d=${base64Data}`;
  }

  /**
   * Parses a contact URI or Base64 QR code string and cryptographically verifies the Signed PreKey signature.
   */
  public static parseContactUri(uriString: string): {
    payload: ContactExportPayload;
    recipientPubkeyHash: string;
    bundle: PreKeyBundle;
  } {
    let base64Data = uriString.trim();

    if (base64Data.startsWith(CONTACT_URI_SCHEME)) {
      const queryIndex = base64Data.indexOf('?');
      if (queryIndex !== -1) {
        const query = base64Data.substring(queryIndex + 1);
        const params = new URLSearchParams(query);
        const d = params.get('d');
        if (!d) {
          throw new Error('Invalid contact URI: missing payload parameter "d"');
        }
        base64Data = d;
      }
    }

    // Restore standard base64 from URL-safe base64
    let standardBase64 = base64Data.replace(/-/g, '+').replace(/_/g, '/');
    while (standardBase64.length % 4 !== 0) {
      standardBase64 += '=';
    }

    let payload: ContactExportPayload;
    try {
      const jsonStr = Buffer.from(standardBase64, 'base64').toString('utf8');
      payload = JSON.parse(jsonStr);
    } catch {
      throw new Error('Failed to parse contact payload: invalid base64 or JSON structure');
    }

    // Validate required fields
    if (
      !payload.signingKeyHex ||
      !payload.identityKeyHex ||
      !payload.signedPreKey ||
      !payload.signedPreKey.publicKeyHex ||
      !payload.signedPreKey.signatureHex
    ) {
      throw new Error('Contact payload is missing required cryptographic keys');
    }

    // Cryptographically verify Ed25519 signature over the Signed PreKey
    const isSignatureValid = IdentityManager.verifySignature(
      payload.signedPreKey.publicKeyHex,
      payload.signedPreKey.signatureHex,
      payload.signingKeyHex
    );

    if (!isSignatureValid) {
      throw new Error(
        'Cryptographic verification failed: Signed PreKey signature does not match Signing Key'
      );
    }

    // Compute mailbox recipient pubkey hash
    const signingKeyBytes = hexToBytes(payload.signingKeyHex);
    const recipientPubkeyHash = IdentityManager.computePubkeyHash(signingKeyBytes);

    const bundle: PreKeyBundle = {
      identityKeyHex: payload.identityKeyHex,
      signingKeyHex: payload.signingKeyHex,
      signedPreKey: payload.signedPreKey,
      oneTimePreKey: payload.oneTimePreKey,
    };

    return {
      payload,
      recipientPubkeyHash,
      bundle,
    };
  }

  /**
   * Imports a contact from URI, verifies the signature, stores in ContactRepository and establishes the Double Ratchet session.
   */
  public static async importContact(
    uriString: string,
    contactRepo: ContactRepository,
    cryptoEngine: CryptoEngine,
    customAlias?: string
  ): Promise<ContactRecord> {
    const { payload, recipientPubkeyHash, bundle } = this.parseContactUri(uriString);

    const contact: ContactRecord = {
      recipientPubkeyHash,
      identityPubkeyHex: payload.identityKeyHex,
      signingPubkeyHex: payload.signingKeyHex,
      alias: customAlias || payload.alias || null,
      createdAt: Date.now(),
    };

    // Save contact record in SQLite
    await contactRepo.saveContact(contact);

    // Initialize initial Double Ratchet / X3DH session
    await cryptoEngine.initiateSession(contact.identityPubkeyHex, bundle);

    return contact;
  }
}

