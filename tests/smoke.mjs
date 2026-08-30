import assert from 'node:assert/strict';

const drawMethods = [
  'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'arc',
  'fill', 'stroke', 'fillRect', 'clearRect', 'ellipse', 'save', 'restore',
  'translate', 'rotate', 'drawImage', 'fillText', 'setLineDash',
];
const context = {};
drawMethods.forEach((method) => { context[method] = () => {}; });

const listeners = new Map();
const classes = new Set();
const fakeCanvas = {
  width: 375,
  height: 667,
  getContext: () => context,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 667 }),
  addEventListener: (name, handler) => listeners.set(name, handler),
  setPointerCapture: () => {},
};
const loading = { classList: { add: (name) => classes.add(name) }, textContent: '' };
const toast = { textContent: '', classList: { add: () => {}, remove: () => {} } };
const storage = new Map();

globalThis.window = globalThis;
globalThis.GameGlobal = globalThis;
globalThis.document = {
  hidden: false,
  getElementById: (id) => ({ 'game-canvas': fakeCanvas, loading, toast }[id]),
  addEventListener: () => {},
};
globalThis.location = { hostname: 'localhost', href: 'http://localhost/' };
Object.defineProperty(globalThis, 'navigator', {
  value: { vibrate: () => {}, clipboard: { writeText: async () => {} } },
  configurable: true,
});
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
globalThis.Image = class {
  constructor() { this.onload = null; this.width = 2172; this.height = 724; }
  set src(value) { this.url = value; if (this.onload) this.onload(); }
};
globalThis.Audio = class {
  constructor() { this.src = ''; this.volume = 1; this.loop = false; this.currentTime = 0; }
  play() { return Promise.resolve(); }
  pause() {}
};
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => 1;

const { default: Main } = await import('../src/main.js');
const game = new Main();

assert.equal(game.state, 'room');
assert.equal(game.dogImageReady, true);
assert.equal(game.itemsImageReady, true);

game.pointsShop.award('h5-test-credit', 1000);
assert.equal(game.pointsShop.exchange('red_scarf').ok, true);
assert.equal(game.pointsShop.equip('red_scarf'), true);
assert.equal(game.pointsShop.data.equipped.neck, 'red_scarf');
assert.equal(game.pointsShop.unequip('red_scarf'), true);
assert.equal(game.pointsShop.data.equipped.neck, undefined);

game.startGame();
assert.equal(game.state, 'playing');
assert.equal(game.player.lane, 1);
game.movePlayer(1);
assert.equal(game.player.lane, 2);
game.pauseGame();
assert.equal(game.state, 'paused');
game.handlePausedTap(game.getPausedButtonAreas().continue.x + 2, game.getPausedButtonAreas().continue.y + 2);
assert.equal(game.state, 'playing');

game.startFrisbee();
game.completeFrisbeeTutorial();
assert.equal(game.state, 'frisbee');
assert.equal(game.items[0].type, 'frisbee');
const item = game.items[0];
item.y = game.player.y - game.player.radius * 0.35;
game.updateFrisbee(0.01);
assert.equal(game.caughtCount, 1);
assert.equal(game.score, 10);
game.elapsed = 39.99;
game.score = 650;
game.bestCombo = 12;
game.updateFrisbee(0.02);
assert.equal(game.state, 'frisbeeResult');
assert.equal(game.stars, 3);

game.render();
assert.equal(JSON.parse(storage.get('dog_adventure_frisbee_tutorial')), 'done');

console.log('h5 smoke test passed');
