/**
 * Web Audio API-based audio player with precise scheduling.
 * Designed for synchronized multi-device playback.
 */
class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.source = null;
    this.gainNode = null;
    this.analyser = null;
    this.audioBuffer = null;
    this.isPlaying = false;
    this.startTime = 0;       // audioContext time when playback started
    this.startPosition = 0;   // position in seconds where playback started
    this.playbackRate = 1.0;
    this.volume = 1.0;
    this.onStateChange = null;
    this.onTimeUpdate = null;
  }

  async init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.audioContext.createGain();
    this.analyser = this.audioContext.createAnalyser();
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.gainNode.gain.value = this.volume;
  }

  async loadAudio(url) {
    // Resume context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.audioBuffer;
  }

  /**
   * Schedule playback at a specific audioContext time.
   * @param {number} when - audioContext.currentTime to start playing
   * @param {number} position - start position in seconds within the audio
   * @param {number} rate - playback rate (1.0 = normal)
   */
  schedulePlay(when, position = 0, rate = 1.0) {
    if (!this.audioBuffer) return false;

    // Stop previous source
    this.stop();

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.playbackRate.value = rate;
    this.source.connect(this.gainNode);

    // Schedule precise playback
    this.source.start(when, position);

    this.startTime = when;
    this.startPosition = position;
    this.playbackRate = rate;
    this.isPlaying = true;

    this.source.onended = () => {
      this.isPlaying = false;
      if (this.onStateChange) this.onStateChange('ended');
    };

    if (this.onStateChange) this.onStateChange('playing');

    return true;
  }

  /**
   * Immediate play (for non-sync local testing).
   */
  play(position = 0) {
    return this.schedulePlay(this.audioContext.currentTime + 0.1, position, this.playbackRate);
  }

  pause() {
    if (!this.isPlaying || !this.source || !this.audioContext) return;

    // Get current position and stop
    const currentPosition = this.getCurrentPosition();
    this.stop();
    this.startPosition = currentPosition;

    if (this.onStateChange) this.onStateChange('paused');
  }

  resume() {
    if (this.isPlaying) return;
    return this.play(this.startPosition);
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    this.isPlaying = false;
  }

  seek(position) {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.startPosition = position;
    if (wasPlaying) {
      this.schedulePlay(this.audioContext.currentTime + 0.05, position, this.playbackRate);
    }
  }

  /**
   * Get current playback position in seconds.
   */
  getCurrentPosition() {
    if (!this.isPlaying || !this.audioContext) {
      return this.startPosition;
    }
    const elapsed = this.audioContext.currentTime - this.startTime;
    return this.startPosition + elapsed * this.playbackRate;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.source) {
      this.source.playbackRate.value = rate;
    }
  }

  /**
   * Smoothly adjust playback rate to correct drift.
   * @param {number} driftSeconds - How far ahead (+) or behind (-) we are
   */
  correctDrift(driftSeconds) {
    if (Math.abs(driftSeconds) < 0.05) return; // ignore tiny drift

    // Adjust rate inversely proportional to drift, capped at ±3%
    const correction = Math.max(-0.03, Math.min(0.03, -driftSeconds * 0.1));
    const newRate = 1.0 + correction;
    this.setPlaybackRate(newRate);
  }

  getAudioContext() {
    return this.audioContext;
  }

  getAnalyser() {
    return this.analyser;
  }

  destroy() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export default AudioPlayer;
