import React, { useState, useEffect, useCallback } from 'react';
import Home from './pages/Home';
import HostRoom from './pages/HostRoom';
import ClientRoom from './pages/ClientRoom';

export default function App() {
  const isElectron = Boolean(window.electronAPI);
  const canAutoJoinWebRoom = !isElectron && window.location.protocol.startsWith('http') &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [page, setPage] = useState(canAutoJoinWebRoom ? 'client' : 'home');
  const [roomInfo, setRoomInfo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(canAutoJoinWebRoom ? 'connecting' : 'disconnected');
  const [wsMessages, setWsMessages] = useState([]);
  const [roomEvents, setRoomEvents] = useState([]);
  const [electronMissing, setElectronMissing] = useState(false);
  const browserSocketRef = React.useRef(null);

  // Check if running in Electron
  useEffect(() => {
    if (!isElectron && !canAutoJoinWebRoom) {
      const timer = setTimeout(() => setElectronMissing(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [canAutoJoinWebRoom, isElectron]);

  // Handle WebSocket messages from main process
  useEffect(() => {
    if (!isElectron) return;

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
  }, [isElectron]);

  const connectBrowserRoom = useCallback((address) => {
    const normalizedAddress = address.trim().replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!normalizedAddress) return;

    if (browserSocketRef.current) {
      browserSocketRef.current.close();
      browserSocketRef.current = null;
    }

    setConnectionStatus('connecting');
    setRoomInfo({ address: normalizedAddress, webUrl: `${window.location.protocol}//${normalizedAddress}` });
    setPage('client');

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${wsProtocol}://${normalizedAddress}`);
    browserSocketRef.current = socket;

    socket.addEventListener('open', () => {
      setConnectionStatus('connected');
    });
    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        setWsMessages((prev) => [...prev.slice(-50), msg]);
      } catch (err) {
        // Ignore malformed messages from non-SyncMusic sockets.
      }
    });
    socket.addEventListener('close', () => {
      setConnectionStatus('disconnected');
    });
    socket.addEventListener('error', () => {
      setConnectionStatus('error');
    });
  }, []);

  useEffect(() => {
    if (!canAutoJoinWebRoom) return;
    connectBrowserRoom(window.location.host);

    return () => {
      if (browserSocketRef.current) {
        browserSocketRef.current.close();
        browserSocketRef.current = null;
      }
    };
  }, [canAutoJoinWebRoom, connectBrowserRoom]);

  const sendBrowserWsMessage = useCallback((msg) => {
    const socket = browserSocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
      return true;
    }
    return false;
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
      connectBrowserRoom(address);
      return;
    }
    const result = await window.electronAPI.joinRoom(address);
    if (result.success) {
      setRoomInfo({ address });
      setPage('client');
    } else {
      throw new Error(result.error || '加入房间失败');
    }
  }, [connectBrowserRoom]);

  const handleLeave = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.leaveRoom();
    } else if (browserSocketRef.current) {
      browserSocketRef.current.close();
      browserSocketRef.current = null;
    }
    setPage('home');
    setRoomInfo(null);
    setConnectionStatus('disconnected');
    setWsMessages([]);
    setRoomEvents([]);
  }, []);

  return (
    <div className="app">
      {electronMissing && page === 'home' && (
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
          sendWsMessage={isElectron ? window.electronAPI.sendWsMessage : sendBrowserWsMessage}
          webClient={!isElectron}
          onLeave={handleLeave}
        />
      )}
    </div>
  );
}
