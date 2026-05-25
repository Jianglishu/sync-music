const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']);
const MIME_MAP = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
};

class HostServer {
  constructor(port = 0) {
    this.port = port;
    this.wss = null;
    this.server = null;
    this.clients = new Map();
    this.nextClientId = 1;
    this.onEvent = null;
    this.localFiles = new Map(); // fileId → { path, name, size, mime, duration }

    this.roomState = {
      playlist: [],
      currentIndex: -1,
      isPlaying: false,
      position: 0,
      startTime: 0,
      startPosition: 0,
      currentSong: null,
    };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = req.url || '/';

        // Route: Serve local audio files
        if (url.startsWith('/files/')) {
          return this._serveFile(req, res, url);
        }

        // Default: health check
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SyncMusic Server');
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws, req) => {
        const clientId = this.nextClientId++;
        const clientInfo = { id: clientId, role: 'client', joinedAt: Date.now(), ip: req.socket.remoteAddress };
        this.clients.set(ws, clientInfo);

        ws.on('message', (data) => this._handleMessage(ws, clientInfo, data));
        ws.on('close', () => this._handleDisconnect(ws, clientInfo));
        ws.on('error', () => this._handleDisconnect(ws, clientInfo));

        this._emit('client-joined', { id: clientId, count: this.clients.size });
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  // ====== File Serving ======

  /**
   * Serve a local audio file via HTTP.
   * @param {string} filePath - Absolute path to the audio file
   * @returns {object} songInfo - { id, name, audioUrl, duration, source, artists, filePath }
   */
  serveLocalFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      throw new Error(`无法读取文件: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`不是有效的文件: ${filePath}`);
    }
    const fileHash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 8);
    const fileName = path.basename(filePath);
    const fileId = `${fileHash}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    this.localFiles.set(fileId, {
      path: filePath,
      name: fileName,
      size: stat.size,
      mime: MIME_MAP[ext] || 'application/octet-stream',
      duration: 0, // will be estimated from file size if ffprobe not available
    });

    // Estimate duration (seconds): assume 128kbps (~16KB/s)
    const estimatedDuration = Math.max(1, Math.round(stat.size / 16000));

    return {
      id: `local-${fileId}`,
      name: fileName.replace(/\.[^/.]+$/, ''),
      artists: '本地音乐',
      album: '',
      albumPic: '',
      duration: estimatedDuration,
      source: 'local',
      audioUrl: `http://127.0.0.1:${this.port}/files/${encodeURIComponent(fileId)}`,
      filePath: filePath,
    };
  }

  _serveFile(req, res, url) {
    const fileId = decodeURIComponent(url.split('/files/')[1] || '');

    if (!fileId || !this.localFiles.has(fileId)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const file = this.localFiles.get(fileId);

    // Support range requests (for seeking in audio)
    const stat = fs.statSync(file.path);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': file.mime,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });

      const stream = fs.createReadStream(file.path, { start, end });
      stream.pipe(res);
      stream.on('error', () => {
        res.end();
      });
    } else {
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });

      const stream = fs.createReadStream(file.path);
      stream.pipe(res);
      stream.on('error', () => {
        res.end();
      });
    }
  }

  /**
   * Get the HTTP URL for a local file.
   */
  getFileUrl(fileId) {
    return `http://127.0.0.1:${this.port}/files/${encodeURIComponent(fileId)}`;
  }

  // ====== WebSocket Message Handling ======

  _handleMessage(ws, clientInfo, data) {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'sync':
          this._handleSync(ws, msg);
          break;
        case 'sync-request':
          this._send(ws, { type: 'sync-response', serverTime: Date.now() });
          break;
        default:
          this._emit('client-message', { clientId: clientInfo.id, message: msg });
          break;
      }
    } catch (e) {
      // Ignore malformed messages
    }
  }

  _handleSync(ws, msg) {
    this._send(ws, {
      type: 'sync',
      clientTime: msg.clientTime,
      serverTime: Date.now(),
    });
  }

  _handleDisconnect(ws, clientInfo) {
    this.clients.delete(ws);
    this._emit('client-left', { id: clientInfo.id, count: this.clients.size });
  }

  broadcast(data, excludeWs = null) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === 1) {
        client.send(msg);
      }
    });
  }

  _send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  _emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  getClientCount() {
    return this.clients.size;
  }

  broadcastPlaybackState() {
    this.broadcast({
      type: 'playback-state',
      state: {
        isPlaying: this.roomState.isPlaying,
        currentIndex: this.roomState.currentIndex,
        currentSong: this.roomState.currentSong,
        position: this.roomState.position,
        startTime: this.roomState.startTime,
        startPosition: this.roomState.startPosition,
      },
    });
  }

  setPlaybackState(state) {
    Object.assign(this.roomState, state);
    this.broadcastPlaybackState();
  }

  addToPlaylist(song) {
    this.roomState.playlist.push(song);
    this.broadcast({
      type: 'playlist-update',
      playlist: this.roomState.playlist,
    });
  }

  removeFromPlaylist(index) {
    if (index >= 0 && index < this.roomState.playlist.length) {
      this.roomState.playlist.splice(index, 1);
      this.broadcast({ type: 'playlist-update', playlist: this.roomState.playlist });
    }
  }

  updatePlaylistItem(index, song) {
    if (index >= 0 && index < this.roomState.playlist.length) {
      this.roomState.playlist[index] = song;
      if (this.roomState.currentIndex === index) {
        this.roomState.currentSong = song;
      }
      this.broadcast({ type: 'playlist-update', playlist: this.roomState.playlist });
    }
  }

  broadcastTimeSync(currentServerTime) {
    this.broadcast({
      type: 'time-sync',
      serverTime: currentServerTime,
      startTime: this.roomState.startTime,
      startPosition: this.roomState.startPosition,
      isPlaying: this.roomState.isPlaying,
      currentIndex: this.roomState.currentIndex,
    });
  }

  stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = HostServer;
