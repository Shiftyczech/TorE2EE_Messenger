export interface DeviceLinkQrPayload {
  version: number;
  ephemeralPubkeyHex: string;
  ephemeralMailboxHash: string;
  deviceName: string;
}

export interface DeviceProvisioningPayload {
  masterMnemonic: string;
  deviceId: number;
  deviceName: string;
  masterRecipientPubkeyHash: string;
  timestamp: number;
}

export interface DeviceSyncPayload {
  isSyncMessage: true;
  originalRecipientHash: string;
  body: string;
  timestamp: number;
  messageId: string;
}

