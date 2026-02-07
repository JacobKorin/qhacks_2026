(function initUtils(globalScope) {
  function normalizeUrl(urlLike, baseUrl) {
    if (!urlLike || typeof urlLike !== "string") {
      return null;
    }

    try {
      const parsed = new URL(urlLike, baseUrl || window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      // Keep query params because signed media URLs often require them.
      parsed.hash = "";
      return parsed.toString();
    } catch (error) {
      return null;
    }
  }

  function hashString(input) {
    if (typeof input !== "string") {
      return "";
    }

    // FNV-1a 32-bit hash, returned as fixed-length hex.
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  globalScope.AIFeedDetectorUtils = {
    normalizeUrl,
    hashString,
  };
})(window);
