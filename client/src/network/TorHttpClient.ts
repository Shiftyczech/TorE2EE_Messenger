import * as net from 'net';
import { Socks5Tunnel } from './Socks5Tunnel';
import { TorConfig, OutgoingMessageEnvelope, SendMessageResponse } from './types';

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export class TorHttpClient {
  private config: TorConfig;

  constructor(config: TorConfig) {
    this.config = config;
  }

  /**
   * Sends an encrypted message envelope to the Relay Server via POST /api/v1/message.
   */
  public async sendMessage(
    envelope: OutgoingMessageEnvelope
  ): Promise<SendMessageResponse> {
    const payload = JSON.stringify(envelope);
    const response = await this.rawRequest('POST', '/api/v1/message', payload, {
      'Content-Type': 'application/json',
    });

    if (response.status !== 200) {
      throw new Error(
        `Relay server rejected message (status ${response.status}): ${response.body}`
      );
    }

    return JSON.parse(response.body.trim()) as SendMessageResponse;
  }

  /**
   * Performs a health check against GET /health.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await this.rawRequest('GET', '/health');
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Sends a raw HTTP/1.1 request tunneled through the Tor SOCKS5 proxy.
   */
  public async rawRequest(
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
    timeoutMs: number = 20000
  ): Promise<HttpResponse> {
    // 1. Establish TCP tunnel (either via SOCKS5 proxy or direct for devMode)
    let socket: net.Socket;

    if (this.config.devMode) {
      socket = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.createConnection(
          { host: this.config.targetHost, port: this.config.targetPort },
          () => resolve(s)
        );
        s.on('error', reject);
      });
    } else {
      socket = await Socks5Tunnel.connectViaSocks5(
        this.config.socksProxyHost,
        this.config.socksProxyPort,
        this.config.targetHost,
        this.config.targetPort,
        timeoutMs
      );
    }

    return new Promise<HttpResponse>((resolve, reject) => {
      let rawData = '';

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.on('data', (chunk) => {
        rawData += chunk.toString('utf8');
        const headerEnd = rawData.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const headerPart = rawData.substring(0, headerEnd);
          const bodyPart = rawData.substring(headerEnd + 4);

          const contentLengthMatch = headerPart.match(/content-length:\s*(\d+)/i);
          if (contentLengthMatch) {
            const expectedLen = parseInt(contentLengthMatch[1], 10);
            if (Buffer.byteLength(bodyPart, 'utf8') >= expectedLen) {
              clearTimeout(timer);
              socket.destroy();
              resolve(this.parseHttpResponse(rawData, expectedLen));
            }
          }
        }
      });

      socket.on('end', () => {
        clearTimeout(timer);
        if (rawData.length > 0) {
          try {
            resolve(this.parseHttpResponse(rawData));
          } catch (err) {
            reject(err);
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // Construct HTTP/1.1 request
      const bodyBytes = body ? Buffer.from(body, 'utf8') : Buffer.alloc(0);
      const reqHeaders: Record<string, string> = {
        Host: `${this.config.targetHost}:${this.config.targetPort}`,
        'User-Agent': 'TorE2EE-Client/0.1',
        Connection: 'close',
        ...headers,
      };

      if (body) {
        reqHeaders['Content-Length'] = bodyBytes.length.toString();
      }

      let httpReq = `${method} ${path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(reqHeaders)) {
        httpReq += `${k}: ${v}\r\n`;
      }
      httpReq += '\r\n';

      socket.write(httpReq);
      if (bodyBytes.length > 0) {
        socket.write(bodyBytes);
      }
    });
  }

  private parseHttpResponse(raw: string, exactContentLength?: number): HttpResponse {
    const splitIndex = raw.indexOf('\r\n\r\n');
    if (splitIndex === -1) {
      throw new Error('Malformed HTTP response');
    }

    const headerText = raw.substring(0, splitIndex);
    let body = raw.substring(splitIndex + 4);
    if (exactContentLength !== undefined) {
      body = Buffer.from(body, 'utf8').subarray(0, exactContentLength).toString('utf8');
    }

    const lines = headerText.split('\r\n');
    const statusLine = lines[0];
    const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)\s*(.*)/);
    if (!statusMatch) {
      throw new Error(`Invalid HTTP status line: ${statusLine}`);
    }

    const status = parseInt(statusMatch[1], 10);
    const statusText = statusMatch[2];

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colon = line.indexOf(':');
      if (colon !== -1) {
        const key = line.substring(0, colon).trim().toLowerCase();
        const value = line.substring(colon + 1).trim();
        headers[key] = value;
      }
    }

    return { status, statusText, headers, body };
  }
}

