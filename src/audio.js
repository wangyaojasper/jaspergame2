import wx from './platform/browser.js';

export default class AudioManager {
  constructor() {
    this.available = Boolean(wx.createInnerAudioContext);
    this.muted = this.readMuted();
    this.music = this.createTrack('public/audio/bgm.wav', 0.2, true);
    this.effects = {
      button: this.createTrack('public/audio/button.wav', 0.32),
      collect: this.createTrack('public/audio/collect.wav', 0.34),
      heart: this.createTrack('public/audio/heart.wav', 0.34),
      hit: this.createTrack('public/audio/hit.wav', 0.34),
      win: this.createTrack('public/audio/win.wav', 0.38),
      fail: this.createTrack('public/audio/fail.wav', 0.32),
    };
  }

  readMuted() {
    try {
      return wx.getStorageSync('dog_adventure_muted') === 'yes';
    } catch (error) {
      return false;
    }
  }

  createTrack(source, volume, loop = false) {
    if (!this.available) return null;
    try {
      const track = wx.createInnerAudioContext();
      track.src = source;
      track.volume = volume;
      track.loop = loop;
      return track;
    } catch (error) {
      return null;
    }
  }

  playMusic() {
    if (this.muted || !this.music) return;
    try { this.music.play(); } catch (error) { /* Audio failure never blocks play. */ }
  }

  pauseMusic() {
    if (!this.music) return;
    try { this.music.pause(); } catch (error) { /* Ignore unavailable audio. */ }
  }

  play(name) {
    if (this.muted) return;
    const track = this.effects[name];
    if (!track) return;
    try {
      track.stop();
      track.seek(0);
      track.play();
    } catch (error) {
      // Some devices reject audio before the first user gesture.
    }
  }

  toggle(isPlaying) {
    this.muted = !this.muted;
    try {
      wx.setStorageSync('dog_adventure_muted', this.muted ? 'yes' : 'no');
    } catch (error) {
      // Keep the in-memory setting when storage is unavailable.
    }
    if (this.muted) this.pauseMusic();
    else if (isPlaying) this.playMusic();
    return this.muted;
  }
}
