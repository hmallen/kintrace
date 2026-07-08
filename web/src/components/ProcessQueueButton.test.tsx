import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { makeQueryClient } from '../queryClient';
import { server } from '../test/msw';
import { useItems } from '../api/hooks';
import { useQueueStore } from '../stores/queue';
import { ProcessQueueButton } from './ProcessQueueButton';

function renderButton(extra?: ReactNode) {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <ProcessQueueButton />
      {extra}
    </QueryClientProvider>,
  );
}

// A gate the test opens to let the queue-process handler respond, keeping the
// mutation deterministically pending for as long as the test needs.
function gatedProcessHandler(processed: number, failed: number) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = http.post('/api/queue/process', async () => {
    await gate;
    return HttpResponse.json({ processed, failed });
  });
  return { handler, release };
}

afterEach(() => {
  useQueueStore.setState({ processing: false });
});

describe('ProcessQueueButton', () => {
  it('click triggers processing state', async () => {
    const { handler, release } = gatedProcessHandler(1, 0);
    server.use(handler);

    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Process queue' }));

    expect(await screen.findByText('Processing…')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();

    release();
    await screen.findByText('Processed 1, failed 0');
  });

  it('503 shows persistent disabled state', async () => {
    const message = 'AI not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY';
    server.use(
      http.post('/api/queue/process', () =>
        HttpResponse.json({ error: message }, { status: 503 }),
      ),
    );

    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Process queue' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();

    // The disabled state persists — it does not auto-clear on a timer.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('success shows processed note', async () => {
    server.use(
      http.post('/api/queue/process', () =>
        HttpResponse.json({ processed: 2, failed: 0 }),
      ),
    );

    renderButton();
    await userEvent.click(screen.getByRole('button', { name: 'Process queue' }));

    expect(await screen.findByText('Processed 2, failed 0')).toBeInTheDocument();
  });

  it('polling activates during processing', async () => {
    let itemsCalls = 0;
    const { handler, release } = gatedProcessHandler(1, 0);
    server.use(
      http.get('/api/items', () => {
        itemsCalls += 1;
        return HttpResponse.json([]);
      }),
      handler,
    );

    function ItemsProbe() {
      useItems({});
      return null;
    }

    renderButton(<ItemsProbe />);
    await waitFor(() => expect(itemsCalls).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: 'Process queue' }));
    expect(useQueueStore.getState().processing).toBe(true);

    // With the mutation still pending (gate closed), only the 2s
    // refetchInterval can drive another items fetch.
    await waitFor(() => expect(itemsCalls).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
    });
    expect(useQueueStore.getState().processing).toBe(true);

    release();
    await screen.findByText('Processed 1, failed 0');
    await waitFor(() => expect(useQueueStore.getState().processing).toBe(false));
  });
});
