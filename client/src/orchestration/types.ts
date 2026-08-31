import { PreKeyBundle } from '../crypto/types';
import { TorConfig, TorStatus, WsClientState } from '../network/types';
import { DatabaseConfig, StoredMessage } from '../storage/types';

/**
 * QR Code / Contact URI Export Payload structure.
 */
export interface ContactExportPayload {
  /** Contact's Ed25519 Signing Public Key (Hex) */
  signingKeyHex: string;
  /** Contact's Curve25519 Identity Public Key (Hex) */
  identityKeyHex: string;
  /** Signed Pre-Key information with Ed25519 signature */
  signedPreKey: {
    keyId: number;
    publicKeyHex: string;
    signatureHex: string;
  };
  /** Optional One-Time Pre-Key */
  oneTimePreKey?: {
    keyId: number;
    publicKeyHex: string;
  };
  /** Suggested display alias */
  alias?: string;
}

/**
 * Event callbacks emitted by AppOrchestrator for reactive UI updates.
 */
export interface OrchestratorEvents {
  onMessageReceived?: (message: StoredMessage) => void;
  onMessageSent?: (message: StoredMessage) => void;
  onMessageStatusChanged?: (
    messageId: string,
    status: StoredMessage['deliveryStatus']
  ) => void;
  onTorStatusChanged?: (status: TorStatus) => void;
  onWsStateChanged?: (state: WsClientState) => void;
  onError?: (error: Error) => void;
}

/**
 * Configuration options for initializing the AppOrchestrator.
 */
export interface AppOrchestratorConfig {
  torConfig: TorConfig;
  databaseConfig?: DatabaseConfig;
  events?: OrchestratorEvents;
}

