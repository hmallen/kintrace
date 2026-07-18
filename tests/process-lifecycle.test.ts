import { afterEach, describe, expect, it, vi } from 'vitest';
import { installProcessLifecycle } from '../src/process-lifecycle.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('installProcessLifecycle', () => {
  it('closes the server and database once when interrupted', async () => {
    const handlers = new Map<string, () => void>();
    const closeServer = vi.fn(async () => undefined);
    const closeDatabase = vi.fn(() => undefined);
    const exit = vi.fn();
    const lifecycle = installProcessLifecycle({
      closeServer,
      closeDatabase,
      parentPid: 0,
      onSignal: (signal, handler) => handlers.set(signal, handler),
      offSignal: (signal) => handlers.delete(signal),
      exit,
      log: vi.fn(),
    });

    handlers.get('SIGINT')?.();
    await lifecycle.shutdown('duplicate request');

    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(closeServer.mock.invocationCallOrder[0]).toBeLessThan(
      closeDatabase.mock.invocationCallOrder[0],
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('shuts down when the dev runner parent disappears', async () => {
    vi.useFakeTimers();
    const closeServer = vi.fn(async () => undefined);
    const closeDatabase = vi.fn(() => undefined);
    const exit = vi.fn();
    const lifecycle = installProcessLifecycle({
      closeServer,
      closeDatabase,
      parentPid: 1234,
      parentCheckIntervalMs: 50,
      onSignal: vi.fn(),
      offSignal: vi.fn(),
      isProcessAlive: () => false,
      exit,
      log: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    lifecycle.dispose();
  });

  it('still closes the database and exits with an error if server close fails', async () => {
    const closeDatabase = vi.fn(() => undefined);
    const exit = vi.fn();
    const lifecycle = installProcessLifecycle({
      closeServer: async () => {
        throw new Error('close failed');
      },
      closeDatabase,
      parentPid: 0,
      onSignal: vi.fn(),
      offSignal: vi.fn(),
      exit,
      log: vi.fn(),
      logError: vi.fn(),
    });

    await lifecycle.shutdown('test');

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
