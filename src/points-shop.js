import wx from './platform/browser.js';

export const SHOP_ITEMS = [
  { id: 'red_scarf', name: '红色领巾', price: 60, slot: 'neck', color: '#ed665f' },
  { id: 'yellow_hat', name: '黄色小帽', price: 120, slot: 'head', color: '#f4c84c' },
  { id: 'blue_bag', name: '蓝色小背包', price: 240, slot: 'back', color: '#65a9d8' },
  { id: 'star_trail', name: '星星足迹', price: 400, slot: 'trail', color: '#f4c84c' },
  { id: 'rainbow_set', name: '彩虹探险套装', price: 700, slot: 'set', color: '#b276cf' },
];

const STORAGE_KEY = 'dog_adventure_points_shop_v1';

function initialData() {
  return { balance: 0, owned: [], equipped: {}, settlements: [] };
}

export function calculatePoints(bonesCollected, success, lives, maxLives = 3) {
  const collected = Math.max(0, Number(bonesCollected) || 0);
  const value = Math.floor(collected / 5) + (success ? 10 : 0) + (success && lives === maxLives ? 5 : 0);
  return Math.min(25, value);
}

export default class PointsShop {
  constructor(storage = wx) {
    this.storage = storage;
    this.data = this.read();
  }

  read() {
    try {
      const saved = this.storage.getStorageSync(STORAGE_KEY);
      if (!saved || typeof saved !== 'object') return initialData();
      return {
        balance: Math.max(0, Number(saved.balance) || 0),
        owned: Array.isArray(saved.owned) ? saved.owned.filter((id) => SHOP_ITEMS.some((item) => item.id === id)) : [],
        equipped: saved.equipped && typeof saved.equipped === 'object' ? saved.equipped : {},
        settlements: Array.isArray(saved.settlements) ? saved.settlements.slice(-50) : [],
      };
    } catch (error) {
      return initialData();
    }
  }

  save(nextData) {
    try {
      this.storage.setStorageSync(STORAGE_KEY, nextData);
      this.data = nextData;
      return true;
    } catch (error) {
      return false;
    }
  }

  award(settlementId, amount) {
    if (!settlementId || this.data.settlements.includes(settlementId)) return 0;
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    const nextData = {
      ...this.data,
      balance: this.data.balance + safeAmount,
      settlements: [...this.data.settlements.slice(-49), settlementId],
    };
    return this.save(nextData) ? safeAmount : 0;
  }

  spend(transactionId, amount) {
    if (!transactionId || this.data.settlements.includes(transactionId)) return { ok: false, reason: 'duplicate' };
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (this.data.balance < safeAmount) return { ok: false, reason: 'insufficient' };
    const nextData = {
      ...this.data,
      balance: this.data.balance - safeAmount,
      settlements: [...this.data.settlements.slice(-49), transactionId],
    };
    return this.save(nextData) ? { ok: true, amount: safeAmount } : { ok: false, reason: 'storage' };
  }

  exchange(itemId) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item) return { ok: false, reason: 'not_found' };
    if (this.data.owned.includes(itemId)) return { ok: false, reason: 'owned' };
    if (this.data.balance < item.price) return { ok: false, reason: 'insufficient' };
    const nextData = {
      ...this.data,
      balance: this.data.balance - item.price,
      owned: [...this.data.owned, itemId],
    };
    return this.save(nextData) ? { ok: true, item } : { ok: false, reason: 'storage' };
  }

  equip(itemId) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item || !this.data.owned.includes(itemId)) return false;
    const equipped = { ...this.data.equipped };
    if (item.slot === 'set') {
      delete equipped.head;
      delete equipped.neck;
      delete equipped.back;
      delete equipped.trail;
    } else {
      delete equipped.set;
    }
    equipped[item.slot] = itemId;
    return this.save({ ...this.data, equipped });
  }

  unequip(itemId) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item || this.data.equipped[item.slot] !== itemId) return false;
    const equipped = { ...this.data.equipped };
    delete equipped[item.slot];
    return this.save({ ...this.data, equipped });
  }

  isEquipped(itemId) {
    return Object.values(this.data.equipped).includes(itemId);
  }

  isOwned(itemId) {
    return this.data.owned.includes(itemId);
  }
}
