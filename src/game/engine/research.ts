// 菜品研究：先花钱学菜系，再逐道试做（200元/次，费用按当地货币折算）。
// 试做时从该分店库存中选配料：组合正确 → 全局解锁该菜（所有分店共享研究成果）；否则 → “令人困惑的实验菜”事件。
import type { Branch, CuisineId, GameState } from "../types";
import { RESEARCH } from "../config";
import { CITY_BY_ID, toLocalCents } from "../data/cities";
import { DISH_BY_ID, DISHES } from "../data/dishes";
import { ING_BY_ID } from "../data/ingredients";
import { availableStock, consumeIngredient, effectiveRecipe } from "./inventory";
import { createPending, findDef } from "./events";

export const LEARNABLE_CUISINES: CuisineId[] = ["sichuan", "cantonese", "dessert", "drink", "fastfood", "western", "japanese", "french"];

export function isDishSellable(s: GameState, dishId: string): boolean {
  return s.study.unlockedDishes.includes(dishId);
}

export function cuisineLearned(s: GameState, c: CuisineId): boolean {
  return c === "hunan" || s.study.learned.includes(c);
}

function localCost(s: GameState, b: Branch, cnyCents: number): number {
  void s;
  return toLocalCents(cnyCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
}

export function learnCuisine(s: GameState, b: Branch, cuisine: CuisineId): { ok: boolean; error?: string; message?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段学习菜系" };
  if (cuisine === "hunan") return { ok: false, error: "湘菜是祖传手艺，无需学习" };
  if (s.study.learned.includes(cuisine)) return { ok: false, error: "该菜系已学习" };
  const costCny = RESEARCH.cuisineCostCents[cuisine];
  if (!costCny) return { ok: false, error: "未知菜系" };
  const cost = localCost(s, b, costCny);
  if (b.cashCents < cost) return { ok: false, error: `本店现金不足（学费折合 ${Math.floor(cost / 100)}）` };
  b.cashCents -= cost;
  b.ledger.push({ day: s.day, account: "research", amountCents: -cost, cash: true, memo: `学习菜系：${cuisine}` });
  s.study.learned.push(cuisine);
  return { ok: true, message: `已拜师学艺：${cuisine} 菜系解锁，可在“菜品研究”中试做该菜系的菜品（研究成果所有分店共享）` };
}

export function researchStart(s: GameState, b: Branch, dishId: string): { ok: boolean; error?: string; message?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段开始研究" };
  const dish = DISH_BY_ID[dishId];
  if (!dish) return { ok: false, error: "菜品不存在" };
  if (isDishSellable(s, dishId)) return { ok: false, error: "该菜品已解锁，无需研究" };
  if (!cuisineLearned(s, dish.cuisine)) return { ok: false, error: "尚未学习该菜系，无法研究其菜品" };
  if (s.study.activeResearch) return { ok: false, error: "已有研究进行中，请先完成或取消" };
  const cost = localCost(s, b, RESEARCH.perTryCents);
  if (b.cashCents < cost) return { ok: false, error: "研究费用不足（200元/次）" };
  b.cashCents -= cost;
  b.ledger.push({ day: s.day, account: "research", amountCents: -cost, cash: true, memo: `试做研究：${dish.name}` });
  s.study.activeResearch = dishId;
  return { ok: true, message: `开始研究「${dish.name}」：从本店库存中选择配料组合，配方线索：${dish.desc}` };
}

export function researchCancel(s: GameState, b: Branch): { ok: boolean; error?: string; message?: string } {
  void b;
  if (!s.study.activeResearch) return { ok: false, error: "没有进行中的研究" };
  s.study.activeResearch = null;
  return { ok: true, message: "已放弃本次研究（学费不退）" };
}

// 提交配料组合：与目标菜品配方“配料种类集合”完全一致且库存足一份样品 → 全局解锁
export function researchSubmit(s: GameState, b: Branch, ings: string[]): { ok: boolean; error?: string; message?: string; success?: boolean } {
  const dishId = s.study.activeResearch;
  if (!dishId) return { ok: false, error: "没有进行中的研究" };
  const dish = DISH_BY_ID[dishId];
  const picked = [...new Set(ings)].filter((id) => ING_BY_ID[id]);
  if (picked.length === 0) return { ok: false, error: "至少选择一种配料" };
  for (const id of picked) {
    if (availableStock(b, id) <= 0) return { ok: false, error: `${ING_BY_ID[id].name}本店库存为0，无法选用` };
  }
  const needSet = new Set(effectiveRecipe(b, dishId).length ? dish.recipe.map((r) => r.ingId) : []);
  let sameSet = needSet.size === picked.length;
  if (sameSet) for (const id of picked) if (!needSet.has(id)) { sameSet = false; break; }

  let consumedCents = 0;
  if (sameSet) {
    const needByIng: Record<string, number> = {};
    for (const r of dish.recipe) needByIng[r.ingId] = (needByIng[r.ingId] ?? 0) + r.qty;
    for (const [ingId, qty] of Object.entries(needByIng)) {
      if (availableStock(b, ingId) < qty) {
        return { ok: false, error: `${ING_BY_ID[ingId]?.name ?? ingId}本店库存不足以完成试做（需${qty}${ING_BY_ID[ingId]?.unit ?? ""}）` };
      }
    }
    for (const [ingId, qty] of Object.entries(needByIng)) consumedCents += consumeIngredient(b, ingId, qty).costCents;
    s.study.unlockedDishes.push(dishId);
    s.study.activeResearch = null;
    if (consumedCents > 0) b.ledger.push({ day: s.day, account: "cogs", amountCents: -consumedCents, cash: false, memo: `研究试做消耗：${dish.name}` });
    for (const bb of Object.values(s.branches)) bb.planConfirmedDirty = true;
    return { ok: true, success: true, message: `🎉 试验成功！「${dish.name}」研发完成（所有分店共享成果），可在各店“菜单定价”上架。（试吃消耗 ${consumedCents} 分）` };
  }

  const inTarget: Record<string, number> = {};
  for (const r of dish.recipe) inTarget[r.ingId] = (inTarget[r.ingId] ?? 0) + r.qty;
  for (const id of picked) {
    const def = ING_BY_ID[id];
    const qty = Math.min(inTarget[id] ?? RESEARCH.fallbackIngredientG, availableStock(b, id));
    if (qty > 0) consumedCents += consumeIngredient(b, id, qty).costCents;
  }
  if (consumedCents > 0) b.ledger.push({ day: s.day, account: "cogs", amountCents: -consumedCents, cash: false, memo: `失败实验消耗：${dish.name}试做` });
  s.study.activeResearch = null;
  const def = findDef("experiment_result");
  if (def) createPending(s, b, def, { dishName: dish.name });
  return { ok: true, success: false, message: "这些材料组合在一起……一锅令人困惑的东西。实验菜已端上桌等处置（见事件待办）。" };
}

// 供 UI：某菜系全部可研究菜品
export function dishesOfCuisine(cuisine: CuisineId): { id: string; name: string; desc: string }[] {
  return DISHES.filter((d) => d.cuisine === cuisine).map((d) => ({ id: d.id, name: d.name, desc: d.desc }));
}
