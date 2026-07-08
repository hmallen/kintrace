import { useState } from 'react';
import { ApiError } from '../api/client';
import { useProcessQueue } from '../api/hooks';
import { useQueueStore } from '../stores/queue';

const NOT_CONFIGURED_FALLBACK =
  'AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY';

export function ProcessQueueButton() {
  const mutation = useProcessQueue();
  const setProcessing = useQueueStore((state) => state.setProcessing);
  // A 503 means no provider key is configured — a persistent disabled state
  // (never auto-cleared) rather than a transient error.
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const handleClick = async () => {
    setNote(null);
    setProcessing(true);
    try {
      const result = await mutation.mutateAsync();
      setNote(`Processed ${result.processed}, failed ${result.failed}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setNotConfigured(error.serverMessage ?? NOT_CONFIGURED_FALLBACK);
      }
      // Other errors surface via mutation.error below.
    } finally {
      // Always stop the live polling, even when the pass fails.
      setProcessing(false);
    }
  };

  const disabled = notConfigured !== null || mutation.isPending;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <button type="button" onClick={() => void handleClick()} disabled={disabled}>
        {mutation.isPending ? (
          <>
            <span aria-hidden="true" className="spinner">
              ⏳
            </span>{' '}
            Processing…
          </>
        ) : (
          'Process queue'
        )}
      </button>
      {notConfigured !== null && <span role="alert">{notConfigured}</span>}
      {notConfigured === null && mutation.isError && (
        <span role="alert">{mutation.error.serverMessage ?? mutation.error.message}</span>
      )}
      {note !== null && <span role="status">{note}</span>}
    </span>
  );
}
