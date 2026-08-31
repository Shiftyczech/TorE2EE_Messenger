import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { CryptoEngine } from '../../crypto/CryptoEngine';
import { InMemorySignalStore } from '../../crypto/InMemorySignalStore';
import { IdentityManager } from '../../identity/IdentityManager';
import { ContactExchange } from '../../orchestration/ContactExchange';
import { NotificationManager } from '../../notifications/NotificationManager';
import { INotificationDriver, NotificationChannelConfig, NotificationOptions } from '../../notifications/types';
import { DatabaseManager } from '../../storage/DatabaseManager';
import { SqliteSignalStore } from '../../storage/SqliteSignalStore';
import { BackgroundSyncService } from '../BackgroundSyncService';

class MockNotificationDriver implements INotificationDriver {
  public notifications: NotificationOptions[] = [];
  public async createChannel(_config: NotificationChannelConfig): Promise<void> {}
  public async displayNotification(options: NotificationOptions): Promise<string> {
    this.notifications.push(options);
    return `notif_${this.notifications.length}`;
  }
  public async cancelNotification(_id: string): Promise<void> {}
  public async cancelAll(): Promise<void> {}
}

describe('BackgroundSyncService', () => {
  let mockDriver: MockNotificationDriver;
  const testDbName = 'bob_sync_test.db';

  beforeEach(() => {
    mockDriver = new MockNotificationDriver();
    NotificationManager.getInstance(mockDriver);
  });

  afterEach(async () => {
    await IdentityManager.clearIdentityFromKeychain();
    if (fs.existsSync(testDbName)) {
      try {
        fs.unlinkSync(testDbName);
      } catch {}
    }
  });

  it('skips sync gracefully when no identity is present in Keychain', async () => {
    await IdentityManager.clearIdentityFromKeychain();
    const result = await BackgroundSyncService.executeSync();
    expect(result.status).toBe('SKIPPED_NO_IDENTITY');
    expect(result.messagesReceived).toBe(0);
  });

  describe('Full Background Sync with Live Relay Simulation', () => {
    let mockServer: http.Server;
    let mockPort: number;
    const activeSockets: Set<net.Socket> = new Set();
    let queuedPayloadForBob: any = null;

    beforeAll(async () => {
      mockServer = http.createServer();

      mockServer.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));
      });

      mockServer.on('upgrade', (req, socket: net.Socket) => {
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
                const hash = IdentityManager.computePubkeyHash(
                  new Uint8Array(Buffer.from(clientMsg.public_key, 'hex'))
                );
                sendWsFrame(
                  socket,
                  JSON.stringify({ type: 'authenticated', recipient_pubkey_hash: hash })
                );

                if (queuedPayloadForBob) {
                  sendWsFrame(socket, JSON.stringify(queuedPayloadForBob));
                  queuedPayloadForBob = null;
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

    it(
      'wakes up on background, drains queued envelope, decrypts and triggers local notification',
      async () => {
        // 1. Bob generates identity and saves to Keychain
        const bobIdentity = await IdentityManager.generateIdentity();
        await IdentityManager.saveIdentityToKeychain(bobIdentity);

        // Pre-populate Bob's SignedPreKey in Bob's persistent SQLite database
        const dbConfig = { name: testDbName };
        const preDb = new DatabaseManager(dbConfig);
        await preDb.initialize();
        const bobStore = new SqliteSignalStore(bobIdentity, preDb);
        const bobEngine = new CryptoEngine(bobStore);
        const bobBundle = await bobEngine.generatePreKeyBundle(5);
        await preDb.close();

        // 2. Alice initiates session and encrypts a message for Bob
        const aliceIdentity = await IdentityManager.generateIdentity();
        const aliceStore = new InMemorySignalStore(aliceIdentity);
        const aliceEngine = new CryptoEngine(aliceStore);
        await aliceEngine.initiateSession(bobBundle.identityKeyHex, bobBundle);

        const plaintext = 'Secret message received during background sync!';
        const encryptedMsg = await aliceEngine.encrypt(bobBundle.identityKeyHex, plaintext);

        queuedPayloadForBob = {
          type: 'message',
          encrypted_payload: JSON.stringify(encryptedMsg),
          nonce: encryptedMsg.nonce,
          created_at: Math.floor(Date.now() / 1000),
        };

        // 3. Execute Headless Background Sync Task on the pre-populated SQLite DB
        const syncResult = await BackgroundSyncService.executeSync({
          torConfig: {
            socksProxyHost: '127.0.0.1',
            socksProxyPort: 9050,
            targetHost: '127.0.0.1',
            targetPort: mockPort,
            devMode: true,
          },
          databaseConfig: dbConfig,
          bootstrapTimeoutMs: 5000,
          drainTimeoutMs: 600,
        });

        expect(syncResult.status).toBe('NEW_DATA');
        expect(syncResult.messagesReceived).toBe(1);

        // 4. Verify Local Notification was triggered
        expect(mockDriver.notifications).toHaveLength(1);
        expect(mockDriver.notifications[0].body).toBe(plaintext);
      },
      30000
    );
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
