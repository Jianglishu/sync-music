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
    this.audioElement = null;
    this.mode = 'buffer';
    this.scheduledTimer = null;
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
    if (this._shouldUseMediaElement(url)) {
      return this._loadMediaElement(url);
    }

    this._clearMediaElement();
    this.mode = 'buffer';

    // Resume context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法加载音频 (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.audioBuffer;
  }

  _shouldUseMediaElement(url) {
    return typeof url === 'string' && /^https?:\/\/127\.0\.0\.1:/i.test(url);
  }

  _loadMediaElement(url) {
    this.stop();
    this.audioBuffer = null;
    this.mode = 'element';

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    audio.volume = this.volume;
    audio.playbackRate = this.playbackRate;
    audio.onended = () => {
      this.isPlaying = false;
      if (this.onStateChange) this.onStateChange('ended');
    };
    audio.onerror = () => {
      if (this.onStateChange) this.onStateChange('error');
    };
    this.audioElement = audio;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve(audio);
      };
      const onError = () => {
        cleanup();
        reject(new Error('无法加载本地音频'));
      };
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('loadedmetadata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    });
  }

  /**
   * Schedule playback at a specific audioContext time.
   * @param {number} when - audioContext.currentTime to start playing
   * @param {number} position - start position in seconds within the audio
   * @param {number} rate - playback rate (1.0 = normal)
   */
  schedulePlay(when, position = 0, rate = 1.0) {
    if (this.mode === 'element') {
      return this._scheduleMediaElementPlay(when, position, rate);
    }

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

  _scheduleMediaElementPlay(when, position = 0, rate = 1.0) {
    if (!this.audioElement) return false;

    this.stop();
    this.mode = 'element';
    this.audioElement.currentTime = Math.max(0, position);
    this.audioElement.playbackRate = rate;

    const delayMs = Math.max(0, (when - this.audioContext.currentTime) * 1000);
    this.scheduledTimer = setTimeout(async () => {
      try {
        await this.audioElement.play();
        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.startPosition = position;
        this.playbackRate = rate;
        if (this.onStateChange) this.onStateChange('playing');
      } catch (err) {
        this.isPlaying = false;
        if (this.onStateChange) this.onStateChange('error');
      }
    }, delayMs);

    this.startTime = when;
    this.startPosition = position;
    this.playbackRate = rate;
    return true;
  }

  /**
   * Immediate play (for non-sync local testing).
   */
  play(position = 0) {
    return this.schedulePlay(this.audioContext.currentTime + 0.1, position, this.playbackRate);
  }

  pause() {
    if (this.mode === 'element') {
      if (!this.audioElement || !this.audioContext) return;
      this.startPosition = this.getCurrentPosition();
      this.audioElement.pause();
      this.isPlaying = false;
      if (this.onStateChange) this.onStateChange('paused');
      return;
    }

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
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    if (this.mode === 'element' && this.audioElement) {
      this.audioElement.pause();
      this.isPlaying = false;
      return;
    }

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
    if (this.mode === 'element' && this.audioElement) {
      return this.audioElement.currentTime || this.startPosition;
    }

    if (!this.isPlaying || !this.audioContext) {
      return this.startPosition;
    }
    const elapsed = this.audioContext.currentTime - this.startTime;
    return this.startPosition + elapsed * this.playbackRate;
  }

  getDuration() {
    if (this.mode === 'element' && this.audioElement && Number.isFinite(this.audioElement.duration)) {
      return this.audioElement.duration;
    }
    if (this.audioBuffer) {
      return this.audioBuffer.duration;
    }
    return 0;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
    if (this.audioElement) {
      this.audioElement.volume = this.volume;
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.source) {
      this.source.playbackRate.value = rate;
    }
    if (this.audioElement) {
      this.audioElement.playbackRate = rate;
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
    this._clearMediaElement();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  _clearMediaElement() {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute('src');
      this.audioElement.load();
      this.audioElement = null;
    }
  }
}

export default AudioPlayer;
