import { detectAIContent } from "./detectClient.js";
import { createTaskQueue } from "./queue.js";
import { getCachedDetection, setCachedDetection } from "./cache.js";
const READY_MESSAGE = "AIFD_CONTENT_READY";
const SCAN_MESSAGE = "SCAN_MEDIA_ITEMS";
const STATS_KEY = "aifd_stats";
const SETTINGS_KEY = "aifd_settings";
const FLAG_THRESHOLD = 0.75;
let statsWriteChain = Promise.resolve();

const detectionQueue = createTaskQueue({
  concurrency: 3,
  delayMs: 120,
});

console.log("[AI Feed Detector] Service worker initialized");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Basic safety check: ignore empty messages
  if (!message) return false;

  // 2. Handle the "Handshake" (READY_MESSAGE)
  if (message.type === READY_MESSAGE) {
    const senderUrl = sender?.url || "unknown";
    console.log("[AI Feed Detector] Received content ready from:", senderUrl);
    
    sendResponse({ ok: true, receivedAt: Date.now() });
    return true; // Keep channel open for the response
  }

  // 3. Handle the "Scan Request" (SCAN_MESSAGE)
  if (message.type === SCAN_MESSAGE) {
    const { items } = message.payload;
    const tabId = sender?.tab?.id;

    console.log(`[AI Feed Detector] Processing ${items?.length} items...`);

    if (tabId && items) {
      processItems(items, tabId);
    }

    // Acknowledge receipt immediately
    sendResponse({ status: "processing", count: items?.length || 0 });
    return true; 
  }

  return false; // Not a message type we handle
});

function enqueueStatsUpdate(scannedDelta, flaggedDelta) {
  statsWriteChain = statsWriteChain
    .then(async () => {
      const stored = await chrome.storage.local.get([STATS_KEY]);
      const stats = stored[STATS_KEY] || {
        scannedCount: 0,
        flaggedCount: 0,
        lastScanAt: null,
      };

      stats.scannedCount += scannedDelta;
      stats.flaggedCount += flaggedDelta;
      stats.lastScanAt = Date.now();

      await chrome.storage.local.set({ [STATS_KEY]: stats });
    })
    .catch((error) => {
      console.error("[AI Feed Detector] Stats update error:", error);
    });

  return statsWriteChain;
}

async function isExtensionEnabled() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = stored[SETTINGS_KEY] || {};
  return settings.extensionEnabled !== false;
}

function normalizeDetectionResult(item, result) {
  const score = Number(result?.score ?? 0);
  const isAI = typeof result?.isAI === "boolean" ? result.isAI : score >= FLAG_THRESHOLD;

  return {
    hash: item.hash,
    score,
    isAI,
  };
}

async function processOneItem(item, tabId) {
  try {
    if (!(await isExtensionEnabled())) {
      return;
    }

    const cachedResult = await getCachedDetection(item.hash);
    let normalizedResult = null;

    if (cachedResult) {
      normalizedResult = normalizeDetectionResult(item, cachedResult);
      console.log(`[AI Feed Detector] Cache hit: ${item.hash}`);
    } else {
      console.log(`[AI Feed Detector] Cache miss: ${item.hash} (calling backend)`);
      normalizedResult = normalizeDetectionResult(item, await detectAIContent(item));
      await setCachedDetection(item.hash, normalizedResult);
      await enqueueStatsUpdate(1, normalizedResult.isAI ? 1 : 0);
    }

    await chrome.tabs.sendMessage(tabId, {
      type: "RENDER_BADGE",
      payload: normalizedResult,
    });
  } catch (error) {
    console.error("[AI Feed Detector] Item processing error:", error);
  }
}

async function processItems(items, tabId) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  if (!(await isExtensionEnabled())) {
    return;
  }

  const uniqueItemsByHash = new Map();
  for (const item of items) {
    if (!item || !item.hash || uniqueItemsByHash.has(item.hash)) {
      continue;
    }
    uniqueItemsByHash.set(item.hash, item);
  }

  for (const item of uniqueItemsByHash.values()) {
    detectionQueue.enqueue(() => processOneItem(item, tabId));
  }
}
