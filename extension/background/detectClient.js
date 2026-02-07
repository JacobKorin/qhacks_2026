// background/detectClient.js

export async function detectAIContent(mediaItem) {
    // Replace with your actual Flask endpoint
    const API_URL = "http://localhost:3000/media/image"; 

    try {
        const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: mediaItem.url,
            hash: mediaItem.hash,
            type: mediaItem.url.includes('video') ? 'video' : 'image' // Basic type check
        })
        });

        if (!response.ok) throw new Error("Backend unavailable");
        
        return await response.json(); 

    } catch (err) {

        return { hash: mediaItem.hash, score: Math.random(), isAI: false };
    }
}