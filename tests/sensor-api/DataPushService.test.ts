```typescript
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import DataPushService from '../../src/sensor-api/DataPushService';
import { DataSource } from '../../src/sensor-api/DataSource';
import { ClientConnection } from '../../src/sensor-api/ClientConnection';

jest.useFakeTimers();

describe('DataPushService', () => {
  let dataSourceMock: jest.Mocked<DataSource>;
  let clientConnectionMock: jest.Mocked<ClientConnection>;
  let service: DataPushService;

  beforeEach(() => {
    dataSourceMock = {
      getData: jest.fn(),
      validateData: jest.fn(),
      isStale: jest.fn(),
      getBatchData: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;

    clientConnectionMock = {
      pushData: jest.fn(),
    } as unknown as jest.Mocked<ClientConnection>;

    service = new DataPushService(dataSourceMock, clientConnectionMock, {
      pushIntervalMs: 1000,
      maxRetries: 3,
      batchSize: 5,
      deviceClass: 'CLASS_C',
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('pushes data at correct intervals', async () => {
    dataSourceMock.getData.mockResolvedValue([{ id: 1, value: 42 }]);
    dataSourceMock.validateData.mockReturnValue(true);
    clientConnectionMock.pushData.mockResolvedValue(true);

    service.start();

    expect(clientConnectionMock.pushData).not.toBeCalled();

    jest.advanceTimersByTime(1000);
    await Promise.resolve(); // Allow promises to resolve
    expect(clientConnectionMock.pushData).toBeCalledTimes(1);

    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(clientConnectionMock.pushData).toBeCalledTimes(4);

    service.stop();
  });

  it('validation catches invalid data and does not push', async () => {
    dataSourceMock.getData.mockResolvedValue([{ id: 1, value: 'bad' }]);
    dataSourceMock.validateData.mockReturnValue(false);

    service.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientConnectionMock.pushData).not.toBeCalled();
    service.stop();
  });

  it('retries pushing data on failure up to maxRetries', async () => {
    dataSourceMock.getData.mockResolvedValue([{ id: 1, value: 42 }]);
    dataSourceMock.validateData.mockReturnValue(true);

    clientConnectionMock.pushData.mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce(true);

    service.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientConnectionMock.pushData).toBeCalledTimes(3);
    service.stop();
  });

  it('pushes data in batches efficiently', async () => {
    const batchData = Array.from({ length: 10 }, (_, i) => ({ id: i, value: i * 10 }));
    dataSourceMock.getBatchData.mockResolvedValue(batchData);
    dataSourceMock.validateData.mockImplementation(data => typeof data.value === 'number');

    clientConnectionMock.pushData.mockResolvedValue(true);

    // Adjust service for batch pushing
    service = new DataPushService(dataSourceMock, clientConnectionMock, {
      pushIntervalMs: 1000,
      maxRetries: 1,
      batchSize: 5,
      deviceClass: 'CLASS_C',
    });

    service.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientConnectionMock.pushData).toBeCalledTimes(2);
    expect(clientConnectionMock.pushData).toHaveBeenNthCalledWith(1, batchData.slice(0, 5));
    expect(clientConnectionMock.pushData).toHaveBeenNthCalledWith(2, batchData.slice(5, 10));

    service.stop();
  });

  it('detects staleness correctly', async () => {
    dataSourceMock.getData.mockResolvedValue([{ id: 1, value: 42 }]);
    dataSourceMock.validateData.mockReturnValue(true);
    dataSourceMock.isStale.mockReturnValue(true);

    service.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientConnectionMock.pushData).not.toBeCalled();

    dataSourceMock.isStale.mockReturnValue(false);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(clientConnectionMock.pushData).toBeCalledTimes(1);

    service.stop();
  });

  it('meets performance requirements for CLASS_C devices', async () => {
    const perfData = Array.from({ length: 50 }, (_, i) => ({ id: i, value: i * 2 }));
    dataSourceMock.getBatchData.mockResolvedValue(perfData);
    dataSourceMock.validateData.mockReturnValue(true);

    clientConnectionMock.pushData.mockImplementation(() => {
      return new Promise(resolve => setTimeout(resolve, 10));
    });

    service = new DataPushService(dataSourceMock, clientConnectionMock, {
      pushIntervalMs: 1000,
      maxRetries: 1,
      batchSize: 10,
      deviceClass: 'CLASS_C',
    });

    service.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    // Wait all async pushes to complete
    await new Promise(r => setTimeout(r, 60));

    expect(clientConnectionMock.pushData).toBeCalledTimes(5);
    service.stop();
  });
});
```