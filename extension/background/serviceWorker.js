const READY_MESSAGE = "AIFD_CONTENT_READY";

console.log("[AI Feed Detector] Service worker initialized");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== READY_MESSAGE) {
    return false;
  }

  const senderUrl = sender?.url || "unknown";
  console.log(
    "[AI Feed Detector] Received content ready message from:",
    senderUrl
  );

  sendResponse({
    ok: true,
    receivedAt: Date.now(),
  });

  return true;
});
