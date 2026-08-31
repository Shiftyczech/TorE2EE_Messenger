import { UserIdentity } from '../identity/types';

/**
 * Status of the local Tor daemon.
 */
export enum TorStatus {
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  BOOTSTRAPPING = 'BOOTSTRAPPING',
  READY = 'READY',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED',
}

/**
 * Detailed Tor bootstrap progress update.
 */
export interface TorBootstrapProgress {
  percentage: number;
  summary: string;
  isReady: boolean;
  error?: string;
}

/**
 * Tor Network Client Configuration.
 */
export interface TorConfig {
  /** SOCKS5 proxy host (typically 127.0.0.1) */
  socksProxyHost: string;
  /** SOCKS5 proxy port (default: 9050) */
  socksProxyPort: number;
  /** Onion v3 address or dev hostname of Relay Server (e.g. "abcdef...onion" or "127.0.0.1") */
  targetHost: string;
  /** Target port of the Relay Server (default: 80 or 8080) */
  targetPort: number;
  /** Whether to enable dev/direct mode (bypasses Tor SOCKS5 during local tests) */
  devMode?: boolean;
}

/**
 * Envelope for sending an encrypted message to the Relay Server.
 */
export interface OutgoingMessageEnvelope {
  recipient_pubkey_hash: string;
  encrypted_payload: string;
  nonce: string;
}

/**
 * Response from Relay Server upon accepting a message.
 */
export interface SendMessageResponse {
  status: string;
  delivered_live: boolean;
}

/**
 * Encrypted payload received from the Relay Server.
 */
export interface IncomingMessagePayload {
  encrypted_payload: string;
  nonce: string;
  created_at: number;
}

/**
 * States of the Tor WebSocket Client lifecycle.
 */
export enum WsClientState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  AWAITING_CHALLENGE = 'AWAITING_CHALLENGE',
  AUTHENTICATING = 'AUTHENTICATING',
  CONNECTED_AUTHENTICATED = 'CONNECTED_AUTHENTICATED',
  RECONNECTING = 'RECONNECTING',
  CLOSED = 'CLOSED',
}

/**
 * Callbacks for WebSocket client events.
 */
export interface TorWebSocketCallbacks {
  onAuthenticated?: (recipientPubkeyHash: string) => void;
  onMessage?: (message: IncomingMessagePayload) => void;
  onStateChange?: (newState: WsClientState) => void;
  onError?: (error: Error) => void;
  onDisconnect?: (reason?: string) => void;
}

/**
 * Protocol messages received from the Relay Server over WebSocket.
 */
export type ServerWsMessage =
  | { type: 'challenge'; challenge: string }
  | { type: 'authenticated'; recipient_pubkey_hash: string }
  | { type: 'message'; encrypted_payload: string; nonce: string; created_at: number }
  | { type: 'pong' }
  | { type: 'error'; message: string };

/**
 * Protocol messages sent to the Relay Server over WebSocket.
 */
export type ClientWsMessage =
  | { type: 'auth'; public_key: string; signature: string }
  | { type: 'ping' };

