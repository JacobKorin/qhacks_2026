const CACHE_STORAGE_KEY = "aifd_detection_cache";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function normalizeHash(hash) {
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

async function readCacheStore() {
  const stored = await chrome.storage.local.get([CACHE_STORAGE_KEY]);
  return stored[CACHE_STORAGE_KEY] || {};
}

async function writeCacheStore(store) {
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: store });
}

function pruneExpiredEntries(store, now) {
  const pruned = {};
  for (const [hash, entry] of Object.entries(store)) {
    if (!entry || !entry.expiresAt || entry.expiresAt <= now) {
      continue;
    }
    pruned[hash] = entry;
  }
  return pruned;
}

function enforceEntryLimit(store) {
  const entries = Object.entries(store).sort(
    (a, b) => (b[1]?.cachedAt || 0) - (a[1]?.cachedAt || 0)
  );
  return Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
}

export async function getCachedDetection(hash) {
  const normalizedHash = normalizeHash(hash);
  if (!normalizedHash) {
    return null;
  }

  const now = Date.now();
  const store = await readCacheStore();
  const entry = store[normalizedHash];

  if (!entry || !entry.expiresAt || entry.expiresAt <= now) {
    if (entry) {
      const nextStore = { ...store };
      delete nextStore[normalizedHash];
      await writeCacheStore(nextStore);
    }
    return null;
  }

  return entry.result || null;
}

export async function setCachedDetection(hash, result, ttlMs = DEFAULT_TTL_MS) {
  const normalizedHash = normalizeHash(hash);
  if (!normalizedHash || !result) {
    return;
  }

  const now = Date.now();
  const store = await readCacheStore();
  const nextStore = pruneExpiredEntries(store, now);

  nextStore[normalizedHash] = {
    result,
    cachedAt: now,
    expiresAt: now + Math.max(1000, Number(ttlMs || DEFAULT_TTL_MS)),
  };

  await writeCacheStore(enforceEntryLimit(nextStore));
}
