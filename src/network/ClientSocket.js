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
      this.address = address;

      try {
        this.ws = new WebSocket(`ws://${address}`);

        this.ws.on('open', () => {
          this.connected = true;
          if (this.onStatusChange) this.onStatusChange('connected');
          resolve();
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
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
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
