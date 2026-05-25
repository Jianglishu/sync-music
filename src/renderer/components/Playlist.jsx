import React from 'react';

export default function Playlist({ items, currentIndex, onSelect, onRemove }) {
  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (items.length === 0) {
    return (
      <div className="playlist">
        <div className="playlist-empty">
          <span>🎶 播放队列为空</span>
          <span>搜索或粘贴歌曲链接添加</span>
        </div>
      </div>
    );
  }

  return (
    <div className="playlist">
      {items.map((song, i) => (
        <div
          key={song.id || i}
          className={`playlist-item ${i === currentIndex ? 'active' : ''}`}
          onClick={() => onSelect(i)}
        >
          <img
            src={song.albumPic || ''}
            alt=""
            onError={(e) => { e.target.src = ''; }}
          />
          <div className="info">
            <div className="name">{song.name || '未知歌曲'}</div>
            <div className="artist">{song.artists || '未知艺术家'}</div>
          </div>
          <div className="duration">{formatTime(song.duration)}</div>
          {onRemove && (
            <button
              className="remove-btn"
              onClick={(e) => { e.stopPropagation(); onRemove(i); }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
