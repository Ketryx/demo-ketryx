```ts
import PythonBackendClient from '../../../server/services/PythonBackendClient';

jest.useFakeTimers();

describe('PythonBackendClient', () => {
  let client: PythonBackendClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    // @ts-ignore
    global.fetch = fetchMock;
    client = new PythonBackendClient({
      baseUrl: 'http://mock-python-service',
      timeoutMs: 1000,
      maxRetries: 2,
      circuitBreakerThreshold: 3,
      circuitBreakerResetPeriodMs: 60000,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('successful communication', () => {
    it('returns parsed result from Python service', async () => {
      const responseBody = { result: 'ok' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => responseBody,
      });

      const result = await client.callService('/endpoint', { some: 'data' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://mock-python-service/endpoint',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ some: 'data' }),
          signal: expect.any(Object),
        }),
      );
      expect(result).toEqual(responseBody);
    });
  });

  describe('timeout handling', () => {
    it('aborts request after timeout period', async () => {
      fetchMock.mockImplementation(() => {
        return new Promise(() => {}); // never resolves
      });

      const promise = client.callService('/long', {});

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('Timeout');
    });
  });

  describe('retry logic', () => {
    it('retries on failure up to maxRetries', async () => {
      const failureResponse = { ok: false, status: 500, statusText: 'Internal Server Error' };
      const successResponse = {
        ok: true,
        json: async () => ({ success: true }),
      };

      fetchMock
        .mockResolvedValueOnce(failureResponse)
        .mockResolvedValueOnce(failureResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await client.callService('/retry', {});

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: true });
    });

    it('throws after max retries exhausted', async () => {
      const failureResponse = { ok: false, status: 503, statusText: 'Service Unavailable' };

      fetchMock.mockResolvedValue(failureResponse);

      await expect(client.callService('/fail', {})).rejects.toThrow('Failed after 3 attempts');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('circuit breaker', () => {
    it('opens circuit after threshold failures and blocks calls', async () => {
      const failureResponse = { ok: false, status: 500, statusText: 'Internal Server Error' };

      fetchMock.mockResolvedValue(failureResponse);

      for (let i = 0; i < 3; i++) {
        await expect(client.callService('/cb', {})).rejects.toThrow();
      }

      // Circuit breaker should now open
      await expect(client.callService('/cb', {})).rejects.toThrow('Circuit breaker is open');

      // fetch should not be called after circuit open
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('resets circuit breaker after reset period', async () => {
      const failureResponse = { ok: false, status: 500, statusText: 'Internal Server Error' };
      fetchMock.mockResolvedValue(failureResponse);

      for (let i = 0; i < 3; i++) {
        await expect(client.callService('/cbreset', {})).rejects.toThrow();
      }

      await expect(client.callService('/cbreset', {})).rejects.toThrow('Circuit breaker is open');

      // Advance time to reset period (60s)
      jest.advanceTimersByTime(60000);

      const successResponse = {
        ok: true,
        json: async () => ({ ok: true }),
      };

      fetchMock.mockResolvedValueOnce(successResponse);

      await expect(client.callService('/cbreset', {})).resolves.toEqual({ ok: true });
    });
  });

  describe('error translation', () => {
    it('throws custom error with correct message on failure response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid input' }),
      });

      await expect(client.callService('/error', {})).rejects.toMatchObject({
        message: expect.stringContaining('Invalid input'),
        status: 400,
      });
    });

    it('handles non-JSON error responses gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => { throw new Error('Invalid JSON'); },
      });

      await expect(client.callService('/error-nonjson', {})).rejects.toMatchObject({
        message: expect.stringContaining('Bad Gateway'),
        status: 502,
      });
    });
  });

  describe('health checking', () => {
    it('returns true when health check succeeds', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true });

      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://mock-python-service/health',
        expect.any(Object),
      );
    });

    it('returns false when health check fails or times out', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });

      const unhealthy1 = await client.healthCheck();
      expect(unhealthy1).toBe(false);

      fetchMock.mockImplementationOnce(() => new Promise(() => {})); // hangs

      const healthPromise = client.healthCheck();
      jest.advanceTimersByTime(1000);
      const unhealthy2 = await healthPromise;
      expect(unhealthy2).toBe(false);
    });
  });
});
```