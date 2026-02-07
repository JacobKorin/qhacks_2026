(function bootstrapContentScript() {
  if (window.__aiFeedDetectorInitialized) {
    return;
  }
  window.__aiFeedDetectorInitialized = true;

  const READY_MESSAGE = "AIFD_CONTENT_READY";
  const pageUrl = window.location.href;

  console.log("[AI Feed Detector] Content script loaded:", pageUrl);

  try {
    chrome.runtime.sendMessage(
      {
        type: READY_MESSAGE,
        payload: { pageUrl, timestamp: Date.now() },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[AI Feed Detector] Background handshake failed:",
            chrome.runtime.lastError.message
          );
          return;
        }

        console.log("[AI Feed Detector] Background handshake ok:", response);
      }
    );
  } catch (error) {
    console.warn("[AI Feed Detector] Unable to message background:", error);
  }

  try {
    const observerApi = window.AIFeedDetectorObserver;
    if (!observerApi || typeof observerApi.createPostObserver !== "function") {
      console.warn("[AI Feed Detector] Post observer API is unavailable");
      return;
    }
    const mediaApi = window.AIFeedDetectorExtractMedia;
    if (!mediaApi || typeof mediaApi.extractMediaFromPost !== "function") {
      console.warn("[AI Feed Detector] Media extractor API is unavailable");
      return;
    }

    const postObserver = observerApi.createPostObserver({
      onPostsDetected(posts) {
        console.log(
          `[AI Feed Detector] Detected ${posts.length} new post(s) in feed`
        );

        for (const post of posts) {
          const mediaItems = mediaApi.extractMediaFromPost(post);
          
          if (!mediaItems || mediaItems.length === 0) continue;
          
          const contentToScan = mediaItems.slice(1);

          if (contentToScan.length === 0) {
            console.log("[AI Feed Detector] Only profile pic found, skipping.");
            continue;
          }

          console.log("[AI Feed Detector] Sending post content to background:", contentToScan);

          chrome.runtime.sendMessage({
            type: "SCAN_MEDIA_ITEMS",
            payload: {
              items: contentToScan,
              timestamp: Date.now()
            }
          });
          console.log("[AI Feed Detector] Extracted media:", contentToScan);
        }
      },
    });

    postObserver.start();
    console.log("[AI Feed Detector] DOM observer started");
  } catch (error) {
    console.warn("[AI Feed Detector] Failed to start DOM observer:", error);
  }
})();
