// 开局：老板创建 → 首城开店（多分店模型下的初始 Branch）
import type { BackgroundId, Branch, CuisineId, DifficultyId, GameState, PersonalityId, SlotId } from "../types";
import { BACKGROUNDS, CALENDAR, CHANGSHA_STARTER_MENU, SAVE_VERSION, WEATHER } from "../config";
import { CITY_BY_ID, districtFor, scaledRent, toLocalCents } from "../data/cities";
import { DISHES } from "../data/dishes";
import { INGREDIENTS } from "../data/ingredients";
import { genCandidates, localWage } from "./staff";

export interface NewGameInput {
  name: string; age: number; restaurantName: string;
  background: BackgroundId; personality: PersonalityId; philosophy: string;
  difficulty: DifficultyId; cityId: string; districtId: string;
  seed?: number;
}

const STARTER_STOCK: Record<string, number> = {
  rice: 6000, noodles: 3500, flour: 2000, bread: 800,
  sugar: 2500, salt: 1200, cooking_oil: 4000, soy_sauce: 2500, vinegar: 1200,
  cooking_wine: 1200, doubanjiang: 800, chili_powder: 600, sichuan_pepper: 300, curry: 400, peanut: 600,
  garlic: 900, ginger: 600, scallion: 600, chili_fresh: 1000,
  potato: 3000, tomato: 2200, cabbage: 2200, lettuce: 1200, green_bean: 1000, radish: 1500, bamboo_shoot: 600, mushroom: 700, tofu: 1500,
  lemon: 600, orange: 1000, strawberry: 400,
  pork_belly: 2000, pork_ribs: 1000, pork_mince: 2000, pork_shoulder: 1500, beef: 1500, sausage: 500,
  chicken_whole: 2000, chicken_breast: 1600, duck_breast: 500, carp: 1000, shrimp: 800, salmon: 400,
  egg: 40, milk: 2000, cream: 500, butter: 300, cheese: 400,
  coffee_beans: 300, tea_leaves: 200, cocoa: 200,
};

export function dayToDate(dayIndex: number, weather: GameState["date"]["weather"]): GameState["date"] {
  const start = Date.UTC(CALENDAR.startYear, CALENDAR.startMonth - 1, CALENDAR.startDay);
  const t = start + (dayIndex - 1) * 86400000;
  const d = new Date(t);
  const month = d.getUTCMonth() + 1;
  return {
    year: d.getUTCFullYear(),
    month,
    dayOfMonth: d.getUTCDate(),
    weekday: (CALENDAR.startWeekday + (dayIndex - 1)) % 7,
    season: CALENDAR.seasonByMonth[month] as GameState["date"]["season"],
    weather,
  };
}

export function rollWeather(s: { rng: number }, season: string, prev?: string): GameState["date"]["weather"] {
  if (prev && Math.floor(nextRand(s) * 100) + 1 <= 45) return prev as GameState["date"]["weather"];
  const weights = WEATHER.seasonWeights[season] ?? WEATHER.seasonWeights["春"];
  const ids = Object.keys(weights);
  const total = ids.reduce((a, k) => a + weights[k], 0);
  let acc = nextRand(s) * total;
  for (const k of ids) {
    acc -= weights[k];
    if (acc < 0) return k as GameState["date"]["weather"];
  }
  return "sunny";
}

function nextRand(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newBranch(s: GameState, cityId: string, districtId: string, withStaff: boolean): Branch {
  const city = CITY_BY_ID[cityId];
  const dist = districtFor(city, districtId);
  const market: GameState["branches"][string]["market"] = {};
  for (const def of INGREDIENTS) {
    const p = toLocalCents(Math.round((def.basePriceCents * city.marketFactorBp) / 10000), city.fxPerCnyBp);
    market[def.id] = { priceCents: p, trendBp: 0, history: [p], supply: 2, eventTag: null, eventUntilDay: 0 };
  }
  const menu: Branch["menu"] = {};
  for (const dish of DISHES) {
    const mid = Math.round((dish.suggestLowCents + dish.suggestHighCents) / 2);
    const localMid = Math.max(50, Math.round(toLocalCents(mid, city.fxPerCnyBp) / 50) * 50);
    menu[dish.id] = {
      dishId: dish.id,
      priceCents: localMid,
      active: withStaff ? (CHANGSHA_STARTER_MENU as readonly string[]).includes(dish.id) : s.study.unlockedDishes.includes(dish.id),
      recipeBp: {},
    };
  }
  const b: Branch = {
    cityId,
    districtId: dist.id,
    day: s.day,
    phase: "planning",
    closedToday: false,
    planConfirmedDirty: true,
    store: {
      seats: dist.seats, stations: dist.stations,
      hygiene: 82, decor: dist.decorStart, equipmentHealth: 95, kitchenFlow: 60,
      fridgeCapacityBp: 10000, openSlots: ["lunch", "dinner", "night"] as SlotId[], orderLimitCovers: 0,
      capacityMultBp: dist.capacityMultBp,
      rentCents: toLocalCents(scaledRent(dist.rentCents, city), city.fxPerCnyBp),
      utilityCents: toLocalCents(scaledRent(dist.utilityCents, city), city.fxPerCnyBp),
      maintainCents: toLocalCents(scaledRent(dist.maintainCents, city), city.fxPerCnyBp),
    },
    cashCents: 0,
    loans: [],
    negCashStreak: 0,
    inventory: {},
    nextLotId: 1,
    market,
    purchasesToday: [],
    cart: [],
    autoRestock: { enabled: false, untilDay: 0, items: [], supplierId: "mawangdui" },
    pendingDeliveries: [],
    pendingSpoilage: [],
    menu,
    staff: [],
    nextEmpId: 4,
    candidatePool: [],
    poolGenerationDay: s.day,
    reputation: 480,
    regulars: 0,
    reviews: [],
    boosts: [],
    marketing: { nextId: 1, active: [], history: [] },
    ledger: [],
    reports: [],
    settledDay: 0,
    lastReportDay: 0,
  };
  return b;
}

export function stockBranchInitialGoods(s: GameState, b: Branch): void {
  const qtyMult = s.boss.background === "miserable" ? 1.5 : 2.5;
  for (const [ingId, qty] of Object.entries(STARTER_STOCK)) {
    const def = INGREDIENTS.find((x) => x.id === ingId)!;
    const q = Math.max(def.unit === "piece" ? 6 : def.moq, Math.round(qty * qtyMult));
    const m = b.market[ingId];
    b.inventory[ingId] = [{
      id: b.nextLotId++, ingId, qty: q, unitPriceCents: m.priceCents,
      perPurchase: def.perPurchase, expiresDay: 1 + def.shelfDays, storage: def.storage, purchasedDay: 1,
    }];
  }
}

export function stockBranchOpeningStaff(s: GameState, b: Branch): void {
  const initial: { name: string; role: import("../types").RoleId; skill: number; shifts: SlotId[] }[] = [
    { name: "陈志强", role: "cook", skill: 45, shifts: ["lunch", "dinner", "night"] },
    { name: "王建国", role: "cook", skill: 28, shifts: ["lunch", "dinner"] },
    { name: "刘小敏", role: "prep", skill: 30, shifts: ["lunch", "dinner", "night"] },
    { name: "周雨欣", role: "server", skill: 35, shifts: ["lunch", "dinner", "night"] },
    { name: "吴海燕", role: "server", skill: 22, shifts: ["dinner", "night"] },
  ];
  for (const i of initial) {
    b.staff.push({
      id: b.nextEmpId++, name: i.name, role: i.role, skill: i.skill, xp: 0, level: 1,
      baseWageCents: localWage(s, b.cityId, i.role, i.skill), overtimeRateBp: 1500,
      shifts: [...i.shifts], fatigue: 5, stress: 5, satisfaction: 65,
      loyalty: 65, trait: "老实肯干", specialty: "通用", trainingUntilDay: 0,
    });
  }
}

export function createNewGame(input: NewGameInput): GameState {
  const seed = input.seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  const tmp = { rng: seed >>> 0 };
  const weather = rollWeather(tmp, "春");
  const bg = BACKGROUNDS.find((b) => b.id === input.background)!;
  const cityId = input.cityId || "changsha";

  const state: GameState = {
    saveVersion: SAVE_VERSION,
    rng: tmp.rng, seed,
    createdAt: Date.now(),
    day: 1,
    date: dayToDate(1, weather),
    over: false,
    negCashStreak: 0,
    boss: {
      name: input.name || "无名老板", age: clampAge(input.age), restaurantName: input.restaurantName || "无名小馆",
      background: input.background, personality: input.personality, philosophy: input.philosophy,
      difficulty: input.difficulty, credibilityRisk: 0,
    },
    story: { marriageStatus: "single", piousGoodUntilDay: 0, piousFakeUntilDay: 0, gayUntilDay: 0 },
    study: {
      learned: ["hunan"],
      unlockedDishes: DISHES.filter((x) => x.cuisine === "hunan").map((x) => x.id),
      activeResearch: null,
    },
    activeCityId: cityId,
    unlockedCities: [cityId],
    branches: {},
    events: {
      nextUid: 1, pending: [], cooldowns: {}, history: [],
      parentCallCooldownUntil: 0, familyHelpUsed: false, transferredTotalCents: 0, transferCount: 0,
    },
    scheduled: [],
    bloggerLog: [],
    achievements: [],
    notes: "",
  };

  const home = newBranch(state, cityId, input.districtId || "community", true);
  home.cashCents = toLocalCents(bg.startCashCents, CITY_BY_ID[cityId].fxPerCnyBp);
  stockBranchInitialGoods(state, home);
  stockBranchOpeningStaff(state, home);
  home.candidatePool = genCandidates(state, home);
  state.branches[cityId] = home;
  return state;
}

function clampAge(a: number): number {
  return Math.max(18, Math.min(70, Math.round(a) || 28));
}

export type { CuisineId };
