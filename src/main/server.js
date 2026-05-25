const { ipcMain, BrowserWindow, dialog } = require('electron');
const path = require('path');
const http = require('http');
const HostServer = require('../network/HostServer');
const ClientSocket = require('../network/ClientSocket');
const NeteaseAPI = require('../../scripts/netease-api');
const AudioExtractor = require('../../scripts/audio-extract');

let currentServer = null;
let currentClient = null;
let activeRole = null; // 'host' or 'client'
let mainWindow = null;
const netease = new NeteaseAPI();
const extractor = new AudioExtractor();

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function registerHandlers(window) {
  mainWindow = window;

  // ======== yt-dlp 安装（按需触发） ========
  ipcMain.handle('tools:ensureYtDlp', async () => {
    const result = await extractor.ensureInstalled((status, msg) => {
      sendToRenderer('tools:ytdlp-status', { status, message: msg });
    });
    return { status: result ? 'done' : 'error', message: result ? 'yt-dlp 已就绪' : '安装失败' };
  });

  // ======== Room Management ========
  ipcMain.handle('room:create', async () => {
    if (activeRole) return { error: 'Already in a room' };

    try {
      const server = new HostServer();
      await server.start(0); // random port

      server.onEvent = (event, data) => {
        sendToRenderer('room:event', { event, data });
      };

      currentServer = server;
      activeRole = 'host';

      // Return immediately with local info — background tasks can update later
      const roomInfo = {
        port: server.port,
        publicIp: '127.0.0.1',
        localAddress: `127.0.0.1:${server.port}`,
        roomCode: `127.0.0.1:${server.port}`,
      };

      // ====== Background: Get public IP ======
      (async () => {
        try {
          const ip = await Promise.race([
            new Promise((resolve) => {
              const req = http.get('http://api.ipify.org', (res) => {
                let d = '';
                res.on('data', (c) => d += c);
                res.on('end', () => resolve(d.trim() || null));
              });
              req.setTimeout(5000, () => { req.destroy(); resolve(null); });
              req.on('error', () => resolve(null));
            }),
            new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (ip) {
            roomInfo.publicIp = ip;
            roomInfo.roomCode = `${ip}:${server.port}`;
            sendToRenderer('server:status', { status: 'public-ip', publicIp: ip });
          }
        } catch {}
      })();

      // ====== Background: Try UPnP ======
      (async () => {
        try {
          const natUpnp = require('nat-upnp');
          const client = natUpnp.createClient();
          await Promise.race([
            new Promise((resolve) => {
              client.portMapping({
                public: server.port,
                private: server.port,
                ttl: 3600,
                description: 'SyncMusic',
              }, (err) => {
                resolve(null);
              });
            }),
            new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
        } catch {}
      })();

      return { success: true, ...roomInfo };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('room:join', async (_, address) => {
    if (activeRole) return { error: 'Already in a room' };

    try {
      const client = new ClientSocket();
      client.onMessage = (msg) => {
        sendToRenderer('ws:message', msg);
      };
      client.onStatusChange = (status) => {
        sendToRenderer('server:status', { status });
      };

      await client.connect(address);
      currentClient = client;
      activeRole = 'client';

      return { success: true, address };
    } catch (err) {
      return { error: `Connection failed: ${err.message}` };
    }
  });

  ipcMain.handle('room:leave', async () => {
    if (currentServer) {
      currentServer.stop();
      currentServer = null;
    }
    if (currentClient) {
      currentClient.disconnect();
      currentClient = null;
    }
    activeRole = null;
    return { success: true };
  });

  // ======== WebSocket Send (Client) ========
  ipcMain.handle('ws:send', async (_, msg) => {
    if (currentClient) {
      currentClient.send(msg);
      return { success: true };
    }
    return { error: 'Not connected' };
  });

  // ======== Host Info ========
  ipcMain.handle('host:info', async () => {
    if (currentServer) {
      return {
        clientCount: currentServer.getClientCount(),
        playlist: currentServer.roomState.playlist,
        playbackState: {
          isPlaying: currentServer.roomState.isPlaying,
          currentIndex: currentServer.roomState.currentIndex,
          currentSong: currentServer.roomState.currentSong,
          position: currentServer.roomState.position,
        },
      };
    }
    return { error: 'Not hosting' };
  });

  // ======== Music Search & Info ========
  ipcMain.handle('music:search', async (_, query) => {
    try {
      const results = await netease.search(query);
      return { success: true, results };
    } catch (err) {
      return { error: err.message, results: [] };
    }
  });

  ipcMain.handle('music:getUrl', async (_, songId) => {
    try {
      const result = await netease.getSongUrl(songId);
      if (result && result.url) {
        return { success: true, url: result.url };
      }
      // Fallback: try yt-dlp
      const songUrl = `https://music.163.com/#/song?id=${songId}`;
      const extracted = await extractor.extractAudioUrl(songUrl).catch(() => null);
      if (extracted) {
        return { success: true, url: extracted.url };
      }
      return { error: 'Could not obtain audio URL' };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('music:resolveLink', async (_, link) => {
    try {
      const parsed = netease.parseSongLink(link);
      if (!parsed) return { error: 'Unrecognized link format' };

      const detail = await netease.getSongDetail(parsed.id);
      if (!detail) return { error: 'Song not found' };

      const urlInfo = await netease.getSongUrl(parsed.id);
      return {
        success: true,
        song: { ...detail, audioUrl: urlInfo?.url || null },
      };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ======== Playback Control (Host) ========
  ipcMain.handle('playback:play', async (_, { songIndex, audioUrl } = {}) => {
    if (!currentServer) return { error: 'Not hosting' };

    const playlist = currentServer.roomState.playlist;
    const idx = songIndex !== undefined ? songIndex : currentServer.roomState.currentIndex;
    if (idx < 0 || idx >= playlist.length) return { error: 'No song selected' };

    const song = { ...playlist[idx], audioUrl };
    currentServer.setPlaybackState({
      currentIndex: idx,
      currentSong: song,
      isPlaying: true,
      startTime: Date.now(),
      startPosition: 0,
      position: 0,
    });

    return { success: true, song };
  });

  ipcMain.handle('playback:pause', async () => {
    if (!currentServer) return { error: 'Not hosting' };

    const currentPos = currentServer.roomState.startPosition +
      (Date.now() - currentServer.roomState.startTime) / 1000;

    currentServer.setPlaybackState({
      isPlaying: false,
      position: currentPos,
    });

    return { success: true };
  });

  ipcMain.handle('playback:resume', async () => {
    if (!currentServer) return { error: 'Not hosting' };

    currentServer.setPlaybackState({
      isPlaying: true,
      startTime: Date.now(),
      startPosition: currentServer.roomState.position,
    });

    return { success: true };
  });

  ipcMain.handle('playback:seek', async (_, seconds) => {
    if (!currentServer) return { error: 'Not hosting' };

    currentServer.setPlaybackState({
      startTime: Date.now(),
      startPosition: seconds,
      position: seconds,
    });

    return { success: true };
  });

  // ======== Local File Selection ========
  ipcMain.handle('file:select', async () => {
    if (!currentServer) return { error: 'Not hosting' };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, songs: [] };
    }

    const songs = [];
    for (const filePath of result.filePaths) {
      try {
        const song = currentServer.serveLocalFile(filePath);
        songs.push(song);
      } catch (err) {
        console.error('Failed to serve file:', filePath, err.message);
      }
    }

    return { success: true, songs };
  });

  // ======== Playlist Management ========
  ipcMain.handle('playlist:add', async (_, song) => {
    if (!currentServer) return { error: 'Not hosting' };
    currentServer.addToPlaylist(song);
    return { success: true, playlist: currentServer.roomState.playlist };
  });

  ipcMain.handle('playlist:addBatch', async (_, songs) => {
    if (!currentServer) return { error: 'Not hosting' };
    for (const song of songs) {
      currentServer.addToPlaylist(song);
    }
    return { success: true, playlist: currentServer.roomState.playlist };
  });

  ipcMain.handle('playlist:remove', async (_, index) => {
    if (!currentServer) return { error: 'Not hosting' };
    currentServer.removeFromPlaylist(index);
    return { success: true };
  });

  ipcMain.handle('playlist:update', async (_, index, song) => {
    if (!currentServer) return { error: 'Not hosting' };
    currentServer.updatePlaylistItem(index, song);
    return { success: true, playlist: currentServer.roomState.playlist };
  });

  ipcMain.handle('playlist:reorder', async (_, fromIndex, toIndex) => {
    if (!currentServer) return { error: 'Not hosting' };
    const pl = currentServer.roomState.playlist;
    if (fromIndex >= 0 && fromIndex < pl.length && toIndex >= 0 && toIndex < pl.length) {
      const [item] = pl.splice(fromIndex, 1);
      pl.splice(toIndex, 0, item);
      currentServer.broadcast({ type: 'playlist-update', playlist: pl });
    }
    return { success: true };
  });
}

module.exports = { registerHandlers };
