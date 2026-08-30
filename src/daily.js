import wx from './platform/browser.js';

export const DAILY_TASKS = [
  { id: 'play_one', name: '今日出发', description: '完成任意1局', target: 1, field: 'games', reward: 10 },
  { id: 'bones_twenty', name: '骨头收藏家', description: '累计收集20根骨头', target: 20, field: 'bones', reward: 20 },
  { id: 'finish_one', name: '安全到家', description: '成功通关1次', target: 1, field: 'wins', reward: 30 },
];

const STORAGE_KEY = 'dog_adventure_daily_v1';

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateSeed(dateKey) {
  let hash = 2166136261;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash ^= dateKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function emptyData(date) {
  return { date, games: 0, bones: 0, wins: 0, bestScore: 0, claimed: [] };
}

export default class DailyProgress {
  constructor(storage = wx, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.data = this.read();
  }

  today() {
    return localDateKey(this.now());
  }

  read() {
    const today = this.today();
    try {
      const saved = this.storage.getStorageSync(STORAGE_KEY);
      if (!saved || typeof saved !== 'object' || saved.date !== today) return emptyData(today);
      return {
        date: today,
        games: Math.max(0, Number(saved.games) || 0),
        bones: Math.max(0, Number(saved.bones) || 0),
        wins: Math.max(0, Number(saved.wins) || 0),
        bestScore: Math.max(0, Number(saved.bestScore) || 0),
        claimed: Array.isArray(saved.claimed) ? saved.claimed.filter((id) => DAILY_TASKS.some((task) => task.id === id)) : [],
      };
    } catch (error) {
      return emptyData(today);
    }
  }

  ensureToday() {
    if (this.data.date !== this.today()) this.data = emptyData(this.today());
  }

  save(next) {
    try {
      this.storage.setStorageSync(STORAGE_KEY, next);
      this.data = next;
      return true;
    } catch (error) {
      this.data = next;
      return false;
    }
  }

  recordGame(bones, success, score, isDailyChallenge) {
    this.ensureToday();
    return this.save({
      ...this.data,
      games: this.data.games + 1,
      bones: this.data.bones + Math.max(0, Math.floor(Number(bones) || 0)),
      wins: this.data.wins + (success ? 1 : 0),
      bestScore: isDailyChallenge ? Math.max(this.data.bestScore, Math.floor(Number(score) || 0)) : this.data.bestScore,
    });
  }

  taskState(task) {
    this.ensureToday();
    const progress = Math.min(task.target, this.data[task.field]);
    return { progress, complete: progress >= task.target, claimed: this.data.claimed.includes(task.id) };
  }

  markClaimed(taskId) {
    this.ensureToday();
    const task = DAILY_TASKS.find((candidate) => candidate.id === taskId);
    if (!task || this.data.claimed.includes(taskId) || !this.taskState(task).complete) return false;
    return this.save({ ...this.data, claimed: [...this.data.claimed, taskId] });
  }
}
