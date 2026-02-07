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
    if (!(postElement instanceof Element)) {
      return [];
    }

    const urlSet = new Set();

    const imageElements = postElement.querySelectorAll("img");
    for (const image of imageElements) {
      addUrlIfValid(urlSet, image.currentSrc || image.src);
      extractFromSrcSet(urlSet, image.srcset);
    }

    const sourceElements = postElement.querySelectorAll("source");
    for (const source of sourceElements) {
      addUrlIfValid(urlSet, source.src);
      extractFromSrcSet(urlSet, source.srcset);
    }

    const videoElements = postElement.querySelectorAll("video");
    for (const video of videoElements) {
      addUrlIfValid(urlSet, video.currentSrc || video.src);
      addUrlIfValid(urlSet, video.poster);
    }

    const utils = globalScope.AIFeedDetectorUtils;
    return Array.from(urlSet).map((url) => ({
      url,
      hash: utils.hashString(url),
    }));
  }

  globalScope.AIFeedDetectorExtractMedia = {
    extractMediaFromPost,
  };
})(window);
