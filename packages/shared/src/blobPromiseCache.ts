type CacheEntry = {
  createdAt: number;
  promise: Promise<Blob>;
};

export function createBlobPromiseCache(options?: { maxEntries?: number; ttlMs?: number }) {
  const entries = new Map<string, CacheEntry>();
  const maxEntries = options?.maxEntries ?? 24;
  const ttlMs = options?.ttlMs ?? 5 * 60 * 1000;

  const prune = (now: number) => {
    for (const [key, entry] of entries) {
      if (now - entry.createdAt > ttlMs) {
        entries.delete(key);
      }
    }

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      entries.delete(oldestKey);
    }
  };

  return {
    get(key: string, load: () => Promise<Blob>) {
      const now = Date.now();
      const cached = entries.get(key);
      if (cached && now - cached.createdAt <= ttlMs) {
        entries.delete(key);
        entries.set(key, { ...cached, createdAt: now });
        return cached.promise;
      }

      if (cached) {
        entries.delete(key);
      }

      const promise = load().catch((error) => {
        entries.delete(key);
        throw error;
      });

      entries.set(key, { createdAt: now, promise });
      prune(now);
      return promise;
    },
    clear() {
      entries.clear();
    },
  };
}
