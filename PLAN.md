# AI Feed Detector — Architecture, Roadmap & Plan

## Overview
AI Feed Detector is a Chrome extension that identifies likely AI-generated images in social media feeds and across the web. It overlays badges on content and provides visual cues (like a heatmap rail) to indicate where suspicious content appears.

Development is structured into three tiers:
1. Instagram-only MVP  
2. Multi-platform social media support  
3. Generic web rectangle-selection detection mode  

Each tier builds on the same detection pipeline and Flask backend.

---

# Tier 1 — Instagram-Only MVP

## File Breakdown (Iteration 1)

ai-feed-detector/

    extension/ # Chrome extension folder (load unpacked from here)

        manifest.json                  # Permissions, scripts, Instagram match rules

        assets/                        # Icons for extension
            icon-16.png
            icon-48.png
            icon-128.png

        content/                       # Runs inside Instagram pages
            content.js                   # Entry point, coordinates scanning & UI
            dom.js                       # Finds Instagram post containers
            observer.js                  # Watches DOM for new posts while scrolling
            extractMedia.js              # Extracts image/reel URLs from posts
            overlay.js                   # Adds badges (AI Likely 82%)
            riskRail.js                  # Right-side dot heatmap rail

        background/                    # Service worker (extension brain)
            serviceWorker.js             # Messaging, API calls, orchestration
            detectClient.js              # Calls Flask backend
            queue.js                     # Rate-limit + concurrency control
            cache.js                     # chrome.storage caching

        popup/                         # Toolbar popup UI
            popup.html
            popup.js
            popup.css

        shared/                        # Shared helpers
            messages.js                  # Message type constants
            constants.js                 # Thresholds, colors, config
            utils.js                     # Hashing & helper functions

    backend/ # Flask backend
        app.py # Detection proxy + normalization
        requirements.txt # Flask dependencies

    .env # API keys (do not commit)
    README.md # Setup instructions

---

## Tier 1 Features

- Automatic Instagram feed scanning  
- AI detection badges per post  
- Risk Rail heatmap (dot per post)  
- Caching to avoid repeat scans  
- Popup stats (scanned/flagged)  
- Flask backend proxy for detection API  

---

## Tier 1 Development Steps

1. Set up manifest and Instagram permissions  
2. Inject content script and verify it runs  
3. Observe DOM to detect new posts  
4. Extract media URLs and hash them  
5. Send detection requests via background script  
6. Build Flask backend proxy  
7. Add queueing and caching  
8. Render badges on posts  
9. Implement risk rail dots  
10. Add popup stats and toggles  
11. Replace mock detection with real provider  
12. Polish UX for demo  

---

# Tier 2 — Multi-Platform Social Media

## Goal
Support Instagram + X + Facebook + TikTok with minimal site-specific code.

## Features

- Cross-platform feed scanning  
- Config-based site rules (selectors & hints)  
- Flexible scroll container handling  
- Optional video scanning toggle  

## Development Steps

1. Add domain matches in manifest  
2. Introduce siteRules configuration  
3. Generalize DOM/media extraction  
4. Adapt risk rail to container scrolling  
5. Strengthen deduplication/filtering  
6. Add UI indicators for supported sites  
7. Demo on at least one additional platform  

---

# Tier 3 — Generic Web Rectangle-Selection Mode

## Goal
Allow users to detect AI-generated images anywhere on any webpage by drawing a rectangle over the screen, similar to the Windows snipping tool.

Instead of taking a screenshot for saving, the selected region is analyzed for AI-generated imagery.

## Features

- Snipping-tool style rectangle selection  
- Works on any webpage  
- Detects images inside selected region  
- Overlays AI likelihood badges on detected images  
- User-triggered scanning (privacy-friendly)  
- Mode toggle in popup (Feed Mode vs Rectangle Mode)

## How It Works (Concept)

1. User activates "Rectangle Detection Mode" from popup  
2. Page enters selection mode with crosshair cursor  
3. User clicks and drags to draw a rectangle  
4. Extension identifies all images intersecting that rectangle  
5. Each image is sent for AI detection  
6. Badges appear on images inside the selected area  

No full-page scanning occurs — only user-selected regions.

---

## Tier 3 Development Steps

1. Add popup toggle for Rectangle Mode  
2. Inject overlay layer for drawing rectangle  
3. Track mouse drag coordinates  
4. Render selection rectangle visually  
5. On mouse release:
   - compute rectangle bounds  
   - find images intersecting region  
6. Extract URLs from those images  
7. Send detection requests via background script  
8. Display badges on detected images  
9. Add cancel/exit selection mode  
10. Polish UX (cursor, shading outside region, etc.)

---

# Summary of Vision

AI Feed Detector evolves into:
- A social media safety tool  
- A scalable cross-platform system  
- A user-controlled web AI detector  

Core principles:
- Clear UX  
- Responsible scanning  
- Privacy awareness  
- Real-time feedback  

---

# Demo Narrative (Hackathon Friendly)

1. Scroll Instagram → badges and heatmap dots appear  
2. Click a red dot → jump to flagged post  
3. Show popup stats dashboard  
4. Switch to Rectangle Mode  
5. Draw a box around images on any site  
6. AI likelihood badges appear on selected images  

This demonstrates scalability, usability, and real-world impact.