```typescript
import ClientManager from '../../src/sensor-api/ClientManager';

interface TestClientOptions {
  pollingRate?: number;
}

const createTestClient = (manager: ClientManager, options?: TestClientOptions) => {
  return manager.registerClient({
    pollingRate: options?.pollingRate ?? 1000,
  });
};

describe('ClientManager', () => {
  let manager: ClientManager;

  beforeEach(() => {
    manager = new ClientManager();
  });

  describe('Client Registration', () => {
    test('generates unique client IDs', () => {
      const clientA = createTestClient(manager);
      const clientB = createTestClient(manager);
      expect(clientA.id).toBeDefined();
      expect(clientB.id).toBeDefined();
      expect(clientA.id).not.toEqual(clientB.id);
    });

    test('default polling rate applied if none specified', () => {
      const client = createTestClient(manager);
      expect(client.pollingRate).toEqual(1000);
    });
  });

  describe('Polling Rate Configuration Persistence', () => {
    test('polling rate config persists across client state changes', () => {
      const pollingRate = 5000;
      const client = createTestClient(manager, { pollingRate });
      expect(client.pollingRate).toEqual(pollingRate);

      manager.updateClientPollingRate(client.id, 3000);
      const updatedClient = manager.getClient(client.id);
      expect(updatedClient?.pollingRate).toEqual(3000);
    });
  });

  describe('Client State Transitions', () => {
    test('client state changes correctly through registration, active, and disconnected', () => {
      const client = createTestClient(manager);
      expect(client.state).toEqual('registered');

      manager.activateClient(client.id);
      expect(manager.getClient(client.id)?.state).toEqual('active');

      manager.disconnectClient(client.id);
      expect(manager.getClient(client.id)?.state).toEqual('disconnected');
    });

    test('invalid state transitions are ignored or throw', () => {
      const client = createTestClient(manager);
      expect(() => manager.disconnectClient(client.id)).not.toThrow();
      expect(manager.getClient(client.id)?.state).toEqual('disconnected');

      // Attempt to activate a disconnected client
      manager.activateClient(client.id);
      expect(manager.getClient(client.id)?.state).toEqual('disconnected');
    });
  });

  describe('Message Queuing', () => {
    test('enqueue and dequeue messages for client', () => {
      const client = createTestClient(manager);
      const msg1 = { type: 'update', payload: { value: 42 } };
      const msg2 = { type: 'alert', payload: { level: 'high' } };

      manager.enqueueMessage(client.id, msg1);
      manager.enqueueMessage(client.id, msg2);

      expect(manager.getMessageQueue(client.id).length).toBe(2);
      expect(manager.dequeueMessage(client.id)).toEqual(msg1);
      expect(manager.getMessageQueue(client.id).length).toBe(1);
      expect(manager.dequeueMessage(client.id)).toEqual(msg2);
      expect(manager.getMessageQueue(client.id).length).toBe(0);
    });

    test('dequeue on empty queue returns undefined', () => {
      const client = createTestClient(manager);
      expect(manager.dequeueMessage(client.id)).toBeUndefined();
    });
  });

  describe('Timeout Detection & Cleanup', () => {
    jest.useFakeTimers();

    test('timeouts trigger client cleanup', () => {
      const timeoutMs = 10000; // 10 seconds timeout
      manager = new ClientManager({ timeoutMs });

      const client = createTestClient(manager);
      manager.activateClient(client.id);

      expect(manager.getClient(client.id)).not.toBeUndefined();

      // Fast-forward time less than timeout
      jest.advanceTimersByTime(timeoutMs - 1);
      manager.checkTimeouts();
      expect(manager.getClient(client.id)).not.toBeUndefined();

      // Fast-forward past timeout
      jest.advanceTimersByTime(2);
      manager.checkTimeouts();
      expect(manager.getClient(client.id)).toBeUndefined();
    });
  });

  describe('Metrics Tracking', () => {
    test('tracks correct number of registered, active, disconnected clients', () => {
      const clientA = createTestClient(manager);
      const clientB = createTestClient(manager);
      const clientC = createTestClient(manager);

      manager.activateClient(clientA.id);
      manager.activateClient(clientB.id);
      manager.disconnectClient(clientC.id);

      const metrics = manager.getMetrics();
      expect(metrics.registered).toBe(0); // all clients moved beyond registered
      expect(metrics.active).toBe(2);
      expect(metrics.disconnected).toBe(1);
    });

    test('message queue length tracked accurately', () => {
      const client = createTestClient(manager);
      manager.enqueueMessage(client.id, { type: 'x' });
      manager.enqueueMessage(client.id, { type: 'y' });

      const metrics = manager.getMetrics();
      expect(metrics.totalQueuedMessages).toBe(2);
    });
  });

  describe('Concurrent Operations Safety', () => {
    test('concurrent client registrations generate unique IDs', async () => {
      const concurrency = 100;
      const registrationPromises = [];

      for (let i = 0; i < concurrency; i++) {
        registrationPromises.push(
          new Promise<{ id: string }>((resolve) => {
            setTimeout(() => {
              resolve(createTestClient(manager));
            }, Math.random() * 10);
          })
        );
      }

      const clients = await Promise.all(registrationPromises);
      const ids = clients.map((c) => c.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(concurrency);
    });

    test('concurrent enqueue and dequeue message operations maintain consistency', async () => {
      const client = createTestClient(manager);
      const messages = Array.from({ length: 50 }, (_, i) => ({ type: 'msg', index: i }));

      // Concurrently enqueue from multiple "threads"
      const enqueuePromises = messages.map(
        (msg) =>
          new Promise<void>((resolve) => setTimeout(() => {
            manager.enqueueMessage(client.id, msg);
            resolve();
          }, Math.random() * 5))
      );
      await Promise.all(enqueuePromises);

      expect(manager.getMessageQueue(client.id).length).toBe(50);

      // Concurrently dequeue messages
      const dequeued: unknown[] = [];
      const dequeuePromises = Array.from({ length: 50 }, () => {
        return new Promise<void>((resolve) => setTimeout(() => {
          const msg = manager.dequeueMessage(client.id);
          if (msg) dequeued.push(msg);
          resolve();
        }, Math.random() * 5));
      });
      await Promise.all(dequeuePromises);

      expect(manager.getMessageQueue(client.id).length).toBe(0);
      expect(dequeued.length).toBe(50);
      // Ensure all dequeued messages are unique and correspond to original messages
      const indices = dequeued.map((m) => (m as any).index).sort((a, b) => a - b);
      expect(indices).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });
  });
});
```