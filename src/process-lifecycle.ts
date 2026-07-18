type Signal = 'SIGINT' | 'SIGTERM';

export interface ProcessLifecycleOptions {
  closeServer: () => Promise<unknown> | unknown;
  closeDatabase: () => Promise<unknown> | unknown;
  parentPid?: number;
  parentCheckIntervalMs?: number;
  onSignal?: (signal: Signal, handler: () => void) => void;
  offSignal?: (signal: Signal, handler: () => void) => void;
  isProcessAlive?: (pid: number) => boolean;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  logError?: (message: string, error: unknown) => void;
}

export interface ProcessLifecycle {
  shutdown: (reason: string, exitCode?: number) => Promise<void>;
  dispose: () => void;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function installProcessLifecycle(options: ProcessLifecycleOptions): ProcessLifecycle {
  const onSignal = options.onSignal ?? ((signal, handler) => process.once(signal, handler));
  const offSignal = options.offSignal ?? ((signal, handler) => process.off(signal, handler));
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const parentPid = options.parentPid ?? process.ppid;
  const parentCheckIntervalMs = options.parentCheckIntervalMs ?? 1_000;

  let shutdownPromise: Promise<void> | null = null;
  let parentTimer: NodeJS.Timeout | null = null;

  const shutdown = (reason: string, exitCode = 0): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      if (parentTimer) {
        clearInterval(parentTimer);
        parentTimer = null;
      }
      offSignal('SIGINT', handleSigint);
      offSignal('SIGTERM', handleSigterm);
      log(`Shutting down KinTrace API (${reason})`);

      try {
        await options.closeServer();
      } catch (error) {
        exitCode = 1;
        logError('Failed to close KinTrace API cleanly:', error);
      }

      try {
        await options.closeDatabase();
      } catch (error) {
        exitCode = 1;
        logError('Failed to close KinTrace database cleanly:', error);
      }

      exit(exitCode);
    })();

    return shutdownPromise;
  };

  const handleSigint = () => {
    void shutdown('SIGINT');
  };
  const handleSigterm = () => {
    void shutdown('SIGTERM');
  };

  onSignal('SIGINT', handleSigint);
  onSignal('SIGTERM', handleSigterm);

  if (parentPid > 0) {
    parentTimer = setInterval(() => {
      if (!isProcessAlive(parentPid)) void shutdown('parent process exited');
    }, parentCheckIntervalMs);
    parentTimer.unref();
  }

  return {
    shutdown,
    dispose: () => {
      if (parentTimer) {
        clearInterval(parentTimer);
        parentTimer = null;
      }
      offSignal('SIGINT', handleSigint);
      offSignal('SIGTERM', handleSigterm);
    },
  };
}
