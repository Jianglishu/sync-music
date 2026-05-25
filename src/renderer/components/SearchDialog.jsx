import React, { useState, useCallback, useRef, useEffect } from 'react';

export default function SearchDialog({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || !window.electronAPI) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await window.electronAPI.searchMusic(q.trim());
      if (result.success) {
        setResults(result.results || []);
      } else {
        setError(result.error || '搜索失败');
      }
    } catch (e) {
      setError('搜索请求失败');
    }
    setLoading(false);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (val.trim().length > 0) {
      searchTimer.current = setTimeout(() => doSearch(val), 400);
    } else {
      setResults([]);
    }
  };

  const formatTime = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#0f0f0f',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 18 }}>←</button>
        <input
          ref={inputRef}
          className="input"
          placeholder="搜索网易云音乐..."
          value={query}
          onChange={handleInputChange}
          style={{ flex: 1 }}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 24, color: '#666' }}>
          搜索中...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ textAlign: 'center', padding: 24, color: '#e74c3c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Results */}
      <div className="search-results" style={{ flex: 1 }}>
        {!loading && !error && results.length === 0 && query.trim() && (
          <div style={{ textAlign: 'center', padding: 24, color: '#666', fontSize: 13 }}>
            未找到结果
          </div>
        )}
        {results.map((song) => (
          <div key={song.id} className="search-result-item" onClick={() => onSelect(song)}>
            <img src={song.albumPic || ''} alt="" onError={(e) => { e.target.src = ''; }} />
            <div className="info">
              <div className="name">{song.name}</div>
              <div className="artist">{song.artists} · {song.album}</div>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginRight: 8 }}>
              {formatTime(song.duration)}
            </div>
            <button className="add-btn">+</button>
          </div>
        ))}
      </div>
    </div>
  );
}
