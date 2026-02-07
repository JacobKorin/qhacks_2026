import { detectAIContent } from "./detectClient.js";
const READY_MESSAGE = "AIFD_CONTENT_READY";
const SCAN_MESSAGE = "SCAN_MEDIA_ITEMS";
const STATS_KEY = "aifd_stats";

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

async function incrementScannedCount() {
  const stored = await chrome.storage.local.get([STATS_KEY]);
  
  // Get existing stats or use defaults if empty
  const stats = stored[STATS_KEY] || { 
    scannedCount: 0, 
    flaggedCount: 0, 
    lastScanAt: null 
  };

  // Increment ONLY the scanned count
  stats.scannedCount += 1;
  stats.lastScanAt = Date.now();

  // Save the updated object back to storage
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

async function processItems(items, tabId) {
  for (const item of items) {
    try {
      const result = await detectAIContent(item);
      
      await incrementScannedCount();

      // Send results back to overlay.js in the content script
      chrome.tabs.sendMessage(tabId, {
        type: "RENDER_BADGE",
        payload: {
          hash: item.hash,
          score: result.score,
          isAI: result.isAI
        }
      });
    } catch (error) {
      console.error("[AI Feed Detector] Item processing error:", error);
    }
  }
}