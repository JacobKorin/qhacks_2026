# AI Feed Detector — Architecture, Roadmap & Plan

## Overview
AI Feed Detector is a Chrome extension that identifies likely AI-generated images in social media feeds and across the web. It overlays badges on content and provides visual cues (like a heatmap rail) to indicate where suspicious content appears.

Development is structured into three tiers:
1. Instagram-only MVP  
2. Multi-platform social media support  
3. Generic web click-to-scan mode  

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

# Tier 3 — Generic Web Click-to-Scan

## Goal
Let users detect AI images anywhere via click.

## Features

- Click-to-scan images  
- Contextual badges on clicked images  
- Mode toggles (social vs web)  
- Privacy-friendly scanning  

## Development Steps

1. Add click listener for images  
2. Ignore small/icons images  
3. Trigger detection on click  
4. Show scanning → result badge  
5. Add popup mode switcher  
6. Enforce size thresholds + caching  
7. Handle cross-origin images via backend  
8. Position as privacy-respecting feature  

---

# Summary of Vision

AI Feed Detector evolves into:
- A social media safety tool  
- A scalable cross-platform system  
- A privacy-aware web AI detector  

Core principles:
- Clear UX  
- Responsible scanning  
- Privacy awareness  
- Real-time feedback  

---

# Demo Narrative (Hackathon Friendly)

1. Scroll Instagram → see badges and heatmap dots appear  
2. Click a red dot → jump to flagged post  
3. Show popup stats dashboard  
4. Switch to click-to-scan mode on a normal website  
5. Click an image → instant AI likelihood badge  

This demonstrates scalability, usability, and real-world impact.