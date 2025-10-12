```ts
import PatientDataService from '../../../dashboard/services/PatientDataService';
import axios from 'axios';

jest.mock('axios');

type Patient = {
  id: string;
  name: string;
  age: number;
  diagnosis: string;
};

const mockPatients: Patient[] = [
  { id: '1', name: 'John Doe', age: 30, diagnosis: 'Flu' },
  { id: '2', name: 'Jane Smith', age: 25, diagnosis: 'Cold' },
  { id: '3', name: 'Alice Johnson', age: 40, diagnosis: 'Diabetes' },
];

describe('PatientDataService', () => {
  let service: PatientDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatientDataService();
  });

  describe('fetchPatients', () => {
    it('fetches patient data successfully from API', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: mockPatients });

      const data = await service.fetchPatients();

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toEqual(mockPatients);
    });

    it('throws an error on network failure', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(service.fetchPatients()).rejects.toThrow('Network error');
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('retries failed requests up to maxRetries', async () => {
      const error = new Error('Timeout');
      (axios.get as jest.Mock).mockRejectedValue(error);

      service.setRetryOptions({ retries: 2, delayMs: 0 });

      await expect(service.fetchPatients()).rejects.toThrow('Timeout');
      expect(axios.get).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('returns cached data on subsequent calls without new API request', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: mockPatients });

      const firstFetch = await service.fetchPatients();
      const secondFetch = await service.fetchPatients();

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(secondFetch).toBe(firstFetch);
    });

    it('validates data structure and throws on invalid response', async () => {
      const invalidData = [{ foo: 'bar' }];

      (axios.get as jest.Mock).mockResolvedValue({ data: invalidData });

      await expect(service.fetchPatients()).rejects.toThrow('Invalid patient data');
    });

    it('applies filtering and pagination parameters correctly', async () => {
      const filter = { diagnosis: 'Flu' };
      const pagination = { page: 1, pageSize: 2 };
      (axios.get as jest.Mock).mockResolvedValue({ data: [mockPatients[0]] });

      const data = await service.fetchPatients(filter, pagination);

      expect(axios.get).toHaveBeenCalledWith(expect.any(String), {
        params: {
          diagnosis: 'Flu',
          page: 1,
          pageSize: 2,
        },
      });
      expect(data).toEqual([mockPatients[0]]);
    });

    it('handles concurrent fetch requests without duplicate API calls', async () => {
      let resolve1: (val: Patient[]) => void;
      const pendingPromise = new Promise<Patient[]>((r) => {
        resolve1 = r;
      });
      (axios.get as jest.Mock).mockReturnValue(pendingPromise);

      const p1 = service.fetchPatients();
      const p2 = service.fetchPatients();

      resolve1!(mockPatients);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(res1).toBe(res2);
    });
  });

  describe('subscription mechanism', () => {
    let mockOnSubscribe: jest.Mock;
    let mockOnUnsubscribe: jest.Mock;

    beforeEach(() => {
      mockOnSubscribe = jest.fn();
      mockOnUnsubscribe = jest.fn();

      service.setSubscriptionHandlers(mockOnSubscribe, mockOnUnsubscribe);
    });

    it('sets up real-time subscription', () => {
      const callback = jest.fn();
      service.subscribe(callback);

      expect(mockOnSubscribe).toHaveBeenCalledTimes(1);
      expect(service.subscribers.has(callback)).toBe(true);
    });

    it('cleans up subscriptions correctly', () => {
      const callback = jest.fn();

      service.subscribe(callback);
      service.unsubscribe(callback);

      expect(mockOnUnsubscribe).toHaveBeenCalledTimes(1);
      expect(service.subscribers.has(callback)).toBe(false);
    });

    it('notifies subscribers on new data', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.subscribe(callback1);
      service.subscribe(callback2);

      service.notifySubscribers(mockPatients);

      expect(callback1).toHaveBeenCalledWith(mockPatients);
      expect(callback2).toHaveBeenCalledWith(mockPatients);
    });
  });
});
```