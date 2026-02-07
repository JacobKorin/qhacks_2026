// background/detectClient.js

export async function detectAIContent(mediaItem) {
    const API_URL = "http://localhost:3500/detect";

    try {
        const mediaType = mediaItem.type === "video" ? "video" : "image";
        const payload = {
            hash: mediaItem.hash,
            media_type: mediaType,
            media_url: mediaItem.url || null
        };

        if (
            typeof mediaItem.base64 === "string" &&
            mediaItem.base64.length > 0 &&
            mediaItem.base64.includes(",")
        ) {
            const encoded = mediaItem.base64.split(",", 2)[1] || "";
            if (encoded.length > 0) {
            payload.image = mediaItem.base64;
            }
        }

        if (!payload.image && !payload.media_url) {
            throw new Error("No image/video payload available");
        }

        console.log(`[AIFD] Forwarding data to Flask for hash: ${mediaItem.hash}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
        
        const response = await fetch(API_URL, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AIFD] Flask returned error ${response.status}:`, errorText);
            throw new Error(`Flask rejected request: ${response.status}`);
        }

        const data = await response.json();
        console.log("[AIFD] RAW DATA FROM FLASK:", data);

        return {
            hash: mediaItem.hash,
            isAI: data.is_ai ?? false,
            score: data.confidence ?? 0,
            fromMock: false
        };

    } catch (err) {
        console.error("%c[AIFD] PIPELINE ERROR:", "color: red; font-weight: bold;", err.message);
        
        return { 
            hash: mediaItem.hash, 
            score: 0, 
            isAI: false, 
            errorMessage: err.message 
        };
    }
}
