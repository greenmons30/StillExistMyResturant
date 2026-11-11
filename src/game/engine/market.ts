// 食材市场：价格演化、供应状态、采购报价与下单（分店独立运行）
import type { GameState, IngredientDef, MarketEntry, SupplierDef, Branch } from "../types";
import { MARKET, SUPPLIERS, WEATHER, getMods } from "../config";
import { ING_BY_ID, INGREDIENTS } from "../data/ingredients";
import { DISH_BY_ID } from "../data/dishes";
import { clamp, costCents } from "../utils";
import { chance, rndInt, noise } from "../rng";
import { addLotFromBuy, availableStock, capacityFor, totalStock } from "./inventory";

export const SUPPLIER_LIST: SupplierDef[] = SUPPLIERS.map((x) => ({ ...x }) as SupplierDef);

function hashStr(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 365;
}

export function supplierById(id: string): SupplierDef | undefined {
  return SUPPLIER_LIST.find((x) => x.id === id);
}

export function supplierName(s: GameState, cityId: string, supId: string): string {
  const c = s.branches[cityId];
  void c;
  return supDisplayName(cityId, supId);
}

import { CITY_BY_ID } from "../data/cities";
export function supDisplayName(cityId: string, supId: string): string {
  const city = CITY_BY_ID[cityId];
  return city?.supplierNames?.[supId] ?? supplierById(supId)?.name ?? supId;
}

// 每日市场更新（每城独立：季节相位按 城市+食材 哈希错开，随机流按分店顺序消耗 → 各城趋势/价格自然分化）
export function marketUpdate(s: GameState, b: Branch): void {
  const wEff = (WEATHER.priceEffect[s.date.weather] ?? {}) as Record<string, number>;
  for (const def of INGREDIENTS) {
    const e = b.market[def.id];
    if (!e) continue;
    if (e.eventTag && b.day > e.eventUntilDay) {
      e.eventTag = null;
      e.supply = 2;
    }
    const seasonalBp = Math.round(def.seasonAmpBp * Math.sin((2 * Math.PI * (b.day + hashStr(def.id + "@" + b.cityId))) / 365));
    const target = Math.round((def.basePriceCents * (10000 + seasonalBp)) / 10000);
    let p = e.priceCents + Math.round((target - e.priceCents) * 0.12);
    const trend = clamp(Math.round((e.trendBp + rndInt(s, -25, 25)) * 0.9), -350, 350);
    const noiseBp = Math.round((noise(s) * def.randAmpBp) / 2);
    const wBp = wEff[def.category] ?? 0;
    p += Math.round((p * (trend + noiseBp + wBp)) / 10000);
    if (b.day > e.eventUntilDay) {
      if (chance(s, MARKET.supplyShortChanceBp)) {
        e.supply = 0; e.eventTag = "缺货"; e.eventUntilDay = b.day + rndInt(s, 2, 3);
        p = Math.round(p * 1.35);
      } else if (chance(s, MARKET.supplyTightChanceBp)) {
        e.supply = 1; e.eventTag = "紧张"; e.eventUntilDay = b.day + rndInt(s, 2, 4);
        p = Math.round(p * (1.1 + rndInt(s, 0, 15) / 100));
      } else {
        e.supply = 2;
      }
    } else if (e.supply === 1) {
      p = Math.round(p * 1.18);
    }
    e.trendBp = trend;
    e.priceCents = clamp(
      p,
      Math.round((def.basePriceCents * MARKET.floorBp) / 10000),
      Math.round((def.basePriceCents * MARKET.ceilBp) / 10000),
    );
    e.history.push(e.priceCents);
    while (e.history.length > MARKET.priceHistoryLen) e.history.shift();
  }
}

// 事件造成的临时涨价/缺货
export function marketShock(b: Branch, ingId: string, pctBp: number | null, days: number, tag: string): void {
  const e = b.market[ingId];
  if (!e) return;
  if (pctBp !== null) e.priceCents = Math.round((e.priceCents * pctBp) / 10000);
  e.eventTag = tag;
  e.eventUntilDay = b.day + days;
  if (tag === "缺货") e.supply = 0;
}

export function effectivePrice(s: GameState, b: Branch, def: IngredientDef, sup: SupplierDef): number {
  const mods = getMods(s.boss.personality);
  const e = b.market[def.id];
  return Math.round((Math.round((e.priceCents * sup.priceModBp) / 10000) * mods.purchasePriceBp) / 10000);
}

export function bulkDiscountBp(qty: number, moq: number): number {
  let bp = 10000;
  for (const t of MARKET.bulkTiers) if (qty >= t.moqMultiples * moq) bp = Math.min(bp, t.discountBp);
  return bp;
}

export interface BuyQuote {
  unitPriceCents: number;
  goodsCents: number;
  feeCents: number;
  totalCents: number;
  discountBp: number;
}

export function quoteBuy(s: GameState, b: Branch, def: IngredientDef, qty: number, sup: SupplierDef): BuyQuote {
  const disc = bulkDiscountBp(qty, def.moq);
  const unit = Math.round((effectivePrice(s, b, def, sup) * disc) / 10000);
  const goods = costCents(qty, unit, def.perPurchase);
  const fee = sup.feeCents;
  return { unitPriceCents: unit, goodsCents: goods, feeCents: fee, totalCents: goods + fee, discountBp: disc };
}

export function purchase(s: GameState, b: Branch, ingId: string, qty: number, supplierId: string): { ok: boolean; error?: string; costCents?: number } {
  if (b.phase !== "planning") return { ok: false, error: "只能在当日计划阶段采购" };
  const def = ING_BY_ID[ingId];
  if (!def) return { ok: false, error: "未知食材" };
  const sup = supplierById(supplierId);
  if (!sup) return { ok: false, error: "未知供应商" };
  if (sup.categories && !sup.categories.includes(def.category)) return { ok: false, error: `${supDisplayName(b.cityId, sup.id)}不供应该品类` };
  if (qty < def.moq) return { ok: false, error: `不足起订量（${def.moq}${def.unit === "g" ? "g" : "个"}）` };
  const m = b.market[ingId];
  if (m.supply === 0 && !chance(s, 2000)) return { ok: false, error: "当地市场缺货，仅有零星散户货源" };
  const cap = capacityFor(b, def);
  const cur = totalStock(b, ingId);
  if (cur + qty > cap) return { ok: false, error: "储存容量不足，请先消化库存或升级冷藏设备" };
  const q = quoteBuy(s, b, def, qty, sup);
  if (b.cashCents < q.totalCents) return { ok: false, error: "该店现金不足" };
  b.cashCents -= q.totalCents;
  b.ledger.push({ day: s.day, account: "purchase", amountCents: -q.totalCents, cash: true, memo: `采购${def.name} ${qty}${def.unit}` });
  if (sup.deliveryDays === 0) {
    addLotFromBuy(b, def, q.unitPriceCents, qty, s.day);
  } else {
    b.pendingDeliveries.push({
      ingId, qty, unitPriceCents: q.unitPriceCents, perPurchase: def.perPurchase,
      arriveDay: s.day + sup.deliveryDays, expiresDay: s.day + sup.deliveryDays + def.shelfDays, storage: def.storage,
    });
  }
  b.purchasesToday.push({ ingId, qty, supplierId, costCents: q.totalCents, arriveDay: s.day + sup.deliveryDays });
  b.planConfirmedDirty = true;
  return { ok: true, costCents: q.totalCents };
}

// 采购建议：仅当可用库存低于「昨日消耗×1.2」时给出缺口量（本地分店口径）
export function recommendQty(b: Branch, def: IngredientDef): number {
  const last = b.reports[0];
  if (!last) return 0;
  let usage = 0;
  for (const ds of last.dishStats) {
    if (!DISH_BY_ID[ds.dishId]) continue;
    for (const r of effectiveRecipeLocal(b, ds.dishId)) if (r.ingId === def.id) usage += r.qty * ds.sold;
  }
  if (usage <= 0) return 0;
  const gap = Math.round(usage * 1.2) - availableStock(b, def.id);
  if (gap <= 0) return 0;
  return Math.max(def.moq, Math.ceil(gap / def.moq) * def.moq);
}

import { effectiveRecipe } from "./inventory";
function effectiveRecipeLocal(b: Branch, dishId: string) { return effectiveRecipe(b, dishId); }

export function trendLabel(e: MarketEntry): string {
  const h = e.history;
  if (h.length < 5) return "新";
  const a = h[h.length - 1];
  const b2 = h[Math.max(0, h.length - 5)];
  if (a > b2 * 1.03) return "↑上涨";
  if (a < b2 * 0.97) return "↓下跌";
  return "→平稳";
}

// 在途（已付款待配送）数量
function inTransit(b: Branch, ingId: string): number {
  let t = 0;
  for (const pd of b.pendingDeliveries) if (pd.ingId === ingId) t += pd.qty;
  return t;
}

// 自动购入：把配置内食材的可用库存补足到目标库容（仅由玩家点击触发）
export function runAutoRestock(s: GameState, b: Branch): { bought: number; spentCents: number; messages: string[] } {
  const cfg = b.autoRestock;
  const out = { bought: 0, spentCents: 0, messages: [] as string[] };
  if (!cfg.enabled || cfg.items.length === 0 || s.day > cfg.untilDay) return out;
  for (const item of cfg.items) {
    const def = ING_BY_ID[item.ingId];
    if (!def) { out.messages.push(`${item.ingId} 已下架，跳过`); continue; }
    let supId = cfg.supplierId;
    let sup = supplierById(supId);
    if (!sup || (sup.categories !== null && !sup.categories.includes(def.category))) {
      supId = "mawangdui";
      sup = supplierById(supId);
      if (!sup) continue;
    }
    const gap = item.targetQty - (availableStock(b, def.id) + inTransit(b, def.id));
    if (gap <= 0) continue;
    const room = capacityFor(b, def) - totalStock(b, def.id);
    if (room < def.moq) { out.messages.push(`${def.name}：剩余容量不足起订量，跳过`); continue; }
    const buyQty = Math.min(Math.ceil(gap / def.moq) * def.moq, Math.floor(room / def.moq) * def.moq);
    if (buyQty < def.moq) continue;
    const r = purchase(s, b, def.id, buyQty, supId);
    if (r.ok) { out.bought++; out.spentCents += r.costCents ?? 0; }
    else out.messages.push(`${def.name}：${r.error}`);
  }
  return out;
}
