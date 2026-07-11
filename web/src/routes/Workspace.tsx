import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MediaTypeSchema, PrecisionSchema, StatusSchema } from '@shared/api.js';
import type { ItemDetail, ItemSummary, MediaType, PatchItemBody } from '@shared/api.js';
import {
  useCreateItemGroup,
  useItem,
  useItemGroupSuggestions,
  useItems,
  useRemoveItemFromGroup,
  useUpdateItemGroup,
  useUpdateItem,
  type ItemFilters,
} from '../api/hooks';
import { FlagsSidebar } from '../review/FlagsSidebar';
import {
  TranscriptionEditor,
  type TranscriptionEditorHandle,
} from '../review/TranscriptionEditor';
import { ConfidenceBanner } from '../components/ConfidenceBanner';
import { MediaViewer } from '../components/MediaViewer';
import { MetadataForm } from '../components/MetadataForm';
import { PeoplePanel } from '../components/PeoplePanel';
import { StatusChip } from '../components/StatusChip';
import { Thumbnail } from '../components/Thumbnail';

export const WorkspaceFormSchema = z.object({
  title: z.string(),
  description: z.string(),
  transcription_diplomatic: z.string().nullable(),
  transcription_normalized: z.string().nullable(),
  date: z.object({
    start: z.string().nullable(),
    precision: PrecisionSchema,
  }),
});
export type WorkspaceFormValues = z.infer<typeof WorkspaceFormSchema>;

function toFormValues(item: ItemDetail): WorkspaceFormValues {
  return {
    title: item.title ?? '',
    description: item.description ?? '',
    transcription_diplomatic: item.transcription_diplomatic,
    transcription_normalized: item.transcription_normalized,
    date: { start: item.date_start, precision: item.date_precision },
  };
}

// Save sends only fields that differ from the loaded item; ai_confidence is
// display-only and never part of a PATCH body.
function diffPatch(values: WorkspaceFormValues, item: ItemDetail): PatchItemBody {
  const patch: PatchItemBody = {};
  if (values.title !== (item.title ?? '')) patch.title = values.title;
  if (values.description !== (item.description ?? '')) {
    patch.description = values.description;
  }
  if (
    values.transcription_diplomatic !== null &&
    values.transcription_diplomatic !== item.transcription_diplomatic
  ) {
    patch.transcription_diplomatic = values.transcription_diplomatic;
  }
  if (
    values.transcription_normalized !== null &&
    values.transcription_normalized !== item.transcription_normalized
  ) {
    patch.transcription_normalized = values.transcription_normalized;
  }
  const start = values.date.precision === 'unknown' ? null : values.date.start;
  if (start !== item.date_start || values.date.precision !== item.date_precision) {
    patch.date = { start, precision: values.date.precision };
  }
  return patch;
}

const TABS = ['diplomatic', 'normalized'] as const;
const MEDIA_TYPES = MediaTypeSchema.options;
type Tab = (typeof TABS)[number];
const TAB_FIELD = {
  diplomatic: 'transcription_diplomatic',
  normalized: 'transcription_normalized',
} as const;

function TranscriptionTabs({
  form,
  flaggedSpans,
}: {
  form: UseFormReturn<WorkspaceFormValues>;
  flaggedSpans: { text: string; reason: string }[];
}) {
  const [tab, setTab] = useState<Tab>('diplomatic');
  const editorRef = useRef<TranscriptionEditorHandle>(null);
  const field = TAB_FIELD[tab];
  const value = form.watch(field);
  const diplomaticValue = form.watch('transcription_diplomatic');

  return (
    <section>
      <div role="tablist" aria-label="Transcription" className="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'diplomatic' ? 'Diplomatic' : 'Normalized'}
          </button>
        ))}
      </div>
      {value === null ? (
        <p>
          No text detected.{' '}
          <button
            type="button"
            onClick={() => form.setValue(field, '', { shouldDirty: true })}
          >
            Start transcription
          </button>
        </p>
      ) : (
        <TranscriptionEditor
          key={tab}
          ref={editorRef}
          label={`${tab === 'diplomatic' ? 'Diplomatic' : 'Normalized'} transcription`}
          value={value}
          onChange={(next) => form.setValue(field, next, { shouldDirty: true })}
          // Flagged spans quote diplomatic text; the normalized editor gets none.
          flaggedSpans={tab === 'diplomatic' ? flaggedSpans : []}
        />
      )}
      <FlagsSidebar
        spans={flaggedSpans}
        value={diplomaticValue ?? ''}
        onSpanClick={(text) => {
          // Span offsets only make sense in the diplomatic text.
          if (tab === 'diplomatic') editorRef.current?.selectSpan(text);
        }}
      />
    </section>
  );
}

const GROUP_REASON_LABELS = {
  filename: 'similar filename',
  title: 'matching title',
  transcription: 'matching transcription',
} as const;

function ItemGroupPanel({ item, items }: { item: ItemDetail; items: ItemSummary[] }) {
  const [selectedItemId, setSelectedItemId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [groupName, setGroupName] = useState(item.group?.label ?? '');
  const { data: allItems = items } = useItems({});
  const { data: suggestions = [] } = useItemGroupSuggestions(item.id);
  const createGroup = useCreateItemGroup();
  const removeFromGroup = useRemoveItemFromGroup();
  const updateGroup = useUpdateItemGroup();
  const memberIds = new Set(item.group?.items.map(({ id }) => id) ?? [item.id]);
  const availableItems = allItems.filter(({ id }) => !memberIds.has(id));

  function groupWith(otherItemId: number) {
    createGroup.mutate({
      itemIds: [item.id, otherItemId],
      ...(!item.group && newGroupName.trim() ? { label: newGroupName.trim() } : {}),
    });
  }

  return (
    <section className="item-group-panel" aria-labelledby="item-group-heading">
      <h3 id="item-group-heading">Views of this item</h3>
      <p className="hint">
        Keep alternate angles and magnifications together while processing each image independently.
      </p>
      {item.group ? (
        <>
          <form
            className="item-group-name"
            onSubmit={(event) => {
              event.preventDefault();
              const label = groupName.trim();
              if (!label) return;
              updateGroup.mutate({ groupId: item.group!.id, body: { label } });
            }}
          >
            <label>
              Group name{' '}
              <input
                value={groupName}
                placeholder="Unnamed group"
                onChange={(event) => setGroupName(event.target.value)}
              />
            </label>{' '}
            <button type="submit" disabled={!groupName.trim() || updateGroup.isPending}>
              Save group name
            </button>
          </form>
          <ul className="item-group-views">
            {item.group.items.map((member) => (
              <li key={member.id} className={member.id === item.id ? 'is-current' : undefined}>
                <Link to={`/items/${member.id}`} aria-current={member.id === item.id ? 'page' : undefined}>
                  <Thumbnail
                    itemId={member.id}
                    alt={member.title ?? `View ${member.id}`}
                    mediaType={member.media_type}
                  />
                  <span>{member.title ?? `Untitled view ${member.id}`}</span>
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={removeFromGroup.isPending}
            onClick={() => removeFromGroup.mutate({ groupId: item.group!.id, itemId: item.id })}
          >
            Remove this view from group
          </button>
        </>
      ) : (
        <>
          <p>This item is not grouped yet.</p>
          <label>
            New group name{' '}
            <input
              value={newGroupName}
              placeholder="Optional"
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
        </>
      )}

      {availableItems.length > 0 && (
        <div className="item-group-add">
          <label>
            Add an existing item{' '}
            <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
              <option value="">Choose an item…</option>
              {availableItems.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title ?? `Untitled item ${candidate.id}`}
                </option>
              ))}
            </select>
          </label>{' '}
          <button
            type="button"
            disabled={!selectedItemId || createGroup.isPending}
            onClick={() => groupWith(Number(selectedItemId))}
          >
            Add view
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <h4>Possible matches</h4>
          <ul className="item-group-suggestions">
            {suggestions.map((suggestion) => (
              <li key={suggestion.item.id}>
                <span>
                  {suggestion.item.title ?? `Untitled item ${suggestion.item.id}`} —{' '}
                  {suggestion.reasons.map((reason) => GROUP_REASON_LABELS[reason]).join(', ')}
                </span>{' '}
                <button
                  type="button"
                  disabled={createGroup.isPending}
                  onClick={() => groupWith(suggestion.item.id)}
                >
                  Group as another view
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(createGroup.isError || removeFromGroup.isError || updateGroup.isError) && (
        <p role="alert">
          Could not update item views:{' '}
          {(createGroup.error ?? removeFromGroup.error ?? updateGroup.error)?.message}
        </p>
      )}
    </section>
  );
}

function WorkspaceContent({ item, items }: { item: ItemDetail; items: ItemSummary[] }) {
  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(WorkspaceFormSchema),
    defaultValues: toFormValues(item),
  });
  const saveMutation = useUpdateItem(item.id);
  const approveMutation = useUpdateItem(item.id);
  const typeMutation = useUpdateItem(item.id);

  const pending = item.status === 'pending';
  const approve409 = approveMutation.error?.status === 409;

  function onSave(values: WorkspaceFormValues) {
    const patch = diffPatch(values, item);
    if (Object.keys(patch).length === 0) return;
    saveMutation.mutate(patch, {
      onSuccess: (savedItem) => form.reset(toFormValues(savedItem)),
    });
  }

  return (
    <div className="workspace">
      <div className="workspace-media">
        <MediaViewer
          itemId={item.id}
          alt={item.title ?? 'Item media'}
          mediaType={item.media_type}
          filePath={item.file_path}
        />
      </div>
      <div className="workspace-review">
        <p>
          <StatusChip status={item.status} />{' '}
          {pending && (
            <label>
              Type{' '}
              <select
                aria-label="Item type"
                value={item.media_type}
                disabled={typeMutation.isPending}
                onChange={(event) => typeMutation.mutate({
                  media_type: event.target.value as MediaType,
                })}
              >
                {MEDIA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
          )}
        </p>
        {typeMutation.isError && (
          <p role="alert">Failed to change item type: {typeMutation.error.message}</p>
        )}
        <ItemGroupPanel item={item} items={items} />
        <ConfidenceBanner confidence={item.ai_confidence} aiError={item.ai_error} />
        <form onSubmit={(e) => void form.handleSubmit(onSave)(e)}>
          <TranscriptionTabs
            form={form}
            flaggedSpans={item.ai_confidence?.flaggedSpans ?? []}
          />
          <MetadataForm control={form.control} register={form.register} />
          <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
            Save
          </button>
          {saveMutation.isSuccess && !form.formState.isDirty && (
            <span role="status" style={{ marginLeft: '0.5rem' }}>
              Changes saved.
            </span>
          )}
          {saveMutation.isError && (
            <p role="alert">Save failed: {saveMutation.error.message}</p>
          )}
        </form>
        <PeoplePanel item={item} />
        <p>
          <button
            type="button"
            disabled={pending || approveMutation.isPending}
            onClick={() => approveMutation.mutate({ status: 'reviewed' })}
          >
            Mark reviewed
          </button>
          {(pending || approve409) && (
            <span style={{ marginLeft: '0.5rem', color: 'var(--kt-status-pending)' }}>
              item hasn&apos;t been transcribed yet
            </span>
          )}
          {approveMutation.isError && !approve409 && (
            <span role="alert" style={{ marginLeft: '0.5rem' }}>
              Failed to mark reviewed: {approveMutation.error.message}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export function Workspace() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = Number(params.id);
  const { data: item, isPending } = useItem(id);
  const filters: ItemFilters = {};
  const status = StatusSchema.safeParse(searchParams.get('status'));
  if (status.success) filters.status = status.data;
  const personId = Number(searchParams.get('personId'));
  if (Number.isInteger(personId) && personId > 0) filters.personId = personId;
  const { data: items } = useItems(filters);
  const itemIndex = items?.findIndex((candidate) => candidate.id === id) ?? -1;
  const previousId = itemIndex > 0 ? items?.[itemIndex - 1]?.id : undefined;
  const nextId = itemIndex >= 0 ? items?.[itemIndex + 1]?.id : undefined;

  function openItem(nextItemId: number | undefined) {
    if (nextItemId === undefined) return;
    const search = searchParams.toString();
    navigate({ pathname: `/items/${nextItemId}`, search });
  }

  return (
    <section>
      <h2>Workspace</h2>
      <nav className="item-navigation" aria-label="Library items">
        <button type="button" disabled={previousId === undefined} onClick={() => openItem(previousId)}>
          Previous
        </button>
        <span>
          {itemIndex >= 0 && items ? `${itemIndex + 1} of ${items.length}` : 'Item position unavailable'}
        </span>
        <button type="button" disabled={nextId === undefined} onClick={() => openItem(nextId)}>
          Next
        </button>
      </nav>
      {isPending && <p>Loading item…</p>}
      {item && <WorkspaceContent key={item.id} item={item} items={items ?? []} />}
    </section>
  );
}
