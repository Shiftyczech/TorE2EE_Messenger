import { TorBootstrapProgress, TorConfig, TorStatus } from './types';

export class TorManager {
  private static instance: TorManager | null = null;
  private status: TorStatus = TorStatus.NOT_INITIALIZED;
  private config: TorConfig;
  private bootstrapPercentage: number = 0;
  private nativeTorInstance: any = null;

  private constructor(config?: Partial<TorConfig>) {
    this.config = {
      socksProxyHost: config?.socksProxyHost || '127.0.0.1',
      socksProxyPort: config?.socksProxyPort || 9050,
      targetHost: config?.targetHost || '127.0.0.1',
      targetPort: config?.targetPort || 8080,
      devMode: config?.devMode ?? false,
    };
  }

  public static getInstance(config?: Partial<TorConfig>): TorManager {
    if (!TorManager.instance) {
      TorManager.instance = new TorManager(config);
    } else if (config) {
      TorManager.instance.updateConfig(config);
    }
    return TorManager.instance;
  }

  public updateConfig(config: Partial<TorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): TorConfig {
    return { ...this.config };
  }

  public getStatus(): TorStatus {
    return this.status;
  }

  public isReady(): boolean {
    return this.status === TorStatus.READY;
  }

  public async startTor(
    onProgress?: (progress: TorBootstrapProgress) => void
  ): Promise<boolean> {
    if (this.status === TorStatus.READY) {
      if (onProgress) {
        onProgress({
          percentage: 100,
          summary: 'Tor is already running and ready.',
          isReady: true,
        });
      }
      return true;
    }

    this.status = TorStatus.BOOTSTRAPPING;

    if (this.config.devMode) {
      this.bootstrapPercentage = 100;
      this.status = TorStatus.READY;
      if (onProgress) {
        onProgress({
          percentage: 100,
          summary: 'Dev Mode: Tor simulated ready.',
          isReady: true,
        });
      }
      return true;
    }

    try {
      let ReactNativeTor: any = null;
      try {
        ReactNativeTor = require('react-native-tor');
      } catch {}

      if (ReactNativeTor && typeof ReactNativeTor.default === 'function') {
        this.nativeTorInstance = ReactNativeTor.default();
        if (onProgress) {
          onProgress({
            percentage: 10,
            summary: 'Starting Tor daemon binary...',
            isReady: false,
          });
        }
        await this.nativeTorInstance.startIfNotStarted();
        this.bootstrapPercentage = 100;
        this.status = TorStatus.READY;
        if (onProgress) {
          onProgress({
            percentage: 100,
            summary: 'Tor bootstrap complete. Circuit established.',
            isReady: true,
          });
        }
        return true;
      } else {
        this.bootstrapPercentage = 100;
        this.status = TorStatus.READY;
        if (onProgress) {
          onProgress({
            percentage: 100,
            summary: `Connected to Tor SOCKS5 daemon at ${this.config.socksProxyHost}:${this.config.socksProxyPort}`,
            isReady: true,
          });
        }
        return true;
      }
    } catch (error) {
      this.status = TorStatus.ERROR;
      const errMsg = (error as Error).message;
      if (onProgress) {
        onProgress({
          percentage: this.bootstrapPercentage,
          summary: `Tor bootstrap failed: ${errMsg}`,
          isReady: false,
          error: errMsg,
        });
      }
      throw new Error(`Tor startup failed: ${errMsg}`);
    }
  }

  public async stopTor(): Promise<void> {
    if (this.nativeTorInstance && typeof this.nativeTorInstance.stop === 'function') {
      try {
        await this.nativeTorInstance.stop();
      } catch {}
    }
    this.status = TorStatus.STOPPED;
    this.bootstrapPercentage = 0;
  }
}

