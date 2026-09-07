// Load settings from storage (for popup or other uses)
async function loadSettings() {
    try {
        const settings = await browser.storage.local.get([
            'videoPath',
            'audioPath', 
            'videoQuality',
            'audioFormat',
            'audioQuality'
        ]);
        
        // Set defaults if not present
        return {
            videoPath: settings.videoPath || '',
            audioPath: settings.audioPath || '',
            videoQuality: settings.videoQuality || 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]',
            audioFormat: settings.audioFormat || 'opus',
            audioQuality: settings.audioQuality || '0'
        };
    } catch (error) {
        console.error('Failed to load settings:', error);
        return {};
    }
}

// Listen for settings updates from options page
browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'settingsUpdated') {
        console.log('Settings updated in background:', message.settings);
        // We could broadcast this to popup if needed
    }
});

// Startup log so we can verify the background script loaded
console.log("background.js loaded");

