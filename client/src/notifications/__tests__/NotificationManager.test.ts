import { NotificationManager } from '../NotificationManager';
import { INotificationDriver, NotificationChannelConfig, NotificationOptions } from '../types';

class MockNotificationDriver implements INotificationDriver {
  public channels: NotificationChannelConfig[] = [];
  public notifications: Map<string, NotificationOptions> = new Map();

  public async createChannel(config: NotificationChannelConfig): Promise<void> {
    this.channels.push(config);
  }

  public async displayNotification(options: NotificationOptions): Promise<string> {
    const id = `notif_${this.notifications.size + 1}`;
    this.notifications.set(id, options);
    return id;
  }

  public async cancelNotification(notificationId: string): Promise<void> {
    this.notifications.delete(notificationId);
  }

  public async cancelAll(): Promise<void> {
    this.notifications.clear();
  }
}

describe('NotificationManager', () => {
  let mockDriver: MockNotificationDriver;
  let manager: NotificationManager;

  beforeEach(() => {
    mockDriver = new MockNotificationDriver();
    manager = new NotificationManager(mockDriver);
  });

  it('initializes default high-importance notification channel', async () => {
    await manager.initialize();
    expect(mockDriver.channels).toHaveLength(1);
    expect(mockDriver.channels[0].id).toBe('tore2ee_messages');
    expect(mockDriver.channels[0].importance).toBe(4);
  });

  it('displays message notification with contact metadata', async () => {
    const id = await manager.displayMessageNotification(
      'Alice',
      'Hello from Tor background!',
      'alice_pubkey_hash_123'
    );

    expect(id).toBe('notif_1');
    expect(mockDriver.notifications.has('notif_1')).toBe(true);

    const displayed = mockDriver.notifications.get('notif_1');
    expect(displayed?.title).toBe('Alice');
    expect(displayed?.body).toBe('Hello from Tor background!');
    expect(displayed?.contactPubkeyHash).toBe('alice_pubkey_hash_123');
  });

  it('cancels specific and all notifications', async () => {
    const id1 = await manager.displayMessageNotification('Alice', 'Msg 1');
    const id2 = await manager.displayMessageNotification('Bob', 'Msg 2');

    expect(mockDriver.notifications.size).toBe(2);

    await manager.cancelNotification(id1);
    expect(mockDriver.notifications.size).toBe(1);
    expect(mockDriver.notifications.has(id2)).toBe(true);

    await manager.cancelAll();
    expect(mockDriver.notifications.size).toBe(0);
  });
});

