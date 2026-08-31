import * as net from 'net';

export class Socks5Error extends Error {
  public code: number;
  constructor(message: string, code: number = -1) {
    super(message);
    this.name = 'Socks5Error';
    this.code = code;
  }
}

const SOCKS_VERSION = 0x05;
const AUTH_NONE = 0x00;
const CMD_CONNECT = 0x01;
const RSV = 0x00;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAINNAME = 0x03;

const SOCKS5_REPLY_MESSAGES: Record<number, string> = {
  0x00: 'Success',
  0x01: 'General SOCKS server failure',
  0x02: 'Connection not allowed by ruleset',
  0x03: 'Network unreachable',
  0x04: 'Host unreachable',
  0x05: 'Connection refused',
  0x06: 'TTL expired',
  0x07: 'Command not supported',
  0x08: 'Address type not supported',
};

export class Socks5Tunnel {
  public static buildAuthRequest(): Uint8Array {
    return new Uint8Array([SOCKS_VERSION, 0x01, AUTH_NONE]);
  }

  public static verifyAuthResponse(data: Uint8Array): void {
    if (data.length < 2) {
      throw new Socks5Error('Invalid SOCKS5 auth response length');
    }
    if (data[0] !== SOCKS_VERSION) {
      throw new Socks5Error(`Unsupported SOCKS version: ${data[0]}`);
    }
    if (data[1] !== AUTH_NONE) {
      throw new Socks5Error(`SOCKS5 authentication failed or required: ${data[1]}`);
    }
  }

  public static buildConnectRequest(host: string, port: number): Uint8Array {
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);

    if (isIpv4) {
      const parts = host.split('.').map(Number);
      const packet = new Uint8Array(10);
      packet[0] = SOCKS_VERSION;
      packet[1] = CMD_CONNECT;
      packet[2] = RSV;
      packet[3] = ATYP_IPV4;
      packet[4] = parts[0];
      packet[5] = parts[1];
      packet[6] = parts[2];
      packet[7] = parts[3];
      packet[8] = (port >> 8) & 0xff;
      packet[9] = port & 0xff;
      return packet;
    } else {
      const domainBytes = new TextEncoder().encode(host);
      const packet = new Uint8Array(7 + domainBytes.length);
      packet[0] = SOCKS_VERSION;
      packet[1] = CMD_CONNECT;
      packet[2] = RSV;
      packet[3] = ATYP_DOMAINNAME;
      packet[4] = domainBytes.length;
      packet.set(domainBytes, 5);
      packet[5 + domainBytes.length] = (port >> 8) & 0xff;
      packet[6 + domainBytes.length] = port & 0xff;
      return packet;
    }
  }

  public static verifyConnectResponse(data: Uint8Array): void {
    if (data.length < 4) {
      throw new Socks5Error('Invalid SOCKS5 connect response length');
    }
    if (data[0] !== SOCKS_VERSION) {
      throw new Socks5Error(`Unsupported SOCKS version in reply: ${data[0]}`);
    }
    const replyCode = data[1];
    if (replyCode !== 0x00) {
      const desc = SOCKS5_REPLY_MESSAGES[replyCode] || `Unknown error (${replyCode})`;
      throw new Socks5Error(`SOCKS5 connection error: ${desc}`, replyCode);
    }
  }

  public static connectViaSocks5(
    proxyHost: string,
    proxyPort: number,
    targetHost: string,
    targetPort: number,
    timeoutMs: number = 30000
  ): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: proxyHost, port: proxyPort });
      let stage: 'AUTH' | 'CONNECT' | 'CONNECTED' = 'AUTH';

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Socks5Error(`SOCKS5 connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.on('connect', () => {
        const authReq = Buffer.from(Socks5Tunnel.buildAuthRequest());
        socket.write(authReq);
      });

      socket.on('data', (data) => {
        try {
          const raw = new Uint8Array(data);
          if (stage === 'AUTH') {
            Socks5Tunnel.verifyAuthResponse(raw);
            stage = 'CONNECT';
            const connectReq = Buffer.from(
              Socks5Tunnel.buildConnectRequest(targetHost, targetPort)
            );
            socket.write(connectReq);
          } else if (stage === 'CONNECT') {
            Socks5Tunnel.verifyConnectResponse(raw);
            stage = 'CONNECTED';
            clearTimeout(timer);
            socket.removeAllListeners('data');
            resolve(socket);
          }
        } catch (err) {
          clearTimeout(timer);
          socket.destroy();
          reject(err);
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(new Socks5Error(`Socket connection error: ${err.message}`));
      });
    });
  }
}

