import {
  INotificationDriver,
  NotificationChannelConfig,
  NotificationOptions,
} from './types';

const DEFAULT_CHANNEL_ID = 'tore2ee_messages';

class DefaultNotificationDriver implements INotificationDriver {
  private notifications: Map<string, NotificationOptions> = new Map();
  private notifee: any = null;

  constructor() {
    try {
      this.notifee = require('@notifee/react-native').default;
    } catch {
      this.notifee = null;
    }
  }

  public async createChannel(config: NotificationChannelConfig): Promise<void> {
    if (this.notifee && typeof this.notifee.createChannel === 'function') {
      await this.notifee.createChannel({
        id: config.id,
        name: config.name,
        importance: config.importance,
        vibration: config.vibration,
        sound: config.sound || 'default',
      });
    }
  }

  public async displayNotification(options: NotificationOptions): Promise<string> {
    const id = options.messageId || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.notifications.set(id, options);

    if (this.notifee && typeof this.notifee.displayNotification === 'function') {
      const displayTitle = options.privacyMode ? 'TorE2EE Messenger' : options.title;
      const displayBody = options.privacyMode ? 'Máte novou šifrovanou zprávu přes Tor.' : options.body;

      await this.notifee.displayNotification({
        id,
        title: displayTitle,
        body: displayBody,
        data: {
          contactPubkeyHash: options.contactPubkeyHash || '',
          messageId: options.messageId || '',
        },
        android: {
          channelId: DEFAULT_CHANNEL_ID,
          pressAction: {
            id: 'default',
          },
          smallIcon: 'ic_notification',
          color: '#10B981',
        },
        ios: {
          sound: 'default',
        },
      });
    }

    return id;
  }

  public async cancelNotification(notificationId: string): Promise<void> {
    this.notifications.delete(notificationId);
    if (this.notifee && typeof this.notifee.cancelNotification === 'function') {
      await this.notifee.cancelNotification(notificationId);
    }
  }

  public async cancelAll(): Promise<void> {
    this.notifications.clear();
    if (this.notifee && typeof this.notifee.cancelAllNotifications === 'function') {
      await this.notifee.cancelAllNotifications();
    }
  }

  public getDisplayedNotifications(): NotificationOptions[] {
    return Array.from(this.notifications.values());
  }
}

export class NotificationManager {
  private static instance: NotificationManager | null = null;
  private driver: INotificationDriver;
  private isInitialized: boolean = false;

  constructor(driver?: INotificationDriver) {
    this.driver = driver || new DefaultNotificationDriver();
  }

  public static getInstance(driver?: INotificationDriver): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager(driver);
    } else if (driver) {
      NotificationManager.instance.driver = driver;
    }
    return NotificationManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.driver.createChannel({
      id: DEFAULT_CHANNEL_ID,
      name: 'TorE2EE Zprávy',
      importance: 4, // High importance (Android IMPORTANCE_HIGH)
      vibration: true,
    });

    this.isInitialized = true;
  }

  public async displayMessageNotification(
    senderAlias: string,
    messageBody: string,
    contactPubkeyHash?: string,
    privacyMode: boolean = false
  ): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return this.driver.displayNotification({
      title: senderAlias,
      body: messageBody,
      contactPubkeyHash,
      privacyMode,
      sound: true,
    });
  }

  public async cancelNotification(notificationId: string): Promise<void> {
    await this.driver.cancelNotification(notificationId);
  }

  public async cancelAll(): Promise<void> {
    await this.driver.cancelAll();
  }

  public getDriver(): INotificationDriver {
    return this.driver;
  }
}

