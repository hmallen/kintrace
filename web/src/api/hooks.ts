import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  ItemDetailSchema,
  ItemSummarySchema,
  PersonSchema,
  CreatePersonResultSchema,
  MergePeopleResultSchema,
  EventSummarySchema,
  GedcomImportResultSchema,
  GedcomReviewItemSchema,
  GedcomReviewQueueSchema,
  ItemGroupSchema,
  LibraryPersonGroupSchema,
  ItemGroupSuggestionSchema,
  QueueResultSchema,
  TimelineStoryStateSchema,
  DocumentSheetIngestResultSchema,
} from '@shared/api.js';
import type {
  ItemSummary,
  ItemDetail,
  Person,
  PersonRole,
  EventSummary,
  GedcomImportResult,
  GedcomReviewGroup,
  GedcomReviewItem,
  GedcomReviewQueue,
  ItemGroup,
  LibraryPersonGroup,
  ItemGroupSuggestion,
  CreateItemGroupBody,
  UpdateItemGroupBody,
  PatchItemBody,
  LinkPersonBody,
  CreatePersonBody,
  CreatePersonResult,
  MergePeopleBody,
  MergePeopleResult,
  QueueResult,
  Status,
  TimelineStoryState,
  DocumentSheetIngestResult,
} from '@shared/api.js';
import { ApiError, apiFetch, apiSend } from './client';
import { useQueueStore } from '../stores/queue';

export interface ItemFilters {
  status?: Status;
  personId?: number;
}

function itemsPath(filters: ItemFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.personId !== undefined) params.set('personId', String(filters.personId));
  const qs = params.toString();
  return qs ? `/api/items?${qs}` : '/api/items';
}

export function useItems(filters: ItemFilters): UseQueryResult<ItemSummary[], ApiError> {
  // While the queue is being processed (UI flag set by ProcessQueueButton),
  // poll so item statuses tick over live; stop as soon as the pass settles.
  const processing = useQueueStore((state) => state.processing);
  return useQuery<ItemSummary[], ApiError>({
    queryKey: ['items', filters],
    queryFn: () => apiFetch(itemsPath(filters), ItemSummarySchema.array()),
    refetchInterval: () => (processing ? 2000 : false),
  });
}

export function useItem(id: number): UseQueryResult<ItemDetail, ApiError> {
  return useQuery<ItemDetail, ApiError>({
    queryKey: ['item', id],
    queryFn: () => apiFetch(`/api/items/${id}`, ItemDetailSchema),
  });
}

export function useItemGroupSuggestions(
  itemId: number,
): UseQueryResult<ItemGroupSuggestion[], ApiError> {
  return useQuery<ItemGroupSuggestion[], ApiError>({
    queryKey: ['item-group-suggestions', itemId],
    queryFn: () => apiFetch(
      `/api/items/${itemId}/group-suggestions`,
      ItemGroupSuggestionSchema.array(),
    ),
  });
}

export function useItemGroups(): UseQueryResult<ItemGroup[], ApiError> {
  return useQuery<ItemGroup[], ApiError>({
    queryKey: ['item-groups'],
    queryFn: () => apiFetch('/api/item-groups', ItemGroupSchema.array()),
  });
}

export function useLibraryPersonGroups(): UseQueryResult<LibraryPersonGroup[], ApiError> {
  return useQuery<LibraryPersonGroup[], ApiError>({
    queryKey: ['library-people'],
    queryFn: () => apiFetch('/api/library/people', LibraryPersonGroupSchema.array()),
  });
}

async function invalidateItemGroups(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['items'] }),
    queryClient.invalidateQueries({ queryKey: ['item'] }),
    queryClient.invalidateQueries({ queryKey: ['item-groups'] }),
    queryClient.invalidateQueries({ queryKey: ['item-group-suggestions'] }),
  ]);
}

export function useCreateItemGroup(): UseMutationResult<
  ItemGroup,
  ApiError,
  CreateItemGroupBody
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch('/api/item-groups', ItemGroupSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    onSuccess: () => invalidateItemGroups(queryClient),
  });
}

export function useAddItemToGroup(): UseMutationResult<
  ItemGroup,
  ApiError,
  { groupId: number; itemId: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, itemId }) => apiFetch(
      `/api/item-groups/${groupId}/items`,
      ItemGroupSchema,
      { method: 'POST', body: JSON.stringify({ itemId }) },
    ),
    onSuccess: () => invalidateItemGroups(queryClient),
  });
}

export function useLinkItemGroupToPerson(): UseMutationResult<
  void,
  ApiError,
  { groupId: number; personId: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, personId }) => apiSend(`/api/item-groups/${groupId}/people`, {
      method: 'POST',
      body: JSON.stringify({ personId, role: 'subject' }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['library-people'] }),
        queryClient.invalidateQueries({ queryKey: ['item'] }),
      ]);
    },
  });
}

export function useRemoveItemFromGroup(): UseMutationResult<
  void,
  ApiError,
  { groupId: number; itemId: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, itemId }) => apiSend(
      `/api/item-groups/${groupId}/items/${itemId}`,
      { method: 'DELETE' },
    ),
    onSuccess: () => invalidateItemGroups(queryClient),
  });
}

export function useUpdateItemGroup(): UseMutationResult<
  ItemGroup,
  ApiError,
  { groupId: number; body: UpdateItemGroupBody }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, body }) => apiFetch(`/api/item-groups/${groupId}`, ItemGroupSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    onSuccess: () => invalidateItemGroups(queryClient),
  });
}

export function usePeople(): UseQueryResult<Person[], ApiError> {
  return useQuery<Person[], ApiError>({
    queryKey: ['people'],
    queryFn: () => apiFetch('/api/people', PersonSchema.array()),
  });
}

export function useEvents(): UseQueryResult<EventSummary[], ApiError> {
  return useQuery<EventSummary[], ApiError>({
    queryKey: ['events'],
    queryFn: () => apiFetch('/api/events', EventSummarySchema.array()),
  });
}

export function useTimelineStory(): UseQueryResult<TimelineStoryState, ApiError> {
  return useQuery<TimelineStoryState, ApiError>({
    queryKey: ['timeline-story'],
    queryFn: () => apiFetch('/api/timeline/story', TimelineStoryStateSchema),
  });
}

export function useGenerateTimelineStory(): UseMutationResult<TimelineStoryState, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<TimelineStoryState, ApiError, void>({
    mutationFn: () => apiFetch('/api/timeline/story', TimelineStoryStateSchema, { method: 'POST' }),
    onSuccess: (state) => {
      queryClient.setQueryData(['timeline-story'], state);
    },
  });
}

function applyPatch(prev: ItemDetail, patch: PatchItemBody): ItemDetail {
  const next: ItemDetail = { ...prev };
  if (patch.media_type !== undefined) next.media_type = patch.media_type;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.transcription_diplomatic !== undefined) {
    next.transcription_diplomatic = patch.transcription_diplomatic;
  }
  if (patch.transcription_normalized !== undefined) {
    next.transcription_normalized = patch.transcription_normalized;
  }
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.date !== undefined) {
    if (patch.date.start !== undefined) next.date_start = patch.date.start;
    if (patch.date.end !== undefined) next.date_end = patch.date.end;
    if (patch.date.precision !== undefined) next.date_precision = patch.date.precision;
  }
  return next;
}

export function useUpdateItem(
  id: number,
): UseMutationResult<ItemDetail, ApiError, PatchItemBody> {
  const queryClient = useQueryClient();
  return useMutation<ItemDetail, ApiError, PatchItemBody, { previous: ItemDetail | undefined }>({
    mutationFn: (body) =>
      apiFetch(`/api/items/${id}`, ItemDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ['item', id] });
      const previous = queryClient.getQueryData<ItemDetail>(['item', id]);
      if (previous !== undefined) {
        queryClient.setQueryData<ItemDetail>(['item', id], applyPatch(previous, body));
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['item', id], context.previous);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['item', id] });
      await queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onSettled: async (_data, error) => {
      // Success invalidation happens in onSuccess; after an error rollback,
      // refetch server truth in case it changed underneath the optimistic write.
      if (error) {
        await queryClient.invalidateQueries({ queryKey: ['item', id] });
      }
    },
  });
}

export function useLinkPerson(
  itemId: number,
): UseMutationResult<void, ApiError, LinkPersonBody> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, LinkPersonBody>({
    mutationFn: (body) =>
      apiSend(`/api/items/${itemId}/people`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['item', itemId] });
    },
  });
}

export function useProcessQueue(): UseMutationResult<QueueResult, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation<QueueResult, ApiError, void>({
    mutationFn: () =>
      apiFetch('/api/queue/process', QueueResultSchema, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['item'] });
    },
  });
}

export function useCreatePerson(): UseMutationResult<
  CreatePersonResult,
  ApiError,
  CreatePersonBody
> {
  const queryClient = useQueryClient();
  return useMutation<CreatePersonResult, ApiError, CreatePersonBody>({
    mutationFn: (body) =>
      apiFetch('/api/people', CreatePersonResultSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export function useMergePeople(): UseMutationResult<
  MergePeopleResult,
  ApiError,
  MergePeopleBody
> {
  const queryClient = useQueryClient();
  return useMutation<MergePeopleResult, ApiError, MergePeopleBody>({
    mutationFn: (body) =>
      apiFetch('/api/people/merge', MergePeopleResultSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['people'] }),
        queryClient.invalidateQueries({ queryKey: ['items'] }),
        queryClient.invalidateQueries({ queryKey: ['item'] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
      ]);
    },
  });
}

export function useUnlinkPerson(
  itemId: number,
): UseMutationResult<void, ApiError, { personId: number; role: PersonRole }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { personId: number; role: PersonRole }>({
    mutationFn: ({ personId, role }) =>
      apiSend(`/api/items/${itemId}/people/${personId}/${role}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      await queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useDeleteItem(): UseMutationResult<void, ApiError, number> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, number>({
    mutationFn: (itemId) => apiSend(`/api/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: async (_data, itemId) => {
      queryClient.removeQueries({ queryKey: ['item', itemId] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['items'] }),
        queryClient.invalidateQueries({ queryKey: ['item-groups'] }),
      ]);
    },
  });
}

export function useImportGedcom(): UseMutationResult<GedcomImportResult, ApiError, File> {
  const queryClient = useQueryClient();
  return useMutation<GedcomImportResult, ApiError, File>({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch('/api/gedcom/import', GedcomImportResultSchema, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['gedcom-review'] });
    },
  });
}

export function useIngestDocumentSheet(): UseMutationResult<
  DocumentSheetIngestResult,
  ApiError,
  File
> {
  const queryClient = useQueryClient();
  return useMutation<DocumentSheetIngestResult, ApiError, File>({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch('/api/document-sheets/ingest', DocumentSheetIngestResultSchema, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useGedcomReviewQueue(): UseQueryResult<GedcomReviewQueue, ApiError> {
  return useQuery<GedcomReviewQueue, ApiError>({
    queryKey: ['gedcom-review'],
    queryFn: () => apiFetch('/api/gedcom/review', GedcomReviewQueueSchema),
  });
}

type ReviewAction = 'accept' | 'reject';

async function invalidateReviewedData(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['gedcom-review'] }),
    queryClient.invalidateQueries({ queryKey: ['people'] }),
    queryClient.invalidateQueries({ queryKey: ['events'] }),
  ]);
}

export function useReviewGedcomItem(): UseMutationResult<
  GedcomReviewItem,
  ApiError,
  { id: number; action: ReviewAction }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }) => apiFetch(
      `/api/gedcom/review/${id}/${action}`,
      GedcomReviewItemSchema,
      { method: 'POST' },
    ),
    onSuccess: () => invalidateReviewedData(queryClient),
  });
}

export function useReviewGedcomGroup(): UseMutationResult<
  GedcomReviewItem[],
  ApiError,
  { group: GedcomReviewGroup; action: ReviewAction }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ group, action }) => apiFetch(
      `/api/gedcom/review/groups/${group}/${action}`,
      GedcomReviewItemSchema.array(),
      { method: 'POST' },
    ),
    onSuccess: () => invalidateReviewedData(queryClient),
  });
}

export function useReviewGedcomSelection(): UseMutationResult<
  GedcomReviewItem[],
  ApiError,
  { ids: number[]; action: ReviewAction }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }) => apiFetch(
      `/api/gedcom/review/selection/${action}`,
      GedcomReviewItemSchema.array(),
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),
    onSuccess: () => invalidateReviewedData(queryClient),
  });
}
