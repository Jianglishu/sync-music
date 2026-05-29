import React, { useState, useCallback, useEffect, useRef } from 'react';
import Playlist from '../components/Playlist';
import SearchDialog from '../components/SearchDialog';
import SyncEngine from '../audio/SyncEngine';
import AudioPlayer from '../audio/AudioPlayer';

const SYNC_START_DELAY_MS = 180;

export default function HostRoom({ roomInfo, wsMessages, roomEvents, onLeave }) {
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [deviceCount, setDeviceCount] = useState(0);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [syncInfo, setSyncInfo] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [ytDlpStatus, setYtDlpStatus] = useState(null); // null | 'checking' | 'installing' | 'done' | 'error'
  const [ytDlpMessage, setYtDlpMessage] = useState('');

  const audioPlayerRef = useRef(null);
  const syncEngineRef = useRef(null);
  const progressInterval = useRef(null);

  const roomCode = roomInfo?.roomCode || `${roomInfo?.publicIp || '127.0.0.1'}:${roomInfo?.port}`;

  // ======== Local File Handler ========
  const handleAddLocalFile = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.selectLocalFiles();
      if (result.success && result.songs.length > 0) {
        setPlaylist((prev) => [...prev, ...result.songs]);
        await window.electronAPI.addSongs(result.songs);
      } else if (result.error) {
        console.error('selectLocalFiles error:', result.error);
      }
    } catch (err) {
      console.error('Failed to add local file:', err);
      alert('添加本地文件失败: ' + (err.message || '未知错误'));
    }
  }, []);

  // Initialize audio player & sync engine
  useEffect(() => {
    const initAudio = async () => {
      const player = new AudioPlayer();
      await player.init();
      audioPlayerRef.current = player;

      player.onStateChange = (state) => {
        if (state === 'ended') {
          callbacksRef.current.handleNext();
        }
      };
    };
    initAudio();

    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.destroy();
      }
    };
  }, []);

  // Sync engine for host (also measures local offset, though it should be 0)
  useEffect(() => {
    const engine = new SyncEngine();
    syncEngineRef.current = engine;

    engine.onSyncResult = (result) => {
      setSyncInfo(result);
    };

    // Host sends sync to itself via broadcast
    engine.start(
      (msg) => {
        // For host, simulate a sync response with offset = 0
        engine.onSyncResponse({
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
      },
      5000
    );

    return () => engine.stop();
  }, []);

  // Process room events (device connect/disconnect)
  useEffect(() => {
    const latest = roomEvents[roomEvents.length - 1];
    if (latest) {
      setDeviceCount(latest.data?.count || 0);
    }
  }, [roomEvents]);

  // Periodic position update for host
  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        const pos = audioPlayerRef.current?.getCurrentPosition() || 0;
        setCurrentPosition(pos);
      }, 500);

      return () => {
        clearInterval(progressInterval.current);
      };
    }
  }, [isPlaying]);

  // Listen for WebSocket messages (though host doesn't need to)
  useEffect(() => {
    // Process incoming messages if needed
  }, [wsMessages]);

  // Listen for yt-dlp install progress events (triggered by search/link action)
  useEffect(() => {
    if (!window.electronAPI) return;
    const cleanup = window.electronAPI.onYtDlpStatus(({ status, message }) => {
      setYtDlpStatus(status);
      setYtDlpMessage(message || '');
    });
    return cleanup;
  }, []);

  // ======== Playback Handlers ========
  // Use refs to avoid stale closures in effects
  const callbacksRef = useRef({
    playSong: async () => {},
    handleNext: async () => {},
    handlePrev: async () => {},
    handlePlayPause: async () => {},
  });

  const currentSong = currentIndex >= 0 && currentIndex < playlist.length
    ? playlist[currentIndex]
    : null;
  const webClientUrl = roomInfo?.localAddress ? `http://${roomInfo.localAddress}` : `http://${roomCode}`;

  const playSong = useCallback(async (index) => {
    const song = playlist[index];
    if (!song) return;

    let url = song.audioUrl;
    // For netease songs, fetch the audio URL dynamically
    if (!url && song.source !== 'local' && window.electronAPI) {
      const result = await window.electronAPI.getSongUrl(song.id);
      if (result.success) {
        url = result.url;
        song.audioUrl = url;
      }
    }

    if (!url) {
      alert('无法获取音频链接');
      return;
    }

    setAudioUrl(url);
    setCurrentIndex(index);

    const player = audioPlayerRef.current;
    if (player) {
      try {
        await player.loadAudio(url);
        let songToPlay = song;
        const actualDuration = player.getDuration();
        if (actualDuration > 0 && Math.abs(actualDuration - (song.duration || 0)) > 1) {
          const updatedSong = { ...song, duration: actualDuration };
          songToPlay = updatedSong;
          setPlaylist((prev) => prev.map((item, i) => i === index ? updatedSong : item));
          if (window.electronAPI) {
            await window.electronAPI.updateSong(index, updatedSong);
          }
        }
        const startTime = Date.now() + SYNC_START_DELAY_MS;
        if (window.electronAPI) {
          await window.electronAPI.hostPlay(index, songToPlay.audioUrl || url, { startTime, startPosition: 0 });
        }
        const ctx = player.getAudioContext();
        const delaySeconds = Math.max(0.02, (startTime - Date.now()) / 1000);
        player.schedulePlay(ctx.currentTime + delaySeconds, 0, 1.0);
        setIsPlaying(true);
      } catch (err) {
        alert('播放失败: ' + (err.message || '未知错误'));
      }
    }
  }, [playlist]);

  const handleSeek = useCallback(async (event) => {
    const player = audioPlayerRef.current;
    if (!player || !currentSong?.duration) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const seconds = ratio * currentSong.duration;

    if (isPlaying) {
      const startTime = Date.now() + SYNC_START_DELAY_MS;
      const delaySeconds = Math.max(0.02, (startTime - Date.now()) / 1000);
      player.stop();
      player.schedulePlay(player.getAudioContext().currentTime + delaySeconds, seconds, 1.0);
      if (window.electronAPI) {
        await window.electronAPI.hostSeek(seconds, { startTime });
      }
    } else {
      player.seek(seconds);
      if (window.electronAPI) {
        await window.electronAPI.hostSeek(seconds);
      }
    }
    setCurrentPosition(seconds);
  }, [currentSong, isPlaying]);

  const handlePlayPause = useCallback(async () => {
    if (currentIndex < 0 && playlist.length > 0) {
      await playSong(0);
      return;
    }

    const player = audioPlayerRef.current;
    if (!player) return;

    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      if (window.electronAPI) await window.electronAPI.hostPause();
    } else {
      if (player.getCurrentPosition() > 0) {
        const startTime = Date.now() + SYNC_START_DELAY_MS;
        const startPosition = player.getCurrentPosition();
        const delaySeconds = Math.max(0.02, (startTime - Date.now()) / 1000);
        player.schedulePlay(player.getAudioContext().currentTime + delaySeconds, startPosition, 1.0);
        setIsPlaying(true);
        if (window.electronAPI) await window.electronAPI.hostResume({ startTime });
      } else {
        await playSong(currentIndex);
      }
    }
  }, [isPlaying, currentIndex, playlist, playSong]);

  const handleNext = useCallback(async () => {
    const next = (currentIndex + 1) % playlist.length;
    await playSong(next);
  }, [currentIndex, playlist, playSong]);

  const handlePrev = useCallback(async () => {
    const prev = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
    await playSong(prev);
  }, [currentIndex, playlist, playSong]);

  // Sync refs whenever callbacks change
  useEffect(() => {
    callbacksRef.current = { playSong, handleNext, handlePrev, handlePlayPause };
  }, [playSong, handleNext, handlePrev, handlePlayPause]);

  // ======== Playlist Handlers ========
  const handleAddSong = useCallback(async (song) => {
    setPlaylist((prev) => [...prev, { ...song, audioUrl: null }]);
    if (window.electronAPI) {
      await window.electronAPI.addSong(song);
    }
  }, []);

  const handleRemoveSong = useCallback(async (index) => {
    setPlaylist((prev) => prev.filter((_, i) => i !== index));
    if (window.electronAPI) {
      await window.electronAPI.removeSong(index);
    }
  }, []);

  const handleAddLink = useCallback(async () => {
    if (!linkInput.trim()) return;
    if (window.electronAPI) {
      const result = await window.electronAPI.resolveSongLink(linkInput.trim());
      if (result.success) {
        await handleAddSong(result.song);
        setLinkInput('');
      } else {
        alert('解析链接失败: ' + (result.error || '无法识别'));
      }
    }
  }, [linkInput, handleAddSong]);

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="room">
      <div className="title-bar">
        Host 控制台
        <button className="btn btn-ghost" style={{ position: 'absolute', right: 8, fontSize: 12, color: '#e74c3c' }} onClick={onLeave}>
          离开
        </button>
      </div>

      <div className="room-header">
        <div className="room-code" onClick={() => navigator.clipboard?.writeText(roomCode)} title="点击复制">
          📋 {roomCode}
        </div>
      </div>

      <div className="web-client-tip">
        <span>iPad 浏览器打开</span>
        <button type="button" onClick={() => navigator.clipboard?.writeText(webClientUrl)}>
          {webClientUrl}
        </button>
      </div>

      {/* Device count & yt-dlp status */}
      <div style={{ display: 'flex', gap: 12, padding: '0 16px 8px', fontSize: 12, color: '#888', flexWrap: 'wrap' }}>
        <span>🖥️ 已连接: {deviceCount || 0} 台设备</span>
        {ytDlpStatus === 'installing' && <span style={{ color: '#f0ad4e' }}>⬇️ 安装 yt-dlp...</span>}
        {ytDlpStatus === 'error' && (
          <span title={ytDlpMessage} style={{ color: '#e74c3c', cursor: 'help' }}>
            ⚠️ yt-dlp 未安装（搜索/链接解析可能失败）
          </span>
        )}
        {syncInfo && (
          <span className={syncInfo.rtt < 100 ? 'good' : syncInfo.rtt < 300 ? 'fair' : 'poor'}>
            延迟: ~{syncInfo.rtt}ms
          </span>
        )}
      </div>

      {/* Search & Link Input */}
      <div className="search-section">
        <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13, flexShrink: 0 }} onClick={() => setShowSearch(true)}>
          🔍 搜索
        </button>
        <button className="btn btn-secondary" style={{ padding: '8px 14px', fontSize: 13, flexShrink: 0, background: '#1e3a1e' }} onClick={handleAddLocalFile}>
          📁 本地文件
        </button>
        <input
          className="input"
          style={{ fontSize: 13, padding: '8px 12px' }}
          placeholder="或粘贴网易云歌曲链接..."
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddLink()}
        />
      </div>

      {/* Search Dialog */}
      {showSearch && (
        <SearchDialog
          onClose={() => setShowSearch(false)}
          onSelect={async (song) => {
            await handleAddSong(song);
            setShowSearch(false);
          }}
        />
      )}

      {/* Playlist */}
      <div className="section-label">播放队列</div>
      <Playlist
        items={playlist}
        currentIndex={currentIndex}
        onSelect={(idx) => playSong(idx)}
        onRemove={handleRemoveSong}
      />

      {/* Player Controls */}
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
              <div className="name">选择歌曲开始播放</div>
            </div>
          )}
        </div>

        <div className="progress-bar" onClick={handleSeek} title="点击调整播放进度">
          <div className="progress-fill" style={{ width: `${currentSong ? (currentPosition / (currentSong.duration || 1)) * 100 : 0}%` }} />
        </div>

        <div className="controls-row">
          <button className="btn-icon" onClick={handlePrev} disabled={playlist.length === 0}>⏮</button>
          <button className="btn-icon play-btn" onClick={handlePlayPause} disabled={playlist.length === 0}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="btn-icon" onClick={handleNext} disabled={playlist.length === 0}>⏭</button>
        </div>

        {currentSong && (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#555', marginTop: 8 }}>
            {formatTime(currentPosition)} / {formatTime(currentSong.duration)}
          </div>
        )}
      </div>
    </div>
  );
}
