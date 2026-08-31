import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { Socks5Tunnel, Socks5Error } from '../Socks5Tunnel';
import { TorManager } from '../TorManager';
import { TorHttpClient } from '../TorHttpClient';
import { TorWebSocketClient } from '../TorWebSocketClient';
import { IdentityManager } from '../../identity/IdentityManager';
import { TorConfig, WsClientState } from '../types';

describe('Tor Network Modules', () => {
  describe('Socks5Tunnel', () => {
    it('builds and verifies valid SOCKS5 auth request/response', () => {
      const authReq = Socks5Tunnel.buildAuthRequest();
      expect(Array.from(authReq)).toEqual([0x05, 0x01, 0x00]);

      expect(() =>
        Socks5Tunnel.verifyAuthResponse(new Uint8Array([0x05, 0x00]))
      ).not.toThrow();

      expect(() =>
        Socks5Tunnel.verifyAuthResponse(new Uint8Array([0x04, 0x00]))
      ).toThrow(Socks5Error);

      expect(() =>
        Socks5Tunnel.verifyAuthResponse(new Uint8Array([0x05, 0xff]))
      ).toThrow(Socks5Error);
    });

    it('builds domain-addressed connect request for .onion addresses (zero DNS leak)', () => {
      const onionHost = 'v3onionaddress1234567890.onion';
      const port = 8080;
      const connectReq = Socks5Tunnel.buildConnectRequest(onionHost, port);

      expect(connectReq[0]).toBe(0x05);
      expect(connectReq[1]).toBe(0x01);
      expect(connectReq[2]).toBe(0x00);
      expect(connectReq[3]).toBe(0x03);
      expect(connectReq[4]).toBe(onionHost.length);

      const domainInPacket = new TextDecoder().decode(
        connectReq.subarray(5, 5 + onionHost.length)
      );
      expect(domainInPacket).toBe(onionHost);

      const portHigh = connectReq[5 + onionHost.length];
      const portLow = connectReq[6 + onionHost.length];
      expect((portHigh << 8) | portLow).toBe(port);
    });

    it('verifies SOCKS5 connect response and throws descriptive errors on failure', () => {
      expect(() =>
        Socks5Tunnel.verifyConnectResponse(
          new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        )
      ).not.toThrow();

      expect(() =>
        Socks5Tunnel.verifyConnectResponse(
          new Uint8Array([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        )
      ).toThrow('Host unreachable');

      expect(() =>
        Socks5Tunnel.verifyConnectResponse(
          new Uint8Array([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        )
      ).toThrow('Connection refused');
    });
  });

  describe('TorManager', () => {
    it('manages Tor singleton lifecycle and reports bootstrap progress', async () => {
      const manager = TorManager.getInstance({ devMode: true });
      const progressUpdates: number[] = [];

      const started = await manager.startTor((progress) => {
        progressUpdates.push(progress.percentage);
      });

      expect(started).toBe(true);
      expect(manager.isReady()).toBe(true);
      expect(progressUpdates).toContain(100);

      await manager.stopTor();
      expect(manager.isReady()).toBe(false);
    });
  });

  describe('TorHttpClient and TorWebSocketClient integration with Relay Protocol', () => {
    let mockServer: http.Server;
    let mockPort: number;
    let testIdentity: any;
    const activeSockets: Set<net.Socket> = new Set();

    beforeAll(async () => {
      testIdentity = await IdentityManager.generateIdentity();

      mockServer = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        } else if (req.method === 'POST' && req.url === '/api/v1/message') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            const parsed = JSON.parse(body);
            if (parsed.recipient_pubkey_hash && parsed.encrypted_payload) {
              const respBody = JSON.stringify({ status: 'accepted', delivered_live: false });
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(respBody).toString(),
              });
              res.end(respBody);
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'invalid payload' }));
            }
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      mockServer.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));
      });

      mockServer.on('upgrade', (req, socket: net.Socket, head) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));

        if (req.url === '/api/v1/stream') {
          const key = req.headers['sec-websocket-key'];
          const acceptKey = crypto
            .createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');

          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
          );

          const challengeHex = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
          const challengeMsg = JSON.stringify({ type: 'challenge', challenge: challengeHex });
          sendWsFrame(socket, challengeMsg);

          let buffer = Buffer.alloc(0);
          socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 2) {
              const isMasked = (buffer[1] & 0x80) !== 0;
              let len = buffer[1] & 0x7f;
              let offset = 2;

              if (len === 126) {
                if (buffer.length < offset + 2) break;
                len = buffer.readUInt16BE(offset);
                offset += 2;
              } else if (len === 127) {
                if (buffer.length < offset + 8) break;
                len = Number(buffer.readBigUInt64BE(offset));
                offset += 8;
              }

              let maskKey: Buffer | null = null;
              if (isMasked) {
                if (buffer.length < offset + 4) break;
                maskKey = buffer.subarray(offset, offset + 4);
                offset += 4;
              }

              if (buffer.length < offset + len) break;

              let payload = buffer.subarray(offset, offset + len);
              buffer = buffer.subarray(offset + len);

              if (isMasked && maskKey) {
                const unmasked = Buffer.alloc(len);
                for (let i = 0; i < len; i++) {
                  unmasked[i] = payload[i] ^ maskKey[i % 4];
                }
                payload = unmasked;
              }

              const clientMsg = JSON.parse(payload.toString('utf8'));
              if (clientMsg.type === 'auth') {
                const isValid = IdentityManager.verifySignature(
                  challengeHex,
                  clientMsg.signature,
                  clientMsg.public_key
                );
                if (isValid) {
                  const hash = IdentityManager.computePubkeyHash(
                    new Uint8Array(Buffer.from(clientMsg.public_key, 'hex'))
                  );
                  sendWsFrame(
                    socket,
                    JSON.stringify({ type: 'authenticated', recipient_pubkey_hash: hash })
                  );

                  sendWsFrame(
                    socket,
                    JSON.stringify({
                      type: 'message',
                      encrypted_payload: 'ENC_TEST_PAYLOAD',
                      nonce: 'NONCE_TEST',
                      created_at: 1234567890,
                    })
                  );
                }
              }
            }
          });
        }
      });

      await new Promise<void>((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as net.AddressInfo).port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      for (const socket of Array.from(activeSockets)) {
        socket.destroy();
      }
      activeSockets.clear();
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    });

    it('TorHttpClient sends HTTP requests successfully (DevMode)', async () => {
      const config: TorConfig = {
        socksProxyHost: '127.0.0.1',
        socksProxyPort: 9050,
        targetHost: '127.0.0.1',
        targetPort: mockPort,
        devMode: true,
      };

      const httpClient = new TorHttpClient(config);

      const isHealthy = await httpClient.checkHealth();
      expect(isHealthy).toBe(true);

      const response = await httpClient.sendMessage({
        recipient_pubkey_hash: testIdentity.recipientPubkeyHash,
        encrypted_payload: 'BLOB_FOR_TEST',
        nonce: 'NONCE_1',
      });

      expect(response.status).toBe('accepted');
      expect(response.delivered_live).toBe(false);
    });

    it('TorWebSocketClient connects, completes Ed25519 challenge-response and receives messages', async () => {
      const config: TorConfig = {
        socksProxyHost: '127.0.0.1',
        socksProxyPort: 9050,
        targetHost: '127.0.0.1',
        targetPort: mockPort,
        devMode: true,
      };

      return new Promise<void>(async (resolve, reject) => {
        const wsClient = new TorWebSocketClient(config, testIdentity, {
          onAuthenticated: (pubkeyHash) => {
            expect(pubkeyHash).toBe(testIdentity.recipientPubkeyHash);
          },
          onMessage: (msg) => {
            try {
              expect(msg.encrypted_payload).toBe('ENC_TEST_PAYLOAD');
              expect(msg.nonce).toBe('NONCE_TEST');
              expect(msg.created_at).toBe(1234567890);
              wsClient.disconnect();
              expect(wsClient.getState()).toBe(WsClientState.CLOSED);
              resolve();
            } catch (err) {
              wsClient.disconnect();
              reject(err);
            }
          },
          onError: (err) => {
            wsClient.disconnect();
            reject(err);
          },
        });

        await wsClient.connect();
      });
    });
  });
});

function sendWsFrame(socket: net.Socket, text: string) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header: Buffer;

  if (len <= 125) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}
