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
                z-index: 999;
                animation: aifd-fade-in 0.4s ease-out;
                display: flex;
                flex-direction: column;
                gap: 4px;
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

            @keyframes aifd-fade-in {
                from { opacity: 0; transform: translateX(-10px); }
                to { opacity: 1; transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    return {
        renderBadgeOnImage: function(hash, isAI, score) {
            const imgElement = document.querySelector(`img[data-aifd-hash="${hash}"]`);
            if (!imgElement) return;

            const postContainer = imgElement.closest('article');
            if (!postContainer) return;

            postContainer.style.overflow = 'visible';
            postContainer.style.position = 'relative';

            if (postContainer.querySelector('.aifd-badge-side')) return;

            // --- Math Logic ---
            let displayScore = score > 1 ? score : score * 100;
            const formattedScore = displayScore.toFixed(1);

            // --- Label Logic ---
            const mainLabel = isAI ? 'AI Generated' : 'Not AI Generated';
            
            // Determine visual style: Use warn colors if confidence is low, 
            // otherwise use the AI/Human primary colors.
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
        }
    };
})();