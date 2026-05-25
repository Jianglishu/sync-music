import React, { useState } from 'react';

export default function Home({ onCreateRoom, onJoinRoom }) {
  const [joinAddress, setJoinAddress] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      await onCreateRoom();
    } catch (e) {
      setError('创建失败: ' + e.message);
    }
    setCreating(false);
  };

  const handleJoin = async () => {
    if (!joinAddress.trim()) return;
    setJoining(true);
    setError('');
    await onJoinRoom(joinAddress.trim());
    setJoining(false);
  };

  return (
    <div className="home">
      <div className="title-bar">SyncMusic</div>
      <div className="home-logo">🎵</div>
      <h1>多设备音乐同步</h1>
      <p className="subtitle">所有设备精确同步播放同一首歌<br/>支持网易云音乐</p>

      <div className="home-actions">
        <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
          {creating ? '⏳ 创建中...' : '✨ 创建房间 (Host)'}
        </button>
      </div>

      <div className="join-section">
        <div style={{ textAlign: 'center', color: '#555', fontSize: 13 }}>— 或者 —</div>
        <input
          className="input"
          placeholder="输入房间地址 IP:端口"
          value={joinAddress}
          onChange={(e) => setJoinAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />
        <button
          className="btn btn-secondary"
          onClick={handleJoin}
          disabled={joining || !joinAddress.trim()}
        >
          {joining ? '⏳ 连接中...' : '🔗 加入房间'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
