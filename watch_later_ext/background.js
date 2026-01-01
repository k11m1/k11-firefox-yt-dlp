// Listen for toolbar button click
browser.action.onClicked.addListener(async (tab) => {
    if (!tab.url) return;

    try {
        // Debug: log that the click handler ran
        console.log("background: action clicked", { id: tab.id, url: tab.url });

        // Connect to native messaging host
        const port = browser.runtime.connectNative("watch_later");
        try {
            port.postMessage({ url: tab.url });
        } catch (e) {
            console.error("background: failed to postMessage to native host", e);
        }

        port.onMessage.addListener((response) => {
            console.log("background: Response from native host:", response);
        });

        port.onDisconnect.addListener(() => {
            if (browser.runtime.lastError) {
                console.error("background: native host error:", browser.runtime.lastError);
            } else {
                console.log("background: native port disconnected");
            }
        });

        // Optional: notify user (may require permissions)
        try {
            browser.notifications.create({
                "type": "basic",
                "iconUrl": browser.runtime.getURL("icon-48.png"),
                "title": "Watch Later Downloader",
                "message": "Sent URL to native downloader."
            });
        } catch (e) {
            // Don't block operation if notifications fail
            console.warn("background: notifications unavailable", e);
        }
    } catch (error) {
        console.error("background: Failed to send URL:", error);
    }
});

// Startup log so we can verify the background script loaded
console.log("background.js loaded");

