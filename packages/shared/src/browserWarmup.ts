type WarmupCleanup = () => void;
type IdleCallbackHandle = number;
type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type NavigatorConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

function readConnection(): NavigatorConnection | undefined {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  return (navigator as Navigator & {
    connection?: NavigatorConnection;
    mozConnection?: NavigatorConnection;
    webkitConnection?: NavigatorConnection;
  }).connection;
}

export function shouldSkipSpeculativeWarmup(): boolean {
  const connection = readConnection();
  if (!connection) {
    return false;
  }

  if (connection.saveData) {
    return true;
  }

  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

export function scheduleBrowserWarmup(task: () => void, options?: { timeout?: number; fallbackDelayMs?: number }): WarmupCleanup {
  if (typeof window === 'undefined' || shouldSkipSpeculativeWarmup()) {
    return () => undefined;
  }

  const warmupWindow = window as Window & {
    requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout: number }) => IdleCallbackHandle;
    cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  };
  const timeout = options?.timeout ?? 1200;
  const fallbackDelayMs = options?.fallbackDelayMs ?? 350;
  let cancelled = false;
  let timerId: number | undefined;
  let idleId: IdleCallbackHandle | undefined;

  const run = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    task();
  };

  if (typeof warmupWindow.requestIdleCallback === 'function') {
    idleId = warmupWindow.requestIdleCallback(run, { timeout });
  } else {
    timerId = window.setTimeout(run, fallbackDelayMs);
  }

  return () => {
    cancelled = true;
    if (typeof idleId === 'number' && typeof warmupWindow.cancelIdleCallback === 'function') {
      warmupWindow.cancelIdleCallback(idleId);
    }
    if (typeof timerId === 'number') {
      window.clearTimeout(timerId);
    }
  };
}
