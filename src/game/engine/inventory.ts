// 库存：批次(FIFO)、保质期、储存损耗、容量、烹饪扣料（全部按分店 Branch 运作）
import type { Branch, IngredientDef, Lot, RecipeItem } from "../types";
import { ING_BY_ID } from "../data/ingredients";
import { DISH_BY_ID } from "../data/dishes";
import { INVENTORY } from "../config";
import { costCents } from "../utils";

export function totalStock(b: Branch, ingId: string): number {
  const lots = b.inventory[ingId] ?? [];
  return lots.reduce((a, l) => a + l.qty, 0);
}

export function availableStock(b: Branch, ingId: string): number {
  const lots = b.inventory[ingId] ?? [];
  return lots.filter((l) => l.expiresDay >= b.day).reduce((a, l) => a + l.qty, 0);
}

export function capacityFor(b: Branch, def: IngredientDef): number {
  const mult = (b.store.capacityMultBp / 10000) * ((def.storage === "fridge" ? b.store.fridgeCapacityBp : def.storage === "freezer" ? Math.round(b.store.fridgeCapacityBp * 0.6) : 10000)) / 10000;
  return Math.max(def.moq * 2, Math.round(def.capacityBase * mult));
}

export function addLot(b: Branch, ingId: string, qty: number, unitPriceCents: number, perPurchase: number, expiresDay: number, storage: Lot["storage"], purchasedDay?: number): void {
  if (qty <= 0) return;
  const list = (b.inventory[ingId] ??= []);
  list.push({ id: b.nextLotId++, ingId, qty, unitPriceCents, perPurchase, expiresDay, storage, purchasedDay: purchasedDay ?? b.day });
}

export function addLotFromBuy(b: Branch, def: IngredientDef, unitPriceCents: number, qty: number, day: number): void {
  addLot(b, def.id, qty, unitPriceCents, def.perPurchase, day + def.shelfDays, def.storage, day);
}

// FIFO 扣减；不足则整单失败并回滚
export function consumeIngredient(b: Branch, ingId: string, qty: number): { ok: boolean; costCents: number } {
  const list = b.inventory[ingId] ?? [];
  const usable = list.filter((l) => l.qty > 0 && l.expiresDay >= b.day);
  const avail = usable.reduce((a, l) => a + l.qty, 0);
  if (avail < qty) return { ok: false, costCents: 0 };
  let need = qty;
  let cost = 0;
  usable.sort((a, b2) => a.expiresDay - b2.expiresDay || a.id - b2.id);
  for (const lot of usable) {
    if (need <= 0) break;
    const take = Math.min(lot.qty, need);
    cost += costCents(take, lot.unitPriceCents, lot.perPurchase);
    lot.qty -= take;
    need -= take;
  }
  b.inventory[ingId] = list.filter((l) => l.qty > 0);
  return { ok: true, costCents: cost };
}

// ===== 有效配方：玩家可在 0~200% 内自定义每种配料用量 =====
export function effectiveRecipe(b: Branch, dishId: string): RecipeItem[] {
  const dish = DISH_BY_ID[dishId];
  if (!dish) return [];
  const mod = b.menu[dishId]?.recipeBp ?? {};
  return dish.recipe
    .map((r) => {
      const bp = mod[r.ingId];
      const qty = bp === undefined || bp === 10000 ? r.qty : Math.round((r.qty * bp) / 10000);
      return { ingId: r.ingId, qty: Math.max(0, qty) };
    })
    .filter((r) => r.qty > 0);
}

export function recipeFillBp(b: Branch, dishId: string): number {
  const dish = DISH_BY_ID[dishId];
  if (!dish) return 10000;
  const mod = b.menu[dishId]?.recipeBp ?? {};
  let std = 0, act = 0;
  for (const r of dish.recipe) {
    std += r.qty;
    act += Math.round((r.qty * (mod[r.ingId] ?? 10000)) / 10000);
  }
  return std === 0 ? 10000 : Math.round((act * 10000) / std);
}

export function coreIngBp(b: Branch, dishId: string): number {
  const dish = DISH_BY_ID[dishId];
  if (!dish || dish.recipe.length === 0) return 10000;
  return b.menu[dishId]?.recipeBp?.[dish.recipe[0].ingId] ?? 10000;
}

// 制作一道菜：所有原料齐备才成功；缺料不扣任何库存
export function cookDish(b: Branch, dishId: string): { ok: boolean; cogsCents: number; missing: string[] } {
  const eff = effectiveRecipe(b, dishId);
  if (!DISH_BY_ID[dishId]) return { ok: false, cogsCents: 0, missing: ["未知菜品"] };
  const missing: string[] = [];
  const needByIng: Record<string, number> = {};
  for (const r of eff) needByIng[r.ingId] = (needByIng[r.ingId] ?? 0) + r.qty;
  for (const [ingId, qty] of Object.entries(needByIng)) {
    if (availableStock(b, ingId) < qty) missing.push(ING_BY_ID[ingId]?.name ?? ingId);
  }
  if (missing.length > 0) return { ok: false, cogsCents: 0, missing };
  let cogs = 0;
  for (const [ingId, qty] of Object.entries(needByIng)) {
    const res = consumeIngredient(b, ingId, qty);
    if (!res.ok) return { ok: false, cogsCents: cogs, missing: [ING_BY_ID[ingId]?.name ?? ingId] };
    cogs += res.costCents;
  }
  return { ok: true, cogsCents: cogs, missing: [] };
}

// 过期批次处理：返回损耗价值（分）与被移除的批次明细
export function processExpiry(b: Branch): { valueCents: number; items: string[]; lots: Lot[] } {
  let total = 0;
  const items: string[] = [];
  const removedLots: Lot[] = [];
  for (const [ingId, lots] of Object.entries(b.inventory)) {
    const bad = lots.filter((l) => l.expiresDay < b.day);
    if (bad.length === 0) continue;
    let v = 0;
    for (const lot of bad) {
      v += costCents(lot.qty, lot.unitPriceCents, lot.perPurchase);
      removedLots.push({ ...lot });
    }
    total += v;
    items.push(ING_BY_ID[ingId]?.name ?? ingId);
    b.inventory[ingId] = lots.filter((l) => l.expiresDay >= b.day);
  }
  return { valueCents: total, items, lots: removedLots };
}

// 每日储存损耗
export function storageLoss(b: Branch): number {
  let loss = 0;
  for (const [ingId, lots] of Object.entries(b.inventory)) {
    const def = ING_BY_ID[ingId];
    if (!def) continue;
    const rateBp = def.storage === "fridge" || def.storage === "freezer"
      ? (def.storage === "freezer" ? INVENTORY.freezerLossBp : INVENTORY.storageLossBp)
      : 40;
    for (const lot of lots) {
      const wasteQty = Math.floor((lot.qty * rateBp) / 10000);
      if (wasteQty > 0 && lot.qty - wasteQty >= 0) {
        lot.qty -= wasteQty;
        loss += costCents(wasteQty, lot.unitPriceCents, lot.perPurchase);
      }
    }
    b.inventory[ingId] = lots.filter((l) => l.qty > 0);
  }
  return loss;
}

export function inventoryValueCents(b: Branch): number {
  let v = 0;
  for (const lots of Object.values(b.inventory)) {
    for (const lot of lots) {
      if (lot.expiresDay < b.day) continue;
      v += costCents(lot.qty, lot.unitPriceCents, lot.perPurchase);
    }
  }
  return v;
}

export function canMakeDish(b: Branch, dishId: string): boolean {
  if (!DISH_BY_ID[dishId]) return false;
  const needByIng: Record<string, number> = {};
  for (const r of effectiveRecipe(b, dishId)) needByIng[r.ingId] = (needByIng[r.ingId] ?? 0) + r.qty;
  for (const [ingId, qty] of Object.entries(needByIng)) {
    if (availableStock(b, ingId) < qty) return false;
  }
  return true;
}

// 按当前市场价估算一道菜的单位食材成本（按调整后的实际用量）
export function marketCogsOfDish(b: Branch, dishId: string): number {
  if (!DISH_BY_ID[dishId]) return 0;
  let c = 0;
  for (const r of effectiveRecipe(b, dishId)) {
    const def = ING_BY_ID[r.ingId];
    const m = b.market[r.ingId];
    if (!def || !m) continue;
    c += costCents(r.qty, m.priceCents, def.perPurchase);
  }
  return c;
}

// 按百分比(bp)额外消耗一道菜的配料（博主加量等）
export function consumePartial(b: Branch, dishId: string, pctBp: number): number {
  let cost = 0;
  for (const r of effectiveRecipe(b, dishId)) {
    const qty = Math.max(0, Math.round((r.qty * pctBp) / 10000));
    if (qty <= 0) continue;
    const avail = availableStock(b, r.ingId);
    const take = Math.min(qty, avail);
    if (take > 0) cost += consumeIngredient(b, r.ingId, take).costCents;
  }
  return cost;
}
