import { IdentityManager } from '../../identity/IdentityManager';
import { DeviceLinkManager } from '../DeviceLinkManager';
import { TorHttpClient } from '../../network/TorHttpClient';
import { OutgoingMessageEnvelope, SendMessageResponse } from '../../network/types';

describe('DeviceLinkManager', () => {
  it('generates a valid pairing QR URI and parses it correctly', () => {
    const { qrUri, ephemeralKeyPair, ephemeralMailboxHash } =
      DeviceLinkManager.generateLinkQrPayload('Linux Desktop');

    expect(qrUri).toContain('tore2ee://link?v=1&d=');

    const parsed = DeviceLinkManager.parseLinkQrUri(qrUri);
    expect(parsed.version).toBe(1);
    expect(parsed.deviceName).toBe('Linux Desktop');
    expect(parsed.ephemeralPubkeyHex).toBe(ephemeralKeyPair.publicKeyHex);
    expect(parsed.ephemeralMailboxHash).toBe(ephemeralMailboxHash);
  });

  it('provisions slave device with asymmetric authenticated encryption and decrypts successfully', async () => {
    // 1. Slave generates pairing QR
    const slavePairing = DeviceLinkManager.generateLinkQrPayload('MacBook Pro');

    // 2. Master identity
    const masterIdentity = await IdentityManager.generateIdentity();

    // Mock HTTP client to capture provisioning envelope
    let capturedEnvelope: OutgoingMessageEnvelope | null = null;
    const mockHttpClient = {
      sendMessage: async (envelope: OutgoingMessageEnvelope): Promise<SendMessageResponse> => {
        capturedEnvelope = envelope;
        return { status: 'accepted', delivered_live: false };
      },
    } as unknown as TorHttpClient;

    // 3. Master provisions Slave
    const slaveDeviceRecord = await DeviceLinkManager.provisionSlaveDevice(
      slavePairing.qrUri,
      masterIdentity,
      2,
      mockHttpClient
    );

    expect(slaveDeviceRecord.deviceId).toBe(2);
    expect(slaveDeviceRecord.deviceName).toBe('MacBook Pro');
    expect(capturedEnvelope).not.toBeNull();
    expect(capturedEnvelope!.recipient_pubkey_hash).toBe(slavePairing.ephemeralMailboxHash);

    // 4. Slave receives envelope and decrypts payload
    const decryptedPayload = DeviceLinkManager.decryptProvisioningPayload(
      capturedEnvelope!.encrypted_payload,
      capturedEnvelope!.nonce,
      slavePairing.ephemeralKeyPair.secretKey
    );

    expect(decryptedPayload.deviceId).toBe(2);
    expect(decryptedPayload.deviceName).toBe('MacBook Pro');
    expect(decryptedPayload.masterMnemonic).toBe(masterIdentity.mnemonic);
    expect(decryptedPayload.masterRecipientPubkeyHash).toBe(masterIdentity.recipientPubkeyHash);
  });
});

