/**
 * NetEase Cloud Music API wrapper.
 * Supports: song search, song info, audio URL extraction.
 * Uses the unofficial NetEase API with weapi encryption.
 */

const crypto = require('crypto');

// Static keys from NetEase's web client
const MODULUS = '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const PUBLIC_KEY = '010001';
const NONCE = '0CoJUm6Qyw8W8jud';
const IV = Buffer.from('0102030506070809', 'hex');

function createSecretKey(size = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function aesEncrypt(text, key, iv) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

// Fast modular exponentiation (square-and-multiply)
function modPow(base, exponent, modulus) {
  let result = 1n;
  base = base % modulus;
  while (exponent > 0n) {
    if (exponent & 1n) {
      result = (result * base) % modulus;
    }
    exponent = exponent >> 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function rsaEncrypt(text, keyHex, modulusHex) {
  const reversed = Buffer.from(text, 'utf-8').reverse();
  const hex = reversed.toString('hex');
  const base = BigInt('0x' + hex);
  const exp = BigInt('0x' + keyHex);
  const mod = BigInt('0x' + modulusHex);
  const result = modPow(base, exp, mod);
  return result.toString(16).padStart(256, '0');
}

function weapiEncrypt(object) {
  const text = JSON.stringify(object);
  const secretKey = createSecretKey(16);
  const enc1 = aesEncrypt(text, NONCE, IV);
  const enc2 = aesEncrypt(enc1, secretKey, IV);
  const encSecKey = rsaEncrypt(secretKey, PUBLIC_KEY, MODULUS);
  return {
    params: enc2,
    encSecKey: encSecKey,
  };
}

class NeteaseAPI {
  constructor() {
    this.baseURL = 'https://music.163.com';
    this.axios = null;
  }

  async _ensureAxios() {
    if (!this.axios) {
      try {
        this.axios = require('axios');
      } catch {
        // Fallback: use fetch (Node 18+ / Electron 28+)
        this.axios = {
          post: async (url, data, config) => {
            const response = await fetch(url, {
              method: 'POST',
              headers: config?.headers || {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: data,
            });
            return { data: await response.json() };
          },
        };
      }
    }
  }

  /**
   * Search for songs on NetEase Cloud Music.
   * @param {string} keywords - Search query
   * @param {number} limit - Number of results (default 20)
   * @returns {Array} List of songs
   */
  async search(keywords, limit = 20) {
    await this._ensureAxios();
    const data = weapiEncrypt({
      s: keywords,
      type: 1,
      limit,
      offset: 0,
    });

    try {
      const resp = await this.axios.post(
        `${this.baseURL}/api/cloudsearch/pc`,
        `params=${encodeURIComponent(data.params)}&encSecKey=${encodeURIComponent(data.encSecKey)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://music.163.com',
          },
        }
      );

      const result = resp.data;
      if (result.code !== 200 || !result.result || !result.result.songs) {
        return [];
      }

      return result.result.songs.map((song) => ({
        id: song.id,
        name: song.name,
        artists: (song.artists || []).map((a) => a.name).join(' / '),
        album: song.album ? song.album.name : '',
        albumPic: song.album ? (song.album.picUrl || song.album.blurPicUrl || '') : '',
        duration: song.duration / 1000,
        source: 'netease',
      }));
    } catch (err) {
      console.error('NetEase search error:', err.message);
      return [];
    }
  }

  /**
   * Get song details by song ID.
   */
  async getSongDetail(songId) {
    await this._ensureAxios();
    const data = weapiEncrypt({ c: JSON.stringify([{ id: songId }]), ids: [songId] });

    try {
      const resp = await this.axios.post(
        `${this.baseURL}/api/v3/song/detail`,
        `params=${encodeURIComponent(data.params)}&encSecKey=${encodeURIComponent(data.encSecKey)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://music.163.com',
          },
        }
      );

      const songs = resp.data.songs;
      if (!songs || songs.length === 0) return null;

      const song = songs[0];
      return {
        id: song.id,
        name: song.name,
        artists: (song.artists || []).map((a) => a.name).join(' / '),
        album: song.album ? song.album.name : '',
        albumPic: song.album ? song.album.picUrl : '',
        duration: song.duration / 1000,
        source: 'netease',
      };
    } catch (err) {
      console.error('NetEase detail error:', err.message);
      return null;
    }
  }

  /**
   * Get audio URL for a song.
   * Returns the direct audio streaming URL.
   */
  async getSongUrl(songId, bitrate = 320000) {
    await this._ensureAxios();
    const data = weapiEncrypt({
      ids: [songId],
      br: bitrate,
    });

    try {
      const resp = await this.axios.post(
        `${this.baseURL}/api/song/enhance/player/url/v1`,
        `params=${encodeURIComponent(data.params)}&encSecKey=${encodeURIComponent(data.encSecKey)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://music.163.com',
          },
        }
      );

      const urls = resp.data.data;
      if (!urls || urls.length === 0) return null;

      const urlInfo = urls[0];
      if (!urlInfo.url) return null;

      return {
        url: urlInfo.url,
        bitrate: urlInfo.br || bitrate,
        size: urlInfo.size || 0,
        encode: urlInfo.encode || '',
        md5: urlInfo.md5 || '',
      };
    } catch (err) {
      console.error('NetEase getUrl error:', err.message);
      return null;
    }
  }

  /**
   * Parse a NetEase music link to extract song ID.
   */
  parseSongLink(link) {
    let match = link.match(/song[?/]id=(\d+)/);
    if (match) return { id: parseInt(match[1]), source: 'netease' };
    return null;
  }
}

module.exports = NeteaseAPI;
