import time
import random
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

def get_now():
    return datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')

# --- GENERATORS LIST (from official docs) ---
IMAGE_GENERATORS = ["midjourney", "dall_e", "stable_diffusion", "this_person_does_not_exist", "adobe_firefly", "flux", "four_o"]

@app.route('/v2/image/sync', methods=['POST'])
@app.route('/v2/text/sync', methods=['POST'])
def mock_sync_detection():
    is_ai = random.choice([True, False])
    # Pick one primary generator to "detect" if it is AI
    detected_gen = random.choice(IMAGE_GENERATORS) if is_ai else None
    
    response = {
        "id": str(uuid.uuid4()),
        "created_at": get_now(),
        "report": {
            "ai_generated": {
                "verdict": "ai" if is_ai else "human",
                "ai": {"is_detected": is_ai, "confidence": round(random.uniform(0.9, 0.99), 4) if is_ai else round(random.uniform(0.01, 0.1), 4)},
                "human": {"is_detected": not is_ai, "confidence": round(random.uniform(0.9, 0.99), 4) if not is_ai else round(random.uniform(0.01, 0.1), 4)},
                "generator": {gen: {
                    "is_detected": (gen == detected_gen),
                    "confidence": round(random.uniform(0.8, 0.95), 4) if (gen == detected_gen) else round(random.uniform(0.001, 0.01), 4)
                } for gen in IMAGE_GENERATORS}
            },
            "deepfake": {
                "is_detected": False,
                "confidence": 0.02,
                "rois": []
            },
            "nsfw": {"is_detected": False},
            "quality": {"is_detected": True},
            "meta": {
                "width": 1024, "height": 1024, "format": "PNG",
                "size_bytes": random.randint(500000, 2000000),
                "md5": uuid.uuid4().hex,
                "processing_status": {
                    "ai_generated": "processed", "deepfake": "processed", "nsfw": "processed", "quality": "processed"
                }
            }
        },
        "external_id": request.args.get("external_id", "my-tracking-id")
    }
    return jsonify(response)

@app.route('/v2/video/detect-file', methods=['POST'])
def mock_video_upload():
    return jsonify({"job_id": str(uuid.uuid4()), "status": "queued"})

@app.route('/query', methods=['POST'])
def mock_video_query():
    is_ai = random.choice([True, False])
    conf = round(random.uniform(0.9, 0.99), 4)
    
    response = {
        "id": request.json.get("job_id", str(uuid.uuid4())),
        "report": {
            "ai_video": {"is_detected": is_ai, "confidence": conf},
            "ai_voice": {"is_detected": is_ai, "confidence": conf},
            "ai_music": {"is_detected": random.choice([True, False]), "confidence": 0.5},
            "meta": {
                "duration": 120,
                "total_bytes": 362594,
                "md5": uuid.uuid4().hex,
                "audio": "processed",
                "video": "processed"
            },
            "deepfake_video": {
                "is_detected": random.choice([True, False]),
                "confidence": round(random.uniform(0.8, 0.95), 4),
                "no_faces_found": False
            }
        },
        "external_id": "extension-query",
        "created_at": get_now()
    }
    return jsonify(response)

if __name__ == '__main__':
    app.run(port=5000, debug=True)