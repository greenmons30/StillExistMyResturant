// Reducer：所有玩家操作都经由此处进入引擎；城市级操作作用于当前分店(activeCityId)
import type { CuisineId, GameState, SlotId } from "./types";
import { DECOR, RECIPE_TUNING } from "./config";
import { purchase, runAutoRestock, supplierById } from "./engine/market";
import { netWorthCents } from "./engine/finance";
import { ING_BY_ID } from "./data/ingredients";
import { DISH_BY_ID } from "./data/dishes";
import { CITY_BY_ID, toCnyCents, toLocalCents } from "./data/cities";
import { assignShifts, fire, hire, trainEmployee } from "./engine/staff";
import { checkPlan, closeToday, confirmPlan, newDay, settleDay, suggestPurchase } from "./engine/dayflow";
import { resolveEvent } from "./engine/events";
import { launchCampaign } from "./engine/marketing";
import { isDishSellable, learnCuisine, researchCancel, researchStart, researchSubmit } from "./engine/research";
import { createNewGame, newBranch, type NewGameInput } from "./engine/newGame";
import { genCandidates } from "./engine/staff";

export type Action =
  | { type: "NEW_GAME"; input: NewGameInput }
  | { type: "LOAD_STATE"; state: GameState }
  | { type: "NEW_GAME_RESET" }
  | { type: "SWITCH_CITY"; cityId: string }
  | { type: "OPEN_BRANCH"; cityId: string }
  | { type: "MOVE_DISTRICT"; districtId: string }
  | { type: "TRANSFER_FUNDS"; toCityId: string; cents: number }
  | { type: "CLOSE_TODAY" }
  | { type: "BUY"; ingId: string; qty: number; supplierId: string }
  | { type: "CART_ADD"; ingId: string; qty: number; supplierId: string }
  | { type: "CART_ADD_SUGGESTED"; supplierId: string }
  | { type: "CART_REMOVE"; index: number }
  | { type: "CART_CLEAR" }
  | { type: "CART_CHECKOUT" }
  | { type: "AUTO_RESTOCK_SAVE"; items: { ingId: string; targetQty: number }[]; days: number; supplierId: string }
  | { type: "AUTO_RESTOCK_RUN" }
  | { type: "AUTO_RESTOCK_STOP" }
  | { type: "SET_PRICE"; dishId: string; priceCents: number }
  | { type: "TOGGLE_DISH"; dishId: string }
  | { type: "SET_RECIPE"; dishId: string; ingId: string; bp: number }
  | { type: "RESET_RECIPE"; dishId: string }
  | { type: "SET_OPEN_SLOTS"; slots: SlotId[] }
  | { type: "SET_ORDER_LIMIT"; covers: number }
  | { type: "HIRE"; poolId: number }
  | { type: "FIRE"; empId: number }
  | { type: "ASSIGN_SHIFTS"; empId: number; shifts: SlotId[] }
  | { type: "TRAIN"; empId: number }
  | { type: "CONFIRM_PLAN" }
  | { type: "SETTLE" }
  | { type: "NEW_DAY" }
  | { type: "RESOLVE_EVENT"; uid: number; optionId: string; payload?: Record<string, string> }
  | { type: "DECOR_UPGRADE"; level: number }
  | { type: "TAKE_REPAIR" }
  | { type: "LAUNCH_MARKETING"; defId: string; tier: string; targetSeg: string }
  | { type: "LEARN_CUISINE"; cuisine: CuisineId }
  | { type: "RESEARCH_START"; dishId: string }
  | { type: "RESEARCH_SUBMIT"; ings: string[] }
  | { type: "RESEARCH_CANCEL" };

export interface DispatchResult {
  state: GameState | null;
  message?: string;
  error?: string;
  messages?: string[];
}

export function dispatch(prev: GameState | null, a: Action): DispatchResult {
  if (a.type === "NEW_GAME") {
    const s = createNewGame(a.input);
    return { state: s, message: `${s.boss.restaurantName} 在${CITY_BY_ID[s.activeCityId].name}开业。今天也没倒闭。` };
  }
  if (a.type === "LOAD_STATE") return { state: a.state };
  if (a.type === "NEW_GAME_RESET") return { state: null };
  if (!prev) return { state: null, error: "没有进行中的游戏" };
  const s: GameState = structuredClone(prev);
  const b = s.branches[s.activeCityId];
  if (!b) return { state: prev, error: "当前城市分店不存在" };
  const cityName = CITY_BY_ID[b.cityId].name;

  switch (a.type) {
    case "SWITCH_CITY": {
      if (!s.branches[a.cityId]) return { state: prev, error: "该城市尚未开设分店" };
      s.activeCityId = a.cityId;
      return { state: s, message: `已切换到 ${CITY_BY_ID[a.cityId].name} 分店` };
    }
    case "OPEN_BRANCH": {
      const city = CITY_BY_ID[a.cityId];
      if (!city) return { state: prev, error: "未知城市" };
      if (s.branches[a.cityId]) return { state: prev, error: "该城市已有分店" };
      const worthCny = netWorthCents(s);
      if (worthCny < city.unlockNetWorthCents) return { state: prev, error: `净资产不足：${city.name}需折合人民币 ${Math.floor(city.unlockNetWorthCents / 100)} 元（当前 ${Math.floor(worthCny / 100)} 元）` };
      const costCny = city.openCostCents + city.districts[0].setupCostCents;
      const costLocal = toLocalCents(costCny, CITY_BY_ID[b.cityId].fxPerCnyBp);
      if (b.cashCents < costLocal) return { state: prev, error: `${cityName}店现金不足（加盟费+押金折合 ${Math.floor(costCny / 100)} 元，需本店支出 ${Math.floor(costLocal / 100)}）` };
      b.cashCents -= costLocal;
      b.ledger.push({ day: s.day, account: "other", amountCents: -costLocal, cash: true, memo: `开设${city.name}分店：加盟费与押金` });
      const nb = newBranch(s, a.cityId, city.districts[0].id, false);
      nb.reputation = 450;
      nb.candidatePool = genCandidates(s, nb);
      s.branches[a.cityId] = nb;
      s.unlockedCities.push(a.cityId);
      s.activeCityId = a.cityId;
      return { state: s, message: `${city.name}分店开业！初始0现金0库存，请从其他城市周转资金、采购铺货。` };
    }
    case "MOVE_DISTRICT": {
      const city = CITY_BY_ID[b.cityId];
      const idx = city.districts.findIndex((d) => d.id === b.districtId);
      const nidx = city.districts.findIndex((d) => d.id === a.districtId);
      if (nidx !== idx + 1) return { state: prev, error: "门店规模只能逐级迁移到下一个商圈（扩张承担现金流风险）" };
      const dist = city.districts[nidx];
      const cost = toLocalCents(dist.setupCostCents, city.fxPerCnyBp);
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段迁移商圈" };
      if (b.cashCents < cost) return { state: prev, error: `现金不足：迁入${dist.name}需 ${Math.floor(cost / 100)}` };
      b.cashCents -= cost;
      b.ledger.push({ day: s.day, account: "other", amountCents: -cost, cash: true, memo: `迁址升级：${dist.name}` });
      b.districtId = dist.id;
      b.store.seats = dist.seats;
      b.store.stations = dist.stations;
      b.store.capacityMultBp = dist.capacityMultBp;
      b.store.decor = Math.max(b.store.decor, dist.decorStart);
      const rentScale = dist.rentCents / city.districts[idx].rentCents;
      b.store.rentCents = Math.round(b.store.rentCents * rentScale);
      b.store.utilityCents = Math.round(b.store.utilityCents * rentScale);
      b.store.maintainCents = Math.round(b.store.maintainCents * rentScale);
      b.planConfirmedDirty = true;
      return { state: s, message: `${cityName}店已迁入${dist.name}：${dist.seats}座 ${dist.stations}灶，日租 ${Math.floor(b.store.rentCents / 100)}` };
    }
    case "TRANSFER_FUNDS": {
      const target = s.branches[a.toCityId];
      if (!target || a.toCityId === b.cityId) return { state: prev, error: "目标城市无效" };
      if (!Number.isInteger(a.cents) || a.cents <= 0) return { state: prev, error: "周转金额需为正整数（当地分）" };
      if (b.cashCents < a.cents) return { state: prev, error: `${cityName}店现金不足` };
      const receive = toLocalCents(toCnyCents(a.cents, CITY_BY_ID[b.cityId].fxPerCnyBp), CITY_BY_ID[target.cityId].fxPerCnyBp);
      b.cashCents -= a.cents;
      target.cashCents += receive;
      b.ledger.push({ day: s.day, account: "transferOut", amountCents: -a.cents, cash: true, memo: `资金周转→${CITY_BY_ID[target.cityId].name}` });
      target.ledger.push({ day: s.day, account: "transferIn", amountCents: receive, cash: true, memo: `资金周转←${cityName}` });
      target.planConfirmedDirty = true;
      return { state: s, message: `周转成功：${cityName}支出 ${a.cents} 分（${CITY_BY_ID[b.cityId].currency}），${CITY_BY_ID[target.cityId].name}到账 ${receive} 分（按汇率折算）` };
    }
    case "CLOSE_TODAY": {
      const r = closeToday(s, b);
      return r.ok ? { state: s, message: `${cityName}店今日歇业（不结算营收，员工不上工无工资）` } : { state: prev, error: r.error };
    }
    case "BUY": {
      const r = purchase(s, b, a.ingId, a.qty, a.supplierId);
      return r.ok ? { state: s, message: `采购完成，支出 ${r.costCents} 分` } : { state: prev, error: r.error };
    }
    case "CART_ADD": {
      const def = ING_BY_ID[a.ingId];
      if (!def) return { state: prev, error: "未知食材" };
      if (!supplierById(a.supplierId)) return { state: prev, error: "未知供应商" };
      if (!Number.isInteger(a.qty) || a.qty < def.moq) return { state: prev, error: `不足起订量（${def.moq}${def.unit === "g" ? "g" : "个"}）` };
      const idx = b.cart.findIndex((c) => c.ingId === a.ingId && c.supplierId === a.supplierId);
      if (idx >= 0) {
        b.cart[idx] = { ...b.cart[idx], qty: b.cart[idx].qty + a.qty };
        return { state: s, message: `已加入购物车：${def.name}（合并为 ${b.cart[idx].qty}${def.unit}）` };
      }
      b.cart.push({ ingId: a.ingId, qty: a.qty, supplierId: a.supplierId });
      return { state: s, message: `已加入购物车：${def.name} ${a.qty}${def.unit}` };
    }
    case "CART_ADD_SUGGESTED": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段加入购物车" };
      if (!supplierById(a.supplierId)) return { state: prev, error: "未知供应商" };
      const list = suggestPurchase(s, b);
      if (list.length === 0) return { state: prev, error: "当前没有缺料预警（库存均达到建议量）" };
      let added = 0;
      for (const x of list) {
        const idx = b.cart.findIndex((c) => c.ingId === x.ingId && c.supplierId === a.supplierId);
        if (idx >= 0) b.cart[idx] = { ...b.cart[idx], qty: Math.max(b.cart[idx].qty, x.shortage) };
        else { b.cart.push({ ingId: x.ingId, qty: x.shortage, supplierId: a.supplierId }); added++; }
      }
      return { state: s, message: `已按本店建议量加入购物车 ${list.length} 种缺料食材（供应商：${supplierById(a.supplierId) ? CITY_BY_ID[b.cityId].supplierNames[a.supplierId] : a.supplierId}），请到购物车一键购买` };
    }
    case "CART_REMOVE": {
      if (a.index < 0 || a.index >= b.cart.length) return { state: prev, error: "条目不存在" };
      const removed = b.cart.splice(a.index, 1)[0];
      return { state: s, message: `已从购物车移除：${ING_BY_ID[removed.ingId]?.name ?? removed.ingId}` };
    }
    case "CART_CLEAR": {
      if (b.cart.length === 0) return { state: prev, error: "购物车为空" };
      b.cart = [];
      return { state: s, message: "购物车已清空" };
    }
    case "CART_CHECKOUT": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段结算购物车" };
      if (b.cart.length === 0) return { state: prev, error: "购物车为空" };
      let okCount = 0, spentCents = 0;
      const failedMsgs: string[] = [];
      const remaining: GameState["branches"][string]["cart"] = [];
      for (const item of b.cart) {
        const r = purchase(s, b, item.ingId, item.qty, item.supplierId);
        if (r.ok) { okCount++; spentCents += r.costCents ?? 0; }
        else {
          remaining.push(item);
          const nm = ING_BY_ID[item.ingId]?.name ?? item.ingId;
          const msg = `${nm}：${r.error ?? "购买失败"}`;
          if (!failedMsgs.includes(msg)) failedMsgs.push(msg);
        }
      }
      b.cart = remaining;
      const m = `购物车结算：成功 ${okCount} 项（支出 ${spentCents} 分）${remaining.length ? `，${remaining.length} 项失败留在车内` : ""}`;
      return { state: s, message: m, messages: failedMsgs.length ? failedMsgs : undefined };
    }
    case "AUTO_RESTOCK_SAVE": {
      if (!supplierById(a.supplierId)) return { state: prev, error: "未知供应商" };
      if (!Number.isInteger(a.days) || a.days < 1 || a.days > 365) return { state: prev, error: "自动购入时长需为1~365天" };
      const norm: { ingId: string; targetQty: number }[] = [];
      for (const it of a.items) {
        const def = ING_BY_ID[it.ingId];
        if (!def) return { state: prev, error: `未知食材：${it.ingId}` };
        if (!Number.isInteger(it.targetQty) || it.targetQty < def.moq) continue;
        const ex = norm.findIndex((x) => x.ingId === it.ingId);
        if (ex >= 0) norm[ex] = { ingId: it.ingId, targetQty: it.targetQty };
        else norm.push({ ingId: it.ingId, targetQty: it.targetQty });
      }
      if (norm.length === 0) return { state: prev, error: "没有有效的自动购入食材（目标量不能低于起订量）" };
      b.autoRestock = { enabled: true, untilDay: s.day + a.days - 1, items: norm, supplierId: a.supplierId };
      return { state: s, message: `${cityName}店自动购入已设置：${norm.length} 种食材，第 ${s.day}~${b.autoRestock.untilDay} 天内可点击「自动购入」补足（不会自动执行）` };
    }
    case "AUTO_RESTOCK_RUN": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段执行自动购入" };
      if (!b.autoRestock.enabled || b.autoRestock.items.length === 0) return { state: prev, error: "尚未设置自动购入或已停用" };
      if (s.day > b.autoRestock.untilDay) return { state: prev, error: "自动购入设置已过期，请重新设置时长" };
      const r = runAutoRestock(s, b);
      const m = `自动购入执行：补齐 ${r.bought} 种食材${r.spentCents > 0 ? `，支出 ${r.spentCents} 分` : ""}${r.messages.length ? `；${r.messages.join("；")}` : ""}`;
      return { state: s, message: m };
    }
    case "AUTO_RESTOCK_STOP": {
      if (!b.autoRestock.enabled) return { state: prev, error: "自动购入未启用" };
      b.autoRestock.enabled = false;
      return { state: s, message: "自动购入已停用（目标量设置仍保留，可随时重新启用）" };
    }
    case "SET_PRICE": {
      if (!Number.isInteger(a.priceCents) || a.priceCents < 50) return { state: prev, error: "售价必须为不低于0.5元（当地分≥50）的整数" };
      if (!b.menu[a.dishId]) return { state: prev, error: "菜品不存在" };
      if (b.phase !== "planning") return { state: prev, error: "当日计划锁定中：请先结算或推进到新一天再调价" };
      b.menu[a.dishId].priceCents = a.priceCents;
      b.planConfirmedDirty = true;
      return { state: s };
    }
    case "SET_RECIPE": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段调整配方用量" };
      const mi = b.menu[a.dishId];
      const dish = DISH_BY_ID[a.dishId];
      if (!mi || !dish) return { state: prev, error: "菜品不存在" };
      if (!dish.recipe.some((r) => r.ingId === a.ingId)) return { state: prev, error: "该菜品不含此配料" };
      if (!Number.isInteger(a.bp) || a.bp < RECIPE_TUNING.minBp || a.bp > RECIPE_TUNING.maxBp) {
        return { state: prev, error: `用量需为 ${RECIPE_TUNING.minBp / 100}%~${RECIPE_TUNING.maxBp / 100}% 的整数` };
      }
      mi.recipeBp = { ...(mi.recipeBp ?? {}), [a.ingId]: a.bp };
      b.planConfirmedDirty = true;
      return { state: s };
    }
    case "RESET_RECIPE": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段调整配方用量" };
      const mi = b.menu[a.dishId];
      if (!mi) return { state: prev, error: "菜品不存在" };
      mi.recipeBp = {};
      b.planConfirmedDirty = true;
      return { state: s, message: "已恢复标准配方" };
    }
    case "TOGGLE_DISH": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段上下架菜品" };
      const m = b.menu[a.dishId];
      if (!m) return { state: prev, error: "菜品不存在" };
      if (!m.active && !isDishSellable(s, a.dishId)) return { state: prev, error: "该菜品尚未研究解锁，无法上架" };
      m.active = !m.active;
      b.planConfirmedDirty = true;
      return { state: s };
    }
    case "SET_OPEN_SLOTS": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段调整营业时段" };
      if (a.slots.length === 0) return { state: prev, error: "至少保留一个营业时段" };
      b.store.openSlots = a.slots;
      b.planConfirmedDirty = true;
      return { state: s };
    }
    case "SET_ORDER_LIMIT": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段设置限单" };
      if (!Number.isInteger(a.covers) || a.covers < 0 || a.covers > 5000) return { state: prev, error: "限单数需为0~5000的整数（0=不限）" };
      b.store.orderLimitCovers = a.covers;
      b.planConfirmedDirty = true;
      return { state: s };
    }
    case "HIRE": {
      const r = hire(s, b, a.poolId);
      return r.ok ? { state: s, message: "已办理入职" } : { state: prev, error: r.error };
    }
    case "FIRE": {
      const r = fire(s, b, a.empId);
      return r.ok ? { state: s, message: "已结清遣散费并办离" } : { state: prev, error: r.error };
    }
    case "ASSIGN_SHIFTS": {
      const r = assignShifts(b, a.empId, a.shifts);
      return r.ok ? { state: s } : { state: prev, error: r.error };
    }
    case "TRAIN": {
      const r = trainEmployee(s, b, a.empId);
      return r.ok ? { state: s, message: "培训已安排（2天后技能+4）" } : { state: prev, error: r.error };
    }
    case "CONFIRM_PLAN": {
      const r = confirmPlan(s, b);
      return r.ok ? { state: s, message: r.messages.join("；") } : { state: prev, error: r.messages.join("；") };
    }
    case "SETTLE": {
      const r = settleDay(s, b);
      return r.ok ? { state: s, message: `${cityName}店第 ${s.day} 日结算完成` } : { state: prev, error: r.error };
    }
    case "NEW_DAY": {
      const r = newDay(s);
      if (r.blocked) return { state: prev, error: r.blocked };
      return { state: s, messages: r.messages };
    }
    case "RESOLVE_EVENT": {
      const r = resolveEvent(s, a.uid, a.optionId, a.payload);
      return { state: s, message: r.message };
    }
    case "LEARN_CUISINE": {
      const r = learnCuisine(s, b, a.cuisine);
      return r.ok ? { state: s, message: r.message } : { state: prev, error: r.error };
    }
    case "RESEARCH_START": {
      const r = researchStart(s, b, a.dishId);
      return r.ok ? { state: s, message: r.message } : { state: prev, error: r.error };
    }
    case "RESEARCH_SUBMIT": {
      const r = researchSubmit(s, b, a.ings);
      if (!r.ok) return { state: prev, error: r.error };
      return { state: s, message: r.message };
    }
    case "RESEARCH_CANCEL": {
      const r = researchCancel(s, b);
      return r.ok ? { state: s, message: r.message } : { state: prev, error: r.error };
    }
    case "DECOR_UPGRADE": {
      if (b.phase !== "planning") return { state: prev, error: "只能在计划阶段装修" };
      const opt = DECOR.upgradeOptions.find((o) => o.level === a.level);
      if (!opt) return { state: prev, error: "装修方案不存在" };
      const cost = toLocalCents(opt.costCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
      if (b.cashCents < cost) return { state: prev, error: "本店现金不足" };
      b.cashCents -= cost;
      b.ledger.push({ day: s.day, account: "other", amountCents: -cost, cash: true, memo: `装修：${opt.label}` });
      b.store.decor = Math.min(100, b.store.decor + opt.decor);
      b.store.hygiene = Math.min(100, b.store.hygiene + opt.hygiene);
      if ("station" in opt && opt.station) b.store.stations += opt.station;
      b.planConfirmedDirty = true;
      return { state: s, message: `装修完成：${opt.label}${"station" in opt && opt.station ? "（产能：炉灶线路上限+1）" : ""}` };
    }
    case "TAKE_REPAIR": {
      const cost = toLocalCents(50000, CITY_BY_ID[b.cityId].fxPerCnyBp);
      if (b.cashCents < cost) return { state: prev, error: "本店现金不足" };
      b.cashCents -= cost;
      b.store.equipmentHealth = Math.min(100, b.store.equipmentHealth + 10);
      b.ledger.push({ day: s.day, account: "repair", amountCents: -cost, cash: true, memo: "日常保养维修" });
      return { state: s, message: "设备完成保养" };
    }
    case "LAUNCH_MARKETING": {
      const r = launchCampaign(s, b, a.defId, a.tier, a.targetSeg);
      return r.ok ? { state: s, message: r.message } : { state: prev, error: r.error };
    }
    default:
      return { state: prev, error: "未知操作" };
  }
}
