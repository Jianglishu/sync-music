import React, { useState, useEffect, useRef, useCallback } from 'react';
import AudioPlayer from '../audio/AudioPlayer';
import SyncEngine from '../audio/SyncEngine';

export default function ClientRoom({ roomInfo, wsMessages, connectionStatus, sendWsMessage, webClient = false, onLeave }) {
  const [playlist, setPlaylist] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncOffset, setSyncOffset] = useState(0);
  const [syncRtt, setSyncRtt] = useState(0);
  const [position, setPosition] = useState(0);
  const [ready, setReady] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(!webClient);

  const audioPlayerRef = useRef(null);
  const syncEngineRef = useRef(null);
  const progressInterval = useRef(null);
  const pendingPlaybackRef = useRef(null);

  // Initialize audio player
  useEffect(() => {
    const init = async () => {
      const player = new AudioPlayer();
      await player.init();
      audioPlayerRef.current = player;
      if (player.getAudioContext()?.state === 'running') {
        setAudioUnlocked(true);
      }
      setReady(true);
    };
    init();

    return () => {
      if (audioPlayerRef.current) audioPlayerRef.current.destroy();
      if (syncEngineRef.current) syncEngineRef.current.stop();
    };
  }, []);

  // Initialize sync engine
  useEffect(() => {
    if (!ready) return;

    const initSync = async () => {
      const engine = new SyncEngine();
      syncEngineRef.current = engine;

      engine.onSyncResult = (result) => {
        setSyncOffset(result.offset);
        setSyncRtt(result.rtt);
      };

      engine.start(
        (msg) => {
          sendWsMessage?.(msg);
        },
        3000
      );
    };

    initSync();
  }, [ready, sendWsMessage]);

  const handlePlaybackSync = useCallback(async (msg) => {
    const player = audioPlayerRef.current;
    const engine = syncEngineRef.current;
    if (!player || !engine) return;

    const fallbackSong = Number.isInteger(msg.currentIndex) ? playlist[msg.currentIndex] : null;
    const { isPlaying: shouldPlay, startTime, startPosition = 0 } = msg;
    const song = msg.currentSong || fallbackSong;

    if (song) setCurrentSong(song);

    if (webClient && !audioUnlocked && shouldPlay) {
      pendingPlaybackRef.current = { ...msg, currentSong: song };
      setIsPlaying(true);
      return;
    }

    if (shouldPlay) {
      const nowServer = engine.getServerTime();
      let delay = (startTime - nowServer) / 1000;

      // If we missed the start, play immediately from current position
      if (delay < -0.15) {
        const elapsed = (nowServer - startTime) / 1000;
        const seekPos = startPosition + elapsed;
        const songDuration = song?.duration || 300;
        if (seekPos < songDuration) {
          await loadAndPlay(player, song, seekPos);
        }
      } else {
        // Schedule precise playback
        delay = Math.max(0, delay);

        // Load audio first
        if (song && song.audioUrl) {
          await player.loadAudio(song.audioUrl);
          const ctx = player.getAudioContext();
          player.schedulePlay(ctx.currentTime + delay, startPosition, 1.0);
        }
      }

      setIsPlaying(true);
    } else {
      player.pause();
      setIsPlaying(false);
    }
  }, [audioUnlocked, playlist, webClient]);

  const handleClockSync = useCallback((msg) => {
    const player = audioPlayerRef.current;
    const engine = syncEngineRef.current;
    if (!player || !engine) return;

    if (!msg.isPlaying) {
      player.pause();
      setIsPlaying(false);
      return;
    }

    const song = msg.currentSong || (Number.isInteger(msg.currentIndex) ? playlist[msg.currentIndex] : null);
    if (!currentSong || (song && song.id !== currentSong.id) || !player.isPlaying) {
      handlePlaybackSync(msg);
      return;
    }

    const expectedPosition = msg.startPosition + (engine.getServerTime() - msg.startTime) / 1000;
    const currentPosition = player.getCurrentPosition();
    const drift = currentPosition - expectedPosition;

    if (Math.abs(drift) > 0.25) {
      player.seek(Math.max(0, expectedPosition));
    } else {
      player.correctDrift(drift);
    }
  }, [currentSong, handlePlaybackSync, playlist]);

  // Process WebSocket messages
  useEffect(() => {
    if (wsMessages.length === 0) return;

    const msg = wsMessages[wsMessages.length - 1];

    switch (msg.type) {
      case 'sync':
        // Forward sync response to sync engine
        if (syncEngineRef.current) {
          syncEngineRef.current.onSyncResponse(msg);
        }
        break;

      case 'playlist-update':
        setPlaylist(msg.playlist || []);
        break;

      case 'playback-state':
        handlePlaybackSync(msg.state || {});
        break;
      case 'time-sync':
        handleClockSync(msg);
        break;
    }
  }, [wsMessages, handleClockSync, handlePlaybackSync]);

  const loadAndPlay = async (player, song, position) => {
    if (!song?.audioUrl) return;
    try {
      await player.loadAudio(song.audioUrl);
      player.play(position);
    } catch (e) {
      console.error('Load/play error:', e);
    }
  };

  const enableAudio = async () => {
    const player = audioPlayerRef.current;
    const ctx = player?.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
    setAudioUnlocked(true);
  };

  useEffect(() => {
    if (!audioUnlocked || !pendingPlaybackRef.current) return;
    const pending = pendingPlaybackRef.current;
    pendingPlaybackRef.current = null;
    handlePlaybackSync(pending);
  }, [audioUnlocked, handlePlaybackSync]);

  // Position update interval
  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        const pos = audioPlayerRef.current?.getCurrentPosition() || 0;
        setPosition(pos);
      }, 500);
      return () => clearInterval(progressInterval.current);
    }
  }, [isPlaying]);

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="room">
      <div className="title-bar">
        已加入房间
        <button className="btn btn-ghost" style={{ position: 'absolute', right: 8, fontSize: 12, color: '#e74c3c' }} onClick={onLeave}>
          离开
        </button>
      </div>

      <div className="room-status" style={{ padding: '4px 16px 12px' }}>
        <span className={`status-dot ${connectionStatus}`} />
        <span>
          {connectionStatus === 'connected' ? '已连接' :
           connectionStatus === 'connecting' ? '连接中...' : '未连接'}
        </span>
        {syncRtt > 0 && (
          <span style={{ marginLeft: 12, color: '#555', fontSize: 11 }}>
            同步偏差: {syncOffset.toFixed(0)}ms | RTT: {syncRtt}ms
          </span>
        )}
      </div>

      {webClient && !audioUnlocked && (
        <div className="web-audio-unlock">
          <button className="btn btn-primary" onClick={enableAudio}>
            启用声音
          </button>
          <span>iPad 需要先点一次，之后会跟随房主同步播放</span>
        </div>
      )}

      {connectionStatus === 'connected' ? (
        <>
          {/* Playlist */}
          <div className="section-label">播放队列</div>
          <div className="playlist">
            {playlist.length === 0 ? (
              <div className="playlist-empty">
                <span>等待主播添加歌曲...</span>
              </div>
            ) : (
              playlist.map((song, i) => (
                <div key={song.id || i} className={`playlist-item ${currentSong?.id === song.id ? 'active' : ''}`}>
                  <img src={song.albumPic || ''} alt="" />
                  <div className="info">
                    <div className="name">{song.name}</div>
                    <div className="artist">{song.artists}</div>
                  </div>
                  <div className="duration">{formatTime(song.duration)}</div>
                </div>
              ))
            )}
          </div>

          {/* Now Playing */}
          <div className="player-controls">
            <div className="now-playing">
              {currentSong ? (
                <>
                  <img src={currentSong.albumPic || ''} alt="" />
                  <div className="info">
                    <div className="name">{currentSong.name}</div>
                    <div className="artist">{currentSong.artists}</div>
                  </div>
                </>
              ) : (
                <div className="info" style={{ color: '#555' }}>
                  <div className="name">等待播放...</div>
                </div>
              )}
            </div>

            <div className="progress-bar">
              <div className="progress-fill" style={{
                width: currentSong ? `${(position / (currentSong.duration || 1)) * 100}%` : '0%'
              }} />
            </div>

            <div className="controls-row">
              <div style={{ fontSize: 12, color: '#666' }}>
                同步精度: {Math.abs(syncOffset) < 50 ? '优' : Math.abs(syncOffset) < 150 ? '良' : '需校准'}
              </div>
            </div>

            {currentSong && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#555', marginTop: 8 }}>
                {formatTime(position)} / {formatTime(currentSong.duration)}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="client-room">
          <div className="status-icon">🔗</div>
          <div className="status-text">
            {connectionStatus === 'connecting' ? '连接中...' : '正在连接房间...'}
          </div>
          <div className="status-detail">
            {roomInfo?.address || ''}
          </div>
        </div>
      )}
    </div>
  );
}
