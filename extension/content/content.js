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

      if (!currentSettings.extensionEnabled) {
        console.log("[AIFD] Extension disabled: Cleaning up UI...");
        // Remove all badges
        document.querySelectorAll(".aifd-badge-side").forEach(b => b.remove());
        // Hide Risk Rail if it exists
        if (window.AIFeedDetectorRiskRail) {
          window.AIFeedDetectorRiskRail.setVisibility(false);
        }
        return; // Stop here
      }

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

              chrome.runtime.sendMessage({
                  type: "SCAN_MEDIA_ITEMS",
                  payload: {
                      items: [{ 
                          ...item, 
                          media_type: "video", // Helps backend detection
                          media_url: item.url,  // Critical fallback
                          isVideo: true 
                      }],
                      timestamp: Date.now()
                  }
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
    if (message.type === "RENDER_BADGE") {
      console.log("%c[AI Feed Detector] RESPONSE RECEIVED FROM BACKEND:", "color: #00ff00; font-weight: bold;", message.payload);
      
      const { hash, score, isAI, url } = message.payload;

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
