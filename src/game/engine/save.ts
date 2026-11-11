// 存档：版本化（v2 多分店）、IndexedDB（生产）/内存适配器（测试）、v1→v2 迁移。刷新不丢进度。
import type { GameState, Branch } from "../types";
import { SAVE_VERSION } from "../config";
import { DISHES } from "../data/dishes";
import { CITY_BY_ID, toCnyCents } from "../data/cities";

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const SLOT_PREFIX = "tnbr_save_";
export const AUTO_SLOT = "auto";
export const MANUAL_SLOTS = ["slot1", "slot2", "slot3"];

export async function saveGame(adapter: StorageAdapter, slot: string, state: GameState): Promise<void> {
  const payload = JSON.stringify({ ...state, savedAt: Date.now() });
  await adapter.set(SLOT_PREFIX + slot, payload);
}

export interface LoadResult {
  ok: boolean;
  state?: GameState;
  error?: string;
  migrated?: boolean;
}

export async function loadGame(adapter: StorageAdapter, slot: string): Promise<LoadResult> {
  const raw = await adapter.get(SLOT_PREFIX + slot);
  if (!raw) return { ok: false, error: "存档不存在" };
  try {
    const parsed = JSON.parse(raw) as GameState & { savedAt?: number };
    delete (parsed as unknown as Record<string, unknown>).savedAt;
    if (typeof parsed.saveVersion !== "number") return { ok: false, error: "存档结构无效" };
    if (parsed.saveVersion > SAVE_VERSION) return { ok: false, error: "存档版本比当前游戏新，请先升级游戏" };
    if (parsed.saveVersion < SAVE_VERSION) {
      const migrated = migrate(parsed as unknown as GameState & { [k: string]: unknown });
      if (!migrated.ok) return { ok: false, error: migrated.error ?? "旧存档迁移失败" };
      return { ok: true, state: migrated.state, migrated: true };
    }
    normalize(parsed);
    return { ok: true, state: parsed };
  } catch {
    return { ok: false, error: "存档损坏，无法读取" };
  }
}

// 各版本增量字段默认值（宽容加载）
function normalize(s: GameState): void {
  s.branches ??= {};
  s.scheduled ??= [];
  s.study ??= { learned: ["hunan"], unlockedDishes: DISHES.map((x) => x.id), activeResearch: null };
  s.story ??= { marriageStatus: "single", piousGoodUntilDay: 0, piousFakeUntilDay: 0, gayUntilDay: 0 };
  s.over ??= false;
  s.negCashStreak ??= 0;
  for (const b of Object.values(s.branches)) normalizeBranch(b, s.day);
  for (const pe of s.events.pending) if (typeof pe.cityId !== "string") pe.cityId = s.activeCityId ?? "changsha";
  for (const sc of s.scheduled) if (typeof (sc as { cityId?: string }).cityId !== "string") (sc as { cityId: string }).cityId = s.activeCityId ?? "changsha";
}

function normalizeBranch(b: Branch, day: number): void {
  b.day ??= day;
  b.phase ??= "planning";
  b.closedToday ??= false;
  b.cart ??= [];
  b.autoRestock ??= { enabled: false, untilDay: 0, items: [], supplierId: "mawangdui" };
  b.pendingSpoilage ??= [];
  for (const sp of b.pendingSpoilage) {
    if (typeof sp.purchasedDay !== "number") sp.purchasedDay = Math.max(1, sp.expiredDay ?? day);
    if (typeof sp.expiredDay !== "number") sp.expiredDay = day;
  }
  b.pendingDeliveries ??= [];
  b.purchasesToday ??= [];
  b.loans ??= [];
  b.negCashStreak ??= 0;
  b.nextLotId ??= 1;
  b.nextEmpId ??= 4;
  b.candidatePool ??= [];
  b.poolGenerationDay ??= 1;
  b.marketing ??= { nextId: 1, active: [], history: [] };
  b.planConfirmedDirty ??= true;
  for (const mi of Object.values(b.menu ?? {})) {
    if (!mi.recipeBp) mi.recipeBp = {};
  }
  b.store.capacityMultBp ??= 10000;
  b.store.rentCents ??= 20000;
  b.store.utilityCents ??= 8000;
  b.store.maintainCents ??= 3000;
}

// v1（单城）→ v2（多分店）：旧字段打包为长沙分店；旧档视为全菜系已学、全部菜品已解锁（保持可玩）
export function migrate(s: GameState & { [k: string]: unknown }): { ok: boolean; state?: GameState; error?: string } {
  try {
    if (s.saveVersion === 1) {
      const anyOld = s as unknown as Record<string, unknown>;
      const day = (anyOld.day as number) ?? 1;
      const oldPhase = (anyOld.phase as string) ?? "planning";
      const branch: Branch = {
        cityId: "changsha",
        districtId: (anyOld.location as { districtId: string })?.districtId ?? "community",
        day,
        phase: oldPhase === "confirmed" ? "confirmed" : oldPhase === "report" ? "report" : "planning",
        closedToday: false,
        planConfirmedDirty: (anyOld.planConfirmedDirty as boolean) ?? true,
        store: {
          ...(anyOld.store as Branch["store"]),
          capacityMultBp: (anyOld.store as Branch["store"])?.capacityMultBp ?? 10000,
          rentCents: (anyOld.store as Branch["store"])?.rentCents ?? 20000,
          utilityCents: (anyOld.store as Branch["store"])?.utilityCents ?? 8000,
          maintainCents: (anyOld.store as Branch["store"])?.maintainCents ?? 3000,
        },
        cashCents: anyOld.cashCents as number,
        loans: (anyOld.loans as Branch["loans"]) ?? [],
        negCashStreak: (anyOld.negCashStreak as number) ?? 0,
        inventory: anyOld.inventory as Branch["inventory"],
        nextLotId: (anyOld.nextLotId as number) ?? 1,
        market: anyOld.market as Branch["market"],
        purchasesToday: (anyOld.purchasesToday as Branch["purchasesToday"]) ?? [],
        cart: (anyOld.cart as Branch["cart"]) ?? [],
        autoRestock: (anyOld.autoRestock as Branch["autoRestock"]) ?? { enabled: false, untilDay: 0, items: [], supplierId: "mawangdui" },
        pendingDeliveries: (anyOld.pendingDeliveries as Branch["pendingDeliveries"]) ?? [],
        pendingSpoilage: (((anyOld.pendingSpoilage as { ingId: string; qty: number; unitPriceCents: number; perPurchase: number; purchasedDay?: number; expiredDay?: number }[]) ?? []))
          .map((x) => ({
            ingId: x.ingId,
            qty: x.qty,
            unitPriceCents: x.unitPriceCents,
            perPurchase: x.perPurchase,
            purchasedDay: x.purchasedDay ?? Math.max(1, day - 1),
            expiredDay: x.expiredDay ?? day,
          })),
        menu: (anyOld.menu as Branch["menu"]) ?? {},
        staff: (anyOld.staff as Branch["staff"]) ?? [],
        nextEmpId: (anyOld.nextEmpId as number) ?? 4,
        candidatePool: (anyOld.candidatePool as Branch["candidatePool"]) ?? [],
        poolGenerationDay: (anyOld.poolGenerationDay as number) ?? 1,
        reputation: (anyOld.reputation as number) ?? 480,
        regulars: (anyOld.regulars as number) ?? 0,
        reviews: (anyOld.reviews as Branch["reviews"]) ?? [],
        boosts: (anyOld.boosts as Branch["boosts"]) ?? [],
        marketing: (anyOld.marketing as Branch["marketing"]) ?? { nextId: 1, active: [], history: [] },
        ledger: (anyOld.ledger as Branch["ledger"]) ?? [],
        reports: (anyOld.reports as Branch["reports"]) ?? [],
        settledDay: (anyOld.settledDay as number) ?? 0,
        lastReportDay: (anyOld.lastReportDay as number) ?? 0,
      };
      const migratedState: GameState = {
        saveVersion: SAVE_VERSION,
        rng: s.rng, seed: s.seed, createdAt: s.createdAt,
        day: s.day, date: s.date,
        over: (anyOld.phase as string) === "gameover",
        negCashStreak: 0,
        boss: s.boss,
        story: s.story ?? { marriageStatus: "single", piousGoodUntilDay: 0, piousFakeUntilDay: 0, gayUntilDay: 0 },
        study: s.study ?? {
          learned: ["hunan", "sichuan", "cantonese", "dessert", "drink", "fastfood", "western", "japanese", "french"],
          unlockedDishes: DISHES.map((x) => x.id),
          activeResearch: null,
        },
        activeCityId: "changsha",
        unlockedCities: s.unlockedCities?.length ? s.unlockedCities : ["changsha"],
        branches: { changsha: branch },
        events: s.events,
        scheduled: s.scheduled ?? [],
        bloggerLog: s.bloggerLog ?? [],
        achievements: s.achievements ?? [],
        notes: s.notes ?? "",
      };
      for (const pe of migratedState.events.pending) if (typeof pe.cityId !== "string") pe.cityId = "changsha";
      for (const h of migratedState.events.history) if (typeof (h as { cityId?: string }).cityId !== "string") (h as { cityId: string }).cityId = "changsha";
      normalizeBranch(branch, day);
      return { ok: true, state: migratedState };
    }
    return { ok: false, error: `暂不支持从 v${String(s.saveVersion)} 迁移` };
  } catch {
    return { ok: false, error: "旧存档迁移失败" };
  }
}

export async function deleteSlot(adapter: StorageAdapter, slot: string): Promise<void> {
  await adapter.del(SLOT_PREFIX + slot);
}

export interface SlotInfo { slot: string; savedAt: number; day: number; cashCnyCents: number; restaurant: string }

export async function listSlots(adapter: StorageAdapter): Promise<SlotInfo[]> {
  const keys = await adapter.keys();
  const out: SlotInfo[] = [];
  for (const k of keys) {
    if (!k.startsWith(SLOT_PREFIX)) continue;
    const raw = await adapter.get(k);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as GameState & { savedAt?: number };
      let cashCny = 0;
      if (p.branches) {
        for (const b of Object.values(p.branches)) cashCny += toCnyCents(b.cashCents ?? 0, CITY_BY_ID[b.cityId]?.fxPerCnyBp ?? 1000);
      } else {
        cashCny = (p as unknown as { cashCents: number }).cashCents ?? 0;
      }
      out.push({ slot: k.slice(SLOT_PREFIX.length), savedAt: p.savedAt ?? 0, day: p.day, cashCnyCents: cashCny, restaurant: p.boss?.restaurantName ?? "" });
    } catch {
      out.push({ slot: k.slice(SLOT_PREFIX.length), savedAt: 0, day: 0, cashCnyCents: 0, restaurant: "(损坏)" });
    }
  }
  return out;
}

// ---------------- IndexedDB 适配器 ----------------
export function idbAdapter(): StorageAdapter {
  const DB_NAME = "today-not-bankrupt";
  const STORE = "saves";
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
  }
  return {
    async get(key) {
      try {
        const v = await tx<string | undefined>("readonly", (st) => st.get(key));
        return v === undefined ? null : (v as unknown as string);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await tx("readwrite", (st) => st.put(value, key));
    },
    async del(key) {
      await tx("readwrite", (st) => st.delete(key));
    },
    async keys() {
      const k = await tx<IDBValidKey[]>("readonly", (st) => st.getAllKeys());
      return k.map(String);
    },
  };
}

// ---------------- 内存适配器（测试/回退） ----------------
export function memoryAdapter(existing?: Map<string, string>): StorageAdapter & { dump(): Record<string, string> } {
  const map = existing ?? new Map<string, string>();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async del(key) { map.delete(key); },
    async keys() { return [...map.keys()]; },
    dump() { return Object.fromEntries(map); },
  };
}

// localStorage 仅用于简单设置
export function setPref(k: string, v: string): void {
  try { localStorage.setItem("tnbr_pref_" + k, v); } catch { /* 忽略 */ }
}

export function getPref(k: string, fallback: string): string {
  try { return localStorage.getItem("tnbr_pref_" + k) ?? fallback; } catch { return fallback; }
}
