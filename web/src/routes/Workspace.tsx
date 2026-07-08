import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PrecisionSchema } from '@shared/api.js';
import type { ItemDetail, PatchItemBody } from '@shared/api.js';
import { useItem, useUpdateItem } from '../api/hooks';
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
      <div role="tablist" aria-label="Transcription">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 'bold' : 'normal' }}
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

function WorkspaceContent({ item }: { item: ItemDetail }) {
  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(WorkspaceFormSchema),
    defaultValues: toFormValues(item),
  });
  const saveMutation = useUpdateItem(item.id);
  const approveMutation = useUpdateItem(item.id);

  const pending = item.status === 'pending';
  const approve409 = approveMutation.error?.status === 409;

  function onSave(values: WorkspaceFormValues) {
    const patch = diffPatch(values, item);
    if (Object.keys(patch).length === 0) return;
    saveMutation.mutate(patch);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
      <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
        <MediaViewer itemId={item.id} alt={item.title ?? 'Item media'} mediaType={item.media_type} />
      </div>
      <div style={{ flex: '1 1 400px', minWidth: '320px' }}>
        <p>
          <StatusChip status={item.status} />
        </p>
        <ConfidenceBanner confidence={item.ai_confidence} aiError={item.ai_error} />
        <form onSubmit={(e) => void form.handleSubmit(onSave)(e)}>
          <TranscriptionTabs
            form={form}
            flaggedSpans={item.ai_confidence?.flaggedSpans ?? []}
          />
          <MetadataForm control={form.control} register={form.register} />
          <button type="submit" disabled={saveMutation.isPending}>
            Save
          </button>
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
            <span style={{ marginLeft: '0.5rem', color: '#92400e' }}>
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
  const id = Number(params.id);
  const { data: item, isPending, isError, error } = useItem(id);

  return (
    <section>
      <h2>Workspace</h2>
      {isPending && <p>Loading item…</p>}
      {isError && <p role="alert">Failed to load item: {error.message}</p>}
      {item && <WorkspaceContent key={item.id} item={item} />}
    </section>
  );
}
