// 每日流程（多分店）：分店级计划检查/确认/结算（幂等），全局日期推进时逐店处理
import type { Branch, GameState, PendingEvent, PurchaseSuggestion } from "../types";
import { BACKGROUNDS, FINANCE, STORY_EVENTS } from "../config";
import { mmdd, runServiceDay, forecastTomorrow, estimateExpectedOrders } from "./simulation";
import { marketUpdate, runAutoRestock } from "./market";
import { addLot, processExpiry, availableStock } from "./inventory";
import { DEMAND, CALENDAR, WEATHER, CAPACITY } from "../config";
import { clamp } from "../utils";
import { CITY_BY_ID, toCnyCents, toLocalCents } from "../data/cities";
import { dailyStaffUpdate, genCandidates, ROLE_NAMES, hasSchedulingManager, autoScheduleByManager } from "./staff";
import { createPending, createWageCrisis, expirePendingEvents, findDef, tryDailyEvents, tryParentCall } from "./events";
import { dayToDate, rollWeather } from "./newGame";
import { isDishSellable } from "./research";
import { DISH_BY_ID } from "../data/dishes";
import { ING_BY_ID } from "../data/ingredients";
import { effectiveRecipe } from "./inventory";

export interface PlanCheck {
  errors: string[];
  warnings: string[];
}

export function slotLabel(slot: string): string {
  return { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", night: "夜宵" }[slot] ?? slot;
}

export function checkPlan(s: GameState, b: Branch): PlanCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (s.over) { errors.push("游戏已结束"); return { errors, warnings }; }
  for (const p of s.events.pending) {
    if (p.blocking) errors.push(`未处理的紧急事件：${p.cityId === b.cityId ? "" : `【${CITY_BY_ID[p.cityId].name}】`}${p.title}`);
  }
  const active = Object.values(b.menu).filter((m) => m.active && isDishSellable(s, m.dishId));
  if (active.length === 0) errors.push("该店菜单上没有任何在售（且已解锁）菜品——可点「今日歇业」跳过本店");
  if (b.cashCents < 0) errors.push("该店现金为负：先处理欠薪危机事件");
  for (const slot of b.store.openSlots) {
    const cooks = b.staff.filter((e) => e.role === "cook" && e.shifts.includes(slot) && e.trainingUntilDay <= s.day);
    if (cooks.length === 0) warnings.push(`${slotLabel(slot)}没有排厨师，该时段无法出餐`);
    const servers = b.staff.filter((e) => e.role === "server" && e.shifts.includes(slot));
    if (servers.length === 0) warnings.push(`${slotLabel(slot)}没有服务员，接待能力极低`);
  }
  for (const m of active) {
    const miss = missingIngrNames(s, b, m.dishId);
    if (miss.length > 0) warnings.push(`${dishName(m.dishId)} 缺料：${miss.join("、")}`);
  }
  if (b.store.hygiene < 50) warnings.push("卫生状况堪忧，顾客进店率下降");
  if (b.store.equipmentHealth < 40) warnings.push("设备健康度过低，出错率上升");
  for (const e of b.staff) if (e.fatigue > 80) warnings.push(`${e.name} 疲劳过高（${e.fatigue}），效率与出错将受影响`);
  const dem = estimateDemand(s, b);
  if (dem.expected > dem.capacity * 1.2) {
    warnings.push(`按当前菜单价格预计约 ${dem.expected} 桌（客流 ${dem.potential} 桌），超过有效产能 ${Math.floor(dem.capacity)} 桌：加人排班、设置“限单”或适当提价抑制需求${hasSchedulingManager(b, s.day) ? "（本店有排班店长，会自动接管排班与轮休）" : ""}`);
  } else if (dem.expected > dem.capacity * 0.95) {
    warnings.push(`预计 ${dem.expected} 桌接近产能 ${Math.floor(dem.capacity)} 桌，高峰时段将有排队流失`);
  }
  return { errors, warnings };
}

// 按当前价格估算今日需求与有效产能（当地桌数口径）
export function estimateDemand(s: GameState, b: Branch): { potential: number; expected: number; capacity: number } {
  const est = estimateExpectedOrders(s, b, { marketing: true });
  let capacity = roughCapacity(s, b);
  if (b.store.orderLimitCovers > 0) capacity = Math.min(capacity, b.store.orderLimitCovers);
  return { potential: est.potential, expected: est.expected, capacity };
}

export function roughCapacity(s: GameState, b: Branch): number {
  let total = 0;
  const city = CITY_BY_ID[b.cityId];
  void city;
  for (const slot of b.store.openSlots) {
    const cooks = b.staff.filter((e) => e.role === "cook" && e.shifts.includes(slot) && e.trainingUntilDay <= s.day).length;
    if (cooks === 0) continue;
    const preps = b.staff.filter((e) => e.role === "prep" && e.shifts.includes(slot) && e.trainingUntilDay <= s.day).length;
    const servers = b.staff.filter((e) => e.role === "server" && e.shifts.includes(slot) && e.trainingUntilDay <= s.day).length;
    const seatCap = Math.floor(b.store.seats * (CAPACITY.slotMinutes / (CAPACITY.dineMinutes + CAPACITY.seatClearMin)));
    const lines = Math.min(cooks + preps * (CAPACITY.prepSupportBp / 10000), b.store.stations * (0.6 + b.store.equipmentHealth / 250));
    const kitchenDishes = (CAPACITY.slotMinutes * lines * CAPACITY.batchParallelBp) / (10000 * 12);
    const kitchen = Math.floor((kitchenDishes * 10000) / DEMAND.avgDishesPerTableBp);
    total += Math.max(0, Math.min(seatCap, servers * CAPACITY.serverCoverPerSlot, kitchen));
  }
  return total;
}

function dishName(id: string): string {
  return DISH_BY_ID[id]?.name ?? id;
}

function missingIngrNames(_s: GameState, b: Branch, dishId: string): string[] {
  const out: string[] = [];
  const need: Record<string, number> = {};
  for (const r of effectiveRecipe(b, dishId)) need[r.ingId] = (need[r.ingId] ?? 0) + r.qty;
  for (const [ingId, q] of Object.entries(need)) {
    if (availableStock(b, ingId) < q) out.push(ING_BY_ID[ingId]?.name ?? ingId);
  }
  return out;
}

export function confirmPlan(s: GameState, b: Branch): { ok: boolean; messages: string[] } {
  if (b.phase !== "planning") return { ok: false, messages: ["该店当前不在计划阶段"] };
  const { errors } = checkPlan(s, b);
  if (errors.length > 0) return { ok: false, messages: errors };
  b.phase = "confirmed";
  b.planConfirmedDirty = false;
  return { ok: true, messages: [`${CITY_BY_ID[b.cityId].name}店营业计划已确认`] };
}

export function closeToday(s: GameState, b: Branch): { ok: boolean; error?: string } {
  if (s.over) return { ok: false, error: "游戏已结束" };
  if (b.phase === "report") return { ok: false, error: "今日该店已结算" };
  b.phase = "report";
  b.closedToday = true;
  b.settledDay = s.day;
  b.lastReportDay = s.day;
  return { ok: true };
}

// 结算：幂等（同店同日重复调用不会重复记账）
export function settleDay(s: GameState, b: Branch): { ok: boolean; error?: string; reportId?: number } {
  if (s.over) return { ok: false, error: "游戏已结束" };
  if (b.phase === "report") return { ok: true, reportId: b.day };
  if (b.phase !== "confirmed") return { ok: false, error: "请先确认该店营业计划（或选择今日歇业）" };
  if (b.settledDay === s.day) return { ok: true, reportId: s.day };
  const report = runServiceDay(s, b);
  b.reports.unshift(report);
  while (b.reports.length > 60) b.reports.pop();
  b.settledDay = s.day;
  b.lastReportDay = s.day;
  b.phase = "report";
  if (b.cashCents < 0) {
    b.negCashStreak++;
    createWageCrisis(s, b);
  } else {
    b.negCashStreak = 0;
  }
  return { ok: true, reportId: b.day };
}

export interface NewDayResult { messages: string[]; blocked?: string }

export function pendingSettleCities(s: GameState): string[] {
  return Object.values(s.branches)
    .filter((b) => b.phase !== "report")
    .map((b) => CITY_BY_ID[b.cityId].name);
}

export function newDay(s: GameState): NewDayResult {
  const messages: string[] = [];
  if (s.over) return { messages: ["游戏已结束"] };
  const notReady = pendingSettleCities(s);
  if (notReady.length > 0) return { messages: [], blocked: `还有城市未结算/未歇业：${notReady.join("、")}` };

  s.day++;
  const weather = rollWeather(s, s.date.season, s.date.weather);
  s.date = dayToDate(s.day, weather);

  for (const b of Object.values(s.branches)) {
    b.day = s.day;
    // 配送到货
    const arrived = b.pendingDeliveries.filter((d) => d.arriveDay <= s.day);
    for (const d of arrived) {
      addLot(b, d.ingId, d.qty, d.unitPriceCents, d.perPurchase, d.expiresDay, d.storage, s.day);
      messages.push(`【${CITY_BY_ID[b.cityId].name}】${ING_BY_ID[d.ingId]?.name ?? d.ingId} ${d.qty}${ING_BY_ID[d.ingId]?.unit === "g" ? "g" : "个"} 已到货`);
    }
    b.pendingDeliveries = b.pendingDeliveries.filter((d) => d.arriveDay > s.day);

    // 过期食材：暂存并出现处置事件（未处理会累积为同一事件）
    const spoil = processExpiry(b);
    if (spoil.valueCents > 0) {
      for (const l of spoil.lots) b.pendingSpoilage.push({ ingId: l.ingId, qty: l.qty, unitPriceCents: l.unitPriceCents, perPurchase: l.perPurchase, purchasedDay: l.purchasedDay ?? 1, expiredDay: s.day });
      const def = findDef("expiry_alarm");
      if (def) {
        const existing = s.events.pending.find((p) => p.defId === "expiry_alarm" && p.cityId === b.cityId);
        if (existing) existing.data = def.build(s, b).data;
        else createPending(s, b, def);
      }
      messages.push(`【${CITY_BY_ID[b.cityId].name}】清理出账面 ${spoil.valueCents} 分的过期食材（${spoil.items.join("、")}），等待处置`);
    }

    b.boosts = b.boosts.filter((x) => x.untilDay >= s.day);

    // 营销结案
    const stillMkt: Branch["marketing"]["active"] = [];
    for (const c of b.marketing.active) {
      if (c.endDay < s.day) {
        if (c.outcome === "success") c.newRegulars = Math.max(0, b.regulars - c.baselineRegulars);
        b.marketing.history.unshift(c);
      } else stillMkt.push(c);
    }
    b.marketing.active = stillMkt;
    while (b.marketing.history.length > 40) b.marketing.history.pop();

    // 市场更新（各城独立价格演化）
    marketUpdate(s, b);

    // 节假日加成（各店独立）
    if ((DEMAND.holidays as readonly string[]).includes(mmdd(s.date))) {
      b.boosts.push({ id: "holiday_" + s.day, label: "节假日人流", trafficBp: DEMAND.holidayBp, untilDay: s.day, persistent: false });
    }

    // 员工：休息/离职
    const shortBp = b.reports[0] && b.reports[0].lostToWait > b.reports[0].served / 2 ? 600 : 100;
    const left = dailyStaffUpdate(s, b, shortBp);
    for (const e of left) {
      messages.push(`【${CITY_BY_ID[b.cityId].name}】${ROLE_NAMES[e.role]} ${e.name} 递交了离职信`);
      b.reputation = Math.max(0, b.reputation - 3);
    }
    // 承诺离职者到点开走
    const going = b.staff.filter((x) => x.pendingLeaveDay === s.day);
    if (going.length > 0) {
      b.staff = b.staff.filter((x) => x.pendingLeaveDay !== s.day);
      for (const e of going) messages.push(`【${CITY_BY_ID[b.cityId].name}】${e.name} 回乡照顾父母去了`);
    }
    // 排班店长接管排班与轮休
    for (const m of autoScheduleByManager(s, b)) messages.push(`【${CITY_BY_ID[b.cityId].name}】${m}`);

    // 候选池刷新
    if (s.day - b.poolGenerationDay >= 3) {
      b.candidatePool = genCandidates(s, b);
      b.poolGenerationDay = s.day;
    }

    b.purchasesToday = [];
    b.phase = "planning";
    b.closedToday = false;
    b.planConfirmedDirty = true;
  }

  expirePendingEvents(s);
  tryDailyEvents(s);
  tryParentCall(s);

  // 延迟触发的后续事件
  const due = s.scheduled.filter((x) => x.triggerDay <= s.day);
  s.scheduled = s.scheduled.filter((x) => x.triggerDay > s.day);
  for (const sc of due) {
    const b = s.branches[sc.cityId];
    const def = findDef(sc.defId);
    if (!b || !def) continue;
    if (sc.defId === "staff_family_hardship" && !b.staff.some((x) => x.id === Number(sc.data.empId))) continue;
    createPending(s, b, def, sc.data);
    messages.push(`后续事件【${CITY_BY_ID[sc.cityId].name}】：${def.title}`);
  }

  // 全局破产判定：所有现金折合人民币连续为负
  const totalCny = Object.values(s.branches).reduce((acc, b) => acc + toCnyCents(b.cashCents, CITY_BY_ID[b.cityId].fxPerCnyBp), 0);
  if (totalCny < 0) s.negCashStreak++;
  else s.negCashStreak = 0;
  if (s.negCashStreak >= FINANCE.bankruptcyGraceDays) {
    s.over = true;
    messages.push("所有资金（折合人民币）连续为负，房东和供应商联手收走了店面。《今天也没倒闭》——这次倒了。");
  }

  return { messages };
}

export function forecastLine(s: GameState, b: Branch): string {
  const f = forecastTomorrow(s, b);
  return `${CITY_BY_ID[b.cityId].name}店次日预测：${f.label}，潜在客流约 ${f.est} 桌`;
}

// 当日建议购入：在售且已解锁菜品按昨日销量(×1.1，无数据按8份)推算原料缺口（本店库存与市价口径）
export function suggestPurchase(s: GameState, b: Branch): PurchaseSuggestion[] {
  const stats = b.reports[0]?.dishStats ?? [];
  const demand: Record<string, number> = {};
  for (const mi of Object.values(b.menu)) {
    if (!mi.active || !isDishSellable(s, mi.dishId)) continue;
    const dish = DISH_BY_ID[mi.dishId];
    if (!dish) continue;
    const found = stats.find((x) => x.dishId === mi.dishId);
    const plan = found ? Math.max(3, Math.ceil((found.sold * 11) / 10)) : 8;
    for (const r of effectiveRecipe(b, mi.dishId)) demand[r.ingId] = (demand[r.ingId] ?? 0) + r.qty * plan;
  }
  const out: PurchaseSuggestion[] = [];
  for (const [ingId, need] of Object.entries(demand)) {
    const def = ING_BY_ID[ingId];
    if (!def) continue;
    const stock = availableStock(b, ingId);
    const gap = need - stock;
    if (gap <= 0) continue;
    const short = Math.ceil(gap / def.moq) * def.moq;
    out.push({
      ingId, name: def.name, demand: need, stock, shortage: short,
      estCostCents: Math.round((short * b.market[ingId].priceCents) / def.perPurchase),
    });
  }
  return out.sort((a, b2) => b2.estCostCents - a.estCostCents);
}

// 汇率工具透传（UI 资金周转用）
export { toLocalCents };
