const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Room management
  createRoom: () => ipcRenderer.invoke('room:create'),
  joinRoom: (address) => ipcRenderer.invoke('room:join', address),
  leaveRoom: () => ipcRenderer.invoke('room:leave'),

  // Playback control (Host only)
  hostPlay: (songIndex, audioUrl) => ipcRenderer.invoke('playback:play', { songIndex, audioUrl }),
  hostPause: () => ipcRenderer.invoke('playback:pause'),
  hostResume: () => ipcRenderer.invoke('playback:resume'),
  hostSeek: (seconds) => ipcRenderer.invoke('playback:seek', seconds),

  // Music search
  searchMusic: (query) => ipcRenderer.invoke('music:search', query),
  getSongUrl: (songId) => ipcRenderer.invoke('music:getUrl', songId),
  resolveSongLink: (link) => ipcRenderer.invoke('music:resolveLink', link),

  // Local file selection (Host only)
  selectLocalFiles: () => ipcRenderer.invoke('file:select'),

  // Playlist management (Host only)
  addSong: (song) => ipcRenderer.invoke('playlist:add', song),
  addSongs: (songs) => ipcRenderer.invoke('playlist:addBatch', songs),
  removeSong: (index) => ipcRenderer.invoke('playlist:remove', index),
  reorderPlaylist: (fromIndex, toIndex) => ipcRenderer.invoke('playlist:reorder', fromIndex, toIndex),

  // Events from main process
  onWsMessage: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('ws:message', handler);
    return () => ipcRenderer.removeListener('ws:message', handler);
  },
  onServerStatus: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('server:status', handler);
    return () => ipcRenderer.removeListener('server:status', handler);
  },
  onRoomEvent: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('room:event', handler);
    return () => ipcRenderer.removeListener('room:event', handler);
  },
  onPlaybackState: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('playback:state', handler);
    return () => ipcRenderer.removeListener('playback:state', handler);
  },
  onSyncData: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('sync:data', handler);
    return () => ipcRenderer.removeListener('sync:data', handler);
  },
  onError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('app:error', handler);
    return () => ipcRenderer.removeListener('app:error', handler);
  },

  // yt-dlp 状态
  onYtDlpStatus: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('tools:ytdlp-status', handler);
    return () => ipcRenderer.removeListener('tools:ytdlp-status', handler);
  },
  ensureYtDlp: () => ipcRenderer.invoke('tools:ensureYtDlp'),

  // Send WebSocket message (Client only)
  sendWsMessage: (msg) => ipcRenderer.invoke('ws:send', msg),

  // Get host server info
  getHostInfo: () => ipcRenderer.invoke('host:info'),
});
