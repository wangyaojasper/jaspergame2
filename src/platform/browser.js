const canvas = document.getElementById('game-canvas');
const toast = document.getElementById('toast');
let shareFactory = null;
let toastTimer = 0;

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    clientX: (event.clientX - rect.left) * canvas.width / rect.width,
    clientY: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function bindPointer(type, handler) {
  canvas.addEventListener(type, (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    if (type === 'pointerdown') {
      canvas.setPointerCapture?.(event.pointerId);
      handler({ touches: [point] });
    } else if (type === 'pointermove') {
      if (event.buttons === 0 && event.pointerType === 'mouse') return;
      handler({ touches: [point] });
    } else {
      handler({ changedTouches: [point] });
    }
  }, { passive: false });
}

function readStorage(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch (error) { return raw; }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createAudioTrack() {
  const audio = new Audio();
  audio.preload = 'auto';
  return {
    get src() { return audio.src; },
    set src(value) { audio.src = value; },
    get volume() { return audio.volume; },
    set volume(value) { audio.volume = value; },
    get loop() { return audio.loop; },
    set loop(value) { audio.loop = value; },
    play() { const promise = audio.play(); if (promise?.catch) promise.catch(() => {}); },
    pause() { audio.pause(); },
    stop() { audio.pause(); audio.currentTime = 0; },
    seek(seconds) { audio.currentTime = seconds; },
  };
}

const platform = {
  createCanvas: () => canvas,
  createImage: () => new Image(),
  createInnerAudioContext: createAudioTrack,
  getWindowInfo: () => ({ screenWidth: 375, screenHeight: 667 }),
  getSystemInfoSync: () => ({ screenWidth: 375, screenHeight: 667 }),
  getStorageSync: readStorage,
  setStorageSync: writeStorage,
  onTouchStart: (handler) => bindPointer('pointerdown', handler),
  onTouchMove: (handler) => bindPointer('pointermove', handler),
  onTouchEnd: (handler) => {
    bindPointer('pointerup', handler);
    bindPointer('pointercancel', handler);
  },
  onHide: (handler) => {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handler();
    });
    window.addEventListener('pagehide', handler);
  },
  showShareMenu: () => {},
  onShareAppMessage: (factory) => { shareFactory = factory; },
  shareAppMessage: async (data = {}) => {
    const generated = shareFactory ? shareFactory() : {};
    const shareData = {
      title: data.title || generated.title || '小狗探险记',
      text: '陪小白狗一起探险和接飞盘吧！',
      url: location.href,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(location.href);
        showToast('游戏链接已复制');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('分享暂不可用');
    }
  },
  vibrateShort: () => navigator.vibrate?.(25),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: location.hostname === 'localhost' ? 'develop' : 'release' } }),
};

export default platform;
