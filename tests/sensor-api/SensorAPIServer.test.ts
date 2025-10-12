```ts
import net from 'net';
import EventEmitter from 'events';
import { SensorAPIServer } from '../../src/sensor-api/SensorAPIServer';
import * as protobuf from '../../src/sensor-api/proto';
import { mocked } from 'ts-jest/utils';

jest.mock('../../src/sensor-api/proto');

type MockSocket = EventEmitter & {
  write: jest.Mock<boolean, [Buffer | string]>;
  end: jest.Mock<void, []>;
  destroy: jest.Mock<void, []>;
  setTimeout: jest.Mock<void, [number]>;
};

function createMockSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.write = jest.fn(() => true);
  socket.end = jest.fn();
  socket.destroy = jest.fn();
  socket.setTimeout = jest.fn();
  return socket;
}

describe('SensorAPIServer', () => {
  let server: SensorAPIServer;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    server = new SensorAPIServer({
      port: 0,
      defaultPollingRateMs: 1000,
      connectionTimeoutMs: 5000,
    });
  });

  afterEach(async () => {
    await server.close();
    jest.useRealTimers();
  });

  describe('client connection and acknowledgment', () => {
    it('should acknowledge client upon connection with default settings', done => {
      const socket = createMockSocket();

      server['handleConnection'](socket);

      process.nextTick(() => {
        expect(socket.write).toHaveBeenCalledTimes(1);
        const callArg = socket.write.mock.calls[0][0];
        expect(callArg).toBeInstanceOf(Buffer);
        done();
      });
    });
  });

  describe('data push at configured intervals', () => {
    it('should push sensor data at specified polling rate', () => {
      const socket = createMockSocket();
      socket.remoteAddress = 'client1';
      server['handleConnection'](socket);

      // client sends polling rate set message (mocked)
      // simulate receiving a valid polling rate message
      const client = server['clients'].get(socket);

      if (client) client.pollingRateMs = 1000;

      const pushSpy = jest.spyOn(server as any, 'pushSensorData').mockImplementation(() => {
        return true;
      });

      jest.advanceTimersByTime(3000); // advance 3 cycles

      expect(pushSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('Protocol Buffer serialization works', () => {
    it('should serialize data using protobuf and write to socket', () => {
      const socket = createMockSocket();
      server['handleConnection'](socket);

      const sensorData = { temperature: 22, humidity: 50 };
      const encoded = Buffer.from('encoded data');
      mocked(protobuf.SensorData.encode).mockReturnValue({
        finish: () => encoded,
      } as any);

      (server as any).pushSensorData(socket, sensorData);

      expect(protobuf.SensorData.encode).toHaveBeenCalledWith(sensorData);
      expect(socket.write).toHaveBeenCalledWith(encoded);
    });
  });

  describe('multiple concurrent clients handled', () => {
    it('should handle multiple clients pushing data independently', () => {
      const socket1 = createMockSocket();
      socket1.remoteAddress = 'client1';
      const socket2 = createMockSocket();
      socket2.remoteAddress = 'client2';

      server['handleConnection'](socket1);
      server['handleConnection'](socket2);

      const client1 = server['clients'].get(socket1);
      const client2 = server['clients'].get(socket2);

      if (client1) client1.pollingRateMs = 1000;
      if (client2) client2.pollingRateMs = 2000;

      const pushSpy = jest.spyOn(server as any, 'pushSensorData').mockImplementation(() => true);

      jest.advanceTimersByTime(4000);

      // client1 should push ~4 times, client2 ~2 times
      expect(pushSpy).toHaveBeenCalled();

      const callsForSocket1 = pushSpy.mock.calls.filter(call => call[0] === socket1);
      const callsForSocket2 = pushSpy.mock.calls.filter(call => call[0] === socket2);

      expect(callsForSocket1.length).toBeGreaterThanOrEqual(3);
      expect(callsForSocket2.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('client disconnection cleanup', () => {
    it('should remove client on disconnection and clear timers', () => {
      const socket = createMockSocket();
      server['handleConnection'](socket);

      expect(server['clients'].has(socket)).toBe(true);

      socket.emit('close');

      expect(server['clients'].has(socket)).toBe(false);
    });
  });

  describe('invalid polling rate rejection', () => {
    it('should reject polling rates that are too low or too high', () => {
      const socket = createMockSocket();
      server['handleConnection'](socket);
      const client = server['clients'].get(socket);

      const sendSetRate = (rate: number) => {
        if (!client) return false;
        return server['setClientPollingRate'](client, rate);
      };

      expect(sendSetRate(10)).toBe(false);
      expect(sendSetRate(100000)).toBe(false);
      expect(sendSetRate(1000)).toBe(true);
    });
  });

  describe('connection timeout handling', () => {
    it('should destroy socket after timeout', () => {
      const socket = createMockSocket();
      server['handleConnection'](socket);

      expect(socket.setTimeout).toHaveBeenCalledWith(5000);

      const timeoutHandler = socket.listeners('timeout')[0];
      timeoutHandler?.();

      expect(socket.destroy).toHaveBeenCalled();
    });
  });

  describe('push failure recovery', () => {
    it('should handle socket write failure without crashing', () => {
      const socket = createMockSocket();
      server['handleConnection'](socket);

      (socket.write as jest.Mock).mockImplementation(() => {
        throw new Error('write failed');
      });

      const sensorData = { temperature: 20 };

      expect(() => (server as any).pushSensorData(socket, sensorData)).not.toThrow();
    });
  });
});
```