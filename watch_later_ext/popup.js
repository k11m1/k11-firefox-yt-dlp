// Popup script for Watch Later Downloader
document.addEventListener('DOMContentLoaded', function() {
    // Get current tab URL
    browser.tabs.query({active: true, currentWindow: true}).then(function(tabs) {
        const currentTab = tabs[0];
        const url = currentTab?.url;
        
        const urlText = document.getElementById('urlText');
        const urlDisplay = document.getElementById('urlDisplay');
        const buttonGroup = document.getElementById('buttonGroup');
        
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            urlText.textContent = url;
            urlText.className = '';
            buttonGroup.style.display = 'flex';
        } else {
            urlText.textContent = 'No valid URL found (must be http/https)';
            urlText.className = 'no-url';
            buttonGroup.style.display = 'none';
        }
        
        // Load settings for logging/debug
        loadSettings();
    }).catch(function(error) {
        console.error('Failed to get current tab:', error);
        document.getElementById('urlText').textContent = 'Error getting URL';
    });
    
    // Button handlers
    document.getElementById('videoBtn').addEventListener('click', function() {
        startDownload('video');
    });
    
    document.getElementById('audioBtn').addEventListener('click', function() {
        startDownload('audio');
    });
    
    // Settings link handler
    document.getElementById('settingsLink').addEventListener('click', function(e) {
        e.preventDefault();
        browser.runtime.openOptionsPage();
    });
});

async function loadSettings() {
    try {
        const settings = await browser.storage.local.get([
            'videoPath',
            'audioPath', 
            'videoQuality',
            'audioFormat',
            'audioQuality'
        ]);
        
        // Log for debugging
        console.log('Popup loaded settings:', settings);
        
        return {
            videoPath: settings.videoPath || '',
            audioPath: settings.audioPath || '',
            videoQuality: settings.videoQuality || 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]',
            audioFormat: settings.audioFormat || 'opus',
            audioQuality: settings.audioQuality || '0'
        };
    } catch (error) {
        console.error('Failed to load settings in popup:', error);
        return {};
    }
}

async function startDownload(downloadType) {
    const status = document.getElementById('status');
    
    try {
        // Get current tab URL
        const tabs = await browser.tabs.query({active: true, currentWindow: true});
        const currentTab = tabs[0];
        const url = currentTab?.url;
        
        if (!url || !url.startsWith('http')) {
            showStatus('No valid URL found', 'error');
            return;
        }
        
        // Load settings
        const settings = await loadSettings();
        
        // Show loading status
        showStatus(`Starting ${downloadType} download...`, 'loading');
        
        // Connect to native messaging host
        const port = browser.runtime.connectNative("watch_later");
        
        // Set up message handlers
        port.onMessage.addListener(function(response) {
            console.log('Native host response:', response);
            
            if (response.status === 'already_downloaded') {
                showStatus(`${downloadType} already downloaded: ${response.filename}`, 'success');
            } else if (response.status === 'ok') {
                showStatus(`${downloadType} download finished: ${response.filename}`, 'success');
            } else if (response.status === 'error') {
                showStatus(`${downloadType} download failed: ${response.reason}`, 'error');
            }
            
            // Close popup after a short delay on success
            if (response.status === 'ok' || response.status === 'already_downloaded') {
                setTimeout(() => {
                    window.close();
                }, 1500);
            }
        });
        
        port.onDisconnect.addListener(function() {
            if (browser.runtime.lastError) {
                console.error('Native host error:', browser.runtime.lastError);
                showStatus('Connection to downloader failed', 'error');
            } else {
                console.log('Native port disconnected');
            }
        });
        
        // Send download message
        port.postMessage({
            url: url,
            type: downloadType,
            settings: settings
        });
        
        // Also send a notification
        try {
            browser.notifications.create({
                "type": "basic",
                "iconUrl": browser.runtime.getURL("icon-48.png"),
                "title": "Watch Later Downloader",
                "message": `Starting ${downloadType} download...`
            });
        } catch (e) {
            // Notifications might fail, that's OK
            console.warn('Notifications unavailable:', e);
        }
        
    } catch (error) {
        console.error('Failed to start download:', error);
        showStatus(`Error: ${error.message}`, 'error');
    }
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = type;
    status.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds (unless popup will close)
    if (type === 'success') {
        setTimeout(() => {
            if (status.style.display !== 'none') {
                status.style.display = 'none';
            }
        }, 3000);
    }
}