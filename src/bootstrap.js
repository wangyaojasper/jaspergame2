globalThis.GameGlobal = globalThis;

try {
  const { default: Main } = await import('./main.js');
  globalThis.main = new Main();
  globalThis.__reviewMain = globalThis.main;
  document.getElementById('loading').classList.add('hidden');
} catch (error) {
  const loading = document.getElementById('loading');
  loading.textContent = '游戏加载失败，请刷新页面重试';
  console.error(error);
}
