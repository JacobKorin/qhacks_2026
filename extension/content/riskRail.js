// content/riskRail.js
window.AIFeedDetectorRiskRail = (function () {
  const railId = "aifd-risk-rail";
  const dotClass = "aifd-risk-dot";
  const dotMap = new Map();

  function ensureStyles() {
    if (document.getElementById("aifd-risk-rail-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "aifd-risk-rail-styles";
    style.textContent = `
      .aifd-risk-rail {
        position: fixed;
        top: 10%;
        right: 6px;
        width: 8px;
        height: 80%;
        z-index: 9999;
        pointer-events: none;
      }
      .aifd-risk-dot {
        position: absolute;
        left: 0;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #ef4444;
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
        cursor: pointer;
        pointer-events: auto;
        transition: transform 0.2s, opacity 0.2s;
        opacity: 0.7;
      }
      .aifd-risk-dot:hover {
        transform: scale(1.5);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRail() {
    ensureStyles();
    let rail = document.getElementById(railId);
    if (!rail) {
      rail = document.createElement("div");
      rail.id = railId;
      rail.className = "aifd-risk-rail";
      document.body.appendChild(rail);
    }
    return rail;
  }

  function getScrollMetrics() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollHeight = Math.max(doc.scrollHeight, document.body.scrollHeight || 0);
    const viewportHeight = window.innerHeight || doc.clientHeight || 1;
    return { scrollTop, scrollHeight, viewportHeight };
  }

  function computeDotTop(targetElement) {
    const { scrollHeight, viewportHeight } = getScrollMetrics();
    const doc = document.documentElement;
    const rect = targetElement.getBoundingClientRect();
    const elementTop = rect.top + (window.scrollY || doc.scrollTop || 0);
    const rail = ensureRail();
    const railHeight = rail.getBoundingClientRect().height || 1;
    const maxScrollable = Math.max(1, scrollHeight - viewportHeight);
    const ratio = Math.min(1, Math.max(0, elementTop / maxScrollable));
    return Math.round(ratio * (railHeight - 8));
  }

  function updateDotPosition(hash) {
    const dot = dotMap.get(hash);
    if (!dot) return;
    const img = document.querySelector(`img[data-aifd-hash="${hash}"]`);
    if (!img) return;
    const post = img.closest("article") || img;
    const top = computeDotTop(post);
    dot.style.top = `${top}px`;
  }

  function addMarkerForHash(hash) {
    if (!hash || dotMap.has(hash)) {
      return;
    }
    const rail = ensureRail();
    const dot = document.createElement("div");
    dot.className = dotClass;
    dot.dataset.hash = hash;
    dot.title = "Click to scroll to AI-detected post";
    
    // Click handler to scroll to post
    dot.addEventListener("click", function() {
      const img = document.querySelector(`img[data-aifd-hash="${hash}"]`);
      if (img) {
        const post = img.closest("article") || img;
        post.scrollIntoView({ 
          behavior: "smooth", 
          block: "center" 
        });
        
        // Highlight the post temporarily
        const originalBoxShadow = post.style.boxShadow;
        post.style.boxShadow = "0 0 0 3px #ef4444";
        setTimeout(() => {
          post.style.boxShadow = originalBoxShadow;
        }, 2000);
      }
    });
    
    rail.appendChild(dot);
    dotMap.set(hash, dot);
    updateDotPosition(hash);
  }

  function updateAllPositions() {
    for (const hash of dotMap.keys()) {
      updateDotPosition(hash);
    }
  }

  function removeAll() {
    const rail = document.getElementById(railId);
    if (rail) rail.remove();
    dotMap.clear();
  }
  function setVisibility(visible) {
    const rail = document.getElementById(railId);
    if (rail) {
        rail.style.display = visible ? "block" : "none";}}

  window.addEventListener("scroll", () => updateAllPositions(), { passive: true });
  window.addEventListener("resize", () => updateAllPositions());

  return {
    addMarkerForHash,
    updateAllPositions,
    removeAll,
    setVisibility
  };
})();
