/**
 * Audio extraction utility using yt-dlp.
 * Extracts direct audio URLs from streaming service links.
 */

const { execFile, execSync } = require('child_process');
const path = require('path');

class AudioExtractor {
  constructor() {
    this.ytdlpPath = 'yt-dlp';
  }

  /**
   * Check if yt-dlp is available.
   */
  async checkAvailable() {
    return new Promise((resolve) => {
      execFile(this.ytdlpPath, ['--version'], (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      });
    });
  }

  /**
   * Install yt-dlp via Homebrew. macOS only.
   */
  async ensureInstalled(onProgress) {
    const available = await this.checkAvailable();
    if (available) {
      if (onProgress) onProgress('done', 'yt-dlp 已就绪');
      return true;
    }

    if (onProgress) onProgress('installing', '正在检查 Homebrew...');

    // Check brew availability
    try {
      execSync('brew --version', { stdio: 'pipe' });
    } catch {
      if (onProgress) onProgress('error', 'Homebrew 未安装，请先安装: https://brew.sh');
      return false;
    }

    if (onProgress) onProgress('installing', '正在安装 yt-dlp (brew install yt-dlp)...');

    try {
      execSync('brew install yt-dlp', { stdio: 'pipe', timeout: 180000 });
      if (onProgress) onProgress('done', 'yt-dlp 安装完成');
      return true;
    } catch (e) {
      const msg = (e.stderr || e.message || '').toString().trim();
      if (onProgress) onProgress('error', 'yt-dlp 安装失败: ' + msg);
      return false;
    }
  }

  /**
   * Extract direct audio URL from a music streaming link.
   * @param {string} url - Song URL (NetEase, YouTube, etc.)
   * @returns {Promise<{url: string, title: string, duration: number}|null>}
   */
  async extractAudioUrl(url) {
    return new Promise((resolve, reject) => {
      const args = [
        '--get-url',
        '--no-warnings',
        '--format', 'bestaudio/best',
        '--no-playlist',
        url,
      ];

      execFile(this.ytdlpPath, args, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          // Try fallback without format
          execFile(this.ytdlpPath, [
            '--get-url',
            '--no-warnings',
            '--no-playlist',
            url,
          ], { timeout: 30000 }, (err2, stdout2) => {
            if (err2) {
              reject(new Error(`Failed to extract audio URL: ${err2.message}`));
            } else {
              const audioUrl = stdout2.trim().split('\n')[0];
              if (audioUrl && audioUrl.startsWith('http')) {
                resolve({ url: audioUrl });
              } else {
                reject(new Error('No audio URL extracted'));
              }
            }
          });
        } else {
          const lines = stdout.trim().split('\n');
          const audioUrl = lines[0];
          if (audioUrl && audioUrl.startsWith('http')) {
            resolve({ url: audioUrl });
          } else {
            reject(new Error('No audio URL extracted'));
          }
        }
      });
    });
  }

  /**
   * Get song info (title, duration) using yt-dlp.
   */
  async getSongInfo(url) {
    return new Promise((resolve, reject) => {
      execFile(this.ytdlpPath, [
        '--print', '%(title)s',
        '--print', '%(duration)s',
        '--no-warnings',
        '--no-playlist',
        url,
      ], { timeout: 30000 }, (err, stdout) => {
        if (err) {
          reject(new Error(`Failed to get song info: ${err.message}`));
        } else {
          const lines = stdout.trim().split('\n');
          const title = lines[0] || '';
          const duration = parseFloat(lines[1]) || 0;
          resolve({ title, duration });
        }
      });
    });
  }
}

module.exports = AudioExtractor;
