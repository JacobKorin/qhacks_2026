// background/detectClient.js

export async function detectAIContent(mediaItem) {
    const API_URL = "http://localhost:3500/mock/detect";

    try {
        const mediaType = mediaItem.type === "video" || mediaItem.isVideo ? "video" : "image";
        
        // Extract media_url but NEVER send blob URLs
        let mediaUrl = mediaItem.url || mediaItem.media_url || null;
        if (mediaUrl && mediaUrl.startsWith("blob:")) {
            console.warn("[AIFD] Blob URL detected in detectClient, removing it:", mediaUrl);
            mediaUrl = null; // Don't send blob URLs to backend
        }
        
        const payload = {
            hash: mediaItem.hash,
            media_type: mediaType,
            media_url: mediaUrl,
            isVideo: mediaType === "video"
        };

        // Handle Video Blob Data (ArrayBuffer converted to B64 in content.js)
        if (mediaItem.videoData) {
            payload.video_data = mediaItem.videoData;
        }

        // Standardize Image Base64 key
        if (mediaItem.base64 && typeof mediaItem.base64 === "string" && mediaItem.base64.length > 0) {
            payload.base64 = mediaItem.base64; 
        }

        // VALIDATION: We need at least one source
        if (!payload.base64 && !payload.media_url && !payload.video_data) {
            throw new Error("No media payload (B64, URL, or VideoData) available");
        }

        console.log(`[AIFD] Forwarding ${mediaType} to Flask. Source: ${payload.video_data ? 'Blob Bytes' : 'Standard'}`);

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
        
        return {
            hash: data.hash || mediaItem.hash,
            isAI: data.is_ai ?? false,
            score: data.confidence ?? 0,
            nsfw: data.nsfw,
            fromMock: true
        };

    } catch (err) {
        console.error("%c[AIFD] PIPELINE ERROR:", "color: red; font-weight: bold;", err.message);
        return { hash: mediaItem.hash, score: 0, isAI: false, error: err.message };
    }
}