// content/overlay.js
window.AIFeedDetectorOverlay = (function() {
    const styleId = 'aifd-injected-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            :root {
                --aifd-bg: #f4f7fb;
                --aifd-card: #ffffff;
                --aifd-ink: #0f172a;
                --aifd-muted: #475569;
                --aifd-line: #dbe4f0;
                --aifd-accent: #0f766e;
                --aifd-accent-soft: #ccfbf1;
                --aifd-error: #ef4444;
                --aifd-error-soft: #fee2e2;
                --aifd-warn: #b45309;
                --aifd-warn-soft: #fef3c7;
            }
            .aifd-badge-side {
                position: absolute;
                left: calc(100% + 15px);
                top: 0;
                width: 140px;
                background: var(--aifd-card);
                border: 1px solid var(--aifd-line);
                border-radius: 12px;
                padding: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                font-family: "Segoe UI", "Aptos", sans-serif;
                z-index: 10001; /* High z-index to stay above video overlays */
                animation: aifd-fade-in 0.4s ease-out;
                display: flex;
                flex-direction: column;
                gap: 4px;
                pointer-events: auto;
            }
            .aifd-badge-header { 
                font-size: 11px; 
                font-weight: 700; 
                text-transform: uppercase; 
                display: block; 
            }
            .aifd-badge-score { 
                font-size: 18px; 
                font-weight: 800; 
                color: var(--aifd-ink); 
                display: block; 
            }
            .aifd-badge-status {
                margin-top: 4px;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 600;
                text-align: center;
                border: 1px solid transparent;
            }
            
            /* Prediction Colors */
            .is-ai { color: var(--aifd-error); }
            .is-human { color: var(--aifd-accent); }
            .is-warn { color: var(--aifd-warn); }

            /* Background/Indicator Colors */
            .bg-ai { background: var(--aifd-error-soft); color: #991b1b; border-color: #fecaca; }
            .bg-human { background: var(--aifd-accent-soft); color: #134e4a; border-color: #99f6e4; }
            .bg-warn { background: var(--aifd-warn-soft); color: #92400e; border-color: #fde68a; }

            .aifd-aggregate-badge {
                position: fixed;
                top: 14px;
                right: 14px;
                width: 220px;
                background: var(--aifd-card);
                border: 1px solid var(--aifd-line);
                border-radius: 12px;
                padding: 12px;
                box-shadow: 0 8px 18px rgba(0,0,0,0.16);
                font-family: "Segoe UI", "Aptos", sans-serif;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .aifd-aggregate-title {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.02em;
                color: var(--aifd-muted);
            }

            .aifd-aggregate-score {
                font-size: 28px;
                line-height: 1;
                font-weight: 800;
                color: var(--aifd-ink);
            }

            .aifd-aggregate-meta {
                font-size: 12px;
                color: var(--aifd-muted);
            }

            .aifd-aggregate-status {
                margin-top: 4px;
                padding: 6px 8px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 700;
                border: 1px solid transparent;
                text-align: center;
            }
            
            @keyframes aifd-fade-in {
                from { opacity: 0; transform: translateX(-10px); }
                to { opacity: 1; transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    return {
        renderBadgeOnImage: function(hash, isAI, score) {
            // UPDATED: Now searches for ANY element (img or video) with the hash
            const mediaElement = document.querySelector(`[data-aifd-hash="${hash}"]`);
            
            if (!mediaElement) {
                console.warn(`[AIFD] Target media for hash ${hash} not found in DOM.`);
                return;
            }

            const postContainer = mediaElement.closest('article') || 
                    mediaElement.closest('div[role="menuitem"]') || 
                    mediaElement.parentElement;
            if (!postContainer) return;

            postContainer.style.overflow = 'visible';
            postContainer.style.position = 'relative';

            // Remove existing badge if present to allow for updates/re-scans
            const existing = postContainer.querySelector('.aifd-badge-side');
            if (existing) existing.remove();

            // --- Math Logic ---
            let displayScore = score > 1 ? score : score * 100;
            const formattedScore = displayScore.toFixed(1);

            // --- Label Logic ---
            const mainLabel = isAI ? 'AI Generated' : 'Not AI Generated';
            
            const colorClass = (displayScore < 65) ? 'is-warn' : (isAI ? 'is-ai' : 'is-human');
            const bgClass = (displayScore < 65) ? 'bg-warn' : (isAI ? 'bg-ai' : 'bg-human');

            const badge = document.createElement('div');
            badge.className = 'aifd-badge-side';
            badge.innerHTML = `
                <span class="aifd-badge-header ${colorClass}">Confidence</span>
                <span class="aifd-badge-score">${formattedScore}%</span>
                <div class="aifd-badge-status ${bgClass}">
                    ${mainLabel}
                </div>
            `;
            postContainer.appendChild(badge);
            console.log(`[AIFD] Badge rendered for ${mediaElement.tagName} (${hash.substring(0,8)})`);
        },

        renderAggregateBadge: function(options) {
            const averageScore = Math.max(0, Math.min(100, Number(options?.averageScore || 0)));
            const uniqueScannedCount = Math.max(
                0,
                Number(options?.uniqueScannedCount ?? options?.totalCount ?? 0)
            );
            const selectedCount = Math.max(
                0,
                Number(options?.selectedCount ?? uniqueScannedCount)
            );
            const aiLikelyCount = Math.max(0, Number(options?.aiLikelyCount || 0));

            let statusLabel = "Likely Human";
            let statusClass = "bg-human";
            if (averageScore >= 75) {
                statusLabel = "Likely AI";
                statusClass = "bg-ai";
            } else if (averageScore >= 60) {
                statusLabel = "Mixed / Unclear";
                statusClass = "bg-warn";
            }

            let badge = document.getElementById("aifd-aggregate-badge");
            if (!badge) {
                badge = document.createElement("div");
                badge.id = "aifd-aggregate-badge";
                badge.className = "aifd-aggregate-badge";
                document.body.appendChild(badge);
            }

            badge.innerHTML = `
                <span class="aifd-aggregate-title">Selection Average</span>
                <span class="aifd-aggregate-score">${averageScore.toFixed(1)}%</span>
                <span class="aifd-aggregate-meta">Selected: ${selectedCount} | Scanned: ${uniqueScannedCount} | AI-likely: ${aiLikelyCount}</span>
                <div class="aifd-aggregate-status ${statusClass}">${statusLabel}</div>
            `;
        },

        clearAggregateBadge: function() {
            const badge = document.getElementById("aifd-aggregate-badge");
            if (badge) {
                badge.remove();
            }
        }
    };
})();
