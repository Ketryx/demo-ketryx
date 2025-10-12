```typescript
import { useState, useEffect, useCallback, useRef } from 'react';

type SortOrder = 'asc' | 'desc';

interface FetchParams<TFilters, TSortKey> {
  page?: number;
  pageSize?: number;
  filters?: Partial<TFilters>;
  sortKey?: TSortKey;
  sortOrder?: SortOrder;
  signal?: AbortSignal;
}

interface UsePatientDataOptions<TFilters, TSortKey> {
  fetchFunction: (params: FetchParams<TFilters, TSortKey>) => Promise<any>;
  initialFilters?: Partial<TFilters>;
  initialSortKey?: TSortKey;
  initialSortOrder?: SortOrder;
  initialPageSize?: number;
  autoRefetchIntervalMs?: number;
  cacheDurationMs?: number;
}

interface UsePatientDataReturn<TData, TFilters, TSortKey> {
  data: TData | null;
  loading: boolean;
  error: Error | null;
  page: number;
  pageSize: number;
  filters: Partial<TFilters>;
  sortKey?: TSortKey;
  sortOrder?: SortOrder;
  refetch: () => void;
  setFilter: (key: keyof TFilters, value: any) => void;
  resetFilters: () => void;
  setSort: (key: TSortKey, order?: SortOrder) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  optimisticUpdate: (data: TData) => void;
}

interface CacheEntry<TData> {
  timestamp: number;
  data: TData;
}

export function usePatientData<
  TData = any,
  TFilters extends Record<string, any> = any,
  TSortKey extends keyof any = string
>(
  options: UsePatientDataOptions<TFilters, TSortKey>
): UsePatientDataReturn<TData, TFilters, TSortKey> {
  const {
    fetchFunction,
    initialFilters = {},
    initialSortKey,
    initialSortOrder = 'asc',
    initialPageSize = 20,
    autoRefetchIntervalMs = 0,
    cacheDurationMs = 5 * 60 * 1000, // 5 minutes
  } = options;

  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [filters, setFilters] = useState<Partial<TFilters>>(initialFilters);
  const [sortKey, setSortKey] = useState<TSortKey | undefined>(initialSortKey);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialSortOrder);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const cacheRef = useRef<Map<string, CacheEntry<TData>>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  const generateCacheKey = useCallback((): string => {
    const keyObj = {
      page,
      pageSize,
      filters,
      sortKey,
      sortOrder,
    };
    return JSON.stringify(keyObj);
  }, [page, pageSize, filters, sortKey, sortOrder]);

  const invalidateCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  const fetchData = useCallback(async () => {
    const cacheKey = generateCacheKey();

    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheDurationMs) {
      setData(cached.data);
      setLoading(false);
      setError(null);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchFunction({
        page,
        pageSize,
        filters,
        sortKey,
        sortOrder,
        signal: abortController.signal,
      });

      cacheRef.current.set(cacheKey, { timestamp: Date.now(), data: result });
      setData(result);
      setLoading(false);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err);
      setLoading(false);
    }
  }, [fetchFunction, page, pageSize, filters, sortKey, sortOrder, cacheDurationMs, generateCacheKey]);

  const refetch = useCallback(() => {
    invalidateCache();
    fetchData();
  }, [fetchData, invalidateCache]);

  // Auto refetch interval
  useEffect(() => {
    fetchData();
    if (autoRefetchIntervalMs > 0) {
      const interval = setInterval(fetchData, autoRefetchIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchData, autoRefetchIntervalMs]);

  const setFilter = useCallback(
    (key: keyof TFilters, value: any) => {
      setFilters((prev) => {
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      });
      setPage(1);
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setPage(1);
  }, [initialFilters]);

  const setSort = useCallback((key: TSortKey, order: SortOrder = 'asc') => {
    setSortKey(key);
    setSortOrder(order);
    setPage(1);
  }, []);

  const optimisticUpdate = useCallback(
    (updatedData: TData) => {
      setData(updatedData);
      invalidateCache();
    },
    [invalidateCache]
  );

  const setPageSafe = useCallback((newPage: number) => {
    if (newPage < 1) return;
    setPage(newPage);
  }, []);

  const setPageSizeSafe = useCallback((newSize: number) => {
    if (newSize < 1) return;
    setPageSize(newSize);
    setPage(1);
  }, []);

  return {
    data,
    loading,
    error,
    page,
    pageSize,
    filters,
    sortKey,
    sortOrder,
    refetch,
    setFilter,
    resetFilters,
    setSort,
    setPage: setPageSafe,
    setPageSize: setPageSizeSafe,
    optimisticUpdate,
  };
}
```