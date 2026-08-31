import { TorConfig } from '../network/types';
import { DatabaseConfig } from '../storage/types';

export type BackgroundFetchResult = 'NEW_DATA' | 'NO_DATA' | 'FAILED' | 'SKIPPED_NO_IDENTITY';

export interface BackgroundSyncConfig {
  torConfig?: Partial<TorConfig>;
  databaseConfig?: DatabaseConfig;
  /** Timeout for Tor bootstrap in milliseconds (default: 20000) */
  bootstrapTimeoutMs?: number;
  /** Duration to listen for queued messages after auth in milliseconds (default: 3000) */
  drainTimeoutMs?: number;
  /** Whether to hide message text and sender in lockscreen notifications */
  privacyMode?: boolean;
}

export interface BackgroundSyncResult {
  status: BackgroundFetchResult;
  messagesReceived: number;
  durationMs: number;
  error?: string;
}

