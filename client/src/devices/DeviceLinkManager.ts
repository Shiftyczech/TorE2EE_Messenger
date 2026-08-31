import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { IdentityManager } from '../identity/IdentityManager';
import { Curve25519KeyPair, UserIdentity } from '../identity/types';
import { TorHttpClient } from '../network/TorHttpClient';
import { OutgoingMessageEnvelope } from '../network/types';
import { OwnDeviceRecord } from '../storage/types';
import { DeviceLinkQrPayload, DeviceProvisioningPayload } from './types';

export const DEVICE_LINK_URI_SCHEME = 'tore2ee://link';

/**
 * DeviceLinkManager - Handles secure, cryptographic Multi-Device provisioning.
 *
 * CRYPTOGRAPHIC SECURITY ARCHITECTURE:
 * ====================================
 * 1. Out-of-Band Ephemeral Handshake:
 *    - The secondary device (Slave, e.g. PC) generates a fresh, ephemeral Curve25519 keypair.
 *    - The Slave calculates an ephemeral Mailbox Hash (SHA-256 of the ephemeral public key)
 *      and encodes this into a Pairing QR code.
 *    - The Server/Relay sees ONLY the ephemeral hash and cannot correlate it with the master identity.
 *
 * 2. Asymmetric Zero-Knowledge Provisioning Envelope:
 *    - The primary device (Master, Mobile) scans the QR code.
 *    - Master generates its own ephemeral Curve25519 keypair and constructs a DeviceProvisioningPayload.
 *    - Master encrypts the payload using authenticated public-key encryption (nacl.box / Curve25519-XSalsa20-Poly1305)
 *      targeted strictly at the Slave's ephemeral public key.
 *    - Master transmits this encrypted envelope over Tor HTTP to the Slave's ephemeral Mailbox.
 *
 * 3. Slave Initialization:
 *    - Slave polls/listens to its ephemeral Mailbox on Tor, receives the envelope, and decrypts it
 *      using its ephemeral secret key.
 *    - Slave deterministically initializes its state, derives its own unique device identity key,
 *      generates its own Double Ratchet PreKey bundles, and operates as an independent cryptographic peer.
 */
export class DeviceLinkManager {
  /**
   * (Step 1 - Executed on Slave / PC)
   * Generates an ephemeral pairing keypair and formats the Pairing QR URI.
   */
  public static generateLinkQrPayload(deviceName: string = 'Desktop Client'): {
    qrUri: string;
    ephemeralKeyPair: Curve25519KeyPair;
    ephemeralMailboxHash: string;
  } {
    const boxKeyPair = nacl.box.keyPair();
    const ephemeralKeyPair: Curve25519KeyPair = {
      publicKey: boxKeyPair.publicKey,
      secretKey: boxKeyPair.secretKey,
      publicKeyHex: bytesToHex(boxKeyPair.publicKey),
    };

    const ephemeralMailboxHash = bytesToHex(sha256(ephemeralKeyPair.publicKey));

    const payload: DeviceLinkQrPayload = {
      version: 1,
      ephemeralPubkeyHex: ephemeralKeyPair.publicKeyHex,
      ephemeralMailboxHash,
      deviceName,
    };

    const jsonStr = JSON.stringify(payload);
    const base64Data = Buffer.from(jsonStr, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const qrUri = `${DEVICE_LINK_URI_SCHEME}?v=1&d=${base64Data}`;

    return {
      qrUri,
      ephemeralKeyPair,
      ephemeralMailboxHash,
    };
  }

  /**
   * Parses the Pairing QR Code URI.
   */
  public static parseLinkQrUri(uriString: string): DeviceLinkQrPayload {
    let base64Data = uriString.trim();

    if (base64Data.startsWith(DEVICE_LINK_URI_SCHEME)) {
      const queryIndex = base64Data.indexOf('?');
      if (queryIndex !== -1) {
        const query = base64Data.substring(queryIndex + 1);
        const params = new URLSearchParams(query);
        const d = params.get('d');
        if (!d) {
          throw new Error('Invalid device link URI: missing parameter "d"');
        }
        base64Data = d;
      }
    }

    let standardBase64 = base64Data.replace(/-/g, '+').replace(/_/g, '/');
    while (standardBase64.length % 4 !== 0) {
      standardBase64 += '=';
    }

    try {
      const jsonStr = Buffer.from(standardBase64, 'base64').toString('utf8');
      const parsed: DeviceLinkQrPayload = JSON.parse(jsonStr);

      if (!parsed.ephemeralPubkeyHex || !parsed.ephemeralMailboxHash) {
        throw new Error('Invalid device link payload: missing required keys');
      }

      return parsed;
    } catch {
      throw new Error('Failed to parse device link QR code');
    }
  }

  /**
   * (Step 2 - Executed on Master / Mobile)
   * Encrypts the provisioning payload with the Slave's ephemeral public key and dispatches it over Tor.
   */
  public static async provisionSlaveDevice(
    qrUri: string,
    masterIdentity: UserIdentity,
    assignedDeviceId: number,
    httpClient: TorHttpClient
  ): Promise<OwnDeviceRecord> {
    const qrPayload = this.parseLinkQrUri(qrUri);

    const provisioningData: DeviceProvisioningPayload = {
      masterMnemonic: masterIdentity.mnemonic,
      deviceId: assignedDeviceId,
      deviceName: qrPayload.deviceName,
      masterRecipientPubkeyHash: masterIdentity.recipientPubkeyHash,
      timestamp: Date.now(),
    };

    // Master creates ephemeral keypair for authenticated asymmetric box encryption
    const masterEphemeral = nacl.box.keyPair();
    const slaveEphemeralPk = hexToBytes(qrPayload.ephemeralPubkeyHex);
    const nonce = nacl.randomBytes(24);

    const payloadBytes = new TextEncoder().encode(JSON.stringify(provisioningData));
    const encryptedBox = nacl.box(
      payloadBytes,
      nonce,
      slaveEphemeralPk,
      masterEphemeral.secretKey
    );

    const envelopePayload = JSON.stringify({
      masterEphemeralPkHex: bytesToHex(masterEphemeral.publicKey),
      encryptedData: Buffer.from(encryptedBox).toString('base64'),
    });

    const envelope: OutgoingMessageEnvelope = {
      recipient_pubkey_hash: qrPayload.ephemeralMailboxHash,
      encrypted_payload: envelopePayload,
      nonce: bytesToHex(nonce),
    };

    // Send provisioning envelope to Slave's ephemeral mailbox
    await httpClient.sendMessage(envelope);

    const slaveDeviceRecord: OwnDeviceRecord = {
      deviceId: assignedDeviceId,
      deviceName: qrPayload.deviceName,
      recipientPubkeyHash: qrPayload.ephemeralMailboxHash,
      identityPubkeyHex: qrPayload.ephemeralPubkeyHex,
      createdAt: Date.now(),
    };

    return slaveDeviceRecord;
  }

  /**
   * (Step 3 - Executed on Slave / PC)
   * Decrypts the provisioning payload using the Slave's ephemeral private key.
   */
  public static decryptProvisioningPayload(
    envelopePayload: string,
    nonceHex: string,
    slaveSecretKey: Uint8Array
  ): DeviceProvisioningPayload {
    const parsed = JSON.parse(envelopePayload);
    const masterEphemeralPk = hexToBytes(parsed.masterEphemeralPkHex);
    const encryptedBox = Buffer.from(parsed.encryptedData, 'base64');
    const nonce = hexToBytes(nonceHex);

    const decryptedBytes = nacl.box.open(
      encryptedBox,
      nonce,
      masterEphemeralPk,
      slaveSecretKey
    );

    if (!decryptedBytes) {
      throw new Error('Failed to decrypt provisioning payload: MAC check failed');
    }

    const jsonStr = new TextDecoder().decode(decryptedBytes);
    return JSON.parse(jsonStr);
  }
}

