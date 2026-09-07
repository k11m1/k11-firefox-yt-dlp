// Options page for Watch Later Downloader
document.addEventListener('DOMContentLoaded', function() {
    // Load saved settings
    loadSettings();
    
    // Save button handler
    document.getElementById('save').addEventListener('click', saveSettings);
    
    // Reset button handler
    document.getElementById('reset').addEventListener('click', resetToDefaults);
});

function loadSettings() {
    browser.storage.local.get([
        'videoPath',
        'audioPath', 
        'videoQuality',
        'audioFormat',
        'audioQuality'
    ]).then(function(settings) {
        document.getElementById('videoPath').value = settings.videoPath || '';
        document.getElementById('audioPath').value = settings.audioPath || '';
        document.getElementById('videoQuality').value = settings.videoQuality || 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]';
        document.getElementById('audioFormat').value = settings.audioFormat || 'opus';
        document.getElementById('audioQuality').value = settings.audioQuality || '0';
    }).catch(function(error) {
        showStatus('Error loading settings: ' + error.message, 'error');
    });
}

function saveSettings() {
    const settings = {
        videoPath: document.getElementById('videoPath').value.trim(),
        audioPath: document.getElementById('audioPath').value.trim(),
        videoQuality: document.getElementById('videoQuality').value.trim(),
        audioFormat: document.getElementById('audioFormat').value.trim(),
        audioQuality: document.getElementById('audioQuality').value.trim()
    };
    
    // Validate audio quality
    if (settings.audioQuality && !/^\d+$/.test(settings.audioQuality) && !/^\d+k$/.test(settings.audioQuality)) {
        showStatus('Audio quality must be a number (0-9) or bitrate like "128k"', 'error');
        return;
    }
    
    browser.storage.local.set(settings).then(function() {
        showStatus('Settings saved successfully!', 'success');
        
        // Also update the background script with new settings
        browser.runtime.sendMessage({
            type: 'settingsUpdated',
            settings: settings
        }).catch(function() {
            // Background script might not be listening, that's OK
        });
    }).catch(function(error) {
        showStatus('Error saving settings: ' + error.message, 'error');
    });
}

function resetToDefaults() {
    if (!confirm('Reset all settings to defaults?')) {
        return;
    }
    
    const defaults = {
        videoPath: '',
        audioPath: '',
        videoQuality: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]',
        audioFormat: 'opus',
        audioQuality: '0'
    };
    
    browser.storage.local.set(defaults).then(function() {
        loadSettings();
        showStatus('Settings reset to defaults', 'success');
        
        // Also update the background script
        browser.runtime.sendMessage({
            type: 'settingsUpdated',
            settings: defaults
        }).catch(function() {
            // Background script might not be listening, that's OK
        });
    }).catch(function(error) {
        showStatus('Error resetting settings: ' + error.message, 'error');
    });
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = type;
    status.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(function() {
            status.style.display = 'none';
        }, 3000);
    }
}