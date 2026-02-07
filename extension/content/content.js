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
  };
  const pageUrl = window.location.href;
  let currentSettings = { ...DEFAULT_SETTINGS };
  const detectionResultsByHash = new Map();

  console.log("[AI Feed Detector] Content script loaded:", pageUrl);

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
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(stored[SETTINGS_KEY] || {}),
    };
    if (window.AIFeedDetectorRiskRail && window.AIFeedDetectorRiskRail.setVisibility) {
      window.AIFeedDetectorRiskRail.setVisibility(currentSettings.showRiskRail);
  }
  }

  function subscribeSettingsChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) {
        return;
      }

      const previousShowScoreOverlay = currentSettings.showScoreOverlay;
      currentSettings = {
        ...DEFAULT_SETTINGS,
        ...(changes[SETTINGS_KEY].newValue || {}),
      };

      if (previousShowScoreOverlay && !currentSettings.showScoreOverlay) {
        document.querySelectorAll(".aifd-badge-side").forEach((badge) => {
          badge.remove();
        });
      } else if (!previousShowScoreOverlay && currentSettings.showScoreOverlay) {
        replayStoredBadges();
      }

      if (window.AIFeedDetectorRiskRail && window.AIFeedDetectorRiskRail.setVisibility) {
        window.AIFeedDetectorRiskRail.setVisibility(currentSettings.showRiskRail);}
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
      payload.score
    );
  }

  function replayStoredBadges() {
    for (const payload of detectionResultsByHash.values()) {
      renderBadge(payload);
    }
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
        if (!currentSettings.extensionEnabled) {
          return;
        }

        console.log(`[AI Feed Detector] Detected ${posts.length} new post(s)`);

        for (const post of posts) {
          const mediaItems = mediaApi.extractMediaFromPost(post);
          if (!mediaItems || mediaItems.length === 0) continue;

          const contentToScan = mediaItems.slice(1);

          for (const item of contentToScan) {
            try {
              // 1. IMPROVED SEARCH: Look for images that CONTAIN the base URL
              // We strip parameters after '?' to find the raw filename match
              const baseUrl = item.url.split('?')[0];
              const imgElements = Array.from(post.querySelectorAll('img'));
              const imgElement = imgElements.find(img => {
              const imgUrl = img.currentSrc || img.src || '';
              return imgUrl.includes(item.hash.substring(0, 8)) || imgUrl.includes(baseUrl);
              });

              if (!imgElement) {
                console.warn("[AIFD] Image element still not found for:", baseUrl);
                continue;
              }

              // 2. CANVAS CAPTURE
              const canvas = document.createElement('canvas');
              canvas.width = imgElement.naturalWidth;
              canvas.height = imgElement.naturalHeight;
              const ctx = canvas.getContext('2d');

              // Crucial: Instagram images usually allow cross-origin if the tag has this
              imgElement.crossOrigin = "anonymous";

              ctx.drawImage(imgElement, 0, 0);
              const base64Data = canvas.toDataURL('image/jpeg', 0.8);

              console.log("%c[AIFD] Successfully captured pixels via Canvas", "color: #00D1FF", item.hash);

              imgElement.setAttribute('data-aifd-hash', item.hash);

              chrome.runtime.sendMessage({
                type: "SCAN_MEDIA_ITEMS",
                payload: {
                  items: [{ ...item, base64: base64Data }],
                  timestamp: Date.now()
                }
              });
            } catch (err) {
              console.error("[AIFD] Canvas capture failed (Tainted Canvas?):", err);
            }
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
    if (message.type === "RENDER_BADGE") {
      console.log("%c[AI Feed Detector] RESPONSE RECEIVED FROM BACKEND:", "color: #00ff00; font-weight: bold;", message.payload);
      
      const { hash, score, isAI } = message.payload;
      const payload = { hash, score, isAI };
      detectionResultsByHash.set(hash, payload);
      
      // FIX 1: Add risk rail marker for AI posts
      if (currentSettings.showRiskRail && isAI && window.AIFeedDetectorRiskRail) {
        window.AIFeedDetectorRiskRail.addMarkerForHash(hash);
      }

      if (!currentSettings.showScoreOverlay) {
        sendResponse({ status: "overlay_disabled" });
        return true;
      }

      renderBadge(payload);
      
      sendResponse({ status: "badge_rendered" });
    }
    
    // FIX 2: Handle immediate toggle from popup
    if (message.type === "AIFD_RISKRAIL_TOGGLE") {
      currentSettings.showRiskRail = message.payload.showRiskRail;
      
      if (window.AIFeedDetectorRiskRail && window.AIFeedDetectorRiskRail.setVisibility) {
        window.AIFeedDetectorRiskRail.setVisibility(currentSettings.showRiskRail);
        console.log("[AIFD] Risk Rail toggled to:", currentSettings.showRiskRail);
      }
      
      sendResponse({ status: "toggled", showRiskRail: currentSettings.showRiskRail });
    }
    
    return true;
  });
})();
