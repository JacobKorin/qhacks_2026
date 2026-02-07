(function initMediaExtractor(globalScope) {
  function addUrlIfValid(urlSet, value) {
    const utils = globalScope.AIFeedDetectorUtils;
    if (!utils) {
      return;
    }

    const normalizedUrl = utils.normalizeUrl(value);
    if (!normalizedUrl) {
      return;
    }

    urlSet.add(normalizedUrl);
  }

  function extractFromSrcSet(urlSet, srcSetValue) {
    if (!srcSetValue || typeof srcSetValue !== "string") {
      return;
    }

    const candidates = srcSetValue
      .split(",")
      .map((segment) => segment.trim().split(/\s+/)[0])
      .filter(Boolean);

    for (const candidate of candidates) {
      addUrlIfValid(urlSet, candidate);
    }
  }

  function extractMediaFromPost(postElement) {
    if (!(postElement instanceof Element)) return [];
    utils = globalScope.AIFeedDetectorUtils;
    const mediaItems = [];

    const profilePic = postElement.querySelector('header img, canvas._aadp');
    mediaItems.push({
        url: profilePic?.src || "ui-placeholder",
        type: 'ui',
        hash: 'profile'
    });

    let video = postElement.querySelector("video");
    
    if (!video) {
      const videoContainer = postElement.querySelector('div._as9-'); 
      video = videoContainer?.querySelector('video');
    }
    
    if (!video && postElement.tagName === 'VIDEO') {
      video = postElement;
    }

    console.log("[AIFD] Video found?", video);
    if (video) {
      const vSrc = video.currentSrc || video.src;
      if (vSrc) {
        mediaItems.push({
          url: vSrc.startsWith('blob:') ? video.poster : vSrc,
          type: 'video', // LABELING as video
          hash: utils.hashString(vSrc)
        });
          
        return mediaItems;
      }
    }

    const img = postElement.querySelector("div._aagv img, img.FFVAD");
    if (img) {
      const iSrc = img.currentSrc || img.src;
      if (iSrc) {
        mediaItems.push({
          url: iSrc,
          type: 'image', // LABELING as image
          hash: utils.hashString(iSrc)
        });
      }
    }
    
    return mediaItems;
  }

  globalScope.AIFeedDetectorExtractMedia = {
    extractMediaFromPost,
  };
})(window);
