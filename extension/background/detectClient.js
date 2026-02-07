// background/detectClient.js

export async function detectAIContent(mediaItem) {
    const API_URL = "http://localhost:3500/mock/detect"; 

    try {
        // If content.js didn't provide base64, we can't proceed (avoids the 403)
        if (!mediaItem.base64) {
            throw new Error("No image data provided by content script");
        }

        console.log(`[AIFD] Forwarding data to Flask for hash: ${mediaItem.hash}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds
        
        const response = await fetch(API_URL, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                image: mediaItem.base64,
                isVideo: mediaItem.isVideo || false,
                hash: mediaItem.hash 
            })
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
            fromMock: true
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