// background/detectClient.js

export async function detectAIContent(mediaItem) {
    const API_URL = "http://localhost:3500/mock/detect";

    try {
        const mediaType = mediaItem.type === "video" || mediaItem.isVideo ? "video" : "image";
        
        const payload = {
            hash: mediaItem.hash,
            media_type: mediaType,
            media_url: mediaItem.url || mediaItem.media_url || null,
            isVideo: mediaType === "video" // Explicit flag for your backend logic
        };

        // Standardize Base64 key to match Flask data.get("base64")
        if (mediaItem.base64 && typeof mediaItem.base64 === "string" && mediaItem.base64.length > 0) {
            // We send the whole string; the backend already handles splitting at the comma
            payload.base64 = mediaItem.base64; 
        }

        if (!payload.base64 && !payload.media_url) {
            throw new Error("No image/video payload available");
        }

        console.log(`[AIFD] Forwarding ${mediaType} to Flask for hash: ${mediaItem.hash}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); 
        
        const response = await fetch(API_URL, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Flask rejected request (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        
        // Ensure the return object matches what background.js:normalizeDetectionResult expects
        return {
            hash: data.hash || mediaItem.hash,
            isAI: data.is_ai ?? false,
            score: data.confidence ?? 0, // background.js uses result.score
            fromMock: true
        };

    } catch (err) {
        console.error("%c[AIFD] PIPELINE ERROR:", "color: red; font-weight: bold;", err.message);
        
        return { 
            hash: mediaItem.hash, 
            score: 0, 
            isAI: false, 
            error: err.message 
        };
    }
}