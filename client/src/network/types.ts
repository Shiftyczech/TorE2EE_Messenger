export enum TorStatus {
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  BOOTSTRAPPING = 'BOOTSTRAPPING',
  READY = 'READY',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED',
}

export interface TorBootstrapProgress {
  percentage: number;
  summary: string;
  isReady: boolean;
  error?: string;
}

export interface TorConfig {
  socksProxyHost: string;
  socksProxyPort: number;
  targetHost: string;
  targetPort: number;
  devMode?: boolean;
}

export interface OutgoingMessageEnvelope {
  recipient_pubkey_hash: string;
  encrypted_payload: string;
  nonce: string;
}

export interface SendMessageResponse {
  status: string;
  delivered_live: boolean;
}

export interface IncomingMessagePayload {
  encrypted_payload: string;
  nonce: string;
  created_at: number;
}

export enum WsClientState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  AWAITING_CHALLENGE = 'AWAITING_CHALLENGE',
  AUTHENTICATING = 'AUTHENTICATING',
  CONNECTED_AUTHENTICATED = 'CONNECTED_AUTHENTICATED',
  RECONNECTING = 'RECONNECTING',
  CLOSED = 'CLOSED',
}

export interface TorWebSocketCallbacks {
  onAuthenticated?: (recipientPubkeyHash: string) => void;
  onMessage?: (message: IncomingMessagePayload) => void;
  onStateChange?: (newState: WsClientState) => void;
  onError?: (error: Error) => void;
  onDisconnect?: (reason?: string) => void;
}

export type ServerWsMessage =
  | { type: 'challenge'; challenge: string }
  | { type: 'authenticated'; recipient_pubkey_hash: string }
  | { type: 'message'; encrypted_payload: string; nonce: string; created_at: number }
  | { type: 'pong' }
  | { type: 'error'; message: string };

export type ClientWsMessage =
  | { type: 'auth'; public_key: string; signature: string }
  | { type: 'ping' };

