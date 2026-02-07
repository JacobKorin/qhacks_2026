const STORAGE_KEYS = {
  settings: "aifd_settings",
  stats: "aifd_stats",
};

const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  showScoreOverlay: true,
  showRiskRail: true,
};

const DEFAULT_STATS = {
  scannedCount: 0,
  flaggedCount: 0,
  lastScanAt: null,
};

const ui = {
  statusText: document.getElementById("status-text"),
  scannedCount: document.getElementById("scanned-count"),
  flaggedCount: document.getElementById("flagged-count"),
  flagRate: document.getElementById("flag-rate"),
  lastScan: document.getElementById("last-scan"),
  resetStats: document.getElementById("reset-stats"),
  toggleEnabled: document.getElementById("toggle-enabled"),
  toggleScoreOverlay: document.getElementById("toggle-score-overlay"),
  toggleRiskRail: document.getElementById("toggle-risk-rail"),
};

let currentSettings = { ...DEFAULT_SETTINGS };
let currentStats = { ...DEFAULT_STATS };

function mergeSettings(raw) {
  return { ...DEFAULT_SETTINGS, ...(raw || {}) };
}

function mergeStats(raw) {
  return { ...DEFAULT_STATS, ...(raw || {}) };
}

function formatLastScan(lastScanAt) {
  if (!lastScanAt) return "Last scan: never";
  const parsedDate = new Date(lastScanAt);
  if (Number.isNaN(parsedDate.getTime())) return "Last scan: unknown";
  return `Last scan: ${parsedDate.toLocaleString()}`;
}

/**
 * UPDATED: Implements Master Kill Switch UI logic
 */
function renderSettings() {
  const isMasterEnabled = Boolean(currentSettings.extensionEnabled);
  
  // Set master toggle state
  ui.toggleEnabled.checked = isMasterEnabled;

  // Sub-toggles: 
  // 1. Visually uncheck if master is off, otherwise show saved state
  ui.toggleScoreOverlay.checked = isMasterEnabled ? Boolean(currentSettings.showScoreOverlay) : false;
  ui.toggleRiskRail.checked = isMasterEnabled ? Boolean(currentSettings.showRiskRail) : false;

  // 2. Disable interaction if master is off
  ui.toggleScoreOverlay.disabled = !isMasterEnabled;
  ui.toggleRiskRail.disabled = !isMasterEnabled;

  // 3. Visual feedback for rows (greying out)
  const subToggles = [ui.toggleScoreOverlay, ui.toggleRiskRail];
  subToggles.forEach(toggle => {
    // Looks for a container div with class 'setting-row' or similar
    const container = toggle.closest('.setting-row') || toggle.parentElement;
    if (container) {
      container.style.opacity = isMasterEnabled ? "1" : "0.5";
      container.style.pointerEvents = isMasterEnabled ? "auto" : "none";
      container.style.transition = "opacity 0.2s ease";
    }
  });

  ui.statusText.textContent = isMasterEnabled
    ? "Active on supported pages"
    : "Paused";
}

function renderStats() {
  const scanned = Number(currentStats.scannedCount || 0);
  const flagged = Number(currentStats.flaggedCount || 0);
  const flagRate = scanned > 0 ? Math.round((flagged / scanned) * 100) : 0;

  ui.scannedCount.textContent = `${scanned}`;
  ui.flaggedCount.textContent = `${flagged}`;
  ui.flagRate.textContent = `${flagRate}%`;
  ui.lastScan.textContent = formatLastScan(currentStats.lastScanAt);
}

function saveSettings() {
  return chrome.storage.local.set({
    [STORAGE_KEYS.settings]: currentSettings,
  });
}

function saveStats() {
  return chrome.storage.local.set({
    [STORAGE_KEYS.stats]: currentStats,
  });
}

function notifySettingsChanged() {
  chrome.runtime.sendMessage({
    type: "AIFD_SETTINGS_UPDATED",
    payload: currentSettings,
  });
}

function attachHandlers() {
  ui.toggleEnabled.addEventListener("change", async (event) => {
    currentSettings.extensionEnabled = event.target.checked;
    await saveSettings();
    renderSettings(); // UI will handle disabling sub-toggles
    notifySettingsChanged();
  });

  ui.toggleRiskRail.addEventListener("change", async (event) => {
    currentSettings.showRiskRail = event.target.checked;
    await saveSettings();
    notifySettingsChanged();
  });

  ui.toggleScoreOverlay.addEventListener("change", async (event) => {
    currentSettings.showScoreOverlay = event.target.checked;
    await saveSettings();
    notifySettingsChanged();
  });

  ui.resetStats.addEventListener("click", async () => {
    currentStats = { ...DEFAULT_STATS };
    await saveStats();
    renderStats();
  });
}

function subscribeStorageChanges() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes[STORAGE_KEYS.settings]) {
      currentSettings = mergeSettings(changes[STORAGE_KEYS.settings].newValue);
      renderSettings();
    }

    if (changes[STORAGE_KEYS.stats]) {
      currentStats = mergeStats(changes[STORAGE_KEYS.stats].newValue);
      renderStats();
    }
  });
}

async function initPopup() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.stats,
  ]);

  currentSettings = mergeSettings(stored[STORAGE_KEYS.settings]);
  currentStats = mergeStats(stored[STORAGE_KEYS.stats]);

  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: currentSettings,
    [STORAGE_KEYS.stats]: currentStats,
  });

  renderSettings();
  renderStats();
  attachHandlers();
  subscribeStorageChanges();
}

initPopup().catch((error) => {
  ui.statusText.textContent = "Popup failed to initialize";
  console.error("[AI Feed Detector] popup init failed:", error);
});