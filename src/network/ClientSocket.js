class ClientSocket {
  constructor() {
    this.ws = null;
    this.address = '';
    this.connected = false;
    this.onMessage = null;
    this.onStatusChange = null;
    this.reconnectTimer = null;
  }

  connect(address) {
    return new Promise((resolve, reject) => {
      // In Electron, we need to use the WebSocket from the renderer context
      // But since we're in the main process, we use Node.js ws
      const WebSocket = require('ws');
      const normalizedAddress = address.trim().replace(/^wss?:\/\//i, '').replace(/\/+$/, '');
      this.address = normalizedAddress;
      let settled = false;
      let timeout = null;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        fn(value);
      };

      try {
        this.ws = new WebSocket(`ws://${normalizedAddress}`);

        timeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.terminate();
          }
          settle(reject, new Error('连接超时，请确认房主已创建房间且两台设备在同一网络'));
        }, 8000);

        this.ws.on('open', () => {
          this.connected = true;
          if (this.onStatusChange) this.onStatusChange('connected');
          settle(resolve);
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (this.onMessage) this.onMessage(msg);
          } catch (e) {
            // Ignore malformed
          }
        });

        this.ws.on('close', () => {
          this.connected = false;
          if (this.onStatusChange) this.onStatusChange('disconnected');
        });

        this.ws.on('error', (err) => {
          if (!this.connected) {
            settle(reject, err);
          }
        });
      } catch (err) {
        settle(reject, err);
      }
    });
  }

  send(data) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = ClientSocket;
