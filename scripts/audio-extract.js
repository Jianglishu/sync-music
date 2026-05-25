const { execFile, execSync } = require('child_process');

class AudioExtractor {
  constructor() {
    this.ytdlpPath = 'yt-dlp';
  }

  async checkAvailable() {
    return new Promise((resolve) => {
      execFile(this.ytdlpPath, ['--version'], (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      });
    });
  }

  async ensureInstalled(onProgress) {
    if (await this.checkAvailable()) {
      if (onProgress) onProgress('done', 'yt-dlp 已就绪');
      return true;
    }

    // Try brew first
    try {
      execSync('brew --version', { stdio: 'pipe' });
      if (onProgress) onProgress('installing', '正在安装 yt-dlp (brew install yt-dlp)...');
      execSync('brew install yt-dlp', { stdio: 'pipe', timeout: 180000 });
      if (onProgress) onProgress('done', 'yt-dlp 安装完成');
      return true;
    } catch {}

    // Fallback: try pip3
    try {
      execSync('pip3 --version', { stdio: 'pipe' });
      if (onProgress) onProgress('installing', '正在安装 yt-dlp (pip3 install yt-dlp)...');
      execSync('pip3 install yt-dlp', { stdio: 'pipe', timeout: 180000 });
      if (onProgress) onProgress('done', 'yt-dlp 安装完成');
      return true;
    } catch {}

    // Both failed
    if (onProgress) onProgress('error',
      'yt-dlp 安装失败，请手动安装:\n  brew install yt-dlp\n或:\n  pip3 install yt-dlp');
    return false;
  }

  async extractAudioUrl(url) {
    if (!(await this.checkAvailable())) {
      await this.ensureInstalled();
    }

    return new Promise((resolve, reject) => {
      const args = [
        '--get-url', '--no-warnings',
        '--format', 'bestaudio/best',
        '--no-playlist', url,
      ];

      execFile(this.ytdlpPath, args, { timeout: 30000 }, (err, stdout) => {
        if (err) {
          // Fallback without format
          execFile(this.ytdlpPath, [
            '--get-url', '--no-warnings',
            '--no-playlist', url,
          ], { timeout: 30000 }, (err2, stdout2) => {
            if (err2) return reject(new Error('提取音频链接失败'));
            const audioUrl = stdout2.trim().split('\n')[0];
            if (audioUrl && audioUrl.startsWith('http')) resolve({ url: audioUrl });
            else reject(new Error('未找到音频链接'));
          });
        } else {
          const audioUrl = stdout.trim().split('\n')[0];
          if (audioUrl && audioUrl.startsWith('http')) resolve({ url: audioUrl });
          else reject(new Error('未找到音频链接'));
        }
      });
    });
  }
}

module.exports = AudioExtractor;
