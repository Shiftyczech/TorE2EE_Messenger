export interface DeviceRecord {
  deviceId: number;
  recipientPubkeyHash: string;
  identityPubkeyHex: string;
  deviceName?: string;
  createdAt: number;
}

export interface OwnDeviceRecord {
  deviceId: number;
  deviceName: string;
  recipientPubkeyHash: string;
  identityPubkeyHex: string;
  createdAt: number;
}

export interface ContactRecord {
  recipientPubkeyHash: string;
  identityPubkeyHex: string;
  signingPubkeyHex: string;
  alias: string | null;
  createdAt: number;
  linkedDevices?: DeviceRecord[];
}

export interface StoredMessage {
  id: string;
  contactPubkeyHash: string;
  senderIdentityHex: string;
  recipientIdentityHex: string;
  body: string;
  timestamp: number;
  isOutgoing: boolean;
  isRead: boolean;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'failed';
  isSyncMessage?: boolean;
}

export interface DatabaseConfig {
  name?: string;
  isMemory?: boolean;
}

export interface IDatabaseDriver {
  execute(sql: string, params?: any[]): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  close(): Promise<void>;
}
