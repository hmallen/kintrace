import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        // Top-level query failures throw so the route error boundary can render
        // a retryable error UI (or the full-page BackendDown for fetch rejections)
        // instead of each route hand-rolling its own load-error branch. Mutations
        // keep their inline per-control error handling (they don't get this).
        throwOnError: true,
      },
    },
  });
}
