import * as net from 'net';
import * as crypto from 'crypto';
import { Socks5Tunnel } from './Socks5Tunnel';
import { IdentityManager } from '../identity/IdentityManager';
import { UserIdentity } from '../identity/types';
import {
  ClientWsMessage,
  IncomingMessagePayload,
  ServerWsMessage,
  TorConfig,
  TorWebSocketCallbacks,
  WsClientState,
} from './types';

export class TorWebSocketClient {
  private config: TorConfig;
  private identity: UserIdentity;
  private callbacks: TorWebSocketCallbacks;
  private state: WsClientState = WsClientState.DISCONNECTED;
  private socket: net.Socket | null = null;
  private autoReconnect: boolean = true;
  private reconnectAttempts: number = 0;
  private maxReconnectDelayMs: number = 30000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingIntervalTimer: NodeJS.Timeout | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    config: TorConfig,
    identity: UserIdentity,
    callbacks: TorWebSocketCallbacks = {}
  ) {
    this.config = config;
    this.identity = identity;
    this.callbacks = callbacks;
  }

  public getState(): WsClientState {
    return this.state;
  }

  public setCallbacks(callbacks: TorWebSocketCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  private setState(newState: WsClientState): void {
    this.state = newState;
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(newState);
    }
  }

  /**
   * Connects to the Relay Server's WebSocket stream over Tor.
   */
  public async connect(): Promise<void> {
    if (
      this.state === WsClientState.CONNECTING ||
      this.state === WsClientState.CONNECTED_AUTHENTICATED
    ) {
      return;
    }

    this.autoReconnect = true;
    this.setState(WsClientState.CONNECTING);

    try {
      // 1. Establish TCP socket via SOCKS5 proxy (or direct if devMode)
      if (this.config.devMode) {
        this.socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection(
            { host: this.config.targetHost, port: this.config.targetPort },
            () => resolve(s)
          );
          s.on('error', reject);
        });
      } else {
        this.socket = await Socks5Tunnel.connectViaSocks5(
          this.config.socksProxyHost,
          this.config.socksProxyPort,
          this.config.targetHost,
          this.config.targetPort,
          30000
        );
      }

      // 2. Perform HTTP Upgrade to WebSocket
      const leftover = await this.performWebSocketUpgrade();
      this.setState(WsClientState.AWAITING_CHALLENGE);

      // 3. Setup WebSocket frame processing
      this.setupSocketHandlers();

      if (leftover && leftover.length > 0) {
        this.handleRawData(leftover);
      }

      this.reconnectAttempts = 0;
    } catch (error) {
      this.handleConnectionFailure(error as Error);
    }
  }

  /**
   * Performs the HTTP -> WebSocket upgrade handshake (RFC 6455).
   * Returns any leftover bytes after the HTTP headers.
   */
  private performWebSocketUpgrade(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        return reject(new Error('Socket not available'));
      }

      const secWebSocketKey = crypto.randomBytes(16).toString('base64');
      const upgradeReq =
        `GET /api/v1/stream HTTP/1.1\r\n` +
        `Host: ${this.config.targetHost}:${this.config.targetPort}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${secWebSocketKey}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`;

      let rawBytes = Buffer.alloc(0);

      const onHandshakeData = (chunk: Buffer) => {
        rawBytes = Buffer.concat([rawBytes, chunk]);
        const headerEnd = rawBytes.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd !== -1) {
          this.socket?.removeListener('data', onHandshakeData);
          const headerString = rawBytes.subarray(0, headerEnd).toString('utf8');

          if (headerString.startsWith('HTTP/1.1 101')) {
            const leftover = rawBytes.subarray(headerEnd + 4);
            resolve(leftover);
          } else {
            reject(new Error(`WebSocket upgrade rejected: ${headerString}`));
          }
        }
      };

      this.socket.on('data', onHandshakeData);
      this.socket.write(Buffer.from(upgradeReq, 'utf8'));
    });
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('data', (chunk: Buffer) => {
      this.handleRawData(chunk);
    });

    this.socket.on('close', () => {
      this.cleanupTimers();
      if (this.state !== WsClientState.CLOSED && this.state !== WsClientState.DISCONNECTED) {
        if (this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect('Socket connection closed');
        }
        if (this.autoReconnect) {
          this.scheduleReconnect();
        } else {
          this.setState(WsClientState.DISCONNECTED);
        }
      }
    });

    this.socket.on('error', (err) => {
      if (this.callbacks.onError) {
        this.callbacks.onError(err);
      }
    });
  }

  /**
   * Parses RFC 6455 frames from the raw byte stream.
   */
  private handleRawData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const _fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLen = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (this.buffer.length < offset + 8) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey: Buffer | null = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) {
        return; // Wait for full frame
      }

      let payload = this.buffer.subarray(offset, offset + payloadLen);
      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (isMasked && maskKey) {
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      this.processFrame(opcode, payload);
    }
  }

  private processFrame(opcode: number, payload: Buffer): void {
    switch (opcode) {
      case 0x01: // Text frame
        const text = payload.toString('utf8');
        this.handleTextMessage(text);
        break;
      case 0x08: // Close frame
        this.disconnect();
        break;
      case 0x09: // Ping frame -> send Pong
        this.sendRawFrame(0x0a, payload);
        break;
      case 0x0a: // Pong frame
        break;
      default:
        break;
    }
  }

  /**
   * Handles high-level TorE2EE protocol JSON messages.
   */
  private handleTextMessage(text: string): void {
    try {
      const msg: ServerWsMessage = JSON.parse(text);

      switch (msg.type) {
        case 'challenge':
          this.handleServerChallenge(msg.challenge);
          break;
        case 'authenticated':
          this.setState(WsClientState.CONNECTED_AUTHENTICATED);
          this.startPingKeepAlive();
          if (this.callbacks.onAuthenticated) {
            this.callbacks.onAuthenticated(msg.recipient_pubkey_hash);
          }
          break;
        case 'message':
          if (this.callbacks.onMessage) {
            this.callbacks.onMessage({
              encrypted_payload: msg.encrypted_payload,
              nonce: msg.nonce,
              created_at: msg.created_at,
            });
          }
          break;
        case 'pong':
          break;
        case 'error':
          if (this.callbacks.onError) {
            this.callbacks.onError(new Error(`Server error: ${msg.message}`));
          }
          break;
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  /**
   * Handles the authentication challenge by signing it with Ed25519 and replying.
   */
  private handleServerChallenge(challengeHex: string): void {
    try {
      this.setState(WsClientState.AUTHENTICATING);

      const signatureHex = IdentityManager.signChallenge(
        challengeHex,
        this.identity.signingKey.secretKey
      );

      const authReply: ClientWsMessage = {
        type: 'auth',
        public_key: this.identity.signingKey.publicKeyHex,
        signature: signatureHex,
      };

      this.sendJson(authReply);
    } catch (err) {
      this.handleConnectionFailure(err as Error);
    }
  }

  /**
   * Sends a JSON object wrapped in a masked RFC 6455 text frame.
   */
  public sendJson(data: object): void {
    const jsonStr = JSON.stringify(data);
    const payloadBytes = Buffer.from(jsonStr, 'utf8');
    this.sendRawFrame(0x01, payloadBytes);
  }

  /**
   * Sends a client-masked WebSocket frame (RFC 6455 mandates client-to-server masking).
   */
  private sendRawFrame(opcode: number, payload: Buffer): void {
    if (!this.socket || this.socket.destroyed) return;

    const payloadLen = payload.length;
    let headerLen = 2 + 4; // 2 byte base + 4 byte mask key
    if (payloadLen > 125 && payloadLen <= 0xffff) {
      headerLen += 2;
    } else if (payloadLen > 0xffff) {
      headerLen += 8;
    }

    const frame = Buffer.alloc(headerLen + payloadLen);
    frame[0] = 0x80 | (opcode & 0x0f); // FIN = 1, Opcode

    let offset = 2;
    if (payloadLen <= 125) {
      frame[1] = 0x80 | payloadLen; // Mask = 1
    } else if (payloadLen <= 0xffff) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(payloadLen, 2);
      offset += 2;
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(payloadLen), 2);
      offset += 8;
    }

    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, offset, 0, 4);
    offset += 4;

    for (let i = 0; i < payloadLen; i++) {
      frame[offset + i] = payload[i] ^ maskKey[i % 4];
    }

    this.socket.write(frame);
  }

  private startPingKeepAlive(): void {
    this.cleanupTimers();
    this.pingIntervalTimer = setInterval(() => {
      this.sendJson({ type: 'ping' });
    }, 25000);
  }

  private cleanupTimers(): void {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleConnectionFailure(error: Error): void {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
    if (this.autoReconnect) {
      this.scheduleReconnect();
    } else {
      this.setState(WsClientState.DISCONNECTED);
    }
  }

  private scheduleReconnect(): void {
    this.setState(WsClientState.RECONNECTING);
    this.cleanupSocket();

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)),
      this.maxReconnectDelayMs
    ) + Math.random() * 1000;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Explicitly closes the WebSocket connection and halts automatic reconnection.
   */
  public disconnect(): void {
    this.autoReconnect = false;
    this.cleanupTimers();
    this.cleanupSocket();
    this.setState(WsClientState.CLOSED);
  }
}

