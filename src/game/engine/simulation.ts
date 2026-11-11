// 营业模拟（分店级）：客流生成 → 进店 → 桌单点菜(1~10道) → 产能约束出餐 → 满意度/口碑 → 财务归集
import type { DishDayStat, DayReport, GameState, Branch, ReviewItem, RoleId, SegmentDef, SlotId } from "../types";
import { ALL_SLOTS } from "../types";
import { CALENDAR, CAPACITY, DEMAND, SATISFACTION, WEATHER, INVENTORY, STORY_EVENTS, RECIPE_TUNING,
  getDiff, getMods, BACKGROUNDS,
} from "../config";
import { CITY_BY_ID, toLocalCents } from "../data/cities";
import { SEG_BY_ID, SEGMENTS, REVIEW_GOOD, REVIEW_MID, REVIEW_BAD, REVIEW_Q_GOOD, REVIEW_Q_BAD, REVIEW_W_BAD, REVIEW_P_BAD, REVIEW_PORTION_BAD, REVIEW_H_BAD } from "../data/segments";
import { DISH_BY_ID } from "../data/dishes";
import { chance, noise, rndInt, rndWeighted, nextRandom } from "../rng";
import { clamp } from "../utils";
import { cookDish, availableStock, storageLoss, effectiveRecipe, recipeFillBp, coreIngBp } from "./inventory";
import { applyWorkImpact, dailyWageCents, onDuty, qualityOfStaffCook, speedFactorBp } from "./staff";
import { isDishSellable } from "./research";

function mulBp(a: number, b: number): number {
  return Math.round((a * b) / 10000);
}

export function repFactorBp(rep: number): number {
  return DEMAND.repFactorBaseBp + rep * DEMAND.repFactorPerRepBp;
}

export function mmdd(d: { month: number; dayOfMonth: number }): string {
  return `${String(d.month).padStart(2, "0")}-${String(d.dayOfMonth).padStart(2, "0")}`;
}

function isHoliday(mmddStr: string): boolean {
  return (DEMAND.holidays as readonly string[]).includes(mmddStr);
}

// 潜在客流（分店口碑/回头客/加成各自独立；quiet=true 不含随机噪声）
export function computePotential(s: GameState, b: Branch, opts: { quiet?: boolean; includeMarketing?: boolean } = {}): number {
  const city = CITY_BY_ID[b.cityId];
  const dist = city.districts.find((d) => d.id === b.districtId) ?? city.districts[0];
  let bp = 10000;
  bp = mulBp(bp, dist.trafficModBp);
  bp = mulBp(bp, DEMAND.weekdayTrafficBp[s.date.weekday]);
  bp = mulBp(bp, DEMAND.seasonTrafficBp[s.date.season] ?? 10000);
  bp = mulBp(bp, WEATHER.trafficBp[s.date.weather]);
  bp = mulBp(bp, repFactorBp(b.reputation));
  bp = mulBp(bp, 10000 + b.regulars * 5);
  bp = mulBp(bp, Math.max(6000, 10000 - Math.round((city.competitionBp - 10000) / 2)));
  if (isHoliday(mmdd(s.date))) bp = mulBp(bp, DEMAND.holidayBp);
  for (const bo of b.boosts) {
    if (bo.untilDay < s.day) continue;
    if (opts.includeMarketing === false && bo.id.startsWith("mk_")) continue;
    bp = mulBp(bp, bo.trafficBp);
  }
  let est = Math.round((city.baseDailyTraffic * bp) / 10000);
  if (!opts.quiet) {
    const mods = getMods(s.boss.personality);
    const diff = getDiff(s.boss.difficulty);
    const ampBp = Math.round(DEMAND.noiseBp * (mods.demandNoiseBp / 10000) * (diff.demandNoiseBp / 10000));
    const nBp = Math.round(noise(s) * ampBp);
    est = Math.max(0, Math.round((est * (10000 + nBp)) / 10000));
  }
  return est;
}

// 次日预测（保守天气延续）
export function forecastTomorrow(s: GameState, b: Branch): { label: string; est: number } {
  const wd = (s.date.weekday + 1) % 7;
  const weather = s.date.weather === "storm" || s.date.weather === "heat" || s.date.weather === "cold" ? "cloudy" : s.date.weather;
  const city = CITY_BY_ID[b.cityId];
  const dist = city.districts.find((d) => d.id === b.districtId) ?? city.districts[0];
  let bp = 10000;
  bp = mulBp(bp, dist.trafficModBp);
  bp = mulBp(bp, DEMAND.weekdayTrafficBp[wd]);
  bp = mulBp(bp, DEMAND.seasonTrafficBp[s.date.season] ?? 10000);
  bp = mulBp(bp, WEATHER.trafficBp[weather]);
  bp = mulBp(bp, repFactorBp(b.reputation));
  bp = mulBp(bp, 10000 + b.regulars * 5);
  for (const bo of b.boosts) if (bo.untilDay >= s.day + 1) bp = mulBp(bp, bo.trafficBp);
  return { label: `${CALENDAR.weekdayNames[wd]}·${WEATHER.names[weather]}`, est: Math.round((city.baseDailyTraffic * bp) / 10000) };
}

interface Customer {
  seg: SegmentDef;
  slot: SlotId;
  dishes: { dishId: string; priceCents: number }[];
  partySize: number;
}

// 顾客点单效用（价格/建议价均为当地货币口径）
export function dishUtility(
  seg: SegmentDef, cityId: string, dishId: string, priceCents: number,
  qualityExp: number, elasticityBp: number,
): number {
  const dish = DISH_BY_ID[dishId];
  const city = CITY_BY_ID[cityId];
  const match = ((city.cuisineAffinityBp[dish.cuisine] ?? 800) / 1000 + (seg.cuisineWeightsBp[dish.cuisine] ?? 800) / 1000 - 1.5) * 1.2;
  const flavor = dish.baseFlavor / 25;
  const quality = qualityExp / 30;
  const pop = dish.heat / 80;
  const prefPortionG = Math.round((380 * seg.portionPrefBp * city.portionPrefBp) / 1000000);
  const portionFit = clamp(1.4 - Math.abs(dish.portionG - prefPortionG) / 240, -1.2, 1.4);
  const refLocal = Math.max(100, toLocalCents(Math.round((dish.suggestLowCents + dish.suggestHighCents) / 2), city.fxPerCnyBp));
  const ratio = priceCents / refLocal;
  const pSens = (seg.priceSensBp / 1000) * (city.priceSensBp / 1000);
  const pricePenalty = ((ratio - 1) * pSens * 10000) / Math.max(1, elasticityBp);
  return match + flavor + quality + pop + portionFit - pricePenalty - 4.2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 偷工减料被留差评的概率（纯函数）：fillBp=实际用量比例，prefMult=客群×城市份量偏好乘子
export function portionCritChanceBp(fillBp: number, prefMult: number): number {
  const RT = RECIPE_TUNING;
  if (fillBp >= RT.fillComfortBp) return 0;
  const gap = RT.fillComfortBp - fillBp;
  return Math.min(RT.critMaxBp, Math.round(((gap * RT.critBaseBp) / 10000) * ((0.5 + prefMult) / 1.5)));
}

// 当前生效的营销折扣/会员倍率（分店）
export function activeDiscountBp(b: Branch): number {
  let d = 10000;
  for (const c of b.marketing.active) {
    if (c.startDay <= b.day && c.endDay >= b.day && c.outcome === "success" && c.discountBp !== 10000) d = Math.round((d * c.discountBp) / 10000);
  }
  return d;
}

export function activeMemberMultBp(b: Branch): number {
  let m = 10000;
  for (const c of b.marketing.active) {
    if (c.startDay <= b.day && c.endDay >= b.day && c.outcome === "success") m = Math.round((m * c.memberMultBp) / 10000);
  }
  return m;
}

// 纯估算：可选是否计入营销效果/附加加成（用于产能预警与营销归因基准，当地货币口径）
export function estimateExpectedOrders(
  s: GameState,
  b: Branch,
  opts: { marketing?: boolean; extraBoostBp?: number; extraDiscountBp?: number } = {},
): { potential: number; expected: number } {
  const withMkt = opts.marketing !== false;
  const city = CITY_BY_ID[b.cityId];
  const potential = (() => {
    const dist = city.districts.find((d) => d.id === b.districtId) ?? city.districts[0];
    let bp = 10000;
    bp = mulBp(bp, dist.trafficModBp);
    bp = mulBp(bp, DEMAND.weekdayTrafficBp[s.date.weekday]);
    bp = mulBp(bp, DEMAND.seasonTrafficBp[s.date.season] ?? 10000);
    bp = mulBp(bp, WEATHER.trafficBp[s.date.weather]);
    bp = mulBp(bp, repFactorBp(b.reputation));
    bp = mulBp(bp, 10000 + b.regulars * 5);
    bp = mulBp(bp, Math.max(6000, 10000 - Math.round((city.competitionBp - 10000) / 2)));
    if (isHoliday(mmdd(s.date))) bp = mulBp(bp, DEMAND.holidayBp);
    for (const bo of b.boosts) {
      if (bo.untilDay < s.day) continue;
      if (!withMkt && bo.id.startsWith("mk_")) continue;
      bp = mulBp(bp, bo.trafficBp);
    }
    if (opts.extraBoostBp) bp = mulBp(bp, opts.extraBoostBp);
    return Math.round((city.baseDailyTraffic * bp) / 10000);
  })();
  let enterBp = DEMAND.enterRateBp;
  if (b.store.hygiene < 60) enterBp = Math.round(enterBp * (1 - (60 - b.store.hygiene) * 0.008));
  if (b.store.decor + 20 < city.envExpect) enterBp = Math.round(enterBp * 0.94);
  const active = Object.values(b.menu).filter((m) => m.active && DISH_BY_ID[m.dishId] && isDishSellable(s, m.dishId));
  if (active.length === 0) return { potential, expected: 0 };
  let disc = withMkt ? activeDiscountBp(b) : 10000;
  if (opts.extraDiscountBp) disc = Math.round((disc * opts.extraDiscountBp) / 10000);
  const sold: Record<string, number> = {};
  for (const d of b.reports[0]?.dishStats ?? []) sold[d.dishId] = d.sold;
  let wsum = 0, rsum = 0;
  for (const m of active) {
    const dish = DISH_BY_ID[m.dishId];
    const ref = Math.max(100, toLocalCents(Math.round((dish.suggestLowCents + dish.suggestHighCents) / 2), city.fxPerCnyBp));
    const w = Math.max(1, sold[m.dishId] ?? 0);
    wsum += w;
    rsum += ((m.priceCents * disc) / 10000 / ref) * w;
  }
  const avgRatio = rsum / Math.max(1, wsum);
  const citySens = city.priceSensBp / 1000;
  const acceptMult = clamp(1.05 - (avgRatio - 1) * citySens * 0.9, 0.08, 1.05);
  const expected = Math.round(((potential * enterBp) / 10000) * (1 - DEMAND.dishSkipBp / 10000) * acceptMult);
  return { potential, expected };
}

function pickRandom<T>(rngHolder: { rng: number }, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(rngHolder) * arr.length) % arr.length];
}

export function runServiceDay(s: GameState, b: Branch): DayReport {
  const city = CITY_BY_ID[b.cityId];
  const mods = getMods(s.boss.personality);
  const diff = getDiff(s.boss.difficulty);

  const potential = computePotential(s, b);
  let enterBp = DEMAND.enterRateBp;
  if (b.store.hygiene < 60) enterBp = mulBp(enterBp, 10000 - (60 - b.store.hygiene) * 80);
  if (b.store.decor + 20 < city.envExpect) enterBp = mulBp(enterBp, 9400);
  const entered = Math.max(0, Math.min(potential, Math.round((potential * enterBp) / 10000)));

  const activeDishes = Object.values(b.menu).filter((m) => m.active && DISH_BY_ID[m.dishId] && isDishSellable(s, m.dishId));
  const openSlots = b.store.openSlots.filter((sl) => ALL_SLOTS.includes(sl));
  const discBp = activeDiscountBp(b);
  const memberMultBp = activeMemberMultBp(b);
  const priceSim = (dishId: string): number => Math.round(((b.menu[dishId]?.priceCents ?? 0) * discBp) / 10000);

  const allCooks = b.staff.filter((e) => e.role === "cook" && e.trainingUntilDay <= s.day);
  const avgCookSkill = allCooks.length ? Math.round(allCooks.reduce((a, e) => a + e.skill, 0) / allCooks.length) : 10;
  const qualityExp = clamp(60 + (avgCookSkill - 50) / 2 + mods.qualityAdd, 10, 100);

  const dist = city.districts.find((d) => d.id === b.districtId) ?? city.districts[0];
  const segIds = Object.keys(dist.segmentWeights);
  const segWeights = segIds.map((k) => dist.segmentWeights[k]);
  const orders: Customer[] = [];
  let lostToPrice = 0;
  let lostNoStock = 0;
  const reviews: ReviewItem[] = [];

  // 生成期虚拟库存：下单即预扣（分店实际用量口径），实现“卖完”效果
  const virt: Record<string, number> = {};
  function virtNeed(id: string): number { return id in virt ? virt[id] : (virt[id] = availableStock(b, id)); }
  function needOf(dishId: string): Record<string, number> {
    const need: Record<string, number> = {};
    for (const r of effectiveRecipe(b, dishId)) need[r.ingId] = (need[r.ingId] ?? 0) + r.qty;
    return need;
  }
  function canMakeVirt(dishId: string): boolean {
    if (!DISH_BY_ID[dishId]) return false;
    for (const [ingId, q] of Object.entries(needOf(dishId))) if (virtNeed(ingId) < q) return false;
    return true;
  }
  function virtConsume(dishId: string): void {
    for (const [ingId, q] of Object.entries(needOf(dishId))) virt[ingId] = virtNeed(ingId) - q;
  }

  for (let i = 0; i < entered; i++) {
    const seg = SEG_BY_ID[rndWeighted(s, segIds, segWeights)] ?? SEGMENTS[0];
    if (activeDishes.length === 0 || openSlots.length === 0) { lostToPrice++; continue; }
    const slotL: SlotId[] = [];
    const slotW: number[] = [];
    for (const sl of openSlots) { slotL.push(sl); slotW.push(DEMAND.slotShareBp[sl] ?? 2000); }
    const slot = rndWeighted(s, slotL, slotW);
    // 一桌顾客：人数、预算（当地货币）与想点的菜数（1~10）
    const psize = DEMAND.partySize[seg.id] ?? [1, 3];
    const party = rndInt(s, psize[0], psize[1]);
    const budget = Math.max(800, toLocalCents(
      Math.round((seg.budgetCents * party * (10000 + Math.round(seg.budgetSpreadBp * (nextRandom(s) * 2 - 1)))) / 10000),
      city.fxPerCnyBp,
    ));
    const scored = activeDishes
      .map((mi) => ({
        id: mi.dishId,
        u: dishUtility(seg, b.cityId, mi.dishId, priceSim(mi.dishId), qualityExp, mods.priceElasticityBp) + (nextRandom(s) - 0.5) * 0.8,
      }))
      .sort((a, c) => c.u - a.u);
    if (scored.length === 0 || scored[0].u < DEMAND.walkawayUtil || chance(s, DEMAND.dishSkipBp)) { lostToPrice++; continue; }
    const want = Math.min(DEMAND.orderMaxDishes, scored.length, party + rndInt(s, 0, Math.ceil(party * 1.5)));
    const dishes: { dishId: string; priceCents: number }[] = [];
    let spend = 0;
    let noStockAny = false;
    let priceBlock = false;
    for (const cand of scored) {
      if (dishes.length >= want) break;
      if (cand.u - (dishes.length * DEMAND.marginalDecayBp) / 10000 < DEMAND.walkawayUtil) break;
      const price = priceSim(cand.id);
      if (spend + price > budget) { priceBlock = true; continue; }
      if (!canMakeVirt(cand.id)) { noStockAny = true; continue; }
      if (dishes.length > 0 && chance(s, DEMAND.extraDishSkipBp)) break;
      virtConsume(cand.id);
      dishes.push({ dishId: cand.id, priceCents: price });
      spend += price;
    }
    if (dishes.length === 0) {
      if (noStockAny && !priceBlock) {
        lostNoStock++;
        if (chance(s, 1500)) pushReview(reviews, s, seg.name, DISH_BY_ID[scored[0].id].name, 2, "想点的菜卖完了/缺料，白跑一趟。");
      } else {
        lostToPrice++;
        if (chance(s, 800)) pushReview(reviews, s, seg.name, DISH_BY_ID[scored[0].id].name, 2, fmtReview(pickRandom(s, REVIEW_P_BAD), DISH_BY_ID[scored[0].id].name, 0));
      }
      continue;
    }
    orders.push({ seg, slot, dishes, partySize: party });
  }

  // 限单
  let turnedAway = 0;
  if (b.store.orderLimitCovers > 0 && orders.length > b.store.orderLimitCovers) {
    while (orders.length > b.store.orderLimitCovers) {
      const idx = Math.floor(nextRandom(s) * orders.length);
      orders.splice(idx, 1);
      turnedAway++;
      if (chance(s, 600)) pushReview(reviews, s, "被拒顾客", "", 3, "去晚了，店里限单不接了，下次赶早。");
    }
  }

  const dishStats: Record<string, DishDayStat> = {};
  let served = 0, lostToWait = 0, revenueCents = 0, cogsCents = 0, errSpoilCents = 0, satSum = 0;
  let totalCookedDishes = 0;

  for (const slot of openSlots) {
    const slotOrders = orders.filter((o) => o.slot === slot);
    if (slotOrders.length === 0) continue;
    const cooks = onDuty(s, b, slot, "cook");
    const preps = onDuty(s, b, slot, "prep");
    const servers = onDuty(s, b, slot, "server");
    const manager = onDuty(s, b, slot, "manager");
    const cleaners = onDuty(s, b, slot, "cleaner");
    let lines = cooks.length + (preps.length * CAPACITY.prepSupportBp) / 10000;
    lines = (lines * mods.capacityBp) / 10000;
    if (manager.length) lines = (lines * (10000 + CAPACITY.managerEffBp)) / 10000 + 0.2;
    lines = clamp(lines, 0, Math.max(1, b.store.stations * (0.6 + b.store.equipmentHealth / 250)));
    if (cooks.length === 0) lines = 0;
    const seatCap = Math.floor(b.store.seats * (CAPACITY.slotMinutes / (CAPACITY.dineMinutes + CAPACITY.seatClearMin)));
    const serviceCap = servers.length * CAPACITY.serverCoverPerSlot + (manager.length ? 8 : 0);
    let slotServed = 0;
    const lineSlots = Math.max(1, Math.ceil((lines * CAPACITY.batchParallelBp) / 10000));
    const lineBusy: number[] = new Array(lineSlots).fill(0);
    slotOrders.sort(() => nextRandom(s) - 0.5);
    for (let oi = 0; oi < slotOrders.length; oi++) {
      const o = slotOrders[oi];
      const rep0 = DISH_BY_ID[o.dishes[0].dishId];
      if (slotServed >= seatCap || slotServed >= serviceCap || lines <= 0) {
        lostToWait++;
        if (chance(s, 1500)) pushReview(reviews, s, o.seg.name, rep0.name, 2, fmtReview(pickRandom(s, lines <= 0 ? REVIEW_Q_BAD : REVIEW_W_BAD), rep0.name, o.seg.waitTolMin + 20));
        continue;
      }
      let li = 0;
      for (let k = 1; k < lineBusy.length; k++) if (lineBusy[k] < lineBusy[li]) li = k;
      const cook = cooks.length ? cooks[Math.floor(lineBusy[li] * 7 + oi) % cooks.length] : null;
      const skill = cook ? cook.skill : 20;
      let totalPrep = 0;
      for (const dd of o.dishes) {
        const di = DISH_BY_ID[dd.dishId];
        const spd = speedFactorBp(skill, cook ? cook.fatigue : 85, di.difficulty);
        const basePrep = di.makeable ? Math.max(3, Math.round((di.prepMin * CAPACITY.makeablePrepBp) / 10000)) : di.prepMin;
        totalPrep += Math.max(2, Math.round((basePrep * spd * mods.prepTimeBp) / 100000000));
      }
      const arrivalMin = (oi / Math.max(1, slotOrders.length)) * CAPACITY.slotMinutes;
      const start = Math.max(arrivalMin, lineBusy[li]);
      const wait = Math.round(start - arrivalMin);
      lineBusy[li] = start + totalPrep;
      const tolMult = s.story.piousGoodUntilDay >= s.day ? 3 : 1;
      if (wait > o.seg.waitTolMin * tolMult) {
        lostToWait++;
        if (chance(s, 2500)) pushReview(reviews, s, o.seg.name, rep0.name, 2, fmtReview(pickRandom(s, s.story.piousGoodUntilDay >= s.day ? REVIEW_MID : REVIEW_W_BAD), rep0.name, wait));
        continue;
      }
      if (lineBusy[li] > CAPACITY.slotMinutes + CAPACITY.closeBufferMin) { lostToWait++; continue; }
      const servedDishes: { dishId: string; price: number; cogs: number }[] = [];
      for (const dd of o.dishes) {
        const res = cookDish(b, dd.dishId);
        if (res.ok) servedDishes.push({ dishId: dd.dishId, price: dd.priceCents, cogs: res.cogsCents });
        else lostNoStock++;
      }
      if (servedDishes.length === 0) continue;
      const errBp = CAPACITY.errorBaseBp + (100 - skill) * CAPACITY.errorPerLowSkillBp + (cook ? cook.fatigue : 85) * CAPACITY.errorPerFatigueBp + mods.errorRateAddBp;
      let qualitySum = 0, portionSum = 0, revTable = 0, cogsTable = 0, fillSum = 0;
      for (const sd of servedDishes) {
        const di = DISH_BY_ID[sd.dishId];
        const fill = recipeFillBp(b, sd.dishId);
        const RT = RECIPE_TUNING;
        let tuneQ = 0;
        if (fill < RT.fillComfortBp) tuneQ -= Math.round(((RT.fillComfortBp - fill) * RT.qualityCutBp) / 1000000);
        else tuneQ += Math.min(RT.qualityMoreCap, Math.round((Math.max(0, fill - 10000) * RT.qualityMoreBonusBp) / 1000000));
        if (coreIngBp(b, sd.dishId) < RT.coreLowBp) tuneQ -= RT.coreLowQuality;
        let q = clamp(di.baseQuality + qualityOfStaffCook(skill, cook ? cook.fatigue : 85, b.store.equipmentHealth, b.store.kitchenFlow) + mods.qualityAdd + tuneQ, 5, 100);
        if (chance(s, Math.max(0, Math.round(errBp)))) {
          const waste = cookDish(b, sd.dishId);
          if (waste.ok) errSpoilCents += waste.cogsCents;
          q = clamp(q - 18, 5, 100);
        }
        qualitySum += q;
        portionSum += Math.round((di.portionG * fill) / 10000);
        fillSum += fill;
        revTable += sd.price;
        cogsTable += sd.cogs;
        const st = (dishStats[sd.dishId] ??= { dishId: sd.dishId, name: di.name, sold: 0, revenueCents: 0, cogsCents: 0, contributionCents: 0, spoilCents: 0, ratingSum: 0, ratingCount: 0 });
        st.sold++;
        st.revenueCents += sd.price;
        st.cogsCents += sd.cogs;
        st.contributionCents = st.revenueCents - st.cogsCents;
      }
      const quality = Math.round(qualitySum / servedDishes.length);
      const dish = rep0;
      const w = SATISFACTION.weightsBp;
      const qs = clamp01(0.3 + (quality - o.seg.qualityRequire) / 55);
      const ps = clamp01(1 - Math.max(0, revTable / Math.max(1, toLocalCents(o.seg.budgetCents * o.partySize, city.fxPerCnyBp)) - 0.55) * (o.seg.priceSensBp / 1000) * 1.2);
      const prefPortionG = Math.round((380 * o.seg.portionPrefBp * city.portionPrefBp) / 1000000);
      const pos = clamp01(1 - Math.abs(portionSum / servedDishes.length - prefPortionG) / 300);
      const ws = clamp01(1 - wait / Math.max(5, o.seg.waitTolMin + 5));
      const es = clamp01(0.35 + (b.store.decor - o.seg.envRequire) / 55 + (b.store.hygiene - 60) / 90);
      const sat = clamp(Math.round(((qs * w.quality + ps * w.priceValue + pos * w.portion + ws * w.wait + es * w.env) / 10000) * 100) + mods.satisfactionAdd, 0, 100);
      satSum += sat;
      served++;
      slotServed++;
      totalCookedDishes += servedDishes.length;
      revenueCents += revTable;
      cogsCents += cogsTable;
      const score = sat >= 80 ? 5 : sat >= 65 ? 4 : sat >= 50 ? 3 : sat >= 35 ? 2 : 1;
      for (const sd of servedDishes) {
        const st = dishStats[sd.dishId];
        st.ratingSum += score * 10;
        st.ratingCount++;
      }
      const comps: [string, number][] = [["quality", qs], ["price", ps], ["wait", ws], ["portion", pos], ["env", es]];
      const worst = comps.slice().sort((a, c) => a[1] - c[1])[0][0];
      if (sat < 45) {
        const badP = Math.min(7500, 1200 + (45 - sat) * 130);
        if (chance(s, badP)) {
          const pool = worst === "quality" ? REVIEW_Q_BAD
            : worst === "price" ? REVIEW_P_BAD
            : worst === "wait" ? (s.story.piousGoodUntilDay >= s.day ? REVIEW_MID : REVIEW_W_BAD)
            : worst === "portion" ? REVIEW_PORTION_BAD
            : b.store.hygiene < 55 ? REVIEW_H_BAD : REVIEW_BAD;
          pushReview(reviews, s, o.seg.name, dish.name, score, fmtReview(pickRandom(s, pool), dish.name, wait));
        } else if (chance(s, 500)) pushReview(reviews, s, o.seg.name, dish.name, score, pickRandom(s, REVIEW_MID));
      } else if (sat >= 72) {
        const bestIsQuality = qs >= Math.max(ps, ws, pos, es);
        const goodP = sat >= 80 ? Math.min(5200, SATISFACTION.goodReviewChanceBp + (sat - 80) * 90) : 800;
        if (chance(s, goodP)) pushReview(reviews, s, o.seg.name, dish.name, score, fmtReview(pickRandom(s, bestIsQuality ? REVIEW_Q_GOOD : REVIEW_GOOD), dish.name, wait));
        else if (chance(s, 500)) pushReview(reviews, s, o.seg.name, dish.name, score, pickRandom(s, REVIEW_MID));
      } else if (chance(s, 650)) pushReview(reviews, s, o.seg.name, dish.name, score, pickRandom(s, REVIEW_MID));
      if (s.story.piousGoodUntilDay >= s.day && chance(s, 1500)) pushReview(reviews, s, o.seg.name, dish.name, 5, "泥泞中开出了鲜艳的花朵。这才是餐饮人的脊梁。");
      if (s.story.piousFakeUntilDay >= s.day && chance(s, 900)) pushReview(reviews, s, o.seg.name, dish.name, 1, "死装。");
      if (s.story.gayUntilDay >= s.day && chance(s, 500)) {
        const mean = chance(s, 5000);
        pushReview(reviews, s, o.seg.name, dish.name, mean ? 1 : 4, mean ? "死gay，不去了。" : "爱只是爱，老板做自己就好。");
      }
      const tableFill = Math.round(fillSum / servedDishes.length);
      const portionPrefMult = (o.seg.portionPrefBp / 1000) * (city.portionPrefBp / 1000);
      if (tableFill < RECIPE_TUNING.fillComfortBp && chance(s, portionCritChanceBp(tableFill, portionPrefMult))) {
        pushReview(reviews, s, o.seg.name, dish.name, tableFill < 5000 ? 1 : 2, fmtReview(pickRandom(s, tableFill < 6000 ? REVIEW_Q_BAD : REVIEW_PORTION_BAD), dish.name, wait));
      }
      if (sat > 60 && b.regulars < SATISFACTION.regularMax && chance(s, Math.max(0, Math.min(9000, Math.round((o.seg.repurchaseBp * (sat - 55)) / 45 * memberMultBp / 10000))))) b.regulars++;
    }
    b.store.hygiene = clamp(b.store.hygiene - (INVENTORY.hygieneDecayPerSlot + Math.floor(slotServed / 40)), 0, 100);
    if (cleaners.length) b.store.hygiene = clamp(b.store.hygiene + Math.round((INVENTORY.hygieneRestoreCleaner * cleaners.length) / 2), 0, 100);
  }

  // 成本归集（当地货币）
  const wageMult = mulBp(mulBp(mods.wageBp, city.wageFactorBp), diff.costBp);
  const wageCents = b.staff.reduce((a, e) => a + dailyWageCents(e, wageMult), 0);
  const rentCents = Math.round(b.store.rentCents * diff.costBp / 10000);
  const maintainCents = Math.round(b.store.maintainCents * diff.costBp / 10000);
  const utilityCents = Math.round(mulBp(mulBp(b.store.utilityCents, 10000 + served * 6), mods.utilityBp) * diff.costBp / 10000);
  const bg = BACKGROUNDS.find((x) => x.id === s.boss.background)!;
  const married = s.story.marriageStatus === "married";
  const familyCentsLocal = toLocalCents(bg.dailyFixedCents + (married ? STORY_EVENTS.marriage.arrangeFeeCents : 0), city.fxPerCnyBp);
  const spoilStockCents = storageLoss(b);
  const spoilCents = Math.round(spoilStockCents * mods.spoilBp / 10000) + errSpoilCents;
  const otherCostCents = maintainCents;

  const staffGrowth = applyWorkImpact(s, b, totalCookedDishes, (() => {
    const rr: Record<RoleId, number> = { cook: 0, prep: 0, server: 0, manager: 0, cleaner: 0 };
    for (const e of b.staff) if (e.shifts.length > 0 && e.trainingUntilDay <= s.day) rr[e.role]++;
    return rr;
  })(), lostToWait > served / 2);

  const avgSat = served > 0 ? Math.round(satSum / served) : 0;
  let repDelta = 0;
  if (served > 0) {
    repDelta = Math.round(((avgSat - 58) * SATISFACTION.repGainPerSatisfiedBp * mods.repGainBp) / 10000);
    const decay = Math.round(((b.reputation - 500) * SATISFACTION.repDecayPerDayBp * (mods.repDecayBp / 10000) * (diff.repDecayBp / 10000)) / 10000);
    repDelta -= decay;
  }
  repDelta -= reviews.filter((r) => r.score <= 2).length * 4;
  if (married) repDelta += STORY_EVENTS.marriage.arrangeRepPerDay;
  b.reputation = clamp(b.reputation + repDelta, 0, 1000);
  b.store.equipmentHealth = clamp(b.store.equipmentHealth - Math.max(1, Math.round(INVENTORY.equipmentDecayPerDay / 10)), 0, 100);

  const netProfit = revenueCents - cogsCents - wageCents - rentCents - utilityCents - spoilCents - familyCentsLocal - otherCostCents;

  b.ledger.push({ day: s.day, account: "revenue", amountCents: revenueCents, cash: true, memo: "营业流水" });
  if (cogsCents > 0) b.ledger.push({ day: s.day, account: "cogs", amountCents: -cogsCents, cash: false, memo: "食材消耗成本" });
  if (wageCents > 0) b.ledger.push({ day: s.day, account: "wage", amountCents: -wageCents, cash: true, memo: "员工工资" });
  if (rentCents > 0) b.ledger.push({ day: s.day, account: "rent", amountCents: -rentCents, cash: true, memo: "房租" });
  if (utilityCents > 0) b.ledger.push({ day: s.day, account: "utility", amountCents: -utilityCents, cash: true, memo: "水电燃气" });
  if (spoilCents > 0) b.ledger.push({ day: s.day, account: "spoil", amountCents: -spoilCents, cash: false, memo: "损耗报废" });
  if (otherCostCents > 0) b.ledger.push({ day: s.day, account: "other", amountCents: -otherCostCents, cash: true, memo: "维护杂费" });
  if (familyCentsLocal > 0) b.ledger.push({ day: s.day, account: "family", amountCents: -familyCentsLocal, cash: true, memo: `${bg.fixedMemo || "家庭固定支出"}${married ? "（含婚后家用）" : ""}` });

  b.cashCents += revenueCents - wageCents - rentCents - utilityCents - otherCostCents - familyCentsLocal;

  b.reviews = [...reviews.slice().reverse().slice(0, 40), ...b.reviews].slice(0, SATISFACTION.reviewCap);

  // 营销归因
  const mktSuccess = b.marketing.active.filter((c) => c.startDay <= s.day && c.endDay >= s.day && c.outcome === "success");
  if (mktSuccess.length > 0) {
    const baseline = estimateExpectedOrders(s, b, { marketing: false }).expected;
    const observedExtra = Math.max(0, served - baseline);
    const upliftSum = mktSuccess.reduce((a, c) => a + Math.max(0, c.upliftExpected), 0) || 1;
    const avgRev = served > 0 ? Math.round(revenueCents / served) : 0;
    const avgGross = served > 0 ? Math.round((revenueCents - cogsCents) / served) : 0;
    for (const c of mktSuccess) {
      const shareBp = Math.round((Math.max(0, c.upliftExpected) * 10000) / upliftSum);
      const extra = Math.min(served, Math.round((observedExtra * shareBp) / 10000));
      c.servedExtra += extra;
      c.revenueExtraCents += extra * avgRev;
      c.grossExtraCents += extra * avgGross;
      c.settledDays++;
    }
  }

  const topDish = Object.values(dishStats).sort((a, c) => c.contributionCents - a.contributionCents)[0]?.name ?? null;

  return {
    day: s.day,
    cityId: b.cityId,
    dateLabel: `${s.date.year}-${String(s.date.month).padStart(2, "0")}-${String(s.date.dayOfMonth).padStart(2, "0")} ${CALENDAR.weekdayNames[s.date.weekday]}`,
    weather: s.date.weather,
    potential, entered, served, lostToWait: lostToWait + lostToPrice + turnedAway, lostNoStock,
    revenueCents, cogsCents, wageCents, rentCents, utilityCents, spoilCents,
    compCents: 0, eventCents: 0, familyCents: familyCentsLocal, otherCostCents,
    netProfitCents: netProfit, cashEndCents: b.cashCents,
    rep: b.reputation, repDelta,
    avgSatisfaction: avgSat,
    dishStats: Object.values(dishStats).sort((a, c) => c.revenueCents - a.revenueCents),
    topDish,
    reviews: reviews.slice(0, 12),
    staffGrowth,
    forecast: forecastTomorrow(s, b),
  };
}

function pushReview(arr: ReviewItem[], s: GameState, segName: string, dishName: string, score: number, text: string): void {
  arr.push({ day: s.day, segName, dishName, score, text });
}

function fmtReview(t: string, dishName: string, wait: number): string {
  return t.replace("{dish}", dishName).replace("{wait}", String(Math.max(5, Math.round(wait))));
}
