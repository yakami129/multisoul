import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { type Endpoint } from '@/types';
import {
  ACTIVITY_PAGE_SIZE,
  activityResultCount,
  hasMoreActivity,
  mergeActivityPages,
  nextActivityLimit,
} from '../services/activityPagination';
import { aggregateActivity, type AggregatedActivityResult } from '../services/activityService';

function emptyActivity(): AggregatedActivityResult {
  return {
    needsAttention: [],
    running: [],
    done: [],
    failedEndpoints: [],
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useActivityInfiniteQuery({
  endpoints,
  enabled,
}: {
  endpoints: Endpoint[];
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const endpointKey = useMemo(
    () =>
      endpoints.map((endpoint) => ({
        id: endpoint.id,
        base_url: endpoint.base_url,
        token: endpoint.token,
      })),
    [endpoints],
  );
  const canQuery = enabled && endpoints.length > 0;
  const queryKey = useMemo(() => ['activity', endpointKey] as const, [endpointKey]);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  const query = useInfiniteQuery({
    queryKey,
    enabled: canQuery,
    initialPageParam: ACTIVITY_PAGE_SIZE,
    queryFn: ({ pageParam }) => aggregateActivity(endpoints, pageParam),
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      const previousPage = allPages.at(-2);
      const previousCount = previousPage ? activityResultCount(previousPage) : 0;
      const currentCount = activityResultCount(lastPage);
      if (!hasMoreActivity({ previousCount, currentCount, currentLimit: lastPageParam })) {
        return undefined;
      }
      return nextActivityLimit(lastPageParam);
    },
  });

  const activity =
    endpoints.length === 0 ? emptyActivity() : mergeActivityPages(query.data?.pages ?? []);

  const refetch = useCallback(async () => {
    setLoadMoreError(null);
    if (!canQuery) return;
    await query.refetch();
  }, [canQuery, query]);

  const refreshFirstPage = useCallback(async () => {
    setLoadMoreError(null);
    if (!canQuery) return;
    queryClient.setQueryData<
      { pages: AggregatedActivityResult[]; pageParams: unknown[] } | undefined
    >(queryKey, (data) => {
      if (!data) return data;
      return {
        pages: data.pages.slice(0, 1),
        pageParams: data.pageParams.slice(0, 1),
      };
    });
    await query.refetch();
  }, [canQuery, query, queryClient, queryKey]);

  const fetchNextPage = useCallback(async () => {
    if (!canQuery || !query.hasNextPage || query.isFetchingNextPage) return;
    setLoadMoreError(null);
    try {
      await query.fetchNextPage({ cancelRefetch: false, throwOnError: true });
    } catch (error) {
      setLoadMoreError(toError(error));
    }
  }, [canQuery, query]);

  return {
    activity,
    isInitialLoading: canQuery && query.isLoading,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    loadMoreError,
    refetch,
    refreshFirstPage,
    fetchNextPage,
  };
}
