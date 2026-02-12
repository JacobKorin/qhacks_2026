# Pixel Zero (AI Feed Detector) — QHacks 2026

Pixel Zero is a real-time **AI-generated media detector + safety layer** for social media feeds. It runs as a **Chrome extension** that labels likely AI-generated images/videos while you scroll, and includes a **“Lasso”** mode for on-demand verification of a specific region on the page.

This project was built at **QHacks 2026** as a prototype to help close the growing “digital trust gap” caused by increasingly convincing synthetic media.

---

## What it does

- **Active Feed Scanning**: Automatically detects and labels AI-generated images/videos in a scrolling feed.
- **NSFW Transparency**: Blurs sensitive content and lets the user reveal it intentionally (protective, not disruptive).
- **Lasso Tool**: Draw a rectangle over any part of a webpage to run **instant, targeted** detection.

---

## How it works (workflow)

1. **Extension watches the page** using DOM observers as you scroll (infinite scroll friendly).
2. New images/videos are **extracted and fingerprinted** (hashing + caching to avoid re-scans).
3. The extension sends detection requests **asynchronously** to a Flask backend.
4. The backend orchestrates AI detection using providers (e.g., **Gemini** + **AI-or-Not**), normalizes results, and returns a confidence score.
5. The extension maps the response back to the exact DOM element and overlays a badge / UI indicator in real time.

A key engineering challenge is correctly mapping backend results back to the right media element in fast-changing feeds (e.g., Instagram). This is handled via **robust hashing + async message passing + caching**.

---

## Repo structure

- `extension/` — Chrome Extension (content scripts, overlays, popup UI, service worker)
- `backend/` — Flask API backend (detection orchestration)
- `PLAN.md` — Architecture / roadmap / tiered plan
- `.env` — API keys (do **not** commit real secrets)
- `mockAPI.py` — local mock for testing without paid API calls

---

## Quickstart (local demo)

### Prereqs
- Google Chrome (or Chromium-based browser)
- Python 3.10+ recommended
- API keys for your detection providers (see `.env` section below)

---

### 1) Clone the repo
```bash
git clone https://github.com/JacobKorin/qhacks_2026.git
cd qhacks_2026
