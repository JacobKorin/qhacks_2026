import base64
import binascii
import hashlib
import mimetypes
import os
import uuid
import random
import time
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple
import io

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
#from moviepy.editor import VideoFileClip

# Load environment variables
load_dotenv()

APP_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", APP_ROOT / "uploads"))
MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "10485760"))  # 10 MB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
CORS(app)

# Configuration for AI detection
AI_OR_NOT_API_KEY = os.getenv('AI_OR_NOT_API_KEY')
AI_OR_NOT_IMAGE_API_URL = "https://api.aiornot.com/v2/image/sync"
AI_OR_NOT_VIDEO_API_URL = "https://api.aiornot.com/v2/video/sync"
QUOTA_LIMIT = int(os.getenv('QUOTA_LIMIT', '10'))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# Validate API keys on startup
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY is not set in environment variables")
if not AI_OR_NOT_API_KEY:
    print("WARNING: AI_OR_NOT_API_KEY is not set in environment variables")

# Quota management
class QuotaManager:
    def __init__(self, limit=QUOTA_LIMIT):
        self.limit = limit
        self.used = 0
    
    def can_analyze(self):
        return self.used < self.limit
    
    def use_credit(self):
        if self.can_analyze():
            self.used += 1
            return True
        return False
    
    def get_status(self):
        return {
            "used": self.used,
            "remaining": self.limit - self.used,
            "limit": self.limit
        }

quota_manager = QuotaManager()
cache = {}  # Cache structure: {image_hash: {"result": result_dict, "timestamp": iso_string}}
nsfw_cache = {}  # Cache structure: {image_hash: {"result": result_dict, "timestamp": iso_string}}

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def _guess_ext(filename: Optional[str], content_type: Optional[str]) -> str:
    if filename:
        suffix = Path(filename).suffix
        if suffix:
            return suffix.lower()
    if content_type:
        if content_type == "image/jpeg":
            return ".jpg"
        if content_type == "image/png":
            return ".png"
        if content_type == "image/gif":
            return ".gif"
        if content_type == "image/webp":
            return ".webp"
    return ".img"

def _save_bytes(data: bytes, filename: Optional[str], content_type: Optional[str]) -> Tuple[str, str, int]:
    _ensure_upload_dir()
    ext = _guess_ext(filename, content_type)
    safe_name = secure_filename(Path(filename).stem) if filename else "upload"
    unique_name = f"{safe_name}-{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / unique_name
    path.write_bytes(data)
    return str(path), ext, len(data)

def _read_base64_payload(b64_value: str) -> bytes:
    if "," in b64_value:
        _, b64_value = b64_value.split(",", 1)
    try:
        return base64.b64decode(b64_value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 payload") from exc

def _fetch_image_url(url: str) -> Tuple[bytes, str]:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "")
    return response.content, content_type

def _generate_image_hash(data: bytes) -> str:
    """Generate hash for image data for caching"""
    return hashlib.sha256(data).hexdigest()

def _guess_content_type(filename: Optional[str], media_type: str) -> str:
    if filename:
        guessed, _ = mimetypes.guess_type(filename)
        if guessed:
            return guessed
    return "video/mp4" if media_type == "video" else "image/jpeg"

def _call_ai_detection_api(media_bytes: bytes, media_type: str, filename: Optional[str]) -> dict:
    """Call AI or Not API with multipart media bytes."""
    endpoint = AI_OR_NOT_VIDEO_API_URL if media_type == "video" else AI_OR_NOT_IMAGE_API_URL
    field_name = "video" if media_type == "video" else "image"
    effective_name = filename or ("upload.mp4" if media_type == "video" else "upload.jpg")
    content_type = _guess_content_type(effective_name, media_type)

    headers = {
        "Authorization": f"Bearer {AI_OR_NOT_API_KEY}",
        "Accept": "application/json",
    }

    files = {
        field_name: (effective_name, media_bytes, content_type),
    }

    print(
        f"[AIFD][AIORNOT] request endpoint={endpoint} media_type={media_type} "
        f"filename={effective_name} bytes={len(media_bytes)}"
    )

    try:
        response = requests.post(endpoint, files=files, headers=headers, timeout=60)
    except requests.Timeout as exc:
        print(f"[AIFD][AIORNOT] timeout media_type={media_type}: {exc}")
        raise
    except requests.RequestException as exc:
        print(f"[AIFD][AIORNOT] network error media_type={media_type}: {exc}")
        raise

    body_preview = response.text[:500] if response.text else ""
    print(
        f"[AIFD][AIORNOT] response status={response.status_code} "
        f"media_type={media_type} body_preview={body_preview!r}"
    )

    response.raise_for_status()
    return response.json()

def _normalize_aiornot_response(api_response: dict) -> Tuple[bool, float]:
    """
    Normalize AI or Not response into (is_ai, confidence_percent).
    Confidence is mapped to AI confidence in [0, 100].
    """
    report = api_response.get("report", {}) if isinstance(api_response, dict) else {}

    candidates = [
        report.get("ai_generated", {}),
        report.get("ai_video", {}),
        report,
    ]

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        verdict = str(candidate.get("verdict", "")).lower()
        ai_obj = candidate.get("ai")
        ai_conf = None

        if isinstance(ai_obj, dict) and isinstance(ai_obj.get("confidence"), (int, float)):
            ai_conf = float(ai_obj["confidence"])
        elif isinstance(candidate.get("confidence"), (int, float)):
            ai_conf = float(candidate["confidence"])

        if ai_conf is not None:
            if ai_conf > 1:
                ai_conf = ai_conf / 100.0
            ai_conf = max(0.0, min(1.0, ai_conf))
            is_ai = verdict == "ai" if verdict in {"ai", "human"} else ai_conf >= 0.5
            return is_ai, round(ai_conf * 100.0, 2)

    return False, 0.0

def _clean_old_cache_entries(cache_store: dict):
    """Remove cache entries older than 24 hours"""
    cutoff = datetime.now(timezone.utc).timestamp() - 24 * 3600
    to_delete = []
    
    for key, entry in cache_store.items():
        entry_time = datetime.fromisoformat(entry["timestamp"]).timestamp()
        if entry_time < cutoff:
            to_delete.append(key)
    
    for key in to_delete:
        del cache_store[key]

def _call_gemini_nsfw_api(image_bytes: bytes, filename: Optional[str]) -> dict:
    """Call Gemini multimodal API to classify NSFW content."""
    if not GEMINI_API_KEY:
        print("[AIFD][GEMINI] ERROR: GEMINI_API_KEY is not set")
        raise ValueError("Missing GEMINI_API_KEY in environment")
    
    if not GEMINI_MODEL:
        print("[AIFD][GEMINI] ERROR: GEMINI_MODEL is not set")
        raise ValueError("Missing GEMINI_MODEL in environment")

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    
    # Try to determine content type from filename
    content_type = "image/jpeg"  # default
    if filename:
        if filename.lower().endswith(('.png', '.png?')):
            content_type = "image/png"
        elif filename.lower().endswith(('.gif', '.gif?')):
            content_type = "image/gif"
        elif filename.lower().endswith(('.webp', '.webp?')):
            content_type = "image/webp"
    
    try:
        encoded = base64.b64encode(image_bytes).decode("utf-8")
    except Exception as e:
        print(f"[AIFD][GEMINI] Error encoding image: {e}")
        raise

    prompt = (
        "Analyze this image and determine if it contains NSFW (Not Safe For Work) content. "
        "Consider: nudity, sexual content, explicit material, violence, gore, or any adult-only themes. "
        "Respond with ONLY a valid JSON object in this exact format: "
        '{"is_nsfw": true|false, "score": 0.0-1.0, "category": "none|sexual|nudity|suggestive|violence|gore|explicit"}'
        "If unsure, default to false."
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": content_type, "data": encoded}},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 100,
            "topP": 0.8,
            "topK": 40
        },
        "safetySettings": [
            {
                "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "threshold": "BLOCK_NONE"
            },
            {
                "category": "HARM_CATEGORY_HATE_SPEECH",
                "threshold": "BLOCK_NONE"
            },
            {
                "category": "HARM_CATEGORY_HARASSMENT",
                "threshold": "BLOCK_NONE"
            },
            {
                "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                "threshold": "BLOCK_NONE"
            }
        ]
    }

    print(f"[AIFD][GEMINI] request model={GEMINI_MODEL} bytes={len(image_bytes)} content_type={content_type}")

    try:
        response = requests.post(
            endpoint,
            params={"key": GEMINI_API_KEY},
            headers={"Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=30,
        )
    except requests.RequestException as e:
        print(f"[AIFD][GEMINI] Network error: {e}")
        raise

    body_preview = response.text[:500] if response.text else ""
    print(f"[AIFD][GEMINI] response status={response.status_code} body_preview={body_preview!r}")

    if response.status_code != 200:
        print(f"[AIFD][GEMINI] API error: {response.text}")
        raise Exception(f"Gemini API error: {response.status_code} - {response.text}")

    response.raise_for_status()
    return response.json()

def _normalize_gemini_nsfw_response(api_response: dict) -> Tuple[bool, float, str]:
    """Normalize Gemini response into (is_nsfw, score[0-1], category)."""
    text = ""
    try:
        # Extract text from Gemini response
        candidates = api_response.get("candidates", [])
        for candidate in candidates:
            content = candidate.get("content", {})
            if isinstance(content, dict):
                parts = content.get("parts", [])
                for part in parts:
                    if isinstance(part, dict) and "text" in part:
                        text = part["text"]
                        break
            if text:
                break
        
        # Fallback: try to get text from promptFeedback
        if not text and "promptFeedback" in api_response:
            text = str(api_response.get("promptFeedback", {}))
            
    except Exception as e:
        print(f"[AIFD][GEMINI] Error extracting text: {e}")
        text = ""

    if not text:
        print("[AIFD][GEMINI] No text found in response")
        return False, 0.0, "unknown"

    # Try to parse JSON from response
    parsed = None
    try:
        # Look for JSON pattern in text
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            json_str = json_match.group(0)
            parsed = json.loads(json_str)
        else:
            # Try to parse entire text as JSON
            parsed = json.loads(text.strip())
    except json.JSONDecodeError as e:
        print(f"[AIFD][GEMINI] JSON parse error: {e}, text was: {text[:200]}")
        # Fallback: check if text contains NSFW indicators
        is_nsfw = any(word in text.lower() for word in ["nsfw", "true", "yes", "sexual", "nudity", "explicit"])
        score = 0.8 if is_nsfw else 0.2
        category = "unknown"
        if "sexual" in text.lower():
            category = "sexual"
        elif "nudity" in text.lower():
            category = "nudity"
        elif "suggestive" in text.lower():
            category = "suggestive"
        elif "violence" in text.lower():
            category = "violence"
        return is_nsfw, score, category

    if not isinstance(parsed, dict):
        print(f"[AIFD][GEMINI] Parsed response is not a dict: {parsed}")
        return False, 0.0, "unknown"

    # Extract values with fallbacks
    is_nsfw = parsed.get("is_nsfw", False)
    if isinstance(is_nsfw, str):
        is_nsfw = is_nsfw.lower() in ["true", "yes", "1"]
    
    raw_score = parsed.get("score", 0.0)
    try:
        score = float(raw_score)
    except (ValueError, TypeError):
        score = 0.8 if is_nsfw else 0.2
    
    # Normalize score to 0-1 range
    if score > 1:
        score = score / 100.0
    score = max(0.0, min(1.0, score))
    
    category = str(parsed.get("category", "unknown")).lower()
    if category not in ["none", "sexual", "nudity", "suggestive", "violence", "gore", "explicit"]:
        category = "unknown"
    
    return bool(is_nsfw), round(score, 3), category

''' def trim_video(input_path, max_duration=15):
    """Trims video to max_duration seconds to save bandwidth and API time"""
    output_path = input_path.replace(".mp4", "_trimmed.mp4")
    try:
        with VideoFileClip(input_path) as video:
            # If video is longer than our limit, cut it
            if video.duration > max_duration:
                new_video = video.subclip(0, max_duration)
                new_video.write_videofile(output_path, codec="libx264", audio=False)
                return output_path
    except Exception as e:
        print(f"[AIFD] Error trimming video: {e}")
    return input_path '''

@app.get("/")
def root():
    return jsonify(
        {
            "name": "ai-feed-detector-backend",
            "status": "ok",
            "timestamp": _utc_now_iso(),
            "endpoints": {
                "/detect": "POST - Analyze image for AI generation",
                "/nsfw": "POST - Analyze image for NSFW content",
                "/quota": "GET - Get quota usage",
                "/health": "GET - Health check",
                "/cache/info": "GET - Cache information"
            }
        }
    )

@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "timestamp": _utc_now_iso(),
        "quota": quota_manager.get_status(),
        "cache_size": len(cache),
        "gemini_api_key_set": bool(GEMINI_API_KEY),
        "aiornot_api_key_set": bool(AI_OR_NOT_API_KEY)
    })

@app.post("/detect")
def detect_image():
    """Analyze image for AI generation using AI or Not API"""
    try:
        if not AI_OR_NOT_API_KEY:
            return jsonify({"ok": False, "error": "Missing AI_OR_NOT_API_KEY in environment"}), 500

        payload = request.get_json(silent=True) or {}
        media_type = "video" if payload.get("media_type") == "video" else "image"

        # Determine input format
        if "file" in request.files:
            # Handle file upload
            upload = request.files["file"]
            if not upload.filename:
                return jsonify({"ok": False, "error": "Missing filename"}), 400
            
            image_bytes = upload.read()
            if not image_bytes:
                return jsonify({"ok": False, "error": "Empty image file"}), 400

            image_hash = _generate_image_hash(image_bytes)
            source_filename = upload.filename

        else:
            # Handle JSON payload with base64 image or media URL
            image_base64 = payload.get("image")
            media_url = payload.get("media_url") or payload.get("url")
            
            if image_base64:
                if image_base64.startswith('data:'):
                    image_base64 = image_base64.split(',', 1)[1]

                try:
                    image_bytes = base64.b64decode(image_base64, validate=True)
                except (binascii.Error, ValueError) as exc:
                    return jsonify({"ok": False, "error": f"Invalid base64: {exc}"}), 400

                if not image_bytes:
                    return jsonify({"ok": False, "error": "Empty decoded image payload"}), 400

                image_hash = _generate_image_hash(image_bytes)
                source_filename = "inline-upload.mp4" if media_type == "video" else "inline-upload.jpg"
            elif media_url:
                try:
                    response = requests.get(media_url, timeout=20)
                    response.raise_for_status()
                    image_bytes = response.content
                except requests.RequestException as exc:
                    return jsonify({"ok": False, "error": f"Failed to fetch media_url: {exc}"}), 400

                if not image_bytes:
                    return jsonify({"ok": False, "error": "Fetched media_url returned empty body"}), 400

                image_hash = _generate_image_hash(image_bytes)
                source_filename = Path(media_url).name or ("remote.mp4" if media_type == "video" else "remote.jpg")
            else:
                return jsonify({"ok": False, "error": "No image or media_url provided"}), 400
        
        # Check cache first
        if image_hash in cache:
            cached_entry = cache[image_hash]
            return jsonify({
                "ok": True,
                "is_ai": cached_entry["result"]["is_ai"],
                "confidence": cached_entry["result"]["confidence"],
                "cached": True,
                "hash": image_hash,
                "quota": quota_manager.get_status()
            })
        
        # Check quota
        if not quota_manager.can_analyze():
            return jsonify({
                "ok": False,
                "error": "Quota limit reached",
                "quota": quota_manager.get_status()
            }), 429
        
        # Call AI detection API
        try:
            api_response = _call_ai_detection_api(image_bytes, media_type, source_filename)
            is_ai, confidence = _normalize_aiornot_response(api_response)

            result = {"is_ai": is_ai, "confidence": confidence}
            
            # Use quota credit
            quota_manager.use_credit()
            
            # Cache result (with 24-hour TTL)
            cache[image_hash] = {
                "result": result,
                "timestamp": _utc_now_iso()
            }
            
            # Clean old cache entries periodically
            if len(cache) % 10 == 0:  # Every 10 requests
                _clean_old_cache_entries(cache)
            
            return jsonify({
                "ok": True,
                "is_ai": is_ai,
                "confidence": confidence,
                "cached": False,
                "hash": image_hash,
                "media_type": media_type,
                "quota": quota_manager.get_status()
            })
            
        except requests.exceptions.RequestException as exc:
            return jsonify({
                "ok": False,
                "error": f"AI detection API error: {exc}"
            }), 503
            
    except Exception as e:
        print(f"[AIFD] Unhandled error in /detect: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/quota")
def get_quota():
    """Get current quota usage"""
    return jsonify({
        "ok": True,
        "quota": quota_manager.get_status()
    })

@app.get("/cache/info")
def cache_info():
    """Get cache information"""
    return jsonify({
        "ok": True,
        "size": len(cache),
        "quota": quota_manager.get_status()
    })

@app.post("/nsfw")
def detect_nsfw():
    """Analyze image for NSFW content using Gemini API."""
    try:
        if not GEMINI_API_KEY:
            return jsonify({"ok": False, "error": "Missing GEMINI_API_KEY in environment"}), 500

        payload = request.get_json(silent=True) or {}
        
        # Check if it's a video (NSFW detection only for images)
        media_type = payload.get("media_type", "image")
        if media_type == "video":
            return jsonify({
                "ok": True,
                "is_nsfw": False,
                "score": 0.0,
                "category": "video_unsupported",
                "note": "NSFW detection for videos not supported"
            })

        if "file" in request.files:
            upload = request.files["file"]
            if not upload.filename:
                return jsonify({"ok": False, "error": "Missing filename"}), 400

            image_bytes = upload.read()
            if not image_bytes:
                return jsonify({"ok": False, "error": "Empty image file"}), 400

            image_hash = _generate_image_hash(image_bytes)
            source_filename = upload.filename
        else:
            image_base64 = payload.get("image") or payload.get("base64")
            media_url = payload.get("media_url") or payload.get("url")

            if image_base64:
                if image_base64.startswith('data:'):
                    image_base64 = image_base64.split(',', 1)[1]

                try:
                    image_bytes = base64.b64decode(image_base64, validate=True)
                except (binascii.Error, ValueError) as exc:
                    return jsonify({"ok": False, "error": f"Invalid base64: {exc}"}), 400

                if not image_bytes:
                    return jsonify({"ok": False, "error": "Empty decoded image payload"}), 400

                image_hash = _generate_image_hash(image_bytes)
                source_filename = "inline-upload.jpg"
            elif media_url:
                try:
                    response = requests.get(media_url, timeout=20)
                    response.raise_for_status()
                    image_bytes = response.content
                except requests.RequestException as exc:
                    return jsonify({"ok": False, "error": f"Failed to fetch media_url: {exc}"}), 400

                if not image_bytes:
                    return jsonify({"ok": False, "error": "Fetched media_url returned empty body"}), 400

                image_hash = _generate_image_hash(image_bytes)
                source_filename = Path(media_url).name or "remote.jpg"
            else:
                return jsonify({"ok": False, "error": "No image or media_url provided"}), 400

        # Check cache first
        if image_hash in nsfw_cache:
            cached_entry = nsfw_cache[image_hash]
            return jsonify({
                "ok": True,
                "is_nsfw": cached_entry["result"]["is_nsfw"],
                "score": cached_entry["result"]["score"],
                "category": cached_entry["result"]["category"],
                "cached": True,
                "hash": image_hash
            })

        try:
            api_response = _call_gemini_nsfw_api(image_bytes, source_filename)
            is_nsfw, score, category = _normalize_gemini_nsfw_response(api_response)

            result = {"is_nsfw": is_nsfw, "score": score, "category": category}
            nsfw_cache[image_hash] = {
                "result": result,
                "timestamp": _utc_now_iso()
            }

            if len(nsfw_cache) % 10 == 0:
                _clean_old_cache_entries(nsfw_cache)

            return jsonify({
                "ok": True,
                "is_nsfw": is_nsfw,
                "score": score,
                "category": category,
                "cached": False,
                "hash": image_hash
            })
        except requests.exceptions.RequestException as exc:
            print(f"[AIFD] Gemini API request error: {exc}")
            return jsonify({
                "ok": False,
                "error": f"Gemini API error: {exc}"
            }), 503
        except ValueError as exc:
            print(f"[AIFD] Gemini API value error: {exc}")
            return jsonify({"ok": False, "error": str(exc)}), 500
        except Exception as exc:
            print(f"[AIFD] Gemini API unexpected error: {exc}")
            return jsonify({"ok": False, "error": str(exc)}), 500

    except Exception as e:
        print(f"[AIFD] Unhandled error in /nsfw: {str(e)}")
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/cache/clear")
def clear_cache_endpoint():
    """Clear the cache (for debugging/maintenance)"""
    cache.clear()
    nsfw_cache.clear()
    return jsonify({
        "ok": True,
        "message": "Cache cleared",
        "cache_size": len(cache),
        "nsfw_cache_size": len(nsfw_cache)
    })

# Keep the original upload endpoint for compatibility (optional)
@app.post("/v1/media/image")
@app.post("/media/image")
def receive_image():
    """Legacy endpoint for backward compatibility"""
    if "file" in request.files:
        upload = request.files["file"]
        if not upload.filename:
            return jsonify({"ok": False, "error": "Missing filename"}), 400
        data = upload.read()
        content_type = upload.content_type
        filename = upload.filename
    else:
        payload = request.get_json(silent=True) or {}
        image_url = payload.get("image_url")
        image_base64 = payload.get("image_base64")
        if image_url:
            try:
                data, content_type = _fetch_image_url(image_url)
            except requests.RequestException as exc:
                return (
                    jsonify({"ok": False, "error": f"Failed to fetch image_url: {exc}"}),
                    400,
                )
            filename = Path(image_url).name or "remote-image"
        elif image_base64:
            try:
                data = _read_base64_payload(image_base64)
            except ValueError as exc:
                return jsonify({"ok": False, "error": str(exc)}), 400
            content_type = payload.get("content_type")
            filename = payload.get("filename") or "inline-image"
        else:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "Provide multipart file, image_url, or image_base64",
                    }
                ),
                400,
            )

    if not data:
        return jsonify({"ok": False, "error": "Empty image payload"}), 400

    try:
        stored_path, ext, size = _save_bytes(data, filename, content_type)
    except OSError as exc:
        return jsonify({"ok": False, "error": f"Failed to store image: {exc}"}), 500

    response = {
        "ok": True,
        "received_at": _utc_now_iso(),
        "meta": {
            "filename": filename,
            "content_type": content_type,
            "size_bytes": size,
            "sha256": _sha256_bytes(data),
            "extension": ext,
        },
        "storage": {
            "path": stored_path,
        },
    }
    return jsonify(response)

@app.post("/mock/detect")
def mock_detect():
    data = request.get_json(silent=True)
    
    if data is None:
        print(f"DEBUG: Received non-JSON body: {request.data[:100]}...")
        return {"error": "Invalid JSON"}, 400

    # 1. Capture all possible keys from frontend
    image_base64 = data.get("base64") or data.get("image")
    media_url = data.get("media_url") or data.get("url")
    is_video = data.get("isVideo") or data.get("media_type") == "video"

    # 2. VALIDATION: We need AT LEAST one data source
    if not image_base64 and not media_url:
        print(f"DEBUG: Missing media. Available keys: {list(data.keys())}")
        return jsonify({"ok": False, "error": "No media data (base64 or URL) provided"}), 400

    # 3. Handle processing stats
    processing_time = 0
    # Use base64 for size calc if available, otherwise assume a standard size
    if image_base64:
        file_size_mb = len(image_base64) * 3 / 4 / (1024 * 1024)
    else:
        file_size_mb = 2.0 # Default fallback for URL-only items

    if is_video:
        processing_time = min(5, file_size_mb / 2)
        print(f"[MOCK] Processing video... Source: {'B64' if image_base64 else 'URL'}")
        time.sleep(processing_time)

    # 4. Generate hash based on whatever source we actually have
    source_str = image_base64 if image_base64 else media_url
    image_hash = hashlib.sha256(source_str[:100].encode()).hexdigest()

    # 5. Result Logic
    is_ai = random.choice([True, False])
    confidence = random.uniform(85.0, 99.9) if random.random() > 0.2 else random.uniform(40.0, 60.0)

    print(f"[MOCK] {'VIDEO' if is_video else 'IMAGE'} | Hash: {image_hash[:8]} | Result: {is_ai}")

    return jsonify({
        "ok": True,
        "is_ai": is_ai,
        "confidence": round(confidence, 2),
        "is_video_processed": is_video,
        "processing_time": processing_time,
        "cached": False,
        "hash": image_hash,
        "quota": quota_manager.get_status()
    })

if __name__ == "__main__":
    print("Starting AI Feed Detector Backend...")
    print(f"Gemini API Key Set: {bool(GEMINI_API_KEY)}")
    print(f"AI or Not API Key Set: {bool(AI_OR_NOT_API_KEY)}")
    print(f"Gemini Model: {GEMINI_MODEL}")
    app.run(host="0.0.0.0", port=3500, debug=True)