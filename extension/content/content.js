(async function bootstrapContentScript() {
  if (window.__aiFeedDetectorInitialized) {
    return;
  }
  window.__aiFeedDetectorInitialized = true;

  const READY_MESSAGE = "AIFD_CONTENT_READY";
  const SETTINGS_KEY = "aifd_settings";
  const DEFAULT_SETTINGS = {
    extensionEnabled: true,
    showScoreOverlay: true,
    showRiskRail: true,
    detectionMode: "feed",
  };
  const pageUrl = window.location.href;
  let currentSettings = { ...DEFAULT_SETTINGS };
  const detectionResultsByHash = new Map();
  let rectangleOverlayController = null;
  let latestRectangleSelection = null;
  const rectangleScanBatches = new Map();
  const RECTANGLE_AI_THRESHOLD = 75;

  console.log("[AI Feed Detector] Content script loaded:", pageUrl);

  function toPercentScore(score) {
    const numeric = Number(score || 0);
    if (!Number.isFinite(numeric)) {
      return 0;
    }
    const percent = numeric > 1 ? numeric : numeric * 100;
    return Math.max(0, Math.min(100, percent));
  }

  function renderRectangleAggregateBadge(summary) {
    if (!summary) {
      return;
    }

    if (
      window.AIFeedDetectorOverlay &&
      typeof window.AIFeedDetectorOverlay.renderAggregateBadge === "function"
    ) {
      window.AIFeedDetectorOverlay.renderAggregateBadge(summary);
      return;
    }

    console.log("[AIFD] Aggregate badge API unavailable.");
  }

  function clearRectangleAggregateBadge() {
    if (
      window.AIFeedDetectorOverlay &&
      typeof window.AIFeedDetectorOverlay.clearAggregateBadge === "function"
    ) {
      window.AIFeedDetectorOverlay.clearAggregateBadge();
    }
  }

  async function exitRectangleMode() {
    if (currentSettings.detectionMode !== "rectangle") {
      return;
    }

    const nextSettings = {
      ...currentSettings,
      detectionMode: "feed",
    };

    applySettings(nextSettings);

    try {
      await chrome.storage.local.set({
        [SETTINGS_KEY]: nextSettings,
      });
    } catch (error) {
      console.warn("[AIFD] Failed to persist rectangle exit mode:", error);
    }

    try {
      chrome.runtime.sendMessage({
        type: "AIFD_SETTINGS_UPDATED",
        payload: nextSettings,
      });
    } catch (error) {
      console.warn("[AIFD] Failed to broadcast rectangle exit mode:", error);
    }
  }

  function handleRectangleDetectionResult(payload) {
    const selectionId = payload?.selectionId;
    if (!selectionId) {
      return false;
    }

    const batch = rectangleScanBatches.get(selectionId);
    if (!batch) {
      return false;
    }

    const hash = payload?.hash || "";
    if (hash && batch.receivedHashes.has(hash)) {
      return true;
    }

    if (hash) {
      batch.receivedHashes.add(hash);
    }

    const scorePercent = toPercentScore(payload?.score);
    batch.receivedCount += 1;
    batch.scorePercentTotal += scorePercent;
    if (payload?.isAI) {
      batch.aiLikelyCount += 1;
    }

    if (batch.receivedCount < batch.expectedCount) {
      return true;
    }

    const averageScore =
      batch.receivedCount > 0
        ? batch.scorePercentTotal / batch.receivedCount
        : 0;

    renderRectangleAggregateBadge({
      averageScore,
      totalCount: batch.receivedCount,
      uniqueScannedCount: batch.receivedCount,
      selectedCount: batch.selectedCount,
      aiLikelyCount: batch.aiLikelyCount,
      isLikelyAI: averageScore >= RECTANGLE_AI_THRESHOLD,
      bounds: batch.bounds || null,
    });

    rectangleScanBatches.delete(selectionId);
    return true;
  }

  function extractRectangleMediaItems(imageElements) {
    const utils = window.AIFeedDetectorUtils;
    if (!utils || !Array.isArray(imageElements) || imageElements.length === 0) {
      return [];
    }

    const uniqueByHash = new Map();

    for (const imageElement of imageElements) {
      if (!(imageElement instanceof HTMLImageElement)) {
        continue;
      }

      const rawUrl =
        imageElement.currentSrc ||
        imageElement.src ||
        imageElement.getAttribute("src") ||
        "";
      const normalizedUrl = utils.normalizeUrl(rawUrl);
      if (!normalizedUrl) {
        continue;
      }

      const hash = utils.hashString(normalizedUrl);
      if (!hash || uniqueByHash.has(hash)) {
        continue;
      }

      imageElement.setAttribute("data-aifd-hash", hash);
      uniqueByHash.set(hash, {
        hash,
        type: "image",
        media_type: "image",
        url: normalizedUrl,
        media_url: normalizedUrl,
      });
    }

    return Array.from(uniqueByHash.values());
  }

  function sendRectangleItemsForDetection(mediaItems, bounds, selectedCount) {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
      console.log("[AIFD] Rectangle selection contains no scannable images.");
      clearRectangleAggregateBadge();
      return null;
    }

    const selectionId = `rect_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    const itemsWithSelection = mediaItems.map((item) => ({
      ...item,
      selectionId,
      source: "rectangle_mode",
    }));

    rectangleScanBatches.set(selectionId, {
      selectionId,
      bounds: bounds || null,
      expectedCount: itemsWithSelection.length,
      selectedCount:
        Number.isFinite(Number(selectedCount)) && Number(selectedCount) >= 0
          ? Number(selectedCount)
          : itemsWithSelection.length,
      receivedCount: 0,
      scorePercentTotal: 0,
      aiLikelyCount: 0,
      receivedHashes: new Set(),
      startedAt: Date.now(),
    });

    chrome.runtime.sendMessage(
      {
        type: "SCAN_MEDIA_ITEMS",
        payload: {
          items: itemsWithSelection,
          source: "rectangle_mode",
          selectionId,
          bounds: bounds || null,
          timestamp: Date.now(),
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          rectangleScanBatches.delete(selectionId);
          console.warn(
            "[AIFD] Rectangle scan request failed:",
            chrome.runtime.lastError.message
          );
          return;
        }
        console.log(
          `[AIFD] Rectangle scan requested for ${itemsWithSelection.length} image(s).`,
          response
        );
      }
    );

    return selectionId;
  }

  function getRectangleOverlayController() {
    if (rectangleOverlayController) {
      return rectangleOverlayController;
    }

    const rectangleOverlayApi = window.AIFeedDetectorRectangleOverlay;
    if (!rectangleOverlayApi || typeof rectangleOverlayApi.createController !== "function") {
      return null;
    }

    rectangleOverlayController = rectangleOverlayApi.createController({
      onSelectionComplete(selectionResult) {
        const rectangleMediaItems = extractRectangleMediaItems(
          selectionResult?.imageElements || []
        );
        latestRectangleSelection = selectionResult
          ? {
              ...selectionResult,
              mediaItems: rectangleMediaItems,
            }
          : null;
        const imageCount = Number(rectangleMediaItems.length || 0);
        const selectedCount = Number(
          selectionResult?.imageElements?.length || 0
        );
        const width = Math.round(Number(selectionResult?.bounds?.width || 0));
        const height = Math.round(Number(selectionResult?.bounds?.height || 0));
        console.log(
          `[AIFD] Rectangle selection complete: ${width}x${height}, selected images: ${selectedCount}, unique URLs: ${imageCount}`
        );

        if (
          currentSettings.extensionEnabled &&
          currentSettings.detectionMode === "rectangle"
        ) {
          const selectionId = sendRectangleItemsForDetection(
            rectangleMediaItems,
            selectionResult?.bounds || null,
            selectedCount
          );
          if (latestRectangleSelection) {
            latestRectangleSelection.selectionId = selectionId;
          }
        }
      },
      onSelectionCanceled() {
        rectangleScanBatches.clear();
        clearRectangleAggregateBadge();
      },
      onExitModeRequested() {
        rectangleScanBatches.clear();
        clearRectangleAggregateBadge();
        void exitRectangleMode();
      },
    });
    return rectangleOverlayController;
  }

  function syncModeUi() {
    const isFeedMode = currentSettings.detectionMode !== "rectangle";
    const shouldShowRiskRail =
      currentSettings.extensionEnabled &&
      isFeedMode &&
      currentSettings.showRiskRail;

    if (window.AIFeedDetectorRiskRail && window.AIFeedDetectorRiskRail.setVisibility) {
      window.AIFeedDetectorRiskRail.setVisibility(shouldShowRiskRail);
    }

    const controller = getRectangleOverlayController();
    if (!controller) {
      return;
    }

    const shouldMountRectangleOverlay =
      currentSettings.extensionEnabled &&
      !isFeedMode;

    if (shouldMountRectangleOverlay) {
      controller.mount();
    } else {
      controller.unmount();
      rectangleScanBatches.clear();
      clearRectangleAggregateBadge();
    }
  }

  // Handshake with background
  try {
    chrome.runtime.sendMessage(
      {
        type: READY_MESSAGE,
        payload: { pageUrl, timestamp: Date.now() },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[AI Feed Detector] Background handshake failed:", chrome.runtime.lastError.message);
          return;
        }
        console.log("[AI Feed Detector] Background handshake ok:", response);
      }
    );
  } catch (error) {
    console.warn("[AI Feed Detector] Unable to message background:", error);
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    applySettings(stored[SETTINGS_KEY] || {});
  }

  function applySettings(nextSettings) {
    const previousShowScoreOverlay = currentSettings.showScoreOverlay;
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(nextSettings || {}),
    };

    if (!currentSettings.extensionEnabled) {
      console.log("[AIFD] Extension disabled: Cleaning up UI...");
      document.querySelectorAll(".aifd-badge-side").forEach((badge) => badge.remove());
      syncModeUi();
      return;
    }

    if (previousShowScoreOverlay && !currentSettings.showScoreOverlay) {
      document.querySelectorAll(".aifd-badge-side").forEach((badge) => {
        badge.remove();
      });
    } else if (!previousShowScoreOverlay && currentSettings.showScoreOverlay) {
      replayStoredBadges();
    }

    syncModeUi();
  }

  function subscribeSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) {
        return;
      }

      applySettings(changes[SETTINGS_KEY].newValue || {});
    });
  }

  function renderBadge(payload) {
    if (!window.AIFeedDetectorOverlay) {
      console.warn("[AIFD] Overlay API not found");
      return;
    }

    window.AIFeedDetectorOverlay.renderBadgeOnImage(
      payload.hash,
      payload.isAI,
      payload.score,
      payload.nsfw
    );
  }

  function replayStoredBadges() {
    for (const payload of detectionResultsByHash.values()) {
      renderBadge(payload);
    }
  }

  async function loadImageThumbnailDataUrl(imageUrl) {
    if (!imageUrl) {
      return null;
    }

    const thumbnailImage = new Image();
    thumbnailImage.crossOrigin = "anonymous";

    await new Promise((resolve, reject) => {
      thumbnailImage.onload = resolve;
      thumbnailImage.onerror = reject;
      thumbnailImage.src = imageUrl;
    });

    if (!thumbnailImage.naturalWidth || !thumbnailImage.naturalHeight) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = thumbnailImage.naturalWidth;
    canvas.height = thumbnailImage.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.drawImage(thumbnailImage, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  function captureVideoFrameDataUrl(videoElement) {
    if (!(videoElement instanceof HTMLVideoElement)) {
      return null;
    }

    const width = videoElement.videoWidth || videoElement.clientWidth || 0;
    const height = videoElement.videoHeight || videoElement.clientHeight || 0;
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.drawImage(videoElement, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  async function getBlobVideoThumbnail(item, videoElement) {
    if (item.posterUrl) {
      try {
        const posterDataUrl = await loadImageThumbnailDataUrl(item.posterUrl);
        if (posterDataUrl) {
          return {
            dataUrl: posterDataUrl,
            mediaUrl: item.posterUrl,
          };
        }
      } catch (error) {
        console.warn("[AIFD] Failed to load blob poster image:", error);
      }
    }

    try {
      const frameDataUrl = captureVideoFrameDataUrl(videoElement);
      if (frameDataUrl) {
        return {
          dataUrl: frameDataUrl,
          mediaUrl: null,
        };
      }
    } catch (error) {
      console.warn("[AIFD] Failed to capture blob video frame:", error);
    }

    return null;
  }

  try {
    await loadSettings();
    subscribeSettingsChanges();

    const observerApi = window.AIFeedDetectorObserver;
    const mediaApi = window.AIFeedDetectorExtractMedia;

    if (!observerApi || !mediaApi) {
      console.warn("[AI Feed Detector] Required APIs are unavailable");
      return;
    }

    const postObserver = observerApi.createPostObserver({
      async onPostsDetected(posts) {
        if (!currentSettings.extensionEnabled || currentSettings.detectionMode === "rectangle") {
          return;
        }

        console.log(`[AI Feed Detector] Detected ${posts.length} new post(s)`);

        for (const post of posts) {
          let mediaItems = mediaApi.extractMediaFromPost(post);
          
          if (mediaItems.length <= 1) { 
            await new Promise(r => setTimeout(r, 500));
            mediaItems = mediaApi.extractMediaFromPost(post);
          }

          if (!mediaItems || mediaItems.length <= 1) continue;

          const contentToScan = mediaItems.slice(1);

          for (const item of contentToScan) {
            if (item.type === "video") {
              const vidEl = post.querySelector("video");
              if (vidEl) {
                vidEl.setAttribute("data-aifd-hash", item.hash);
              }

              // Blob videos are scanned as image thumbnails to avoid blob video parsing issues.
              if (item.url.startsWith("blob:")) {
                console.log("[AIFD] Blob video detected, using thumbnail image instead");
                const thumbnail = await getBlobVideoThumbnail(item, vidEl);

                if (!thumbnail || !thumbnail.dataUrl) {
                  console.warn("[AIFD] Skipping blob video (thumbnail unavailable)");
                  continue;
                }

                chrome.runtime.sendMessage({
                  type: "SCAN_MEDIA_ITEMS",
                  payload: {
                    items: [{
                      hash: item.hash,
                      type: "image",
                      media_type: "image",
                      media_url: thumbnail.mediaUrl,
                      base64: thumbnail.dataUrl,
                      isVideo: false,
                    }],
                    timestamp: Date.now(),
                  },
                });
                continue;
              }

              // Non-blob videos: send normally (explicit payload to avoid leaking blob URLs)
              chrome.runtime.sendMessage({
                type: "SCAN_MEDIA_ITEMS",
                payload: {
                  items: [{
                    hash: item.hash,
                    type: item.type,
                    media_type: "video",
                    media_url: item.posterUrl || item.url,
                    posterUrl: item.posterUrl,
                    isVideo: true,
                  }],
                  timestamp: Date.now(),
                },
              });
              continue;
            }
            let payloadItem = { ...item };

            try {
              const baseUrl = item.url.split("?")[0];
              const imgElements = Array.from(post.querySelectorAll("img"));
              const imgElement = imgElements.find((img) => {
                const candidate = img.currentSrc || img.src || "";
                return candidate.includes(baseUrl);
              });

              if (imgElement) {
                imgElement.crossOrigin = "anonymous";
                try {
                const canvas = document.createElement("canvas");
                canvas.width = imgElement.naturalWidth;
                canvas.height = imgElement.naturalHeight;
                const ctx = canvas.getContext("2d");

                if (canvas.width > 0 && canvas.height > 0 && ctx) {
                  imgElement.crossOrigin = "anonymous";
                  ctx.drawImage(imgElement, 0, 0);

                  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
                  const encoded = dataUrl.includes(",")
                    ? dataUrl.split(",", 2)[1]
                    : "";

                    if (encoded.length > 0) {
                      payloadItem.base64 = dataUrl;
                    }
                  }
                } catch (err) {
                  console.warn("[AIFD] Canvas failed, sending URL only.");
                }

                imgElement.setAttribute("data-aifd-hash", item.hash);
              }
            } catch (err) {
              console.warn("[AIFD] Canvas capture unavailable; using URL fallback:", err.message);
            }

            chrome.runtime.sendMessage({
              type: "SCAN_MEDIA_ITEMS",
              payload: {
                  items: [{
                      hash: item.hash,
                      media_type: item.type,
                      media_url: item.url, // This matches your backend logs!
                      base64: payloadItem.base64 || null,
                      isVideo: item.type === "video"
                  }]
              }
          });
          }
        }
      },
    });

    postObserver.start();
    console.log("[AI Feed Detector] DOM observer started");
  } catch (error) {
    console.warn("[AI Feed Detector] Failed to start DOM observer:", error);
  }

  // Listener for results from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "AIFD_SETTINGS_UPDATED") {
      applySettings(message.payload || {});
      sendResponse({ status: "settings_applied" });
      return true;
    }

    if (message.type === "RENDER_BADGE") {
      const payload = message.payload || {};

      if (payload.source === "rectangle_mode" || payload.selectionId) {
        const handled = handleRectangleDetectionResult(payload);
        sendResponse({
          status: handled
            ? "rectangle_aggregate_updated"
            : "rectangle_result_ignored",
        });
        return true;
      }

      console.log("%c[AI Feed Detector] RESPONSE RECEIVED FROM BACKEND:", "color: #00ff00; font-weight: bold;", payload);
      
      const { hash, score, isAI, url, nsfw } = payload;

      let target = document.querySelector(`[data-aifd-hash="${hash}"]`);

      if (!target && url) {
        const baseUrl = url.split("?")[0]; // Clean Instagram tokens
        const allMedia = document.querySelectorAll("img, video");
        
        for (const el of allMedia) {
          const src = el.currentSrc || el.src || "";
          if (src.includes(baseUrl)) {
            el.setAttribute("data-aifd-hash", hash); // Restore the hash tag
            target = el;
            break;
          }
        }
      }

    if (!target) {
      console.warn(`[AIFD] Target media for hash ${hash} not found in DOM.`);
      return true;
    }

      const badgePayload = { hash, score, isAI, nsfw };
      detectionResultsByHash.set(hash, badgePayload);
      
      // FIX 1: Add risk rail marker for AI posts
      if (currentSettings.detectionMode === "feed" && currentSettings.showRiskRail && isAI && window.AIFeedDetectorRiskRail) {
        window.AIFeedDetectorRiskRail.addMarkerForHash(hash);
      }

      if (!currentSettings.showScoreOverlay) {
        sendResponse({ status: "overlay_disabled" });
        return true;
      }

      renderBadge(badgePayload);
      
      sendResponse({ status: "badge_rendered" });
    }
    
    // FIX 2: Handle immediate toggle from popup
    if (message.type === "AIFD_RISKRAIL_TOGGLE") {
      currentSettings.showRiskRail = message.payload.showRiskRail;
      syncModeUi();
      console.log("[AIFD] Risk Rail toggled to:", currentSettings.showRiskRail);
      
      sendResponse({ status: "toggled", showRiskRail: currentSettings.showRiskRail });
    }
    
    return true;
  });
})();


