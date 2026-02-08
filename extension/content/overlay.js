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

            /* --- BADGE STYLES (Beside the post) --- */
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
                font-family: "Segoe UI", sans-serif;
                z-index: 10001;
                animation: aifd-fade-in 0.4s ease-out;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .aifd-badge-header { font-size: 11px; font-weight: 700; text-transform: uppercase; }
            .aifd-badge-score { font-size: 18px; font-weight: 800; color: var(--aifd-ink); }
            .aifd-badge-status { margin-top: 4px; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-align: center; border: 1px solid transparent; }
            
            .is-ai { color: var(--aifd-error); }
            .is-human { color: var(--aifd-accent); }
            .is-warn { color: var(--aifd-warn); }
            .bg-ai { background: var(--aifd-error-soft); color: #991b1b; border-color: #fecaca; }
            .bg-human { background: var(--aifd-accent-soft); color: #134e4a; border-color: #99f6e4; }
            .bg-warn { background: var(--aifd-warn-soft); color: #92400e; border-color: #fde68a; }

            /* --- NSFW OVERLAY STYLES (Covers the image) --- */
            .aifd-nsfw-overlay {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: rgba(5, 5, 5, 0.96) !important; /* Deep black blur */
                backdrop-filter: blur(25px);
                -webkit-backdrop-filter: blur(25px);
                display: flex !important; 
                flex-direction: column;
                align-items: center; 
                justify-content: center;
                z-index: 2147483647 !important; /* Max Z-Index to force top */
                border-radius: inherit;
                color: white;
                font-family: system-ui, -apple-system, sans-serif;
                transition: opacity 0.3s ease;
                overflow: hidden;
            }
            .aifd-nsfw-content { text-align: center; padding: 20px; pointer-events: auto; }
            .aifd-nsfw-icon { font-size: 40px; margin-bottom: 12px; display: block; }
            .aifd-nsfw-title { font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #fff; }
            .aifd-nsfw-text { font-size: 12px; opacity: 0.8; margin-bottom: 20px; max-width: 200px; line-height: 1.4; }
            
            .aifd-reveal-btn {
                background: white; 
                color: black; 
                border: none;
                padding: 10px 24px; 
                border-radius: 25px;
                font-weight: 700; 
                cursor: pointer;
                transition: all 0.2s ease;
                min-width: 140px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            }
            .aifd-reveal-btn:hover { background: var(--aifd-error); color: white; transform: scale(1.05); }

            @keyframes aifd-fade-in {
                from { opacity: 0; transform: translateX(-10px); }
                to { opacity: 1; transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    return {
        renderBadgeOnImage: function(hash, isAI, score, nsfw = false) {
            // 1. DATA SANITIZATION
            // Ensure nsfw is strictly boolean true. Handles string "true" or undefined/null.
            const isNSFW = (nsfw === true || nsfw === "true");

            // 2. FIND ELEMENTS
            const mediaElement = document.querySelector(`[data-aifd-hash="${hash}"]`);
            if (!mediaElement) return;

            // Strategy: 
            // - Attach OVERLAY to the immediate wrapper (to cover image perfectly).
            // - Attach BADGE to the article/post container (to sit to the side).
            
            const wrapper = mediaElement.parentElement;
            const postContainer = mediaElement.closest('article') || 
                                mediaElement.closest('div._as9-') || 
                                wrapper;

            console.log(`[AIFD] Rendering | Hash: ${hash} | AI: ${isAI} | NSFW: ${isNSFW}`);

            // 3. APPLY NSFW OVERLAY (To Wrapper)
            if (isNSFW && wrapper) {
                // Ensure wrapper can accept absolute children
                const computed = window.getComputedStyle(wrapper);
                if (computed.position === 'static') {
                    wrapper.style.position = 'relative';
                }
                this.applyNSFWCover(wrapper);
            }

            // 4. RENDER BADGE (To Post Container)
            if (postContainer) {
                // Ensure container handles the side badge
                if (window.getComputedStyle(postContainer).position === 'static') {
                    postContainer.style.position = 'relative';
                }

                const existingBadge = postContainer.querySelector('.aifd-badge-side');
                if (existingBadge) existingBadge.remove();

                let displayScore = score > 1 ? score : score * 100;
                const formattedScore = displayScore.toFixed(1);
                const mainLabel = isAI ? 'AI Generated' : 'Not AI Generated';
                const colorClass = (displayScore < 65) ? 'is-warn' : (isAI ? 'is-ai' : 'is-human');
                const bgClass = (displayScore < 65) ? 'bg-warn' : (isAI ? 'bg-ai' : 'bg-human');

                const badge = document.createElement('div');
                badge.className = 'aifd-badge-side';
                badge.innerHTML = `
                    <span class="aifd-badge-header ${colorClass}">Confidence</span>
                    <span class="aifd-badge-score">${formattedScore}%</span>
                    <div class="aifd-badge-status ${bgClass}">${mainLabel}</div>
                `;
                postContainer.appendChild(badge);
            }
        },

        applyNSFWCover: function(container) {
            // Avoid duplicates
            if (container.querySelector('.aifd-nsfw-overlay')) return;

            const overlay = document.createElement('div');
            overlay.className = 'aifd-nsfw-overlay';
            overlay.innerHTML = `
                <div class="aifd-nsfw-content">
                    <span class="aifd-nsfw-icon">🔞</span>
                    <div class="aifd-nsfw-title">Sensitive Content</div>
                    <div class="aifd-nsfw-text">
                        Gemini AI flagged this media as potentially NSFW.
                    </div>
                    <button class="aifd-reveal-btn">Show Content</button>
                </div>
            `;

            const btn = overlay.querySelector('.aifd-reveal-btn');
            
            // Hover logic
            btn.addEventListener('mouseenter', () => { btn.textContent = "Are you sure?"; });
            btn.addEventListener('mouseleave', () => { btn.textContent = "Show Content"; });

            // Click logic: Remove overlay
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
            });
            
            // Prevent clicks on the overlay from opening the post/image
            overlay.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
            });

            container.appendChild(overlay);
        }
    };
})();