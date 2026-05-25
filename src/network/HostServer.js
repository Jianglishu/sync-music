const { WebSocketServer } = require('ws');
const http = require('http');

class HostServer {
  constructor(port = 0) {
    this.port = port;
    this.wss = null;
    this.clients = new Map(); // ws -> { id, role, joinedAt }
    this.nextClientId = 1;
    this.onEvent = null; // callback(event, data)

    // Room state
    this.roomState = {
      playlist: [],
      currentIndex: -1,
      isPlaying: false,
      position: 0,     // current position in seconds (for seek)
      startTime: 0,    // server timestamp when playback started
      startPosition: 0,// position in song when playback started
      currentSong: null,
    };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
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
          // Forward to host (the server itself is the host)
          this._emit('client-message', { clientId: clientInfo.id, message: msg });
          break;
      }
    } catch (e) {
      // Ignore malformed messages
    }
  }

  _handleSync(ws, msg) {
    // NTP-style sync: return the received clientTime along with serverTime
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
