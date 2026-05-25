import React, { useState, useEffect, useCallback } from 'react';
import Home from './pages/Home';
import HostRoom from './pages/HostRoom';
import ClientRoom from './pages/ClientRoom';

export default function App() {
  const [page, setPage] = useState('home');
  const [roomInfo, setRoomInfo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [wsMessages, setWsMessages] = useState([]);
  const [roomEvents, setRoomEvents] = useState([]);
  const [electronMissing, setElectronMissing] = useState(false);

  // Check if running in Electron
  useEffect(() => {
    if (!window.electronAPI) {
      const timer = setTimeout(() => setElectronMissing(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Handle WebSocket messages from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanups = [];

    cleanups.push(window.electronAPI.onWsMessage((msg) => {
      setWsMessages((prev) => [...prev.slice(-50), msg]);
    }));

    cleanups.push(window.electronAPI.onServerStatus((data) => {
      setConnectionStatus(data.status);
    }));

    cleanups.push(window.electronAPI.onRoomEvent((data) => {
      setRoomEvents((prev) => [...prev.slice(-20), data]);
    }));

    cleanups.push(window.electronAPI.onError((data) => {
      console.error('App error:', data);
    }));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  const handleCreateRoom = useCallback(async () => {
    if (!window.electronAPI) {
      throw new Error('请在桌面应用中运行');
    }
    const result = await window.electronAPI.createRoom();
    if (result.success) {
      setRoomInfo(result);
      setPage('host');
    } else {
      throw new Error(result.error || '创建房间失败');
    }
  }, []);

  const handleJoinRoom = useCallback(async (address) => {
    if (!window.electronAPI) {
      throw new Error('请在桌面应用中运行');
    }
    const result = await window.electronAPI.joinRoom(address);
    if (result.success) {
      setRoomInfo({ address });
      setPage('client');
    } else {
      throw new Error(result.error || '加入房间失败');
    }
  }, []);

  const handleLeave = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.leaveRoom();
    }
    setPage('home');
    setRoomInfo(null);
    setConnectionStatus('disconnected');
    setWsMessages([]);
    setRoomEvents([]);
  }, []);

  return (
    <div className="app">
      {electronMissing && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#332200', color: '#f0ad4e', fontSize: 12, padding: '8px 16px', textAlign: 'center', zIndex: 999 }}>
          ⚠️ 未检测到桌面环境，部分功能不可用。请使用 <code>npm run dev</code> 启动完整应用
        </div>
      )}
      {page === 'home' && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
        />
      )}
      {page === 'host' && (
        <HostRoom
          roomInfo={roomInfo}
          wsMessages={wsMessages}
          roomEvents={roomEvents}
          onLeave={handleLeave}
        />
      )}
      {page === 'client' && (
        <ClientRoom
          roomInfo={roomInfo}
          wsMessages={wsMessages}
          connectionStatus={connectionStatus}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}
