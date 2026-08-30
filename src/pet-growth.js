import { localDateKey } from './daily.js';

import wx from './platform/browser.js';

const STORAGE_KEY = 'dog_adventure_pet_growth_v1';
const MAX_LEVEL = 10;

function initialData(date) {
  return {
    totalExp: 0,
    date,
    feedCount: 0,
    played: false,
    bathed: false,
    dailyChallengeBonus: false,
    onboardingStep: 0,
    settlements: [],
  };
}

export function levelFromExp(totalExp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(Number(totalExp) || 0));
  while (level < MAX_LEVEL) {
    const needed = 20 + level * 10;
    if (remaining < needed) return { level, current: remaining, needed };
    remaining -= needed;
    level += 1;
  }
  return { level: MAX_LEVEL, current: 0, needed: 0 };
}

export default class PetGrowth {
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
      if (!saved || typeof saved !== 'object') return initialData(today);
      const sameDay = saved.date === today;
      return {
        totalExp: Math.max(0, Number(saved.totalExp) || 0),
        date: today,
        feedCount: sameDay ? Math.max(0, Math.min(3, Number(saved.feedCount) || 0)) : 0,
        played: sameDay && saved.played === true,
        bathed: sameDay && saved.bathed === true,
        dailyChallengeBonus: sameDay && saved.dailyChallengeBonus === true,
        onboardingStep: Number.isFinite(saved.onboardingStep)
          ? Math.max(0, Math.min(4, saved.onboardingStep))
          : ((Number(saved.totalExp) || 0) > 0 ? 4 : 0),
        settlements: Array.isArray(saved.settlements) ? saved.settlements.slice(-80) : [],
      };
    } catch (error) {
      return initialData(today);
    }
  }

  ensureToday() {
    if (this.data.date === this.today()) return;
    this.data = { ...this.data, date: this.today(), feedCount: 0, played: false, bathed: false, dailyChallengeBonus: false };
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

  status() {
    return levelFromExp(this.data.totalExp);
  }

  setOnboardingStep(step) {
    return this.save({ ...this.data, onboardingStep: Math.max(0, Math.min(4, step)) });
  }

  addExp(settlementId, amount, extra = {}) {
    this.ensureToday();
    if (!settlementId || this.data.settlements.includes(settlementId)) return { gained: 0, levelUp: false };
    const before = this.status().level;
    const gained = Math.max(0, Math.floor(Number(amount) || 0));
    const next = {
      ...this.data,
      ...extra,
      totalExp: this.data.totalExp + gained,
      settlements: [...this.data.settlements.slice(-79), settlementId],
    };
    if (!this.save(next)) return { gained: 0, levelUp: false };
    const after = this.status().level;
    return { gained, levelUp: after > before, before, after };
  }

  recordGame(runId, success, mode) {
    this.ensureToday();
    const dailyBonus = mode === 'daily' && !this.data.dailyChallengeBonus ? 5 : 0;
    return this.addExp(`run-${runId}`, 3 + (success ? 3 : 0) + dailyBonus, dailyBonus ? { dailyChallengeBonus: true } : {});
  }

  interact(type) {
    this.ensureToday();
    if (type === 'feed') {
      if (this.data.feedCount >= 3) return { gained: 0, repeated: true };
      return this.addExp(`care-${this.data.date}-feed-${this.data.feedCount + 1}`, 8, { feedCount: this.data.feedCount + 1 });
    }
    if (type === 'play') {
      if (this.data.played) return { gained: 0, repeated: true };
      return this.addExp(`care-${this.data.date}-play`, 5, { played: true });
    }
    if (type === 'bath') {
      if (this.data.bathed) return { gained: 0, repeated: true };
      return this.addExp(`care-${this.data.date}-bath`, 5, { bathed: true });
    }
    return { gained: 0, repeated: true };
  }
}
