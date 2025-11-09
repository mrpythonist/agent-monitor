const { ipcRenderer } = require('electron');

let screenStream = null;
let webcamStream = null;
let isServiceRunning = false;

// DOM Elements
const statusElement = document.getElementById('status');
const serviceStatusElement = document.getElementById('serviceStatus');
const screenVideo = document.getElementById('screenVideo');
const webcamVideo = document.getElementById('webcamVideo');
const deviceInfoElement = document.getElementById('deviceInfo');
const shareScreenBtn = document.getElementById('shareScreen');
const shareWebcamBtn = document.getElementById('shareWebcam');
const stopSharingBtn = document.getElementById('stopSharing');
const sendDeviceInfoBtn = document.getElementById('sendDeviceInfo');
const startServiceBtn = document.getElementById('startService');
const stopServiceBtn = document.getElementById('stopService');
const serverUrlInput = document.getElementById('serverUrl');
const updateServerUrlBtn = document.getElementById('updateServerUrl');
const agentIdElement = document.getElementById('agentId');
const logContent = document.getElementById('logContent');

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    addLog('🔧 Application initialized');
    
    // Get initial service status
    isServiceRunning = await ipcRenderer.invoke('get-service-status');
    updateServiceStatus();
    
    // Load device info
    try {
        const deviceInfo = await ipcRenderer.invoke('get-device-info');
        deviceInfoElement.textContent = JSON.stringify(deviceInfo, null, 2);
        addLog('💻 Device information loaded');
    } catch (error) {
        addLog('❌ Error loading device information');
    }
});

// Service Control
startServiceBtn.addEventListener('click', () => {
    ipcRenderer.send('start-service');
    addLog('🟡 Starting service...');
});

stopServiceBtn.addEventListener('click', () => {
    ipcRenderer.send('stop-service');
    addLog('🟡 Stopping service...');
});

// Update service status display
function updateServiceStatus() {
    const statusText = serviceStatusElement.querySelector('div:last-child');
    if (isServiceRunning) {
        serviceStatusElement.className = 'status-card running';
        statusText.textContent = 'Running';
        startServiceBtn.disabled = true;
        stopServiceBtn.disabled = false;
        shareScreenBtn.disabled = false;
        shareWebcamBtn.disabled = false;
        sendDeviceInfoBtn.disabled = false;
    } else {
        serviceStatusElement.className = 'status-card stopped';
        statusText.textContent = 'Stopped';
        startServiceBtn.disabled = false;
        stopServiceBtn.disabled = true;
        shareScreenBtn.disabled = true;
        shareWebcamBtn.disabled = true;
        sendDeviceInfoBtn.disabled = true;
    }
}

// Handle service status updates
ipcRenderer.on('service-status', (event, data) => {
    isServiceRunning = data.running;
    updateServiceStatus();
    addLog(isServiceRunning ? '✅ Service started' : '🛑 Service stopped');
});

// Update connection status
function updateConnectionStatus(connected) {
    const statusText = statusElement.querySelector('div:last-child');
    if (connected) {
        statusElement.className = 'status-card connected';
        statusText.textContent = 'Connected';
    } else {
        statusElement.className = 'status-card disconnected';
        statusText.textContent = 'Disconnected';
    }
}

// Update server URL
updateServerUrlBtn.addEventListener('click', async () => {
    const newUrl = serverUrlInput.value;
    if (newUrl) {
        await ipcRenderer.invoke('update-server-url', newUrl);
        addLog(`🔧 Server URL updated to: ${newUrl}`);
    }
});

// Handle server messages
ipcRenderer.on('server-message', (event, message) => {
    switch (message.type) {
        case 'registration_success':
            agentIdElement.textContent = message.agentId || 'Connected';
            addLog('✅ Successfully registered with server');
            break;
        case 'error':
            addLog(`❌ Server error: ${message.message}`);
            break;
    }
});

// Handle admin commands
ipcRenderer.on('admin-command', (event, message) => {
    const command = message.command;
    addLog(`📨 Admin command received: ${command}`);
    
    switch (command) {
        case 'request_device_info':
            sendDeviceInfoBtn.click();
            break;
        case 'request_screen_share':
            shareScreenBtn.click();
            break;
        case 'request_webcam_share':
            shareWebcamBtn.click();
            break;
        case 'stop_sharing':
            stopSharingBtn.click();
            break;
    }
});

// Screen sharing
shareScreenBtn.addEventListener('click', async () => {
    if (!isServiceRunning) {
        alert('Please start the service first');
        return;
    }
    
    try {
        addLog('🖥️ Starting screen sharing...');
        const sources = await ipcRenderer.invoke('get-sources', {
            types: ['screen']
        });
        
        if (sources.length === 0) {
            alert('No screen sources available');
            addLog('❌ No screen sources available');
            return;
        }
        
        // Stop existing stream
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Get screen stream
        screenStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sources[0].id,
                    maxWidth: 1920,
                    maxHeight: 1080,
                    maxFrameRate: 30
                }
            }
        });
        
        screenVideo.srcObject = screenStream;
        
        // Send to admin
        ipcRenderer.send('send-to-admin', {
            type: 'screen_share_started',
            timestamp: new Date().toISOString()
        });
        
        addLog('✅ Screen sharing started');
        
    } catch (error) {
        console.error('Error sharing screen:', error);
        addLog(`❌ Screen sharing failed: ${error.message}`);
        alert('Error sharing screen: ' + error.message);
    }
});

// Webcam sharing
shareWebcamBtn.addEventListener('click', async () => {
    if (!isServiceRunning) {
        alert('Please start the service first');
        return;
    }
    
    try {
        addLog('📷 Starting webcam sharing...');
        
        // Stop existing stream
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
        }
        
        // Get webcam stream
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: 1280, 
                height: 720,
                frameRate: 30 
            },
            audio: true
        });
        
        webcamVideo.srcObject = webcamStream;
        
        // Send to admin
        ipcRenderer.send('send-to-admin', {
            type: 'webcam_share_started',
            timestamp: new Date().toISOString()
        });
        
        addLog('✅ Webcam sharing started');
        
    } catch (error) {
        console.error('Error sharing webcam:', error);
        addLog(`❌ Webcam sharing failed: ${error.message}`);
        alert('Error sharing webcam: ' + error.message);
    }
});

// Stop sharing
stopSharingBtn.addEventListener('click', () => {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        screenVideo.srcObject = null;
        addLog('🖥️ Screen sharing stopped');
    }
    
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
        webcamVideo.srcObject = null;
        addLog('📷 Webcam sharing stopped');
    }
    
    ipcRenderer.send('send-to-admin', {
        type: 'sharing_stopped',
        timestamp: new Date().toISOString()
    });
});

// Send device info
sendDeviceInfoBtn.addEventListener('click', async () => {
    if (!isServiceRunning) {
        alert('Please start the service first');
        return;
    }
    
    try {
        addLog('💻 Sending device information...');
        const deviceInfo = await ipcRenderer.invoke('get-device-info');
        deviceInfoElement.textContent = JSON.stringify(deviceInfo, null, 2);
        
        ipcRenderer.send('send-to-admin', {
            type: 'device_info',
            data: deviceInfo,
            timestamp: new Date().toISOString()
        });
        
        addLog('✅ Device information sent to admin');
        
    } catch (error) {
        console.error('Error getting device info:', error);
        addLog(`❌ Error sending device info: ${error.message}`);
    }
});

// Handle connection status
ipcRenderer.on('connection-status', (event, connected) => {
    updateConnectionStatus(connected);
    if (connected) {
        addLog('✅ Connected to server');
    } else {
        addLog('🔌 Disconnected from server');
    }
});

// Add log function
function addLog(message) {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
    
    // Keep only last 50 log entries
    while (logContent.children.length > 50) {
        logContent.removeChild(logContent.firstChild);
    }
}