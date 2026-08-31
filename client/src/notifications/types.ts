export interface NotificationOptions {
  title: string;
  body: string;
  contactPubkeyHash?: string;
  messageId?: string;
  privacyMode?: boolean;
  sound?: boolean;
}

export interface NotificationChannelConfig {
  id: string;
  name: string;
  importance: number;
  vibration: boolean;
  sound?: string;
}

export interface INotificationDriver {
  createChannel(config: NotificationChannelConfig): Promise<void>;
  displayNotification(options: NotificationOptions): Promise<string>;
  cancelNotification(notificationId: string): Promise<void>;
  cancelAll(): Promise<void>;
}

