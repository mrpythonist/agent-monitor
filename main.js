// Linux sandbox fix
if (process.platform === 'linux') {
  process.env.ELECTRON_DISABLE_SANDBOX = '1';
  const { app } = require('electron');
  app.commandLine.appendSwitch('--no-sandbox');
  app.commandLine.appendSwitch('--disable-setuid-sandbox');
}

const { app, BrowserWindow, ipcMain, desktopCapturer, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const si = require('systeminformation');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let ws = null;
let agentId = `agent-${Math.random().toString(36).substr(2, 9)}`;
let serverUrl = 'ws://localhost:8090';
let isRunning = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('src/index.html');
  
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  try {
    let trayIcon;
    
    // Try to load icon from file
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      console.log('✅ Loaded tray icon from file');
    } else {
      // Create fallback icon programmatically
      console.log('⚠️ Creating fallback tray icon');
      const size = 16;
      trayIcon = nativeImage.createEmpty();
      const canvas = Buffer.alloc(size * size * 4);
      
      // Fill with blue color
      for (let i = 0; i < canvas.length; i += 4) {
        canvas[i] = 52;     // R
        canvas[i + 1] = 152; // G
        canvas[i + 2] = 219; // B
        canvas[i + 3] = 255; // A
      }
      
      trayIcon.addRepresentation({
        width: size,
        height: size,
        scaleFactor: 1,
        buffer: canvas
      });
    }
    
    tray = new Tray(trayIcon);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Dashboard',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: isRunning ? 'Stop Service' : 'Start Service',
        click: () => {
          if (isRunning) {
            stopService();
          } else {
            startService();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Agent Desktop Service');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
    console.log('✅ Tray created successfully');
  } catch (error) {
    console.error('❌ Error creating tray:', error.message);
    // Continue without tray - app will still work
  }
}

function startService() {
  if (isRunning) return;
  
  isRunning = true;
  connectWebSocket();
  updateTrayMenu();
  
  if (mainWindow) {
    mainWindow.webContents.send('service-status', { running: true });
  }
  
  console.log('🚀 Agent service started');
}

function stopService() {
  if (!isRunning) return;
  
  isRunning = false;
  if (ws) {
    ws.close();
    ws = null;
  }
  updateTrayMenu();
  
  if (mainWindow) {
    mainWindow.webContents.send('service-status', { running: false });
  }
  
  console.log('🛑 Agent service stopped');
}

function updateTrayMenu() {
  if (!tray) return;
  
  try {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Dashboard',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: isRunning ? 'Stop Service' : 'Start Service',
        click: () => {
          if (isRunning) {
            stopService();
          } else {
            startService();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    const status = isRunning ? 'Running' : 'Stopped';
    tray.setToolTip(`Agent Desktop Service - ${status}`);
  } catch (error) {
    console.error('Error updating tray menu:', error);
  }
}

function connectWebSocket() {
  if (ws) ws.close();
  
  console.log(`🔗 Connecting to server: ${serverUrl}`);
  
  ws = new WebSocket(serverUrl);
  
  ws.on('open', () => {
    console.log('✅ Connected to central server');
    ws.send(JSON.stringify({ 
      type: 'register_agent', 
      agentId: agentId,
      computerName: require('os').hostname(),
      status: 'online'
    }));
    
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', true);
    }
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (mainWindow) {
        mainWindow.webContents.send('server-message', message);
      }
      handleServerMessage(message);
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Disconnected from server');
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', false);
    }
    
    if (isRunning) {
      setTimeout(connectWebSocket, 5000);
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
    if (mainWindow) {
      mainWindow.webContents.send('connection-status', false);
    }
  });
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'admin_command':
      handleAdminCommand(message);
      break;
  }
}

function handleAdminCommand(message) {
  const command = message.command;
  console.log(`📨 Executing admin command: ${command}`);
  
  switch (command) {
    case 'request_device_info':
      sendDeviceInfo();
      break;
    case 'get_status':
      sendStatusUpdate();
      break;
    default:
      if (mainWindow) {
        mainWindow.webContents.send('admin-command', message);
      }
      break;
  }
}

async function sendDeviceInfo() {
  try {
    const deviceInfo = await getDeviceInfo();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'agent_data',
        agentId: agentId,
        dataType: 'device_info',
        data: deviceInfo,
        timestamp: new Date().toISOString()
      }));
    }
  } catch (error) {
    console.error('❌ Error sending device info:', error);
  }
}

function sendStatusUpdate() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'agent_data',
      agentId: agentId,
      dataType: 'status_update',
      data: {
        status: 'online',
        serviceRunning: isRunning,
        timestamp: new Date().toISOString()
      }
    }));
  }
}

async function getDeviceInfo() {
  try {
    const [cpu, mem, os, graphics, disks, network] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.graphics(),
      si.diskLayout(),
      si.networkInterfaces()
    ]);
    
    return {
      agentId: agentId,
      computerName: require('os').hostname(),
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        speed: cpu.speed
      },
      memory: {
        total: (mem.total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        free: (mem.free / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      },
      os: {
        platform: os.platform,
        distro: os.distro,
        release: os.release,
        arch: os.arch
      },
      graphics: graphics.controllers.map(gpu => ({
        model: gpu.model,
        vram: gpu.vram ? (gpu.vram / 1024).toFixed(2) + ' GB' : 'Unknown'
      })),
      disks: disks.map(disk => ({
        type: disk.type,
        name: disk.name,
        size: (disk.size / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      })),
      network: network.filter(nic => nic.ip4).map(nic => ({
        iface: nic.iface,
        ip4: nic.ip4,
        mac: nic.mac
      }))
    };
  } catch (error) {
    console.error('❌ Error getting device info:', error);
    return { error: error.message };
  }
}

async function checkAndRequestPermissions() {
  try {
    console.log('🔐 Checking permissions...');
    
    // Media permissions handling - simplified for Linux
    if (process.platform === 'linux') {
      console.log('📝 On Linux, please ensure:');
      console.log('   - PulseAudio is running for audio');
      console.log('   - Screen recording may require additional setup');
      console.log('   - App may request permissions when you first use screen/webcam');
      return;
    }
    
    // For macOS and Windows, check if systemPreferences is available
    const { systemPreferences } = require('electron');
    if (systemPreferences && typeof systemPreferences.getMediaAccessStatus === 'function') {
      // Camera permission
      const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
      console.log(`📷 Camera access status: ${cameraStatus}`);
      
      // Microphone permission  
      const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log(`🎤 Microphone access status: ${microphoneStatus}`);
    } else {
      console.log('ℹ️  System preferences API not available on this platform');
    }
    
    console.log('✅ Permission check completed');
  } catch (error) {
    console.log('✅ Permission check completed (with platform limitations)');
  }
}

// App event handlers
app.whenReady().then(async () => {
  console.log('🔧 Application starting...');
  
  try {
    await checkAndRequestPermissions();
  } catch (error) {
    console.log('⚠️  Permission check had issues, continuing...');
  }
  
  try {
    createTray();
  } catch (error) {
    console.error('❌ Failed to create tray, continuing without it:', error.message);
  }
  
  try {
    createMainWindow();
  } catch (error) {
    console.error('❌ Failed to create main window:', error.message);
  }
  
  // Auto-start service
  const autoStart = true;
  if (autoStart) {
    setTimeout(() => {
      try {
        startService();
      } catch (error) {
        console.error('❌ Failed to start service:', error.message);
      }
    }, 2000);
  }
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createMainWindow();
      } catch (error) {
        console.error('❌ Failed to create window on activate:', error.message);
      }
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopService();
});

app.on('window-all-closed', function (event) {
  event.preventDefault();
});

// IPC Handlers
ipcMain.handle('get-sources', async (event, options) => {
  try {
    return await desktopCapturer.getSources(options);
  } catch (error) {
    console.error('❌ Error getting sources:', error);
    return [];
  }
});

ipcMain.handle('get-device-info', async () => {
  try {
    return await getDeviceInfo();
  } catch (error) {
    console.error('❌ Error getting device info:', error);
    return { error: error.message };
  }
});

ipcMain.on('send-to-admin', (event, data) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({
        type: 'agent_data',
        agentId: agentId,
        ...data
      }));
    } catch (error) {
      console.error('❌ Error sending to admin:', error);
    }
  }
});

ipcMain.on('start-service', () => {
  startService();
});

ipcMain.on('stop-service', () => {
  stopService();
});

ipcMain.handle('get-service-status', () => {
  return isRunning;
});

ipcMain.handle('update-server-url', (event, newUrl) => {
  serverUrl = newUrl;
  if (isRunning) {
    stopService();
    startService();
  }
  return true;
});

ipcMain.on('show-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});