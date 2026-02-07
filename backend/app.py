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

APP_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", APP_ROOT / "uploads"))
MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "10485760"))  # 10 MB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
CORS(app)


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


@app.get("/")
def root():
    return jsonify(
        {
            "name": "ai-feed-detector-backend",
            "status": "ok",
            "timestamp": _utc_now_iso(),
        }
    )


@app.get("/health")
def health():
    return jsonify({"ok": True, "timestamp": _utc_now_iso()})


@app.post("/v1/media/image")
@app.post("/media/image")
def receive_image():
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
