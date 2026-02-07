import base64
import binascii
import hashlib
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

APP_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", APP_ROOT / "uploads"))
MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "10485760"))  # 10 MB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
CORS(app)

# Configuration for AI detection
AI_OR_NOT_API_KEY = os.getenv('AI_OR_NOT_API_KEY')
AI_OR_NOT_API_URL = "https://api.aiornot.com/v2/image/sync"  # Verify this URL
QUOTA_LIMIT = int(os.getenv('QUOTA_LIMIT', '625'))

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

def _call_ai_detection_api(image_data_base64: str) -> dict:
    """Call AI or Not API with the image data"""
    headers = {
        "Authorization": f"Bearer {AI_OR_NOT_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "image": image_data_base64,
        "model": "v2"  # Check AI or Not API documentation for correct model
    }
    
    response = requests.post(AI_OR_NOT_API_URL, json=payload, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()

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
    """Analyze image for AI generation using AI or Not API"""
    try:
        # Determine input format
        if "file" in request.files:
            # Handle file upload
            upload = request.files["file"]
            if not upload.filename:
                return jsonify({"ok": False, "error": "Missing filename"}), 400
            
            image_bytes = upload.read()
            if not image_bytes:
                return jsonify({"ok": False, "error": "Empty image file"}), 400
            
            # Convert to base64 for API
            image_b64 = base64.b64encode(image_bytes).decode('utf-8')
            image_hash = _generate_image_hash(image_bytes)
            
        else:
            # Handle JSON payload with base64 image
            payload = request.get_json(silent=True) or {}
            image_base64 = payload.get("image")
            
            if not image_base64:
                return jsonify({"ok": False, "error": "No image data provided"}), 400
            
            # Extract pure base64 data
            if image_base64.startswith('data:image'):
                # Remove data URL prefix
                image_base64 = image_base64.split(',')[1]
            
            try:
                image_bytes = base64.b64decode(image_base64, validate=True)
            except (binascii.Error, ValueError) as exc:
                return jsonify({"ok": False, "error": f"Invalid base64: {exc}"}), 400
            
            image_b64 = image_base64  # Already in base64 format
            image_hash = _generate_image_hash(image_bytes)
        
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
            api_response = _call_ai_detection_api(image_b64)
            
            # Parse API response (adjust based on actual API response format)
            # Expected format: {"ai_probability": 0.85, "is_ai": true}
            ai_probability = api_response.get("ai_probability", 0)
            is_ai = api_response.get("is_ai", ai_probability > 0.5)
            
            result = {
                "is_ai": is_ai,
                "confidence": ai_probability * 100
            }
            
            # Use quota credit
            quota_manager.use_credit()
            
            # Cache result (with 24-hour TTL)
            cache[image_hash] = {
                "result": result,
                "timestamp": _utc_now_iso()
            }
            
            # Clean old cache entries periodically
            if len(cache) % 10 == 0:  # Every 10 requests
                _clean_old_cache_entries()
            
            return jsonify({
                "ok": True,
                "is_ai": is_ai,
                "confidence": ai_probability * 100,
                "cached": False,
                "hash": image_hash,
                "quota": quota_manager.get_status()
            })
            
        except requests.exceptions.RequestException as exc:
            return jsonify({
                "ok": False,
                "error": f"AI detection API error: {exc}"
            }), 503
            
    except Exception as e:
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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3500, debug=True)

