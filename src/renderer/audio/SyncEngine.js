/**
 * NTP-style clock synchronization engine.
 * Runs in the renderer process (Web Audio API context).
 */
class SyncEngine {
  constructor() {
    this.offset = 0;           // estimated offset from local time to server time
    this.rtt = 0;              // latest round-trip time
    this.samples = [];         // recent offset samples for median filtering
    this.maxSamples = 10;
    this.syncInterval = null;
    this.burstTimers = [];
    this.onSyncResult = null;  // callback({ offset, rtt, accuracy })
    this._sendSync = null;     // function to send sync message
  }

  /**
   * Start periodic sync.
   * @param {function} sendFn - Function to send sync message to server
   * @param {number} intervalMs - Sync interval (default 3000ms)
   */
  start(sendFn, intervalMs = 3000) {
    this._sendSync = sendFn;

    // Do an immediate sync
    this._doSync();
    this.burstTimers = [100, 250, 500, 900, 1400].map((delay) =>
      setTimeout(() => this._doSync(), delay)
    );

    // Then periodic sync
    this.syncInterval = setInterval(() => this._doSync(), intervalMs);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.burstTimers.forEach((timer) => clearTimeout(timer));
    this.burstTimers = [];
  }

  /**
   * Called when a sync response is received from the server.
   */
  onSyncResponse(msg) {
    const T4 = Date.now();
    const T1 = msg.clientTime;
    const T2 = msg.serverTime;

    // T1 = client sent time
    // T2 = server received time (server clock)
    // T4 = client received time
    const sampleRtt = T4 - T1;
    const sampleOffset = (T2 - T1 - sampleRtt / 2);

    this.rtt = sampleRtt;

    // Only use samples with reasonable RTT
    if (sampleRtt < 5000) {
      this.samples.push({ offset: sampleOffset, rtt: sampleRtt, time: T4 });
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }
    }

    // Calculate median offset from recent samples
    this.offset = this._getMedianOffset();

    const accuracy = this._estimateAccuracy();

    if (this.onSyncResult) {
      this.onSyncResult({ offset: this.offset, rtt: this.rtt, accuracy });
    }
  }

  /**
   * Estimate server time from local time.
   */
  getServerTime() {
    return Date.now() + this.offset;
  }

  /**
   * Get the current estimated time offset.
   */
  getOffset() {
    return this.offset;
  }

  _doSync() {
    if (this._sendSync) {
      this._sendSync({ type: 'sync', clientTime: Date.now() });
    }
  }

  _getMedianOffset() {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a.offset - b.offset);
    const mid = Math.floor(sorted.length / 2);
    // Use median for robustness against outliers
    return sorted[mid].offset;
  }

  _estimateAccuracy() {
    if (this.samples.length < 3) return 999;
    const offsets = this.samples.map(s => s.offset);
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    const variance = offsets.reduce((sum, o) => sum + (o - mean) ** 2, 0) / offsets.length;
    return Math.sqrt(variance);
  }
}

export default SyncEngine;
