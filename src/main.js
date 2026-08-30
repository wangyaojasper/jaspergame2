import './render.js';
import wx from './platform/browser.js';
import AudioManager from './audio.js';
import PointsShop, { calculatePoints, SHOP_ITEMS } from './points-shop.js';
import DailyProgress, { DAILY_TASKS, dateSeed } from './daily.js';
import PetGrowth from './pet-growth.js';
import {
  COLORS,
  ENABLE_DEBUG_TOOLS,
  FRISBEE_DURATION,
  GAME_DURATION,
  HIT_INVINCIBLE_SECONDS,
  MAX_HEART_SPAWNS,
  MAX_LIVES,
  PHASES,
  PUDDLE_SLOW_SECONDS,
  SHIELD_SECONDS,
} from './config.js';

const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const SCALE = Math.min(WIDTH / 375, HEIGHT / 667);
const ROAD_LEFT = WIDTH * 0.12;
const ROAD_WIDTH = WIDTH * 0.76;
const LANE_WIDTH = ROAD_WIDTH / 3;
const LANES = [0, 1, 2].map((lane) => ROAD_LEFT + LANE_WIDTH * (lane + 0.5));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function circle(context, x, y, radius) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function overlaps(player, item) {
  const dx = player.x - item.x;
  const dy = player.y - item.y;
  const radius = player.radius * 0.58 + item.radius * 0.72;
  return dx * dx + dy * dy < radius * radius;
}

export default class Main {
  constructor() {
    this.state = 'room';
    this.bestScore = this.readBestScore();
    this.career = this.readCareer();
    this.pointsShop = new PointsShop();
    this.daily = new DailyProgress();
    this.petGrowth = new PetGrowth();
    this.selectedShopItem = SHOP_ITEMS[0].id;
    this.shopMessage = '';
    this.dailyMessage = '';
    this.roomMessage = '小白狗在等你一起玩';
    this.roomAnimationType = '';
    this.roomAnimationUntil = 0;
    this.pendingUnlockLevel = 0;
    this.pendingExchangeItem = null;
    this.tutorialCompleted = this.readTutorialCompleted();
    this.audio = new AudioManager();
    this.lastTimestamp = Date.now();
    this.roadOffset = 0;
    this.touchStart = null;
    this.touchMoved = false;
    this.movesThisTouch = 0;
    this.pausedFrom = 'playing';
    this.frisbeeTutorialCompleted = this.readFrisbeeTutorialCompleted();
    this.dogImage = wx.createImage();
    this.dogImageReady = false;
    this.dogImage.onload = () => { this.dogImageReady = true; };
    this.dogImage.src = 'public/images/dog-run-spritesheet.png';
    this.itemsImage = wx.createImage();
    this.itemsImageReady = false;
    this.itemsImage.onload = () => { this.itemsImageReady = true; };
    this.itemsImage.src = 'public/images/items-spritesheet.png';
    this.bindTouchEvents();
    this.setupShare();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  bindTouchEvents() {
    wx.onTouchStart((event) => {
      const point = event.touches && event.touches[0];
      if (!point) return;

      if (this.state === 'home') {
        this.handleHomeTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'shop') {
        this.handleShopTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'daily') {
        this.handleDailyTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'room') {
        this.handleRoomTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'activities') {
        this.handleActivitiesTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'frisbeeResult') {
        this.handleFrisbeeResultTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'success' || this.state === 'failed') {
        this.handleResultTap(point.clientX, point.clientY);
        return;
      }

      if (this.state === 'paused') {
        this.handlePausedTap(point.clientX, point.clientY);
        return;
      }

      if ((this.state === 'playing' || this.state === 'frisbee') && this.isInsidePauseButton(point.clientX, point.clientY)) {
        this.audio.play('button');
        this.pauseGame();
        this.touchStart = null;
        return;
      }

      if ((this.state === 'playing' || this.state === 'frisbee') && this.isInsideSoundButton(point.clientX, point.clientY)) {
        this.audio.toggle(true);
        this.touchStart = null;
        return;
      }

      this.touchStart = { x: point.clientX, y: point.clientY };
      this.touchMoved = false;
      this.movesThisTouch = 0;
    });

    if (wx.onTouchMove) {
      wx.onTouchMove((event) => {
        if ((this.state !== 'playing' && this.state !== 'frisbee') || !this.touchStart) return;
        const point = event.touches && event.touches[0];
        if (!point) return;
        if (this.handleSwipePoint(point.clientX, point.clientY)) {
          this.touchStart = { x: point.clientX, y: point.clientY };
          this.touchMoved = true;
        }
      });
    }

    wx.onTouchEnd((event) => {
      if ((this.state !== 'playing' && this.state !== 'frisbee') || !this.touchStart) return;
      const point = event.changedTouches && event.changedTouches[0];
      if (!point) return;
      this.handleSwipePoint(point.clientX, point.clientY);
      this.touchStart = null;
      this.touchMoved = false;
      this.movesThisTouch = 0;
    });

    if (wx.onHide) wx.onHide(() => this.pauseGame());
  }

  setupShare() {
    if (wx.showShareMenu) {
      wx.showShareMenu({ withShareTicket: true });
    }
    if (wx.onShareAppMessage) {
      wx.onShareAppMessage(() => ({
        title: this.state === 'success'
          ? `我帮小白狗找到了宝藏，拿到${this.score}分！`
          : '来帮小白狗收集骨头、找到宝藏吧！',
      }));
    }
  }

  pauseGame() {
    if (this.state === 'playing' || this.state === 'frisbee') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.audio.pauseMusic();
    }
  }

  handleSwipePoint(x, y) {
    if (!this.touchStart) return false;
    if (this.state === 'frisbee' && this.frisbeeMudTime > 0) return false;
    const dx = x - this.touchStart.x;
    const dy = y - this.touchStart.y;
    const threshold = this.movesThisTouch === 0
      ? Math.max(16, 18 * SCALE)
      : Math.max(56, 64 * SCALE);
    if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * 0.72) return false;
    const moved = this.movePlayer(dx > 0 ? 1 : -1);
    if (!moved) return false;
    this.movesThisTouch += 1;
    return true;
  }

  getSoundButtonArea() {
    return {
      x: 14 * SCALE,
      y: 76 * SCALE,
      width: 44 * SCALE,
      height: 44 * SCALE,
    };
  }

  isInsideSoundButton(x, y) {
    return this.pointInArea(x, y, this.getSoundButtonArea());
  }

  getPauseButtonArea() {
    return {
      x: WIDTH - 58 * SCALE,
      y: 82 * SCALE,
      width: 44 * SCALE,
      height: 44 * SCALE,
    };
  }

  isInsidePauseButton(x, y) {
    const area = this.getPauseButtonArea();
    return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  }

  getPausedButtonAreas() {
    return {
      continue: {
        x: WIDTH * 0.2,
        y: HEIGHT * 0.53,
        width: WIDTH * 0.6,
        height: 58 * SCALE,
      },
      home: {
        x: WIDTH * 0.2,
        y: HEIGHT * 0.64,
        width: WIDTH * 0.6,
        height: 54 * SCALE,
      },
    };
  }

  pointInArea(x, y, area) {
    return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  }

  getHomeButtonAreas() {
    return {
      start: { x: WIDTH * 0.2, y: HEIGHT * 0.22 + HEIGHT * 0.56 - 92 * SCALE, width: WIDTH * 0.6, height: 58 * SCALE },
      room: { x: WIDTH * 0.055, y: HEIGHT * 0.82, width: WIDTH * 0.27, height: 42 * SCALE },
      shop: { x: WIDTH * 0.365, y: HEIGHT * 0.82, width: WIDTH * 0.27, height: 42 * SCALE },
      daily: { x: WIDTH * 0.675, y: HEIGHT * 0.82, width: WIDTH * 0.27, height: 42 * SCALE },
    };
  }

  handleHomeTap(x, y) {
    const areas = this.getHomeButtonAreas();
    if (this.pointInArea(x, y, areas.room)) {
      this.audio.play('button');
      this.state = 'room';
      return;
    }
    if (this.pointInArea(x, y, areas.shop)) {
      this.audio.play('button');
      this.state = 'shop';
      this.shopMessage = '';
      return;
    }
    if (this.pointInArea(x, y, areas.daily)) {
      this.audio.play('button');
      this.daily.ensureToday();
      this.state = 'daily';
      this.dailyMessage = '';
      return;
    }
    if (this.pointInArea(x, y, areas.start)) this.startGame();
  }

  getActivitiesAreas() {
    return {
      runner: { x: WIDTH * 0.1, y: HEIGHT * 0.28, width: WIDTH * 0.8, height: 118 * SCALE },
      frisbee: { x: WIDTH * 0.1, y: HEIGHT * 0.49, width: WIDTH * 0.8, height: 118 * SCALE },
      back: { x: WIDTH * 0.3, y: HEIGHT * 0.8, width: WIDTH * 0.4, height: 44 * SCALE },
    };
  }

  handleActivitiesTap(x, y) {
    const areas = this.getActivitiesAreas();
    if (this.pointInArea(x, y, areas.runner)) {
      this.audio.play('button');
      this.state = 'home';
      return;
    }
    if (this.pointInArea(x, y, areas.frisbee)) {
      this.audio.play('button');
      this.startFrisbee();
      return;
    }
    if (this.pointInArea(x, y, areas.back)) {
      this.audio.play('button');
      this.state = 'room';
    }
  }

  getFrisbeeResultAreas() {
    return {
      retry: { x: WIDTH * 0.2, y: HEIGHT * 0.65, width: WIDTH * 0.6, height: 58 * SCALE },
      home: { x: WIDTH * 0.12, y: HEIGHT * 0.76, width: WIDTH * 0.34, height: 44 * SCALE },
      activities: { x: WIDTH * 0.54, y: HEIGHT * 0.76, width: WIDTH * 0.34, height: 44 * SCALE },
    };
  }

  handleFrisbeeResultTap(x, y) {
    const areas = this.getFrisbeeResultAreas();
    if (this.pointInArea(x, y, areas.retry)) {
      this.audio.play('button');
      this.startFrisbee();
    } else if (this.pointInArea(x, y, areas.home)) {
      this.audio.play('button');
      this.state = 'room';
    } else if (this.pointInArea(x, y, areas.activities)) {
      this.audio.play('button');
      this.state = 'activities';
    }
  }

  getRoomAreas() {
    return {
      debug: { x: WIDTH * 0.04, y: HEIGHT * 0.035, width: WIDTH * 0.25, height: 30 * SCALE },
      care: [
        { type: 'feed', label: '喂食', x: WIDTH * 0.055, y: HEIGHT * 0.675, width: WIDTH * 0.27, height: 58 * SCALE },
        { type: 'play', label: '玩耍', x: WIDTH * 0.365, y: HEIGHT * 0.675, width: WIDTH * 0.27, height: 58 * SCALE },
        { type: 'bath', label: '洗澡', x: WIDTH * 0.675, y: HEIGHT * 0.675, width: WIDTH * 0.27, height: 58 * SCALE },
      ],
      adventure: { x: WIDTH * 0.055, y: HEIGHT * 0.855, width: WIDTH * 0.27, height: 50 * SCALE },
      shop: { x: WIDTH * 0.365, y: HEIGHT * 0.855, width: WIDTH * 0.27, height: 50 * SCALE },
      daily: { x: WIDTH * 0.675, y: HEIGHT * 0.855, width: WIDTH * 0.27, height: 50 * SCALE },
    };
  }

  handleRoomTap(x, y) {
    const areas = this.getRoomAreas();
    if (this.pendingUnlockLevel) {
      const close = this.getUnlockCloseArea();
      if (this.pointInArea(x, y, close)) {
        this.audio.play('button');
        this.pendingUnlockLevel = 0;
      }
      return;
    }
    if (this.isDebugToolsEnabled() && this.pointInArea(x, y, areas.debug)) {
      const amount = this.pointsShop.award(`debug-${Date.now()}-${Math.random()}`, 100);
      this.roomMessage = amount ? '测试骨头币 +100' : '测试加币失败，请重试';
      this.audio.play('collect');
      return;
    }
    const onboarding = this.petGrowth.data.onboardingStep;
    if (onboarding === 0) {
      const playArea = areas.care.find((area) => area.type === 'play');
      if (!this.pointInArea(x, y, playArea)) {
        this.roomMessage = '先和小白狗玩一下吧';
        return;
      }
    }
    if (onboarding === 1 && !this.pointInArea(x, y, areas.adventure)) {
      this.roomMessage = '带小白狗去完成第一次探险吧';
      return;
    }
    if (onboarding === 3) {
      const feedArea = areas.care.find((area) => area.type === 'feed');
      if (!this.pointInArea(x, y, feedArea)) {
        this.roomMessage = '第一次喂食已经准备好啦';
        return;
      }
    }
    if (this.pointInArea(x, y, areas.adventure)) {
      this.audio.play('button');
      if (onboarding === 1) {
        this.petGrowth.setOnboardingStep(2);
        this.state = 'home';
      } else {
        this.state = 'activities';
      }
      return;
    }
    if (this.pointInArea(x, y, areas.shop)) {
      this.audio.play('button');
      this.state = 'shop';
      return;
    }
    if (this.pointInArea(x, y, areas.daily)) {
      this.audio.play('button');
      this.state = 'daily';
      return;
    }
    const care = areas.care.find((area) => this.pointInArea(x, y, area));
    if (!care) return;
    this.startRoomAnimation(care.type);
    if (care.type === 'feed' && onboarding === 3) {
      const result = this.petGrowth.interact('feed');
      const welcome = this.petGrowth.addExp(`welcome-${this.petGrowth.data.date}`, 14);
      this.petGrowth.setOnboardingStep(4);
      const levelUp = result.levelUp || welcome.levelUp;
      this.roomMessage = `第一次喂食免费！亲密 +${result.gained + welcome.gained}`;
      if (levelUp) this.pendingUnlockLevel = this.petGrowth.status().level;
    } else if (care.type === 'feed' && this.petGrowth.data.feedCount < 3) {
      const transactionId = `feed-${this.petGrowth.data.date}-${this.petGrowth.data.feedCount + 1}`;
      const spent = this.pointsShop.spend(transactionId, 5);
      if (!spent.ok) {
        this.roomMessage = spent.reason === 'insufficient' ? '骨头币不够，去探险带一些回来吧' : '这次没有扣币，请重试';
        this.audio.play('button');
        return;
      }
      const result = this.petGrowth.interact('feed');
      if (!result.gained) {
        this.pointsShop.award(`refund-${transactionId}`, 5);
        this.roomMessage = '喂食没有成功，骨头币已退回';
      } else {
        this.setCareMessage('吃得饱饱的！', result);
      }
    } else {
      const result = this.petGrowth.interact(care.type);
      if (result.repeated) {
        const messages = { feed: '今天已经吃得很满足啦', play: '再陪你玩一会儿！', bath: '已经香香的啦！' };
        this.roomMessage = messages[care.type];
      } else {
        const messages = { play: '开心地摇起了尾巴！', bath: '洗得干干净净！' };
        this.setCareMessage(messages[care.type], result);
      }
    }
    if (care.type === 'play' && onboarding === 0) this.petGrowth.setOnboardingStep(1);
    this.audio.play(care.type === 'bath' ? 'heart' : 'collect');
  }

  setCareMessage(message, result) {
    this.roomMessage = `${message} 亲密 +${result.gained}${result.levelUp ? ` · 升到${result.after}级！` : ''}`;
    if (result.levelUp) this.pendingUnlockLevel = result.after;
  }

  startRoomAnimation(type) {
    this.roomAnimationType = type;
    this.roomAnimationUntil = Date.now() + 1200;
  }

  getUnlockCloseArea() {
    return { x: WIDTH * 0.2, y: HEIGHT * 0.62, width: WIDTH * 0.6, height: 54 * SCALE };
  }

  isDebugToolsEnabled() {
    if (!ENABLE_DEBUG_TOOLS) return false;
    try {
      if (!wx.getAccountInfoSync) return true;
      const info = wx.getAccountInfoSync();
      return info?.miniProgram?.envVersion !== 'release';
    } catch (error) {
      return true;
    }
  }

  unlockName(level) {
    return {
      2: '柔软小窝',
      3: '彩色饭碗',
      4: '开心摇尾动作',
      5: '森林窗户',
      6: '庆祝动作',
      7: '探险照片墙',
      8: '小屋地毯',
      9: '星星灯串',
      10: '亲密纪念皇冠',
    }[level] || '新的小屋内容';
  }

  getShopAreas() {
    const rows = SHOP_ITEMS.map((item, index) => ({
      item,
      x: WIDTH * 0.1,
      y: HEIGHT * 0.24 + index * 54 * SCALE,
      width: WIDTH * 0.8,
      height: 44 * SCALE,
    }));
    return {
      rows,
      action: { x: WIDTH * 0.18, y: HEIGHT * 0.7, width: WIDTH * 0.64, height: 54 * SCALE },
      back: { x: WIDTH * 0.3, y: HEIGHT * 0.81, width: WIDTH * 0.4, height: 42 * SCALE },
      confirm: { x: WIDTH * 0.18, y: HEIGHT * 0.57, width: WIDTH * 0.64, height: 54 * SCALE },
      cancel: { x: WIDTH * 0.25, y: HEIGHT * 0.67, width: WIDTH * 0.5, height: 44 * SCALE },
    };
  }

  handleShopTap(x, y) {
    const areas = this.getShopAreas();
    if (this.pendingExchangeItem) {
      if (this.pointInArea(x, y, areas.cancel)) {
        this.pendingExchangeItem = null;
        this.shopMessage = '已取消兑换';
        this.audio.play('button');
        return;
      }
      if (!this.pointInArea(x, y, areas.confirm)) return;
      const item = SHOP_ITEMS.find((candidate) => candidate.id === this.pendingExchangeItem);
      const result = this.pointsShop.exchange(item.id);
      this.pendingExchangeItem = null;
      if (result.ok) {
        this.pointsShop.equip(item.id);
        this.shopMessage = `已兑换并穿戴${item.name}`;
      } else if (result.reason === 'insufficient') {
        this.shopMessage = `还差${item.price - this.pointsShop.data.balance}骨头币`;
      } else {
        this.shopMessage = '兑换失败，未扣骨头币';
      }
      this.audio.play('button');
      return;
    }
    const row = areas.rows.find((candidate) => this.pointInArea(x, y, candidate));
    if (row) {
      this.selectedShopItem = row.item.id;
      this.shopMessage = '';
      this.audio.play('button');
      return;
    }
    if (this.pointInArea(x, y, areas.back)) {
      this.audio.play('button');
      this.state = 'room';
      return;
    }
    if (!this.pointInArea(x, y, areas.action)) return;
    const item = SHOP_ITEMS.find((candidate) => candidate.id === this.selectedShopItem);
    if (this.pointsShop.isEquipped(item.id)) {
      this.shopMessage = this.pointsShop.unequip(item.id) ? `已卸下${item.name}` : '卸下失败，请重试';
    } else if (this.pointsShop.isOwned(item.id)) {
      this.shopMessage = this.pointsShop.equip(item.id) ? `已穿戴${item.name}` : '穿戴失败，请重试';
    } else if (this.pointsShop.data.balance < item.price) {
      this.shopMessage = `还差${item.price - this.pointsShop.data.balance}骨头币`;
    } else {
      this.pendingExchangeItem = item.id;
      this.shopMessage = '';
    }
    this.audio.play('button');
  }

  getDailyAreas() {
    return {
      start: { x: WIDTH * 0.18, y: HEIGHT * 0.66, width: WIDTH * 0.64, height: 56 * SCALE },
      tasks: DAILY_TASKS.map((task, index) => ({
        task,
        x: WIDTH * 0.1,
        y: HEIGHT * 0.29 + index * 76 * SCALE,
        width: WIDTH * 0.8,
        height: 64 * SCALE,
      })),
      back: { x: WIDTH * 0.3, y: HEIGHT * 0.8, width: WIDTH * 0.4, height: 42 * SCALE },
    };
  }

  handleDailyTap(x, y) {
    const areas = this.getDailyAreas();
    if (this.pointInArea(x, y, areas.start)) {
      this.audio.play('button');
      this.startGame('daily');
      return;
    }
    if (this.pointInArea(x, y, areas.back)) {
      this.audio.play('button');
      this.state = 'room';
      return;
    }
    const row = areas.tasks.find((candidate) => this.pointInArea(x, y, candidate));
    if (!row) return;
    const state = this.daily.taskState(row.task);
    if (state.claimed) this.dailyMessage = '这项奖励今天已经领过啦';
    else if (!state.complete) this.dailyMessage = '完成任务后就能领取';
    else {
      const settlementId = `daily-${this.daily.data.date}-${row.task.id}`;
      const credited = this.pointsShop.award(settlementId, row.task.reward);
      const alreadyCredited = this.pointsShop.data.settlements.includes(settlementId);
      if ((credited > 0 || alreadyCredited) && this.daily.markClaimed(row.task.id)) {
        this.dailyMessage = `领取成功 +${row.task.reward} 骨头币`;
      } else {
        this.dailyMessage = '领取失败，请重试';
      }
    }
    this.audio.play('button');
  }

  handlePausedTap(x, y) {
    const areas = this.getPausedButtonAreas();
    if (this.pointInArea(x, y, areas.continue)) {
      this.audio.play('button');
      this.state = this.pausedFrom || 'playing';
      this.lastTimestamp = Date.now();
      this.audio.playMusic();
      return;
    }

    if (this.pointInArea(x, y, areas.home)) {
      this.audio.play('button');
      this.audio.pauseMusic();
      this.state = 'room';
      this.touchStart = null;
    }
  }

  getResultButtonAreas() {
    const panelY = HEIGHT * 0.22;
    const panelHeight = HEIGHT * 0.56;
    return {
      retry: {
        x: WIDTH * 0.2,
        y: panelY + panelHeight - 112 * SCALE,
        width: WIDTH * 0.6,
        height: 58 * SCALE,
      },
      home: { x: WIDTH * 0.105, y: panelY + panelHeight - 46 * SCALE, width: WIDTH * 0.245, height: 38 * SCALE },
      shop: { x: WIDTH * 0.3775, y: panelY + panelHeight - 46 * SCALE, width: WIDTH * 0.245, height: 38 * SCALE },
      share: { x: WIDTH * 0.65, y: panelY + panelHeight - 46 * SCALE, width: WIDTH * 0.245, height: 38 * SCALE },
    };
  }

  handleResultTap(x, y) {
    const areas = this.getResultButtonAreas();
    if (this.pointInArea(x, y, areas.retry)) {
      this.audio.play('button');
      this.startGame(this.gameMode || 'normal');
      return;
    }
    if (this.pointInArea(x, y, areas.home)) {
      this.audio.play('button');
      if (this.petGrowth.data.onboardingStep === 2) this.petGrowth.setOnboardingStep(3);
      if (this.growthLevelUp) this.pendingUnlockLevel = this.growthLevelAfter;
      this.state = 'room';
      return;
    }
    if (this.pointInArea(x, y, areas.shop)) {
      this.audio.play('button');
      if (this.gameMode === 'daily') {
        this.state = 'daily';
        this.dailyMessage = '';
      } else {
        this.state = 'shop';
        this.shopMessage = '';
      }
      return;
    }
    if (this.pointInArea(x, y, areas.share) && wx.shareAppMessage) {
      wx.shareAppMessage({
        title: `我在《小狗探险记》拿到了${this.score}分，来挑战吧！`,
      });
    }
  }

  readBestScore() {
    try {
      return Number(wx.getStorageSync('dog_adventure_best')) || 0;
    } catch (error) {
      return 0;
    }
  }

  readTutorialCompleted() {
    try {
      return wx.getStorageSync('dog_adventure_tutorial') === 'done';
    } catch (error) {
      return false;
    }
  }

  readFrisbeeTutorialCompleted() {
    try {
      return wx.getStorageSync('dog_adventure_frisbee_tutorial') === 'done';
    } catch (error) {
      return false;
    }
  }

  readCareer() {
    try {
      const saved = wx.getStorageSync('dog_adventure_career_v1');
      if (!saved || typeof saved !== 'object') return { bestCombo: 0, completions: 0 };
      return {
        bestCombo: Math.max(0, Number(saved.bestCombo) || 0),
        completions: Math.max(0, Number(saved.completions) || 0),
      };
    } catch (error) {
      return { bestCombo: 0, completions: 0 };
    }
  }

  saveCareer(success) {
    const next = {
      bestCombo: Math.max(this.career.bestCombo, this.bestCombo),
      completions: this.career.completions + (success ? 1 : 0),
    };
    try {
      wx.setStorageSync('dog_adventure_career_v1', next);
      this.career = next;
    } catch (error) {
      // Career records can fall back to the current session.
      this.career = next;
    }
  }

  completeTutorial() {
    this.tutorialCompleted = true;
    this.tutorialVisible = false;
    this.spawnTimer = 0.7;
    try {
      wx.setStorageSync('dog_adventure_tutorial', 'done');
    } catch (error) {
      // The tutorial can continue even when local storage is unavailable.
    }
  }

  saveBestScore() {
    if (this.score <= this.bestScore) return;
    this.bestScore = this.score;
    try {
      wx.setStorageSync('dog_adventure_best', this.bestScore);
    } catch (error) {
      // Local storage failure must never block the game loop.
    }
  }

  startGame(mode = 'normal') {
    this.state = 'playing';
    this.pausedFrom = 'playing';
    this.gameMode = mode;
    this.randomState = mode === 'daily' ? dateSeed(this.daily.data.date) : 0;
    this.elapsed = 0;
    this.score = 0;
    this.lives = MAX_LIVES;
    this.combo = 0;
    this.bestCombo = 0;
    this.bonesCollected = 0;
    this.runId = `${Date.now()}-${Math.random()}`;
    this.pointsEarned = 0;
    this.intimacyEarned = 0;
    this.growthLevelUp = false;
    this.stars = 0;
    this.animationClock = 0;
    this.invincible = 0;
    this.shieldTime = 0;
    this.slowTime = 0;
    this.heartSpawns = 0;
    this.shieldSpawns = 0;
    this.isNewRecord = false;
    this.spawnTimer = 0.5;
    this.tutorialVisible = !this.tutorialCompleted;
    this.items = [];
    this.effects = [];
    this.player = {
      lane: 1,
      x: LANES[1],
      targetX: LANES[1],
      y: HEIGHT * 0.79,
      radius: 28 * SCALE,
    };
    this.lastTimestamp = Date.now();
    this.audio.playMusic();
  }

  startFrisbee() {
    this.state = 'frisbee';
    this.pausedFrom = 'frisbee';
    this.gameMode = 'frisbee';
    this.elapsed = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.caughtCount = 0;
    this.frisbeeMisses = 0;
    this.frisbeeMudTime = 0;
    this.frisbeeSpawnTimer = 0.6;
    this.runId = `frisbee-${Date.now()}-${Math.random()}`;
    this.pointsEarned = 0;
    this.intimacyEarned = 0;
    this.stars = 0;
    this.items = [];
    this.effects = [];
    this.animationClock = 0;
    this.invincible = 0;
    this.shieldTime = 0;
    this.slowTime = 0;
    this.tutorialVisible = !this.frisbeeTutorialCompleted;
    this.player = {
      lane: 1,
      x: LANES[1],
      targetX: LANES[1],
      y: HEIGHT * 0.79,
      radius: 30 * SCALE,
    };
    this.addFrisbeeItem('frisbee', 1, true);
    this.lastTimestamp = Date.now();
    this.audio.playMusic();
  }

  addFrisbeeItem(type, lane, tutorial = false) {
    const radius = type === 'tennis' ? 17 : type === 'mud' ? 22 : 25;
    this.items.push({
      type,
      lane,
      x: LANES[lane],
      y: tutorial ? HEIGHT * 0.2 : 112 * SCALE,
      radius: radius * SCALE,
      speed: (tutorial ? 112 : 145 + Math.min(75, this.elapsed * 2.1)) * SCALE,
      phase: Math.random() * Math.PI * 2,
      collected: false,
    });
  }

  spawnFrisbeeItem() {
    const lane = Math.floor(Math.random() * 3);
    const mudChance = this.elapsed < 15 ? 0 : Math.min(0.22, 0.1 + (this.elapsed - 15) * 0.006);
    const roll = Math.random();
    const type = roll < mudChance ? 'mud' : roll < 0.38 ? 'tennis' : 'frisbee';
    this.addFrisbeeItem(type, lane);
  }

  frisbeeMultiplier() {
    if (this.combo >= 20) return 4;
    if (this.combo >= 10) return 3;
    if (this.combo >= 5) return 2;
    return 1;
  }

  catchFrisbeeItem(item) {
    item.collected = true;
    if (item.type === 'mud') {
      this.combo = 0;
      this.frisbeeMudTime = 0.5;
      this.addEffect(item.x, item.y, '沾到泥啦', '#87522f');
      this.audio.play('hit');
      return;
    }
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.caughtCount += 1;
    const base = item.type === 'tennis' ? 15 : 10;
    const gained = base * this.frisbeeMultiplier();
    this.score += gained;
    this.addEffect(item.x, item.y, `+${gained}`, item.type === 'tennis' ? '#d99d25' : '#65a9d8');
    this.audio.play('collect');
  }

  updateFrisbee(delta) {
    this.animationClock += delta;
    this.player.x += (this.player.targetX - this.player.x) * Math.min(1, delta * 11);
    this.frisbeeMudTime = Math.max(0, this.frisbeeMudTime - delta);
    this.elapsed += delta;
    if (this.elapsed >= FRISBEE_DURATION) {
      this.elapsed = FRISBEE_DURATION;
      this.finishFrisbee();
      return;
    }
    if (!this.tutorialVisible) {
      this.frisbeeSpawnTimer -= delta;
      if (this.frisbeeSpawnTimer <= 0 && this.items.length < 3) {
        this.spawnFrisbeeItem();
        this.frisbeeSpawnTimer = Math.max(0.62, 1.12 - this.elapsed * 0.011);
      }
    }
    const catchY = this.player.y - this.player.radius * 0.35;
    this.items.forEach((item) => {
      item.y += item.speed * delta;
      item.x = LANES[item.lane] + Math.sin(this.animationClock * 3.2 + item.phase) * 8 * SCALE;
      if (!item.collected && item.y >= catchY - 30 * SCALE && item.y <= catchY + 28 * SCALE && item.lane === this.player.lane) {
        this.catchFrisbeeItem(item);
      } else if (!item.collected && item.y > HEIGHT + item.radius) {
        item.collected = true;
        if (item.type !== 'mud') {
          this.combo = 0;
          this.frisbeeMisses += 1;
        }
      }
    });
    this.items = this.items.filter((item) => !item.collected);
    this.effects.forEach((effect) => {
      effect.life -= delta;
      effect.y -= 36 * SCALE * delta;
    });
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  finishFrisbee() {
    if (this.state !== 'frisbee') return;
    this.score = Math.floor(this.score);
    this.stars = this.score >= 600 && this.bestCombo >= 12 ? 3 : this.score >= 300 ? 2 : 1;
    const points = Math.min(8, 2 + Math.floor(this.score / 100));
    this.pointsEarned = this.pointsShop.award(this.runId, points);
    this.petGrowth.ensureToday();
    const baseGrowth = this.petGrowth.addExp(`${this.runId}-growth`, 2);
    const dailyGrowth = this.petGrowth.addExp(`frisbee-first-${this.petGrowth.data.date}`, 3);
    this.intimacyEarned = baseGrowth.gained + dailyGrowth.gained;
    this.growthLevelUp = baseGrowth.levelUp || dailyGrowth.levelUp;
    this.growthLevelAfter = this.petGrowth.status().level;
    this.audio.pauseMusic();
    this.audio.play('win');
    this.state = 'frisbeeResult';
  }

  movePlayer(direction) {
    const nextLane = clamp(this.player.lane + direction, 0, 2);
    if (nextLane === this.player.lane) return false;
    this.player.lane = nextLane;
    this.player.targetX = LANES[nextLane];
    if (this.tutorialVisible) {
      if (this.state === 'frisbee') this.completeFrisbeeTutorial();
      else this.completeTutorial();
    }
    return true;
  }

  completeFrisbeeTutorial() {
    this.frisbeeTutorialCompleted = true;
    this.tutorialVisible = false;
    this.frisbeeSpawnTimer = 0.35;
    try {
      wx.setStorageSync('dog_adventure_frisbee_tutorial', 'done');
    } catch (error) {
      // The round remains playable without local tutorial storage.
    }
  }

  random() {
    if (this.gameMode !== 'daily') return Math.random();
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  getPhase() {
    return PHASES.find((phase) => this.elapsed < phase.end) || PHASES[PHASES.length - 1];
  }

  addItem(type, lane, yOffset) {
    const sizes = { bone: 23, log: 31, heart: 25, shield: 27, puddle: 32 };
    this.items.push({
      type,
      lane,
      x: LANES[lane],
      y: -40 * SCALE - (yOffset || 0) * SCALE,
      radius: sizes[type] * SCALE,
      collected: false,
    });
  }

  spawnTemplate(name) {
    const safeLane = Math.floor(this.random() * 3);
    if (name === 'single') {
      const blocked = Math.floor(this.random() * 3);
      this.addItem('log', blocked, 0);
      this.addItem('bone', (blocked + 1 + Math.floor(this.random() * 2)) % 3, 10);
      return;
    }

    if (name === 'double') {
      [0, 1, 2].forEach((lane) => {
        this.addItem(lane === safeLane ? 'bone' : 'log', lane, 0);
      });
      return;
    }

    if (name === 'switch') {
      const nextLane = safeLane === 2 ? 1 : safeLane + 1;
      this.addItem('bone', safeLane, 0);
      this.addItem('bone', safeLane, 42);
      this.addItem('bone', nextLane, 92);
      this.addItem('log', safeLane, 112);
      return;
    }

    if (name === 'hazards') {
      this.addItem('puddle', safeLane, 0);
      this.addItem('bone', (safeLane + 1) % 3, 20);
      return;
    }

    if (name === 'reward') {
      [0, 1, 2].forEach((lane) => this.addItem('bone', lane, lane * 28));
      return;
    }

    const boneLane = Math.floor(this.random() * 3);
    for (let i = 0; i < 4; i += 1) this.addItem('bone', boneLane, i * 46);
  }

  spawnWave() {
    const phase = this.getPhase();
    const name = phase.templates[Math.floor(this.random() * phase.templates.length)];
    this.spawnTemplate(name);

    if (this.lives < MAX_LIVES && this.elapsed > 20 && this.heartSpawns < MAX_HEART_SPAWNS && this.random() < 0.08) {
      this.addItem('heart', Math.floor(this.random() * 3), 170);
      this.heartSpawns += 1;
    }
    if (this.elapsed > 38 && this.shieldSpawns < 1 && this.shieldTime <= 0 && this.random() < 0.08) {
      this.addItem('shield', Math.floor(this.random() * 3), 210);
      this.shieldSpawns += 1;
    }
  }

  collectBone(item) {
    item.collected = true;
    this.combo += 1;
    this.bonesCollected += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const multiplier = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
    this.score += 10 * multiplier;
    this.addEffect(item.x, item.y, `+${10 * multiplier}`, COLORS.yellow);
    this.audio.play('collect');
  }

  collectHeart(item) {
    item.collected = true;
    this.lives = Math.min(MAX_LIVES, this.lives + 1);
    this.addEffect(item.x, item.y, '+1 ♥', COLORS.red);
    this.audio.play('heart');
  }

  collectShield(item) {
    item.collected = true;
    this.shieldTime = SHIELD_SECONDS;
    this.addEffect(item.x, item.y, '护盾！', '#65a9d8');
    this.audio.play('heart');
  }

  hitObstacle(item) {
    item.collected = true;
    if (this.invincible > 0) return;
    if (this.shieldTime > 0) {
      this.shieldTime = 0;
      this.addEffect(item.x, item.y, '护盾抵挡', '#65a9d8');
      this.audio.play('heart');
      return;
    }
    this.lives -= 1;
    this.combo = 0;
    this.invincible = HIT_INVINCIBLE_SECONDS;
    this.addEffect(item.x, item.y, '-1 ♥', COLORS.red);
    this.audio.play('hit');
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
    if (this.lives <= 0) this.finishGame(false);
  }

  hitPuddle(item) {
    item.collected = true;
    this.slowTime = Math.max(this.slowTime, PUDDLE_SLOW_SECONDS);
    this.addEffect(item.x, item.y, '减速', '#65a9d8');
    this.audio.play('hit');
  }

  addEffect(x, y, text, color) {
    this.effects.push({ x, y, text, color, life: 0.65 });
  }

  finishGame(success) {
    if (this.state !== 'playing') return;
    if (success) {
      this.score += 200;
      if (this.lives === MAX_LIVES) this.score += 100;
    }
    this.score = Math.floor(this.score);
    this.stars = success ? 1 : 0;
    if (success && this.score >= 700) this.stars = 2;
    if (success && this.score >= 1000 && this.lives >= 2) this.stars = 3;
    this.isNewRecord = this.score > this.bestScore;
    this.saveBestScore();
    this.saveCareer(success);
    this.daily.recordGame(this.bonesCollected, success, this.score, this.gameMode === 'daily');
    const growth = this.petGrowth.recordGame(this.runId, success, this.gameMode);
    this.intimacyEarned = growth.gained;
    this.growthLevelUp = growth.levelUp;
    this.growthLevelAfter = growth.after;
    const points = calculatePoints(this.bonesCollected, success, this.lives, MAX_LIVES);
    this.pointsEarned = this.pointsShop.award(this.runId, points);
    this.audio.pauseMusic();
    this.audio.play(success ? 'win' : 'fail');
    this.state = success ? 'success' : 'failed';
  }

  update(delta) {
    if (this.reviewFreeze) return;
    if (this.state === 'frisbee') {
      this.updateFrisbee(delta);
      return;
    }
    if (this.state !== 'playing') return;

    this.animationClock += delta;

    if (this.tutorialVisible) {
      this.roadOffset = (this.roadOffset + 90 * SCALE * delta) % (54 * SCALE);
      this.player.x += (this.player.targetX - this.player.x) * Math.min(1, delta * 10);
      return;
    }

    this.elapsed += delta;
    if (this.elapsed >= GAME_DURATION) {
      this.elapsed = GAME_DURATION;
      this.finishGame(true);
      return;
    }

    const phase = this.getPhase();
    this.shieldTime = Math.max(0, this.shieldTime - delta);
    this.slowTime = Math.max(0, this.slowTime - delta);
    const speed = phase.speed * SCALE * (this.slowTime > 0 ? 0.58 : 1);
    this.roadOffset = (this.roadOffset + speed * delta) % (54 * SCALE);
    this.spawnTimer -= delta;
    this.invincible = Math.max(0, this.invincible - delta);
    this.score += 5 * delta;
    this.player.x += (this.player.targetX - this.player.x) * Math.min(1, delta * 10);

    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = phase.gap;
    }

    this.items.forEach((item) => {
      item.y += speed * delta;
      if (!item.collected && overlaps(this.player, item)) {
        if (item.type === 'bone') this.collectBone(item);
        else if (item.type === 'heart') this.collectHeart(item);
        else if (item.type === 'shield') this.collectShield(item);
        else if (item.type === 'puddle') this.hitPuddle(item);
        else this.hitObstacle(item);
      }

      if (!item.collected && item.type === 'bone' && item.y > HEIGHT + item.radius) {
        item.collected = true;
        this.combo = 0;
      }
    });

    this.items = this.items.filter((item) => !item.collected && item.y < HEIGHT + 80 * SCALE);
    this.effects.forEach((effect) => {
      effect.life -= delta;
      effect.y -= 36 * SCALE * delta;
    });
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  drawBackground() {
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = COLORS.cloud;
    [[55, 65, 28], [WIDTH - 58, 92, 22], [WIDTH * 0.54, 45, 18]].forEach((cloud) => {
      circle(ctx, cloud[0], cloud[1] * SCALE, cloud[2] * SCALE);
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, HEIGHT * 0.14, WIDTH, HEIGHT * 0.86);
    this.drawCrayonScenery();
    ctx.fillStyle = COLORS.roadEdge;
    ctx.fillRect(ROAD_LEFT - 7 * SCALE, HEIGHT * 0.13, ROAD_WIDTH + 14 * SCALE, HEIGHT * 0.87);
    ctx.fillStyle = COLORS.road;
    ctx.fillRect(ROAD_LEFT, HEIGHT * 0.13, ROAD_WIDTH, HEIGHT * 0.87);

    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 3 * SCALE;
    ctx.setLineDash([22 * SCALE, 32 * SCALE]);
    ctx.lineDashOffset = this.roadOffset;
    [ROAD_LEFT + LANE_WIDTH, ROAD_LEFT + LANE_WIDTH * 2].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, HEIGHT * 0.13);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  drawRoomBackground() {
    ctx.fillStyle = '#f8efdf';
    ctx.fillRect(0, 0, WIDTH, HEIGHT * 0.445);
    ctx.fillStyle = '#dfc49b';
    ctx.fillRect(0, HEIGHT * 0.445, WIDTH, HEIGHT * 0.225);
    ctx.fillStyle = '#f4ead9';
    ctx.fillRect(0, HEIGHT * 0.67, WIDTH, HEIGHT * 0.18);
    ctx.fillStyle = '#dcc197';
    ctx.fillRect(0, HEIGHT * 0.85, WIDTH, HEIGHT * 0.15);

    ctx.strokeStyle = 'rgba(139,115,86,0.32)';
    ctx.lineWidth = 3 * SCALE;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT * 0.445);
    ctx.lineTo(WIDTH, HEIGHT * 0.445);
    ctx.stroke();
    ctx.fillStyle = '#f3e3c9';
    ctx.fillRect(0, HEIGHT * 0.435, WIDTH, 10 * SCALE);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#cbbda8';
    ctx.lineWidth = 1.5 * SCALE;
    for (let index = 0; index < 14; index += 1) {
      const x = (24 + (index * 71) % 340) * SCALE;
      const y = (52 + (index * 47) % 260) * SCALE;
      ctx.beginPath();
      ctx.arc(x, y, (2 + index % 3) * SCALE, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(158,123,82,0.25)';
    for (let index = 0; index < 9; index += 1) {
      const y = HEIGHT * 0.48 + index * 16 * SCALE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(WIDTH * 0.5, y + 4 * SCALE, WIDTH, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255,249,233,0.7)';
    roundedRect(ctx, WIDTH * 0.045, HEIGHT * 0.025, WIDTH * 0.91, HEIGHT * 0.155, 20 * SCALE);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,249,233,0.8)';
    roundedRect(ctx, WIDTH * 0.035, HEIGHT * 0.66, WIDTH * 0.93, HEIGHT * 0.15, 20 * SCALE);
    ctx.fill();
  }

  drawFinishApproach() {
    if (this.state !== 'playing' || this.elapsed < 65) return;
    const progress = clamp((this.elapsed - 65) / 10, 0, 1);
    const y = -65 * SCALE + progress * HEIGHT * 0.34;
    const houseX = WIDTH / 2;
    const size = (42 + progress * 18) * SCALE;

    ctx.save();
    ctx.globalAlpha = 0.55 + progress * 0.45;
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#8d8379';
    ctx.lineWidth = 3 * SCALE;
    roundedRect(ctx, houseX - size * 0.62, y, size * 1.24, size * 0.82, 8 * SCALE);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dcae78';
    ctx.beginPath();
    ctx.moveTo(houseX - size * 0.78, y + 4 * SCALE);
    ctx.lineTo(houseX, y - size * 0.55);
    ctx.lineTo(houseX + size * 0.78, y + 4 * SCALE);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#a6c785';
    roundedRect(ctx, houseX - size * 0.17, y + size * 0.36, size * 0.34, size * 0.46, 5 * SCALE);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${(14 + progress * 3) * SCALE}px sans-serif`;
    ctx.fillText('终点', houseX, y + size * 1.16);
    ctx.restore();
  }

  drawCrayonScenery() {
    ctx.save();
    ctx.globalAlpha = 0.75;

    const bushes = [
      [WIDTH * 0.04, HEIGHT * 0.23, 28],
      [WIDTH * 0.08, HEIGHT * 0.38, 22],
      [WIDTH * 0.93, HEIGHT * 0.27, 30],
      [WIDTH * 0.96, HEIGHT * 0.48, 24],
      [WIDTH * 0.05, HEIGHT * 0.68, 25],
      [WIDTH * 0.94, HEIGHT * 0.75, 28],
    ];
    bushes.forEach((bush, index) => {
      ctx.fillStyle = index % 2 ? '#afd58b' : '#9dcc7d';
      circle(ctx, bush[0], bush[1], bush[2] * SCALE);
      circle(ctx, bush[0] + 13 * SCALE, bush[1] + 4 * SCALE, bush[2] * 0.72 * SCALE);
    });

    ctx.strokeStyle = COLORS.grassDark;
    ctx.lineWidth = 2 * SCALE;
    ctx.lineCap = 'round';
    for (let i = 0; i < 18; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side > 0
        ? ROAD_LEFT - (12 + (i % 4) * 7) * SCALE
        : ROAD_LEFT + ROAD_WIDTH + (12 + (i % 4) * 7) * SCALE;
      const y = HEIGHT * 0.19 + i * HEIGHT * 0.043;
      ctx.beginPath();
      ctx.moveTo(x, y + 8 * SCALE);
      ctx.lineTo(x - 5 * SCALE, y);
      ctx.moveTo(x, y + 8 * SCALE);
      ctx.lineTo(x + 5 * SCALE, y + 1 * SCALE);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBone(item) {
    const r = item.radius;
    if (this.itemsImageReady) {
      this.drawItemSprite(0, item.x - r * 1.55, item.y - r * 0.95, r * 3.1, r * 1.9);
      return;
    }
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(-0.55);
    ctx.strokeStyle = COLORS.boneEdge;
    ctx.lineWidth = r * 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.65, 0);
    ctx.lineTo(r * 0.65, 0);
    ctx.stroke();
    ctx.strokeStyle = COLORS.bone;
    ctx.lineWidth = r * 0.52;
    ctx.stroke();
    ctx.fillStyle = COLORS.bone;
    circle(ctx, -r * 0.72, -r * 0.22, r * 0.31);
    circle(ctx, -r * 0.72, r * 0.22, r * 0.31);
    circle(ctx, r * 0.72, -r * 0.22, r * 0.31);
    circle(ctx, r * 0.72, r * 0.22, r * 0.31);
    ctx.restore();
  }

  drawLog(item) {
    const r = item.radius;
    if (this.itemsImageReady) {
      this.drawItemSprite(1, item.x - r * 1.45, item.y - r * 0.82, r * 2.9, r * 1.64);
      return;
    }
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.fillStyle = COLORS.brown;
    roundedRect(ctx, -r, -r * 0.55, r * 2, r * 1.1, r * 0.28);
    ctx.fill();
    ctx.strokeStyle = '#bb7945';
    ctx.lineWidth = 3 * SCALE;
    [-0.45, 0.1, 0.55].forEach((offset) => {
      ctx.beginPath();
      ctx.moveTo(offset * r, -r * 0.48);
      ctx.lineTo((offset - 0.15) * r, r * 0.48);
      ctx.stroke();
    });
    ctx.restore();
  }

  drawHeart(item) {
    if (this.itemsImageReady) {
      this.drawItemSprite(2, item.x - item.radius * 1.25, item.y - item.radius * 1.25, item.radius * 2.5, item.radius * 2.5);
      return;
    }
    ctx.fillStyle = COLORS.red;
    ctx.font = `bold ${item.radius * 2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♥', item.x, item.y);
  }

  drawShield(item) {
    const r = item.radius;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.fillStyle = 'rgba(101,169,216,0.24)';
    ctx.strokeStyle = '#65a9d8';
    ctx.lineWidth = 4 * SCALE;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${r * 1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', 0, 1 * SCALE);
    ctx.restore();
  }

  drawPuddle(item) {
    const r = item.radius;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.fillStyle = 'rgba(101,169,216,0.72)';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2 * SCALE;
    ctx.beginPath();
    ctx.arc(-r * 0.2, 0, r * 0.42, Math.PI * 1.1, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();
  }

  drawItemSprite(index, x, y, width, height) {
    const cellWidth = this.itemsImage.width / 3;
    const crops = [
      { x: 0.1, y: 0.12, width: 0.8, height: 0.7 },
      { x: 0.05, y: 0.16, width: 0.9, height: 0.62 },
      { x: 0.1, y: 0.1, width: 0.8, height: 0.78 },
    ];
    const crop = crops[index];
    ctx.drawImage(
      this.itemsImage,
      cellWidth * index + cellWidth * crop.x,
      this.itemsImage.height * crop.y,
      cellWidth * crop.width,
      this.itemsImage.height * crop.height,
      x,
      y,
      width,
      height
    );
  }

  drawDog() {
    const player = this.player;
    const r = player.radius;
    ctx.save();
    if (this.invincible > 0 && Math.floor(this.invincible * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.translate(player.x, player.y);

    if (this.shieldTime > 0) {
      ctx.fillStyle = 'rgba(101,169,216,0.14)';
      ctx.strokeStyle = 'rgba(101,169,216,0.88)';
      ctx.lineWidth = 3 * SCALE;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (this.dogImageReady) {
      const frame = Math.floor(this.animationClock / 0.14) % 4;
      const equippedIds = Object.values(this.pointsShop.data.equipped);
      this.drawEquippedCosmetics(r, equippedIds, frame, 'back');
      this.drawDogSpriteFrame(frame, -r * 1.9, -r * 2.15, r * 3.8, r * 3.8);
      this.drawEquippedCosmetics(r, equippedIds, frame, 'front');
      this.drawDogStatusFeedback(r);
      ctx.restore();
      return;
    }

    ctx.fillStyle = COLORS.dogDark;
    ctx.beginPath();
    ctx.ellipse(-r * 0.72, -r * 0.45, r * 0.33, r * 0.62, -0.45, 0, Math.PI * 2);
    ctx.ellipse(r * 0.72, -r * 0.45, r * 0.33, r * 0.62, 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.dog;
    circle(ctx, 0, 0, r);
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.2, r * 0.62, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.ink;
    circle(ctx, -r * 0.35, -r * 0.18, r * 0.1);
    circle(ctx, r * 0.35, -r * 0.18, r * 0.1);
    circle(ctx, 0, r * 0.12, r * 0.15);
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    ctx.arc(0, r * 0.27, r * 0.34, 0.2, Math.PI - 0.2);
    ctx.stroke();
    this.drawEquippedCosmetics(r);
    this.drawDogStatusFeedback(r);
    ctx.restore();
  }

  drawDogStatusFeedback(r) {
    if (this.invincible <= 0) return;
    ctx.save();
    ctx.fillStyle = '#f4c84c';
    ctx.font = `bold ${r * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    const sway = Math.sin(this.animationClock * 18) * r * 0.18;
    ctx.fillText('★', -r * 0.55 + sway, -r * 1.42);
    ctx.fillText('★', r * 0.55 + sway, -r * 1.25);
    ctx.restore();
  }

  drawEquippedCosmetics(r, itemIds = Object.values(this.pointsShop.data.equipped), frame = null, layer = 'all') {
    const frameAnchors = [
      { x: -0.02, y: 0, rotation: -0.015 },
      { x: 0.01, y: -0.18, rotation: 0.02 },
      { x: 0, y: 0.01, rotation: -0.015 },
      { x: 0.03, y: -0.18, rotation: 0.02 },
    ];
    const anchor = frame === null ? { x: 0, y: 0, rotation: 0 } : frameAnchors[frame] || frameAnchors[0];
    ctx.save();
    ctx.translate(anchor.x * r, anchor.y * r);
    ctx.rotate(anchor.rotation);
    const has = (id) => itemIds.includes(id);
    const outline = 'rgba(126,119,110,0.72)';
    if (layer !== 'front' && has('star_trail')) {
      const sparkles = [
        [-1.35, 0.66, 0.18, '#f6d878'],
        [-1.05, 0.98, 0.11, '#f1b9aa'],
        [-1.58, 1.08, 0.09, '#a9d3c2'],
      ];
      sparkles.forEach(([x, y, size, color]) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x * r, (y - size) * r);
        ctx.lineTo((x + size * 0.38) * r, (y - size * 0.38) * r);
        ctx.lineTo((x + size) * r, y * r);
        ctx.lineTo((x + size * 0.38) * r, (y + size * 0.38) * r);
        ctx.lineTo(x * r, (y + size) * r);
        ctx.lineTo((x - size * 0.38) * r, (y + size * 0.38) * r);
        ctx.lineTo((x - size) * r, y * r);
        ctx.lineTo((x - size * 0.38) * r, (y - size * 0.38) * r);
        ctx.closePath();
        ctx.fill();
      });
    }
    if (layer !== 'front' && (has('blue_bag') || has('rainbow_set'))) {
      const rainbow = has('rainbow_set');
      ctx.fillStyle = rainbow ? '#b9a6cf' : '#85b8d5';
      ctx.strokeStyle = outline;
      ctx.lineWidth = r * 0.07;
      roundedRect(ctx, r * 0.68, r * 0.08, r * 0.76, r * 0.76, r * 0.22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rainbow ? '#f3c6b9' : '#a9d3e6';
      roundedRect(ctx, r * 0.74, r * 0.16, r * 0.64, r * 0.24, r * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff4df';
      circle(ctx, r * 1.06, r * 0.56, r * 0.12);
      ctx.fillStyle = rainbow ? '#d99fb5' : '#5f98bd';
      circle(ctx, r * 1.06, r * 0.55, r * 0.055);
      circle(ctx, r * 1.0, r * 0.49, r * 0.03);
      circle(ctx, r * 1.12, r * 0.49, r * 0.03);
    }
    if (layer !== 'back' && (has('red_scarf') || has('rainbow_set'))) {
      const rainbow = has('rainbow_set');
      ctx.fillStyle = rainbow ? '#d6b7dc' : '#e9877f';
      ctx.strokeStyle = outline;
      ctx.lineWidth = r * 0.065;
      roundedRect(ctx, -r * 0.72, r * 0.62, r * 1.44, r * 0.2, r * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, r * 0.77);
      ctx.quadraticCurveTo(0, r * 1.02, r * 0.43, r * 0.77);
      ctx.lineTo(r * 0.18, r * 1.08);
      ctx.quadraticCurveTo(0, r * 0.99, -r * 0.22, r * 1.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rainbow ? '#f3c6b9' : '#f4b2a8';
      circle(ctx, 0, r * 0.79, r * 0.1);
    }
    if (layer !== 'back' && (has('yellow_hat') || has('rainbow_set'))) {
      const rainbow = has('rainbow_set');
      ctx.fillStyle = rainbow ? '#a9d3c2' : '#eacb72';
      ctx.strokeStyle = outline;
      ctx.lineWidth = r * 0.07;
      roundedRect(ctx, -r * 1.03, -r * 1.0, r * 2.06, r * 0.2, r * 0.1);
      ctx.fill();
      ctx.stroke();
      roundedRect(ctx, -r * 0.7, -r * 1.5, r * 1.4, r * 0.62, r * 0.24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rainbow ? '#f2b9ad' : '#d89d55';
      roundedRect(ctx, -r * 0.7, -r * 1.08, r * 1.4, r * 0.14, r * 0.05);
      ctx.fill();
      ctx.fillStyle = rainbow ? '#8ebca8' : '#9dbb75';
      ctx.beginPath();
      ctx.ellipse(r * 0.54, -r * 1.39, r * 0.16, r * 0.08, -0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDogSpriteFrame(frame, x, y, width, height) {
    const cellWidth = this.dogImage.width / 4;
    const cropY = this.dogImage.height * 0.1;
    const cropHeight = this.dogImage.height * 0.72;
    ctx.drawImage(
      this.dogImage,
      cellWidth * frame,
      cropY,
      cellWidth,
      cropHeight,
      x,
      y,
      width,
      height
    );
  }

  drawHud() {
    ctx.fillStyle = 'rgba(73,52,38,0.82)';
    roundedRect(ctx, 12 * SCALE, 14 * SCALE, WIDTH - 24 * SCALE, 58 * SCALE, 18 * SCALE);
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`得分 ${Math.floor(this.score)}`, 27 * SCALE, 35 * SCALE);
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillText(`连击 ${this.combo}`, 27 * SCALE, 56 * SCALE);

    ctx.textAlign = 'center';
    ctx.font = `bold ${12 * SCALE}px sans-serif`;
    ctx.fillText(this.gameMode === 'daily' ? '今日挑战' : '小狗探险记', WIDTH / 2, 33 * SCALE);
    ctx.font = `bold ${14 * SCALE}px sans-serif`;
    ctx.fillText(`${Math.ceil(GAME_DURATION - this.elapsed)}秒`, WIDTH / 2, 53 * SCALE);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.red;
    ctx.font = `bold ${19 * SCALE}px sans-serif`;
    ctx.fillText('♥'.repeat(this.lives), WIDTH - 26 * SCALE, 43 * SCALE);

    const progressX = 70 * SCALE;
    const progressY = 88 * SCALE;
    const progressWidth = WIDTH - 168 * SCALE;
    const progress = clamp(this.elapsed / GAME_DURATION, 0, 1);
    ctx.strokeStyle = 'rgba(104,124,83,0.45)';
    ctx.lineWidth = 5 * SCALE;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(progressX, progressY);
    ctx.lineTo(progressX + progressWidth, progressY);
    ctx.stroke();
    ctx.strokeStyle = '#8fb56d';
    ctx.lineWidth = 6 * SCALE;
    ctx.beginPath();
    ctx.moveTo(progressX, progressY);
    ctx.lineTo(progressX + progressWidth * progress, progressY);
    ctx.stroke();
    ctx.fillStyle = '#687c53';
    circle(ctx, progressX + progressWidth * progress, progressY, 5 * SCALE);

    if (this.elapsed >= 65) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#687c53';
      ctx.font = `bold ${14 * SCALE}px sans-serif`;
      ctx.fillText('最后冲刺！', WIDTH / 2, 113 * SCALE);
    }
    if (this.shieldTime > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#65a9d8';
      ctx.font = `bold ${14 * SCALE}px sans-serif`;
      ctx.fillText(`护盾 ${this.shieldTime.toFixed(1)}秒`, WIDTH / 2, (this.elapsed >= 65 ? 132 : 113) * SCALE);
    }
  }

  drawPauseButton() {
    const area = this.getPauseButtonArea();
    ctx.fillStyle = 'rgba(73,52,38,0.86)';
    roundedRect(ctx, area.x, area.y, area.width, area.height, 14 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    const barWidth = 5 * SCALE;
    const barHeight = 19 * SCALE;
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    roundedRect(ctx, centerX - 8 * SCALE, centerY - barHeight / 2, barWidth, barHeight, 2 * SCALE);
    ctx.fill();
    roundedRect(ctx, centerX + 3 * SCALE, centerY - barHeight / 2, barWidth, barHeight, 2 * SCALE);
    ctx.fill();
  }

  drawSoundButton() {
    const area = this.getSoundButtonArea();
    ctx.fillStyle = 'rgba(73,52,38,0.78)';
    roundedRect(ctx, area.x, area.y, area.width, area.height, 14 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${22 * SCALE}px sans-serif`;
    ctx.fillText(this.audio.muted ? '×' : '♪', area.x + area.width / 2, area.y + area.height / 2);
  }

  drawEffects() {
    this.effects.forEach((effect) => {
      ctx.globalAlpha = clamp(effect.life * 2, 0, 1);
      ctx.fillStyle = effect.color;
      ctx.font = `bold ${18 * SCALE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(effect.text, effect.x, effect.y);
    });
    ctx.globalAlpha = 1;
  }

  drawPanel(title, subtitle, buttonText, buttonOffset = 92) {
    const x = WIDTH * 0.09;
    const y = HEIGHT * 0.22;
    const width = WIDTH * 0.82;
    const height = HEIGHT * 0.56;
    ctx.fillStyle = 'rgba(255,249,233,0.96)';
    roundedRect(ctx, x, y, width, height, 28 * SCALE);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${31 * SCALE}px sans-serif`;
    ctx.fillText(title, WIDTH / 2, y + 75 * SCALE);
    ctx.font = `${16 * SCALE}px sans-serif`;
    ctx.fillStyle = '#786454';
    ctx.fillText(subtitle, WIDTH / 2, y + 118 * SCALE);

    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, WIDTH * 0.2, y + height - buttonOffset * SCALE, WIDTH * 0.6, 58 * SCALE, 20 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${20 * SCALE}px sans-serif`;
    ctx.fillText(buttonText, WIDTH / 2, y + height - (buttonOffset - 29) * SCALE);
  }

  drawHome() {
    this.drawPanel('小狗探险记', '收集骨头，躲开木桩', '点击开始');
    if (this.dogImageReady) {
      const dogSize = 124 * SCALE;
      this.drawDogSpriteFrame(0, WIDTH / 2 - dogSize / 2, HEIGHT * 0.41, dogSize, dogSize);
    } else {
      ctx.fillStyle = COLORS.dog;
      circle(ctx, WIDTH / 2, HEIGHT * 0.51, 43 * SCALE);
      ctx.font = `${42 * SCALE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🐶', WIDTH / 2, HEIGHT * 0.525);
    }
    ctx.fillStyle = '#786454';
    ctx.font = `${14 * SCALE}px sans-serif`;
    ctx.fillText('左右滑动切换路线', WIDTH / 2, HEIGHT * 0.62);
    ctx.font = `bold ${16 * SCALE}px sans-serif`;
    ctx.fillText(`骨头币 ${this.pointsShop.data.balance}`, WIDTH / 2, HEIGHT * 0.17);
    ctx.fillStyle = '#786454';
    ctx.font = `${12 * SCALE}px sans-serif`;
    ctx.fillText(`已通关 ${this.career.completions} 次 · 最佳连击 ${this.career.bestCombo}`, WIDTH / 2, HEIGHT * 0.197);
    const shopArea = this.getHomeButtonAreas().shop;
    ctx.fillStyle = 'rgba(255,249,233,0.96)';
    roundedRect(ctx, shopArea.x, shopArea.y, shopArea.width, shopArea.height, 15 * SCALE);
    ctx.fill();
    ctx.strokeStyle = 'rgba(73,52,38,0.25)';
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    ctx.fillText('装扮', shopArea.x + shopArea.width / 2, shopArea.y + shopArea.height / 2);
    const roomArea = this.getHomeButtonAreas().room;
    ctx.fillStyle = 'rgba(255,249,233,0.96)';
    roundedRect(ctx, roomArea.x, roomArea.y, roomArea.width, roomArea.height, 15 * SCALE);
    ctx.fill();
    ctx.strokeStyle = 'rgba(73,52,38,0.25)';
    ctx.stroke();
    ctx.fillStyle = '#8f6f58';
    ctx.fillText('小屋', roomArea.x + roomArea.width / 2, roomArea.y + roomArea.height / 2);
    const dailyArea = this.getHomeButtonAreas().daily;
    ctx.fillStyle = 'rgba(255,249,233,0.96)';
    roundedRect(ctx, dailyArea.x, dailyArea.y, dailyArea.width, dailyArea.height, 15 * SCALE);
    ctx.fill();
    ctx.strokeStyle = 'rgba(73,52,38,0.25)';
    ctx.stroke();
    ctx.fillStyle = '#687c53';
    ctx.fillText('今日挑战', dailyArea.x + dailyArea.width / 2, dailyArea.y + dailyArea.height / 2);
  }

  drawActivities() {
    ctx.fillStyle = 'rgba(255,249,233,0.96)';
    roundedRect(ctx, WIDTH * 0.07, HEIGHT * 0.12, WIDTH * 0.86, HEIGHT * 0.72, 28 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${28 * SCALE}px sans-serif`;
    ctx.fillText('今天玩什么？', WIDTH / 2, HEIGHT * 0.18);
    ctx.font = `${14 * SCALE}px sans-serif`;
    ctx.fillStyle = '#786454';
    ctx.fillText('陪小白狗选一项活动吧', WIDTH / 2, HEIGHT * 0.225);
    const areas = this.getActivitiesAreas();
    const cards = [
      [areas.runner, '#d9edc1', '森林探险', '75秒 · 收集骨头、躲开障碍', '跑'],
      [areas.frisbee, '#d8edf0', '接飞盘', '40秒 · 连续接住、避开泥团', '盘'],
    ];
    cards.forEach(([area, color, title, subtitle, icon]) => {
      ctx.fillStyle = color;
      roundedRect(ctx, area.x, area.y, area.width, area.height, 22 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(73,52,38,0.18)';
      ctx.lineWidth = 2 * SCALE;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,249,233,0.8)';
      circle(ctx, area.x + 48 * SCALE, area.y + area.height / 2, 30 * SCALE);
      ctx.fillStyle = COLORS.ink;
      ctx.font = `bold ${22 * SCALE}px sans-serif`;
      ctx.fillText(icon, area.x + 48 * SCALE, area.y + area.height / 2);
      ctx.textAlign = 'left';
      ctx.font = `bold ${21 * SCALE}px sans-serif`;
      ctx.fillText(title, area.x + 92 * SCALE, area.y + 42 * SCALE);
      ctx.font = `${13 * SCALE}px sans-serif`;
      ctx.fillStyle = '#786454';
      ctx.fillText(subtitle, area.x + 92 * SCALE, area.y + 76 * SCALE);
      ctx.textAlign = 'center';
    });
    ctx.fillStyle = '#786454';
    ctx.font = `bold ${15 * SCALE}px sans-serif`;
    ctx.fillText('返回小屋', WIDTH / 2, areas.back.y + areas.back.height / 2);
  }

  drawFrisbeeBackground() {
    ctx.fillStyle = '#dff3f5';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#f8f0d8';
    circle(ctx, WIDTH * 0.82, HEIGHT * 0.14, 34 * SCALE);
    ctx.fillStyle = '#cbe5a9';
    ctx.fillRect(0, HEIGHT * 0.2, WIDTH, HEIGHT * 0.8);
    ctx.fillStyle = '#aed18c';
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT * 0.35);
    ctx.quadraticCurveTo(WIDTH * 0.25, HEIGHT * 0.28, WIDTH * 0.5, HEIGHT * 0.36);
    ctx.quadraticCurveTo(WIDTH * 0.78, HEIGHT * 0.27, WIDTH, HEIGHT * 0.35);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.lineTo(0, HEIGHT);
    ctx.closePath();
    ctx.fill();
    LANES.forEach((x) => {
      ctx.fillStyle = 'rgba(255,249,233,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, HEIGHT * 0.79, 43 * SCALE, 16 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#7fa864';
    for (let index = 0; index < 12; index += 1) {
      const x = (index * 47 + 19) % WIDTH;
      ctx.fillRect(x, HEIGHT * (0.38 + (index % 4) * 0.14), 2 * SCALE, 10 * SCALE);
    }
  }

  drawFrisbeeItem(item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(Math.sin(this.animationClock * 7 + item.phase) * 0.25);
    if (item.type === 'tennis') {
      ctx.fillStyle = '#ead45d';
      circle(ctx, 0, 0, item.radius);
      ctx.strokeStyle = '#fff9e9';
      ctx.lineWidth = 3 * SCALE;
      ctx.beginPath();
      ctx.arc(0, 0, item.radius * 0.72, -1.2, 1.2);
      ctx.stroke();
    } else if (item.type === 'mud') {
      ctx.fillStyle = '#8c6045';
      circle(ctx, 0, 0, item.radius);
      ctx.fillStyle = '#a97a59';
      circle(ctx, -item.radius * 0.35, -item.radius * 0.2, item.radius * 0.22);
      circle(ctx, item.radius * 0.28, item.radius * 0.18, item.radius * 0.16);
    } else {
      ctx.fillStyle = '#78aacb';
      ctx.strokeStyle = '#4f7f9e';
      ctx.lineWidth = 3 * SCALE;
      ctx.beginPath();
      ctx.ellipse(0, 0, item.radius * 1.25, item.radius * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b9d8e8';
      ctx.beginPath();
      ctx.ellipse(0, 0, item.radius * 0.58, item.radius * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFrisbeeHud() {
    ctx.fillStyle = 'rgba(73,52,38,0.82)';
    roundedRect(ctx, 12 * SCALE, 14 * SCALE, WIDTH - 24 * SCALE, 58 * SCALE, 18 * SCALE);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = 'left';
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    ctx.fillText(`得分 ${this.score}`, 27 * SCALE, 35 * SCALE);
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillText(`连击 ${this.combo} · ×${this.frisbeeMultiplier()}`, 27 * SCALE, 56 * SCALE);
    ctx.textAlign = 'center';
    ctx.font = `bold ${13 * SCALE}px sans-serif`;
    ctx.fillText('接飞盘', WIDTH / 2, 34 * SCALE);
    ctx.fillText(`${Math.ceil(FRISBEE_DURATION - this.elapsed)}秒`, WIDTH / 2, 55 * SCALE);
  }

  drawFrisbeeTutorial() {
    ctx.fillStyle = 'rgba(255,249,233,0.94)';
    roundedRect(ctx, WIDTH * 0.16, HEIGHT * 0.39, WIDTH * 0.68, 76 * SCALE, 20 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    ctx.fillText('按住不松手，左右滑动', WIDTH / 2, HEIGHT * 0.425);
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillStyle = '#786454';
    ctx.fillText('移动小狗去接住飞盘', WIDTH / 2, HEIGHT * 0.465);
  }

  drawFrisbeeResult() {
    this.drawPanel('接飞盘完成！', `本局 ${this.score} 分 · 最高连击 ${this.bestCombo}`, '再玩一次', 86);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.yellow;
    ctx.font = `bold ${32 * SCALE}px sans-serif`;
    ctx.fillText([0, 1, 2].map((index) => index < this.stars ? '★' : '☆').join(' '), WIDTH / 2, HEIGHT * 0.47);
    ctx.fillStyle = '#687c53';
    ctx.font = `bold ${15 * SCALE}px sans-serif`;
    ctx.fillText(`接住 ${this.caughtCount} 个 · 漏掉 ${this.frisbeeMisses} 个`, WIDTH / 2, HEIGHT * 0.53);
    ctx.fillText(`+${this.pointsEarned} 骨头币 · 亲密 +${this.intimacyEarned}`, WIDTH / 2, HEIGHT * 0.575);
    const areas = this.getFrisbeeResultAreas();
    [[areas.home, '回小屋'], [areas.activities, '换个活动']].forEach(([area, label]) => {
      ctx.fillStyle = 'rgba(159,189,126,0.24)';
      roundedRect(ctx, area.x, area.y, area.width, area.height, 14 * SCALE);
      ctx.fill();
      ctx.fillStyle = '#687c53';
      ctx.font = `bold ${15 * SCALE}px sans-serif`;
      ctx.fillText(label, area.x + area.width / 2, area.y + area.height / 2);
    });
  }

  drawResult() {
    const success = this.state === 'success';
    this.drawPanel(success ? '找到宝藏啦！' : '差一点点！', `本局 ${this.score} 分 · 最佳 ${this.bestScore}`, '再玩一次', 112);
    ctx.textAlign = 'center';
    this.drawResultCharacter(success);
    this.drawTreasureChest(success);

    ctx.font = `bold ${30 * SCALE}px sans-serif`;
    const stars = [0, 1, 2].map((index) => (index < this.stars ? '★' : '☆')).join(' ');
    ctx.fillStyle = success ? COLORS.yellow : '#a79586';
    ctx.fillText(success ? stars : '再试一次', WIDTH / 2, HEIGHT * 0.525);
    ctx.fillStyle = '#786454';
    ctx.font = `${15 * SCALE}px sans-serif`;
    ctx.fillText(`最高连击 ${this.bestCombo}`, WIDTH / 2, HEIGHT * 0.565);
    ctx.fillStyle = '#687c53';
    ctx.font = `bold ${15 * SCALE}px sans-serif`;
    ctx.fillText(`+${this.pointsEarned} 骨头币 · 亲密 +${this.intimacyEarned || 0}`, WIDTH / 2, HEIGHT * 0.6);

    if (this.isNewRecord || this.growthLevelUp) {
      ctx.fillStyle = '#d99d25';
      ctx.font = `bold ${16 * SCALE}px sans-serif`;
      const highlights = [];
      if (this.isNewRecord) highlights.push('新纪录');
      if (this.growthLevelUp) highlights.push(`亲密升到Lv.${this.growthLevelAfter}`);
      ctx.fillText(`★ ${highlights.join(' · ')}！`, WIDTH / 2, HEIGHT * 0.425);
    }

    const resultAreas = this.getResultButtonAreas();
    const buttons = [
      [resultAreas.home, '小屋'],
      [resultAreas.shop, this.gameMode === 'daily' ? '今日' : '装扮'],
      [resultAreas.share, '分享'],
    ];
    ctx.fillStyle = 'rgba(159,189,126,0.22)';
    buttons.forEach(([area, label]) => {
      ctx.fillStyle = 'rgba(159,189,126,0.22)';
      roundedRect(ctx, area.x, area.y, area.width, area.height, 12 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(104,124,83,0.45)';
      ctx.lineWidth = 1.5 * SCALE;
      ctx.stroke();
      ctx.fillStyle = '#687c53';
      ctx.font = `bold ${14 * SCALE}px sans-serif`;
      ctx.fillText(label, area.x + area.width / 2, area.y + area.height / 2);
    });
  }

  drawPaused() {
    ctx.fillStyle = 'rgba(40,30,22,0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${30 * SCALE}px sans-serif`;
    ctx.fillText('探险暂停', WIDTH / 2, HEIGHT * 0.4);

    const areas = this.getPausedButtonAreas();
    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, areas.continue.x, areas.continue.y, areas.continue.width, areas.continue.height, 20 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${20 * SCALE}px sans-serif`;
    ctx.fillText('继续游戏', WIDTH / 2, areas.continue.y + areas.continue.height / 2);

    ctx.fillStyle = 'rgba(255,249,233,0.94)';
    roundedRect(ctx, areas.home.x, areas.home.y, areas.home.width, areas.home.height, 20 * SCALE);
    ctx.fill();
    ctx.strokeStyle = 'rgba(73,52,38,0.25)';
    ctx.lineWidth = 2 * SCALE;
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${18 * SCALE}px sans-serif`;
    ctx.fillText('返回首页', WIDTH / 2, areas.home.y + areas.home.height / 2);
  }

  drawTutorial() {
    const centerY = HEIGHT * 0.58;
    const pulse = 8 * SCALE * Math.sin(Date.now() / 220);
    ctx.fillStyle = 'rgba(43,32,24,0.58)';
    roundedRect(ctx, WIDTH * 0.13, HEIGHT * 0.43, WIDTH * 0.74, 126 * SCALE, 22 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${20 * SCALE}px sans-serif`;
    ctx.fillText('左右滑动，帮助小狗换路', WIDTH / 2, HEIGHT * 0.49);
    ctx.font = `bold ${40 * SCALE}px sans-serif`;
    ctx.fillText('←', WIDTH * 0.31 - pulse, centerY);
    ctx.fillText('☝', WIDTH / 2, centerY + 5 * SCALE);
    ctx.fillText('→', WIDTH * 0.69 + pulse, centerY);
  }

  drawShop() {
    ctx.fillStyle = 'rgba(255,249,233,0.97)';
    roundedRect(ctx, WIDTH * 0.06, HEIGHT * 0.08, WIDTH * 0.88, HEIGHT * 0.82, 26 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${28 * SCALE}px sans-serif`;
    ctx.fillText('小狗装扮', WIDTH / 2, HEIGHT * 0.125);
    ctx.font = `bold ${15 * SCALE}px sans-serif`;
    ctx.fillText(`骨头币 ${this.pointsShop.data.balance}`, WIDTH / 2, HEIGHT * 0.165);

    const previewItem = SHOP_ITEMS.find((item) => item.id === this.selectedShopItem);
    this.drawShopDogPreview(previewItem);

    const areas = this.getShopAreas();
    areas.rows.forEach(({ item, x, y, width, height }) => {
      const selected = item.id === this.selectedShopItem;
      ctx.fillStyle = selected ? 'rgba(159,189,126,0.35)' : 'rgba(159,189,126,0.12)';
      roundedRect(ctx, x, y, width, height, 13 * SCALE);
      ctx.fill();
      this.drawShopItemIcon(item, x + 25 * SCALE, y + height / 2, 10 * SCALE);
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.ink;
      ctx.font = `bold ${15 * SCALE}px sans-serif`;
      ctx.fillText(item.name, x + 45 * SCALE, y + height / 2);
      ctx.textAlign = 'right';
      ctx.font = `${14 * SCALE}px sans-serif`;
      const equipped = this.pointsShop.isEquipped(item.id);
      ctx.fillText(equipped ? '使用中' : (this.pointsShop.isOwned(item.id) ? '已拥有' : `${item.price}币`), x + width - 15 * SCALE, y + height / 2);
    });

    const selected = previewItem;
    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, areas.action.x, areas.action.y, areas.action.width, areas.action.height, 18 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = 'center';
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    const actionLabel = this.pointsShop.isEquipped(selected.id)
      ? '卸下装扮'
      : this.pointsShop.isOwned(selected.id) ? '穿戴' : `用 ${selected.price} 骨头币兑换`;
    ctx.fillText(actionLabel, WIDTH / 2, areas.action.y + areas.action.height / 2);
    ctx.fillStyle = '#786454';
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillText(this.shopMessage, WIDTH / 2, HEIGHT * 0.79);
    ctx.fillText('返回首页', WIDTH / 2, areas.back.y + areas.back.height / 2);
    if (this.pendingExchangeItem) this.drawExchangeConfirmation(areas);
  }

  drawRoom() {
    this.petGrowth.ensureToday();
    const growth = this.petGrowth.status();
    this.drawRoomFurniture(growth.level);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${25 * SCALE}px sans-serif`;
    ctx.fillText('小狗小屋', WIDTH / 2, HEIGHT * 0.06);
    ctx.font = `bold ${14 * SCALE}px sans-serif`;
    ctx.fillStyle = '#786454';
    ctx.fillText(`亲密 Lv.${growth.level}`, WIDTH / 2, HEIGHT * 0.095);

    const progressX = WIDTH * 0.24;
    const progressY = HEIGHT * 0.13;
    const progressWidth = WIDTH * 0.52;
    ctx.strokeStyle = 'rgba(126,119,110,0.22)';
    ctx.lineWidth = 8 * SCALE;
    ctx.beginPath();
    ctx.moveTo(progressX, progressY);
    ctx.lineTo(progressX + progressWidth, progressY);
    ctx.stroke();
    if (growth.level < 10) {
      ctx.strokeStyle = '#e7a89e';
      ctx.lineWidth = 8 * SCALE;
      ctx.beginPath();
      ctx.moveTo(progressX, progressY);
      ctx.lineTo(progressX + progressWidth * (growth.current / growth.needed), progressY);
      ctx.stroke();
    }
    ctx.fillStyle = '#786454';
    ctx.font = `${11 * SCALE}px sans-serif`;
    ctx.fillText(growth.level >= 10 ? '亲密满级' : `${growth.current}/${growth.needed}`, WIDTH / 2, HEIGHT * 0.13);

    if (this.isDebugToolsEnabled()) {
      const debug = this.getRoomAreas().debug;
      ctx.fillStyle = 'rgba(126,119,110,0.16)';
      roundedRect(ctx, debug.x, debug.y, debug.width, debug.height, 10 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,119,110,0.35)';
      ctx.lineWidth = 1 * SCALE;
      ctx.stroke();
      ctx.fillStyle = '#786454';
      ctx.textAlign = 'center';
      ctx.font = `bold ${11 * SCALE}px sans-serif`;
      ctx.fillText('测试 +100币', debug.x + debug.width / 2, debug.y + debug.height / 2);
    }

    const animationActive = Date.now() < this.roomAnimationUntil;
    const animationPhase = animationActive ? 1 - (this.roomAnimationUntil - Date.now()) / 1200 : 0;
    const dogBounce = animationActive ? Math.sin(animationPhase * Math.PI * 4) * 5 * SCALE : 0;
    const dogTilt = animationActive && this.roomAnimationType === 'play' ? Math.sin(animationPhase * Math.PI * 3) * 0.08 : 0;
    const r = 33 * SCALE;
    ctx.save();
    ctx.translate(WIDTH * 0.507, HEIGHT * 0.515 + dogBounce);
    ctx.rotate(dogTilt);
    const equippedIds = Object.values(this.pointsShop.data.equipped);
    this.drawEquippedCosmetics(r, equippedIds, 0, 'back');
    if (this.dogImageReady) this.drawDogSpriteFrame(0, -r * 1.9, -r * 2.15, r * 3.8, r * 3.8);
    else {
      ctx.fillStyle = COLORS.dog;
      circle(ctx, 0, 0, r);
    }
    this.drawEquippedCosmetics(r, equippedIds, 0, 'front');
    if (growth.level >= 10) {
      ctx.fillStyle = '#f1c85b';
      ctx.strokeStyle = '#a98745';
      ctx.lineWidth = 2 * SCALE;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 1.23);
      ctx.lineTo(-r * 0.32, -r * 1.62);
      ctx.lineTo(0, -r * 1.32);
      ctx.lineTo(r * 0.32, -r * 1.62);
      ctx.lineTo(r * 0.55, -r * 1.23);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (animationActive) this.drawRoomInteractionEffect(this.roomAnimationType, animationPhase);

    const stamps = [
      ['饱饱', this.petGrowth.data.feedCount > 0],
      ['开心', this.petGrowth.data.played],
      ['香香', this.petGrowth.data.bathed],
    ];
    stamps.forEach(([label, done], index) => {
      const stampX = WIDTH * (0.28 + index * 0.22);
      ctx.fillStyle = done ? 'rgba(231,168,158,0.72)' : 'rgba(255,249,233,0.72)';
      roundedRect(ctx, stampX - 30 * SCALE, HEIGHT * 0.145, 60 * SCALE, 22 * SCALE, 10 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,119,110,0.24)';
      ctx.lineWidth = 1 * SCALE;
      ctx.stroke();
      ctx.fillStyle = done ? '#fff9e9' : '#8d8175';
      ctx.font = `bold ${11 * SCALE}px sans-serif`;
      ctx.fillText(`${done ? '✓ ' : ''}${label}`, stampX, HEIGHT * 0.145 + 11 * SCALE);
    });

    const areas = this.getRoomAreas();
    areas.care.forEach((area) => {
      ctx.fillStyle = area.type === 'feed' ? '#eacb72' : area.type === 'play' ? '#a9d3c2' : '#a9cde2';
      roundedRect(ctx, area.x, area.y, area.width, area.height, 16 * SCALE);
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.font = `bold ${16 * SCALE}px sans-serif`;
      ctx.fillText(area.label, area.x + area.width / 2, area.y + area.height / 2 - 6 * SCALE);
      ctx.font = `${10 * SCALE}px sans-serif`;
      const note = area.type === 'feed' ? (this.petGrowth.data.feedCount < 3 ? '5骨头币' : '已满足') : '每日首次成长';
      ctx.fillText(note, area.x + area.width / 2, area.y + area.height / 2 + 12 * SCALE);
    });

    ctx.fillStyle = '#786454';
    ctx.font = `${12 * SCALE}px sans-serif`;
    ctx.fillText(this.roomMessage, WIDTH / 2, HEIGHT * 0.805);

    const nav = [
      [areas.adventure, '去玩'],
      [areas.shop, '装扮'],
      [areas.daily, '今日'],
    ];
    nav.forEach(([area, label]) => {
      ctx.fillStyle = 'rgba(255,249,233,0.95)';
      roundedRect(ctx, area.x, area.y, area.width, area.height, 15 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(73,52,38,0.25)';
      ctx.stroke();
      ctx.fillStyle = '#687c53';
      ctx.font = `bold ${14 * SCALE}px sans-serif`;
      ctx.fillText(label, area.x + area.width / 2, area.y + area.height / 2);
    });
    if (this.petGrowth.data.onboardingStep < 4) this.drawGrowthOnboarding(areas);
    if (this.pendingUnlockLevel) this.drawUnlockModal();
  }

  drawRoomInteractionEffect(type, phase) {
    ctx.save();
    if (type === 'play') {
      const x = WIDTH * (0.35 + phase * 0.3);
      const y = HEIGHT * 0.56 - Math.sin(phase * Math.PI) * 70 * SCALE;
      ctx.fillStyle = '#e9877f';
      circle(ctx, x, y, 11 * SCALE);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      circle(ctx, x - 3 * SCALE, y - 3 * SCALE, 3 * SCALE);
    } else if (type === 'bath') {
      for (let index = 0; index < 7; index += 1) {
        const angle = phase * Math.PI * 2 + index;
        const distance = (28 + index * 3) * SCALE;
        ctx.fillStyle = 'rgba(169,205,226,0.45)';
        ctx.strokeStyle = 'rgba(101,169,216,0.65)';
        ctx.beginPath();
        ctx.arc(WIDTH * 0.507 + Math.cos(angle) * distance, HEIGHT * 0.515 + Math.sin(angle) * distance, (4 + index % 3) * SCALE, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (type === 'feed') {
      ctx.fillStyle = '#d6a56c';
      ctx.font = `bold ${22 * SCALE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1 - phase * 0.6;
      ctx.fillText('●', WIDTH * 0.507 + Math.sin(phase * 8) * 10 * SCALE, HEIGHT * (0.59 - phase * 0.08));
      ctx.fillStyle = '#e7a89e';
      ctx.fillText('♥', WIDTH * 0.507 + 30 * SCALE, HEIGHT * 0.46 - phase * 20 * SCALE);
    }
    ctx.restore();
  }

  drawGrowthOnboarding(areas) {
    const step = this.petGrowth.data.onboardingStep;
    const target = step === 0
      ? areas.care.find((area) => area.type === 'play')
      : step === 1 ? areas.adventure
        : step === 3 ? areas.care.find((area) => area.type === 'feed') : null;
    if (!target) return;
    const textMap = {
      0: '先点击“玩耍”，和小白狗认识一下',
      1: '它想出去看看，带它完成第一次探险吧',
      3: '欢迎回家！第一次喂食免费',
    };
    const pulse = 3 * SCALE + Math.sin(Date.now() / 180) * 2 * SCALE;
    ctx.strokeStyle = '#e9877f';
    ctx.lineWidth = pulse;
    roundedRect(ctx, target.x - 4 * SCALE, target.y - 4 * SCALE, target.width + 8 * SCALE, target.height + 8 * SCALE, 18 * SCALE);
    ctx.stroke();
    ctx.fillStyle = 'rgba(73,52,38,0.86)';
    roundedRect(ctx, WIDTH * 0.1, HEIGHT * 0.59, WIDTH * 0.8, 43 * SCALE, 15 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = 'center';
    ctx.font = `bold ${13 * SCALE}px sans-serif`;
    ctx.fillText(textMap[step], WIDTH / 2, HEIGHT * 0.59 + 21 * SCALE);
  }

  drawUnlockModal() {
    const close = this.getUnlockCloseArea();
    ctx.fillStyle = 'rgba(40,30,22,0.58)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(255,249,233,0.98)';
    roundedRect(ctx, WIDTH * 0.1, HEIGHT * 0.3, WIDTH * 0.8, HEIGHT * 0.4, 24 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d99d25';
    ctx.font = `bold ${26 * SCALE}px sans-serif`;
    ctx.fillText(`亲密 Lv.${this.pendingUnlockLevel}`, WIDTH / 2, HEIGHT * 0.38);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${20 * SCALE}px sans-serif`;
    ctx.fillText(`解锁：${this.unlockName(this.pendingUnlockLevel)}`, WIDTH / 2, HEIGHT * 0.48);
    ctx.fillStyle = '#786454';
    ctx.font = `${14 * SCALE}px sans-serif`;
    ctx.fillText('小屋又变得更温暖啦', WIDTH / 2, HEIGHT * 0.55);
    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, close.x, close.y, close.width, close.height, 18 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${18 * SCALE}px sans-serif`;
    ctx.fillText('开心收下', WIDTH / 2, close.y + close.height / 2);
  }

  drawRoomFurniture(level) {
    if (level >= 8) {
      ctx.fillStyle = 'rgba(169,211,194,0.48)';
      ctx.strokeStyle = 'rgba(113,158,139,0.35)';
      ctx.lineWidth = 2 * SCALE;
      ctx.beginPath();
      ctx.ellipse(WIDTH * 0.507, HEIGHT * 0.592, WIDTH * 0.273, 36 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (level >= 9) {
      ctx.strokeStyle = '#d9a85f';
      ctx.lineWidth = 2 * SCALE;
      ctx.beginPath();
      ctx.moveTo(WIDTH * 0.1, HEIGHT * 0.195);
      ctx.quadraticCurveTo(WIDTH / 2, HEIGHT * 0.25, WIDTH * 0.9, HEIGHT * 0.195);
      ctx.stroke();
      [0.18, 0.31, 0.44, 0.57, 0.7, 0.82].forEach((ratio, index) => {
        ctx.fillStyle = index % 2 ? '#e7a89e' : '#f1c85b';
        circle(ctx, WIDTH * ratio, HEIGHT * (0.21 + Math.abs(0.5 - ratio) * 0.05), 4 * SCALE);
      });
    }
    if (level >= 5) {
      ctx.fillStyle = '#dff3f5';
      ctx.strokeStyle = '#b59d7a';
      ctx.lineWidth = 4 * SCALE;
      roundedRect(ctx, WIDTH * 0.733, HEIGHT * 0.195, WIDTH * 0.187, HEIGHT * 0.165, 8 * SCALE);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(WIDTH * 0.8265, HEIGHT * 0.195);
      ctx.lineTo(WIDTH * 0.8265, HEIGHT * 0.36);
      ctx.stroke();
    }
    if (level >= 2) {
      const bedX = WIDTH * 0.208;
      const bedY = HEIGHT * 0.562;
      ctx.fillStyle = '#cba879';
      ctx.strokeStyle = 'rgba(126,105,82,0.72)';
      ctx.lineWidth = 2.5 * SCALE;
      ctx.beginPath();
      ctx.ellipse(bedX, bedY, 53 * SCALE, 22 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4d6cf';
      ctx.beginPath();
      ctx.ellipse(bedX, bedY - 5 * SCALE, 41 * SCALE, 14 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(178,132,121,0.55)';
      ctx.lineWidth = 2 * SCALE;
      ctx.stroke();
      ctx.fillStyle = '#d8b789';
      roundedRect(ctx, bedX - 53 * SCALE, bedY + 1 * SCALE, 106 * SCALE, 20 * SCALE, 10 * SCALE);
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,105,82,0.72)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,241,217,0.65)';
      ctx.lineWidth = 1.5 * SCALE;
      [-27, -9, 9, 27].forEach((offset) => {
        ctx.beginPath();
        ctx.moveTo(bedX + offset * SCALE, bedY + 5 * SCALE);
        ctx.lineTo(bedX + (offset + 5) * SCALE, bedY + 14 * SCALE);
        ctx.stroke();
      });
      ctx.fillStyle = '#fff1d7';
      circle(ctx, bedX, bedY + 10 * SCALE, 4 * SCALE);
      circle(ctx, bedX - 5 * SCALE, bedY + 6 * SCALE, 2.2 * SCALE);
      circle(ctx, bedX, bedY + 4.5 * SCALE, 2.2 * SCALE);
      circle(ctx, bedX + 5 * SCALE, bedY + 6 * SCALE, 2.2 * SCALE);
      ctx.fillStyle = '#fff3de';
      ctx.beginPath();
      ctx.moveTo(bedX + 17 * SCALE, bedY - 12 * SCALE);
      ctx.quadraticCurveTo(bedX + 36 * SCALE, bedY - 5 * SCALE, bedX + 28 * SCALE, bedY + 7 * SCALE);
      ctx.lineTo(bedX + 8 * SCALE, bedY + 1 * SCALE);
      ctx.closePath();
      ctx.fill();
    }
    if (level >= 3) {
      const bowlX = WIDTH * 0.8;
      const bowlY = HEIGHT * 0.585;
      ctx.fillStyle = 'rgba(126,105,82,0.16)';
      ctx.beginPath();
      ctx.ellipse(bowlX, bowlY + 11 * SCALE, 31 * SCALE, 8 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e7bd5f';
      ctx.strokeStyle = 'rgba(126,105,82,0.7)';
      ctx.lineWidth = 2 * SCALE;
      ctx.beginPath();
      ctx.moveTo(bowlX - 27 * SCALE, bowlY - 5 * SCALE);
      ctx.lineTo(bowlX + 27 * SCALE, bowlY - 5 * SCALE);
      ctx.lineTo(bowlX + 20 * SCALE, bowlY + 14 * SCALE);
      ctx.quadraticCurveTo(bowlX, bowlY + 20 * SCALE, bowlX - 20 * SCALE, bowlY + 14 * SCALE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f5d985';
      ctx.beginPath();
      ctx.ellipse(bowlX, bowlY - 5 * SCALE, 28 * SCALE, 7 * SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff4df';
      ctx.font = `bold ${12 * SCALE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('骨', bowlX, bowlY + 8 * SCALE);
    }
    if (level >= 7) {
      ctx.fillStyle = '#fff9e9';
      ctx.strokeStyle = '#b59d7a';
      roundedRect(ctx, WIDTH * 0.093, HEIGHT * 0.217, WIDTH * 0.187, HEIGHT * 0.12, 5 * SCALE);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e7a89e';
      ctx.font = `bold ${20 * SCALE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('♥', WIDTH * 0.1865, HEIGHT * 0.277);
    }
  }

  drawDaily() {
    this.daily.ensureToday();
    ctx.fillStyle = 'rgba(255,249,233,0.97)';
    roundedRect(ctx, WIDTH * 0.06, HEIGHT * 0.07, WIDTH * 0.88, HEIGHT * 0.84, 26 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${27 * SCALE}px sans-serif`;
    ctx.fillText('今日探险', WIDTH / 2, HEIGHT * 0.12);
    ctx.fillStyle = '#687c53';
    ctx.font = `bold ${15 * SCALE}px sans-serif`;
    ctx.fillText(`今日挑战最高 ${this.daily.data.bestScore} 分`, WIDTH / 2, HEIGHT * 0.17);
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillText(`骨头币 ${this.pointsShop.data.balance} · 每天任务会重置`, WIDTH / 2, HEIGHT * 0.21);

    const areas = this.getDailyAreas();
    areas.tasks.forEach(({ task, x, y, width, height }) => {
      const state = this.daily.taskState(task);
      ctx.fillStyle = state.claimed ? 'rgba(159,189,126,0.16)' : (state.complete ? 'rgba(244,200,76,0.22)' : 'rgba(159,189,126,0.12)');
      roundedRect(ctx, x, y, width, height, 14 * SCALE);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.ink;
      ctx.font = `bold ${15 * SCALE}px sans-serif`;
      ctx.fillText(task.name, x + 16 * SCALE, y + 20 * SCALE);
      ctx.font = `${12 * SCALE}px sans-serif`;
      ctx.fillStyle = '#786454';
      ctx.fillText(`${task.description}  ${state.progress}/${task.target}`, x + 16 * SCALE, y + 43 * SCALE);
      ctx.textAlign = 'right';
      ctx.fillStyle = state.claimed ? '#8b8b7d' : '#687c53';
      ctx.font = `bold ${13 * SCALE}px sans-serif`;
      ctx.fillText(state.claimed ? '已领取' : (state.complete ? `领取 +${task.reward}` : `+${task.reward}币`), x + width - 14 * SCALE, y + height / 2);
    });

    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, areas.start.x, areas.start.y, areas.start.width, areas.start.height, 19 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.textAlign = 'center';
    ctx.font = `bold ${19 * SCALE}px sans-serif`;
    ctx.fillText('开始今日挑战', WIDTH / 2, areas.start.y + areas.start.height / 2);
    ctx.fillStyle = '#786454';
    ctx.font = `${13 * SCALE}px sans-serif`;
    ctx.fillText(this.dailyMessage, WIDTH / 2, HEIGHT * 0.765);
    ctx.fillText('返回首页', WIDTH / 2, areas.back.y + areas.back.height / 2);
  }

  drawShopDogPreview(item) {
    const r = 18 * SCALE;
    ctx.save();
    ctx.translate(WIDTH * 0.24, HEIGHT * 0.19);
    if (this.dogImageReady) {
      this.drawEquippedCosmetics(r, [item.id], 0, 'back');
      this.drawDogSpriteFrame(0, -r * 1.9, -r * 2.15, r * 3.8, r * 3.8);
    } else {
      ctx.fillStyle = COLORS.dog;
      circle(ctx, 0, 0, r);
    }
    this.drawEquippedCosmetics(r, [item.id], 0, 'front');
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${14 * SCALE}px sans-serif`;
    ctx.fillText(`试穿：${item.name}`, WIDTH * 0.36, HEIGHT * 0.19);
  }

  drawResultCharacter(success) {
    const r = 18 * SCALE;
    ctx.save();
    ctx.translate(WIDTH * 0.36, HEIGHT * 0.475);
    if (!success) {
      ctx.rotate(-0.12);
      ctx.globalAlpha = 0.78;
    }
    const resultFrame = success ? 1 : 0;
    const equippedIds = Object.values(this.pointsShop.data.equipped);
    if (this.dogImageReady) {
      this.drawEquippedCosmetics(r, equippedIds, resultFrame, 'back');
      this.drawDogSpriteFrame(resultFrame, -r * 1.9, -r * 2.15, r * 3.8, r * 3.8);
    }
    else {
      ctx.fillStyle = COLORS.dog;
      circle(ctx, 0, 0, r);
    }
    this.drawEquippedCosmetics(r, equippedIds, resultFrame, 'front');
    if (!success) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#a79586';
      ctx.font = `bold ${12 * SCALE}px sans-serif`;
      ctx.fillText('…', r * 0.9, -r * 0.8);
    }
    ctx.restore();
  }

  drawTreasureChest(success) {
    const x = WIDTH * 0.63;
    const y = HEIGHT * 0.455;
    const size = 34 * SCALE;
    ctx.save();
    ctx.globalAlpha = success ? 1 : 0.45;
    ctx.fillStyle = this.stars >= 3 ? '#f4c84c' : this.stars >= 2 ? '#d9b06f' : '#a97950';
    roundedRect(ctx, x - size * 0.7, y, size * 1.4, size * 0.78, 6 * SCALE);
    ctx.fill();
    ctx.strokeStyle = '#87522f';
    ctx.lineWidth = 3 * SCALE;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, size * 0.7, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3a8';
    ctx.fillRect(x - 4 * SCALE, y + size * 0.2, 8 * SCALE, 12 * SCALE);
    ctx.restore();
  }

  drawShopItemIcon(item, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = item.color;
    if (item.id === 'red_scarf') {
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.45);
      ctx.lineTo(r, -r * 0.45);
      ctx.lineTo(r * 0.35, r);
      ctx.closePath();
      ctx.fill();
    } else if (item.id === 'yellow_hat') {
      roundedRect(ctx, -r * 0.65, -r, r * 1.3, r * 1.45, r * 0.25);
      ctx.fill();
      ctx.fillRect(-r, r * 0.25, r * 2, r * 0.3);
    } else if (item.id === 'blue_bag') {
      roundedRect(ctx, -r * 0.75, -r * 0.7, r * 1.5, r * 1.5, r * 0.3);
      ctx.fill();
      ctx.strokeStyle = item.color;
      ctx.lineWidth = r * 0.25;
      ctx.beginPath();
      ctx.arc(0, -r * 0.5, r * 0.6, Math.PI, 0);
      ctx.stroke();
    } else if (item.id === 'star_trail') {
      ctx.font = `bold ${r * 2.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', 0, 0);
    } else {
      ['#ed665f', '#f4c84c', '#65a9d8'].forEach((color, index) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = r * 0.45;
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.35 + index * 0.28), Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  drawExchangeConfirmation(areas) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === this.pendingExchangeItem);
    ctx.fillStyle = 'rgba(40,30,22,0.58)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(255,249,233,0.98)';
    roundedRect(ctx, WIDTH * 0.1, HEIGHT * 0.34, WIDTH * 0.8, HEIGHT * 0.42, 24 * SCALE);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold ${24 * SCALE}px sans-serif`;
    ctx.fillText('确认兑换？', WIDTH / 2, HEIGHT * 0.41);
    this.drawShopItemIcon(item, WIDTH / 2, HEIGHT * 0.47, 18 * SCALE);
    ctx.font = `bold ${17 * SCALE}px sans-serif`;
    ctx.fillText(`${item.name} · ${item.price} 骨头币`, WIDTH / 2, HEIGHT * 0.52);
    ctx.fillStyle = COLORS.blue;
    roundedRect(ctx, areas.confirm.x, areas.confirm.y, areas.confirm.width, areas.confirm.height, 18 * SCALE);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.font = `bold ${18 * SCALE}px sans-serif`;
    ctx.fillText('确认兑换并穿戴', WIDTH / 2, areas.confirm.y + areas.confirm.height / 2);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `${15 * SCALE}px sans-serif`;
    ctx.fillText('取消', WIDTH / 2, areas.cancel.y + areas.cancel.height / 2);
  }

  render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (this.state === 'room') this.drawRoomBackground();
    else if (this.state === 'frisbee' || (this.state === 'paused' && this.pausedFrom === 'frisbee')) this.drawFrisbeeBackground();
    else this.drawBackground();

    if ((this.state === 'playing' || this.state === 'paused') && this.pausedFrom !== 'frisbee') {
      this.drawFinishApproach();
      this.items.forEach((item) => {
        if (item.type === 'bone') this.drawBone(item);
        else if (item.type === 'heart') this.drawHeart(item);
        else if (item.type === 'shield') this.drawShield(item);
        else if (item.type === 'puddle') this.drawPuddle(item);
        else this.drawLog(item);
      });
      this.drawDog();
      this.drawHud();
      if (this.state === 'playing') {
        this.drawSoundButton();
        this.drawPauseButton();
      }
      this.drawEffects();
      if (this.tutorialVisible) this.drawTutorial();
    }

    if (this.state === 'frisbee' || (this.state === 'paused' && this.pausedFrom === 'frisbee')) {
      this.items.forEach((item) => this.drawFrisbeeItem(item));
      this.drawDog();
      this.drawFrisbeeHud();
      if (this.state === 'frisbee') {
        this.drawSoundButton();
        this.drawPauseButton();
      }
      this.drawEffects();
      if (this.tutorialVisible) this.drawFrisbeeTutorial();
    }

    if (this.state === 'home') this.drawHome();
    if (this.state === 'activities') this.drawActivities();
    if (this.state === 'room') this.drawRoom();
    if (this.state === 'shop') this.drawShop();
    if (this.state === 'daily') this.drawDaily();
    if (this.state === 'success' || this.state === 'failed') this.drawResult();
    if (this.state === 'frisbeeResult') this.drawFrisbeeResult();
    if (this.state === 'paused') this.drawPaused();
  }

  loop() {
    const now = Date.now();
    const delta = Math.min(0.034, Math.max(0, (now - this.lastTimestamp) / 1000));
    this.lastTimestamp = now;
    this.update(delta);
    this.render();
    requestAnimationFrame(this.loop);
  }
}
