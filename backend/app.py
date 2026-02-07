import base64
import io
import binascii
import hashlib
import mimetypes
import os
import uuid
import random
import time
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from moviepy import VideoFileClip

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
        key_preview = f"{AI_OR_NOT_API_KEY[:4]}...{AI_OR_NOT_API_KEY[-4:]}"
        print(f"[DEBUG] Using Key: {key_preview} (Length: {len(AI_OR_NOT_API_KEY)})")
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

def _clean_old_cache_entries():
    """Remove cache entries older than 24 hours"""
    cutoff = datetime.now(timezone.utc).timestamp() - 24 * 3600
    to_delete = []
    
    for key, entry in cache.items():
        entry_time = datetime.fromisoformat(entry["timestamp"]).timestamp()
        if entry_time < cutoff:
            to_delete.append(key)
    
    for key in to_delete:
        del cache[key]

def trim_video(input_path, max_duration=15):
    """Trims video to max_duration seconds to save bandwidth and API time"""
    output_path = input_path.replace(".mp4", "_trimmed.mp4")
    with VideoFileClip(input_path) as video:
        # If video is longer than our limit, cut it
        if video.duration > max_duration:
            new_video = video.subclip(0, max_duration)
            new_video.write_videofile(output_path, codec="libx264", audio=True)
            return output_path
    return input_path

@app.get("/")
def root():
    return jsonify(
        {
            "name": "ai-feed-detector-backend",
            "status": "ok",
            "timestamp": _utc_now_iso(),
            "endpoints": {
                "/detect": "POST - Analyze image for AI generation",
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
        "cache_size": len(cache)
    })

@app.post("/detect")
def detect_image():
    """
    Analyze media for AI generation. 
    Handles:
    1. Video Data (Base64 bytes from Blobs)
    2. Image Data (Base64 from Canvas)
    3. Media URLs (Standard fallbacks/thumbnails)
    """
    try:
        if not AI_OR_NOT_API_KEY:
            return jsonify({"ok": False, "error": "Missing AI_OR_NOT_API_KEY"}), 500

        payload = request.get_json(silent=True) or {}
        
        # 1. Identify Content Type & Source
        # Priority: video_data (Blob) > base64 (Image) > media_url (Fallback/Poster)
        video_data = payload.get("video_data")
        image_base64 = payload.get("base64") or payload.get("image")
        media_url = payload.get("media_url") or payload.get("url")
        is_video_type = payload.get("isVideo") or payload.get("media_type") == "video"

        media_bytes = None
        source_filename = "upload.jpg"

        # A) Handle Video Blob Bytes (The primary "Friend's Computer" fix)
        if video_data:
            media_bytes = base64.b64decode(video_data)
            source_filename = "blob_video.mp4"
            is_video_type = True
        
        # B) Handle Image Base64 (The "Canvas" capture)
        elif image_base64:
            if "," in image_base64:
                image_base64 = image_base64.split(',', 1)[1]
            media_bytes = base64.b64decode(image_base64)
            source_filename = "canvas_capture.jpg"
            is_video_type = False # It's a captured frame/thumbnail

        # C) Handle URL (The "My Computer" or "Poster" fallback)
        elif media_url:
            resp = requests.get(media_url, timeout=20)
            resp.raise_for_status()
            media_bytes = resp.content
            source_filename = Path(media_url).name or "remote_media"

        if not media_bytes:
            return jsonify({"ok": False, "error": "No media content provided"}), 400

        media_hash = hashlib.sha256(media_bytes).hexdigest()

        # 2. Cache Check (Same as Mock)
        if media_hash in cache:
            return jsonify({
                **cache[media_hash]["result"], 
                "cached": True, 
                "hash": media_hash, 
                "quota": quota_manager.get_status()
            })

        # 3. Quota Guard
        if not quota_manager.can_analyze():
            return jsonify({"ok": False, "error": "Quota reached", "quota": quota_manager.get_status()}), 429

        # 4. Video Trimming (First 5 Seconds Only)
        # We only trim if it's actually a video file, not a poster image URL.
        if is_video_type and source_filename.endswith(('.mp4', '.webm', '.mov', 'video_blob.mp4')):
            _ensure_upload_dir()
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=UPLOAD_DIR) as tmp_in:
                tmp_in.write(media_bytes)
                input_path = tmp_in.name
            
            output_path = input_path.replace(".mp4", "_trimmed.mp4")
            
            try:
                with VideoFileClip(input_path) as video:
                    # Clip to 5 seconds to speed up AI detection and save bandwidth
                    duration = min(5, video.duration)
                    trimmed = video.subclip(0, duration)
                    # Using ultrafast to keep server response snappy
                    trimmed.write_videofile(output_path, codec="libx264", audio=False, logger=None, preset="ultrafast")
                
                media_bytes = Path(output_path).read_bytes()
            finally:
                if os.path.exists(input_path): os.remove(input_path)
                if os.path.exists(output_path): os.remove(output_path)

        # 5. Execute AI Detection
        api_response = _call_ai_detection_api(media_bytes, "video" if is_video_type else "image", source_filename)
        is_ai, confidence = _normalize_aiornot_response(api_response)
        quota_manager.use_credit()

        # 6. Response Construction (Matches your Mock structure)
        result = {
            "ok": True,
            "is_ai": is_ai,
            "confidence": confidence,
            "hash": media_hash,
            "media_type": "video" if is_video_type else "image",
            "quota": quota_manager.get_status()
        }

        # Cache with 24h TTL logic
        cache[media_hash] = {"result": result, "timestamp": _utc_now_iso()}
        
        return jsonify(result)

    except Exception as e:
        print(f"[AIFD] Backend Error: {str(e)}")
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

@app.post("/cache/clear")
def clear_cache_endpoint():
    """Clear the cache (for debugging/maintenance)"""
    cache.clear()
    return jsonify({
        "ok": True,
        "message": "Cache cleared",
        "size": len(cache)
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
        return {"error": "Invalid JSON"}, 400

    # 1. Capture all possible keys
    image_base64 = data.get("base64") or data.get("image")
    video_blob_data = data.get("video_data") # New key for raw bytes
    media_url = data.get("media_url") or data.get("url")
    is_video = data.get("isVideo") or data.get("media_type") == "video"

    # 2. VALIDATION: Check for ANY source
    if not image_base64 and not media_url and not video_blob_data:
        return jsonify({"ok": False, "error": "No media data provided"}), 400

    # 3. Processing Logic
    processing_time = 0
    # Prioritize size calculation: Video Bytes > Image B64 > URL
    if video_blob_data:
        file_size_mb = len(video_blob_data) * 3 / 4 / (1024 * 1024)
        source_for_hash = video_blob_data
    elif image_base64:
        file_size_mb = len(image_base64) * 3 / 4 / (1024 * 1024)
        source_for_hash = image_base64
    else:
        file_size_mb = 2.0 
        source_for_hash = media_url

    if is_video:
        # Simulate longer processing for raw video bytes
        processing_time = min(5, file_size_mb / 2)
        print(f"[MOCK] Processing video... Mode: {'RAW BYTES' if video_blob_data else 'URL'}")
        time.sleep(processing_time) 

    # 4. Generate hash
    image_hash = hashlib.sha256(source_for_hash[:100].encode()).hexdigest()

    # 5. Result Logic
    is_ai = random.choice([True, False])
    confidence = random.uniform(85.0, 99.9) if random.random() > 0.2 else random.uniform(40.0, 60.0)

    return jsonify({
        "ok": True,
        "is_ai": is_ai,
        "confidence": round(confidence, 2),
        "is_video_processed": is_video,
        "source_type": "blob" if video_blob_data else "url/b64",
        "hash": image_hash,
        "quota": quota_manager.get_status()
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3500, debug=True)


