(function initRectangleOverlay(globalScope) {
  const STYLE_ID = "aifd-rectangle-overlay-style";
  const ROOT_ID = "aifd-rectangle-overlay-root";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.aifd-rectangle-mode-cursor,
      html.aifd-rectangle-mode-cursor * {
        cursor: crosshair !important;
      }

      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: auto;
        cursor: crosshair !important;
      }

      #${ROOT_ID},
      #${ROOT_ID} * {
        cursor: crosshair !important;
      }

      #${ROOT_ID} .aifd-rectangle-overlay-shade {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.08);
      }

      #${ROOT_ID} .aifd-rectangle-selection {
        position: absolute;
        border: 1px dashed #14b8a6;
        background: rgba(20, 184, 166, 0.12);
        display: none;
      }

      #${ROOT_ID} .aifd-rectangle-toolbar {
        position: fixed;
        top: 14px;
        left: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid #dbe4f0;
        border-radius: 10px;
        padding: 8px 10px;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16);
        z-index: 2147483647;
        pointer-events: auto;
      }

      #${ROOT_ID} .aifd-rectangle-toolbar-label {
        font-family: "Segoe UI", "Aptos", sans-serif;
        font-size: 12px;
        color: #334155;
        user-select: none;
      }

      #${ROOT_ID} .aifd-rectangle-toolbar button {
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        color: #0f172a;
        border-radius: 8px;
        padding: 4px 8px;
        font-family: "Segoe UI", "Aptos", sans-serif;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer !important;
      }

      #${ROOT_ID} .aifd-rectangle-toolbar button:hover {
        background: #eef2f7;
      }
    `;

    document.head.appendChild(style);
  }

  function createRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = `
      <div class="aifd-rectangle-toolbar">
        <span class="aifd-rectangle-toolbar-label">Rectangle Mode (Esc to exit)</span>
        <button type="button" data-aifd-rectangle-action="cancel">Cancel</button>
        <button type="button" data-aifd-rectangle-action="exit">Exit</button>
      </div>
      <div class="aifd-rectangle-overlay-shade"></div>
      <div class="aifd-rectangle-selection"></div>
    `;
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) {
      return null;
    }

    mountTarget.appendChild(root);
    return root;
  }

  function createController(options = {}) {
    const onSelectionComplete =
      typeof options.onSelectionComplete === "function"
        ? options.onSelectionComplete
        : null;
    const onSelectionCanceled =
      typeof options.onSelectionCanceled === "function"
        ? options.onSelectionCanceled
        : null;
    const onExitModeRequested =
      typeof options.onExitModeRequested === "function"
        ? options.onExitModeRequested
        : null;

    let mounted = false;
    let lastSelectionResult = null;
    const selectionState = {
      isDragging: false,
      startX: null,
      startY: null,
      currentX: null,
      currentY: null,
      endX: null,
      endY: null,
    };

    function updateState(nextValues) {
      Object.assign(selectionState, nextValues);
    }

    function isToolbarTarget(target) {
      return Boolean(
        target &&
          typeof target.closest === "function" &&
          target.closest(".aifd-rectangle-toolbar")
      );
    }

    function resetSelectionVisual() {
      const selectionElement = getSelectionElement();
      if (!selectionElement) {
        return;
      }
      selectionElement.style.display = "none";
      selectionElement.style.left = "0px";
      selectionElement.style.top = "0px";
      selectionElement.style.width = "0px";
      selectionElement.style.height = "0px";
    }

    function clearSelectionState() {
      updateState({
        isDragging: false,
        startX: null,
        startY: null,
        currentX: null,
        currentY: null,
        endX: null,
        endY: null,
      });
      lastSelectionResult = null;
      resetSelectionVisual();
    }

    function cancelCurrentSelection() {
      clearSelectionState();
      if (onSelectionCanceled) {
        onSelectionCanceled();
      }
    }

    function requestExitMode() {
      clearSelectionState();
      if (onExitModeRequested) {
        onExitModeRequested();
      } else {
        unmount();
      }
    }

    function getBoundsFromPoints(startX, startY, endX, endY) {
      if (
        !Number.isFinite(startX) ||
        !Number.isFinite(startY) ||
        !Number.isFinite(endX) ||
        !Number.isFinite(endY)
      ) {
        return null;
      }

      const left = Math.min(startX, endX);
      const top = Math.min(startY, endY);
      const right = Math.max(startX, endX);
      const bottom = Math.max(startY, endY);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);

      return {
        left,
        top,
        right,
        bottom,
        width,
        height,
      };
    }

    function rectanglesIntersect(a, b) {
      return (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
    }

    function findIntersectingImages(bounds) {
      if (!bounds) {
        return [];
      }

      const allImages = Array.from(document.querySelectorAll("img"));

      return allImages.filter((img) => {
        const source = img.currentSrc || img.src || "";
        if (!source) {
          return false;
        }

        const imageBounds = img.getBoundingClientRect();
        if (!imageBounds || imageBounds.width <= 0 || imageBounds.height <= 0) {
          return false;
        }

        return rectanglesIntersect(bounds, {
          left: imageBounds.left,
          top: imageBounds.top,
          right: imageBounds.right,
          bottom: imageBounds.bottom,
        });
      });
    }

    function getSelectionElement() {
      const root = document.getElementById(ROOT_ID);
      if (!root) {
        return null;
      }
      return root.querySelector(".aifd-rectangle-selection");
    }

    function renderSelectionRectangle() {
      const selectionElement = getSelectionElement();
      if (!selectionElement) {
        return;
      }

      const hasStart =
        Number.isFinite(selectionState.startX) &&
        Number.isFinite(selectionState.startY);
      const hasCurrent =
        Number.isFinite(selectionState.currentX) &&
        Number.isFinite(selectionState.currentY);

      if (!hasStart || !hasCurrent) {
        selectionElement.style.display = "none";
        selectionElement.style.width = "0px";
        selectionElement.style.height = "0px";
        return;
      }

      const left = Math.min(selectionState.startX, selectionState.currentX);
      const top = Math.min(selectionState.startY, selectionState.currentY);
      const width = Math.abs(selectionState.currentX - selectionState.startX);
      const height = Math.abs(selectionState.currentY - selectionState.startY);

      selectionElement.style.display = "block";
      selectionElement.style.left = `${left}px`;
      selectionElement.style.top = `${top}px`;
      selectionElement.style.width = `${width}px`;
      selectionElement.style.height = `${height}px`;
    }

    function handleMouseDown(event) {
      if (isToolbarTarget(event.target)) {
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        cancelCurrentSelection();
        return;
      }

      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      updateState({
        isDragging: true,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        endX: null,
        endY: null,
      });
      renderSelectionRectangle();
    }

    function handleMouseMove(event) {
      if (!selectionState.isDragging) {
        return;
      }

      event.preventDefault();
      updateState({
        currentX: event.clientX,
        currentY: event.clientY,
      });
      renderSelectionRectangle();
    }

    function handleMouseUp(event) {
      if (!selectionState.isDragging) {
        return;
      }

      event.preventDefault();
      updateState({
        isDragging: false,
        currentX: event.clientX,
        currentY: event.clientY,
        endX: event.clientX,
        endY: event.clientY,
      });
      renderSelectionRectangle();

      const bounds = getBoundsFromPoints(
        selectionState.startX,
        selectionState.startY,
        selectionState.endX,
        selectionState.endY
      );

      const minimumSelectionPx = 6;
      const isValidSelection =
        bounds &&
        bounds.width >= minimumSelectionPx &&
        bounds.height >= minimumSelectionPx;

      if (!isValidSelection) {
        lastSelectionResult = null;
        resetSelectionVisual();
        return;
      }

      const imageElements = findIntersectingImages(bounds);
      lastSelectionResult = {
        bounds,
        imageElements,
        imageCount: imageElements.length,
        selectedAt: Date.now(),
      };

      if (onSelectionComplete) {
        onSelectionComplete(lastSelectionResult);
      }
    }

    function handleToolbarActionClick(event) {
      const actionElement =
        event.target &&
        typeof event.target.closest === "function"
          ? event.target.closest("[data-aifd-rectangle-action]")
          : null;
      if (!actionElement) {
        return;
      }

      const actionName = actionElement.getAttribute("data-aifd-rectangle-action");
      event.preventDefault();
      event.stopPropagation();

      if (actionName === "cancel") {
        cancelCurrentSelection();
        return;
      }

      if (actionName === "exit") {
        requestExitMode();
      }
    }

    function handleContextMenu(event) {
      if (!mounted) {
        return;
      }
      if (!isToolbarTarget(event.target)) {
        event.preventDefault();
      }
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      requestExitMode();
    }

    function attachListeners(root) {
      root.addEventListener("mousedown", handleMouseDown, true);
      root.addEventListener("mousemove", handleMouseMove, true);
      root.addEventListener("mouseup", handleMouseUp, true);
      root.addEventListener("click", handleToolbarActionClick, true);
      root.addEventListener("contextmenu", handleContextMenu, true);
      document.addEventListener("keydown", handleKeyDown, true);
    }

    function detachListeners(root) {
      root.removeEventListener("mousedown", handleMouseDown, true);
      root.removeEventListener("mousemove", handleMouseMove, true);
      root.removeEventListener("mouseup", handleMouseUp, true);
      root.removeEventListener("click", handleToolbarActionClick, true);
      root.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    }

    function mount() {
      if (mounted) {
        return;
      }
      ensureStyles();
      const root = createRoot();
      if (!root) {
        return;
      }
      attachListeners(root);
      document.documentElement.classList.add("aifd-rectangle-mode-cursor");
      mounted = true;
    }

    function unmount() {
      if (!mounted) {
        return;
      }
      const root = document.getElementById(ROOT_ID);
      if (root) {
        detachListeners(root);
        root.remove();
      }
      clearSelectionState();
      document.documentElement.classList.remove("aifd-rectangle-mode-cursor");
      mounted = false;
    }

    function isMounted() {
      return mounted;
    }

    function getRootElement() {
      return document.getElementById(ROOT_ID);
    }

    function getSelectionState() {
      return { ...selectionState };
    }

    function getLastSelectionResult() {
      return lastSelectionResult;
    }

    return {
      mount,
      unmount,
      isMounted,
      getRootElement,
      getSelectionState,
      getLastSelectionResult,
    };
  }

  globalScope.AIFeedDetectorRectangleOverlay = {
    createController,
  };
})(window);
