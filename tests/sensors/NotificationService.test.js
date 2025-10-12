```javascript
const NotificationService = require('../../sensors/NotificationService');

jest.useFakeTimers();

describe('NotificationService', () => {
  let notificationService;
  let mockEmailAPI;
  let mockSmsAPI;
  let mockPushAPI;

  const testNotifications = [
    { id: '1', channel: 'email', priority: 2, message: 'Email Message 1', recipient: 'user1@example.com' },
    { id: '2', channel: 'sms', priority: 3, message: 'SMS Message 1', recipient: '+1234567890' },
    { id: '3', channel: 'push', priority: 1, message: 'Push Msg 1', recipient: 'userDeviceToken1' },
    { id: '4', channel: 'email', priority: 5, message: 'Email Message 2', recipient: 'user2@example.com' }
  ];

  beforeEach(() => {
    mockEmailAPI = { send: jest.fn() };
    mockSmsAPI = { send: jest.fn() };
    mockPushAPI = { send: jest.fn() };

    notificationService = new NotificationService({
      emailAPI: mockEmailAPI,
      smsAPI: mockSmsAPI,
      pushAPI: mockPushAPI,
      retryDelayMs: 1000,
      maxRetryAttempts: 2
    });
  });

  afterEach(() => jest.clearAllMocks());

  test('successfully delivers notifications across all channels', async () => {
    mockEmailAPI.send.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    mockSmsAPI.send.mockResolvedValueOnce(true);
    mockPushAPI.send.mockResolvedValueOnce(true);

    await Promise.all(testNotifications.map(n => notificationService.sendNotification(n)));

    expect(mockEmailAPI.send).toHaveBeenCalledTimes(2);
    expect(mockEmailAPI.send).toHaveBeenCalledWith(testNotifications[0]);
    expect(mockEmailAPI.send).toHaveBeenCalledWith(testNotifications[3]);

    expect(mockSmsAPI.send).toHaveBeenCalledTimes(1);
    expect(mockSmsAPI.send).toHaveBeenCalledWith(testNotifications[1]);

    expect(mockPushAPI.send).toHaveBeenCalledTimes(1);
    expect(mockPushAPI.send).toHaveBeenCalledWith(testNotifications[2]);

    const history = notificationService.getNotificationHistory();
    expect(history).toHaveLength(4);
    history.forEach(h => expect(h.status).toBe('delivered'));
  });

  test('processes notification queue in priority order', async () => {
    mockEmailAPI.send.mockResolvedValue(true);
    mockSmsAPI.send.mockResolvedValue(true);
    mockPushAPI.send.mockResolvedValue(true);

    // Add all notifications to queue
    testNotifications.forEach(n => notificationService.queueNotification(n));
    // Start queue processing
    await notificationService.processQueue();

    // The order notifications were sent should match priority (descending)
    const sentOrder = notificationService.getNotificationHistory().map(h => h.id);
    const expectedOrder = [...testNotifications]
      .sort((a, b) => b.priority - a.priority)
      .map(n => n.id);

    expect(sentOrder).toEqual(expectedOrder);
  });

  test('retries failed delivery with retry logic then succeeds', async () => {
    const failingNotification = { id: 'fail1', channel: 'sms', priority: 4, message: 'Retry Test', recipient: '+1987654321' };

    // Fail first attempt, succeed second
    mockSmsAPI.send
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(true);

    const sendPromise = notificationService.sendNotification(failingNotification);

    // Fast-forward timers for retry delay
    jest.advanceTimersByTime(notificationService.retryDelayMs);

    await sendPromise;

    expect(mockSmsAPI.send).toHaveBeenCalledTimes(2);

    const history = notificationService.getNotificationHistory().filter(h => h.id === 'fail1');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('delivered');
    expect(history[0].attempts).toBe(2);
  });

  test('marks notification as failed after max retry attempts', async () => {
    const failingNotification = { id: 'fail2', channel: 'email', priority: 1, message: 'Failure test', recipient: 'fail@example.com' };

    mockEmailAPI.send.mockRejectedValue(new Error('Permanent failure'));

    const sendPromise = notificationService.sendNotification(failingNotification);

    for (let i = 0; i < notificationService.maxRetryAttempts; i++) {
      jest.advanceTimersByTime(notificationService.retryDelayMs);
      // Allow promise microtasks to run
      await Promise.resolve();
    }

    await sendPromise;

    expect(mockEmailAPI.send).toHaveBeenCalledTimes(notificationService.maxRetryAttempts);

    const history = notificationService.getNotificationHistory().filter(h => h.id === 'fail2');
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].attempts).toBe(notificationService.maxRetryAttempts);
  });

  test('tracks notification history with correct data', async () => {
    mockPushAPI.send.mockResolvedValue(true);

    const notification = { id: 'track1', channel: 'push', priority: 3, message: 'Track this', recipient: 'token123' };

    await notificationService.sendNotification(notification);

    const history = notificationService.getNotificationHistory();
    const trackRecord = history.find(h => h.id === notification.id);

    expect(trackRecord).toBeDefined();
    expect(trackRecord).toMatchObject({
      id: notification.id,
      channel: notification.channel,
      message: notification.message,
      recipient: notification.recipient,
      status: 'delivered',
      attempts: 1,
      timestamp: expect.any(Number)
    });
  });

  test('handles concurrent notification sending without data races', async () => {
    mockEmailAPI.send.mockResolvedValue(true);
    mockSmsAPI.send.mockResolvedValue(true);

    const concurrentNotifications = [
      { id: 'conc1', channel: 'email', priority: 2, message: 'Concurrent 1', recipient: 'c1@example.com' },
      { id: 'conc2', channel: 'sms', priority: 4, message: 'Concurrent 2', recipient: '+1111111111' },
      { id: 'conc3', channel: 'email', priority: 1, message: 'Concurrent 3', recipient: 'c3@example.com' }
    ];

    await Promise.all(concurrentNotifications.map(n => notificationService.sendNotification(n)));

    expect(mockEmailAPI.send).toHaveBeenCalledTimes(2);
    expect(mockSmsAPI.send).toHaveBeenCalledTimes(1);

    const history = notificationService.getNotificationHistory();
    expect(history).toHaveLength(3);

    // Ensure no duplicated history, all notifications recorded once
    const ids = history.map(h => h.id);
    expect(new Set(ids).size).toBe(3);
  });
});
```