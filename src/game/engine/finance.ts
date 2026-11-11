// 财务报表：分店级账目（当地货币）+ 全局净资产/现金（折合人民币）
import type { Branch, GameState, LedgerEntry } from "../types";
import { inventoryValueCents } from "./inventory";
import { CITY_BY_ID, toCnyCents } from "../data/cities";

export const ACCOUNT_NAMES: Record<string, string> = {
  revenue: "营业收入", refund: "退款赔偿", cogs: "食材消耗", wage: "员工工资",
  rent: "房租", utility: "水电燃气", marketing: "营销费用", repair: "设备维修",
  family: "家庭支出", event: "事件损益", spoil: "损耗", purchase: "采购付款",
  transferIn: "转账注入", transferOut: "周转转出", training: "培训", research: "菜品研究", other: "其他",
};

// P&L 科目（采购付款、转账注入/周转不计入损益）
const PNL_ACCOUNTS = ["revenue", "refund", "cogs", "wage", "rent", "utility", "marketing", "repair", "family", "event", "spoil", "training", "research", "other"];

export function dayEntries(b: Branch, day: number): LedgerEntry[] {
  return b.ledger.filter((e) => e.day === day);
}

export interface PnlRow {
  account: string;
  name: string;
  cents: number;
}

export function pnlForDay(b: Branch, day: number): { rows: PnlRow[]; netCents: number; revenue: number; cost: number } {
  const entries = dayEntries(b, day).filter((e) => PNL_ACCOUNTS.includes(e.account));
  const byAcc: Record<string, number> = {};
  for (const e of entries) byAcc[e.account] = (byAcc[e.account] ?? 0) + e.amountCents;
  const rows = Object.entries(byAcc)
    .map(([account, cents]) => ({ account, name: ACCOUNT_NAMES[account] ?? account, cents }))
    .sort((a, b2) => b2.cents - a.cents);
  const revenue = rows.filter((r) => r.cents > 0).reduce((a, r) => a + r.cents, 0);
  const cost = -rows.filter((r) => r.cents < 0).reduce((a, r) => a + r.cents, 0);
  return { rows, netCents: revenue - cost, revenue, cost };
}

export function cashflowForDay(b: Branch, day: number): { rows: PnlRow[]; netCents: number } {
  const entries = dayEntries(b, day).filter((e) => e.cash);
  const byAcc: Record<string, number> = {};
  for (const e of entries) byAcc[e.account] = (byAcc[e.account] ?? 0) + e.amountCents;
  const rows = Object.entries(byAcc)
    .map(([account, cents]) => ({ account, name: ACCOUNT_NAMES[account] ?? account, cents }))
    .sort((a, b2) => b2.cents - a.cents);
  return { rows, netCents: rows.reduce((a, r) => a + r.cents, 0) };
}

export function equipmentValueCents(b: Branch): number {
  const city = CITY_BY_ID[b.cityId];
  const baseRent = b.store.rentCents; // 以日租近似资产规模的档位差异
  const scale = Math.round(30 * baseRent + b.store.stations * 200000 + b.store.seats * 4000);
  return Math.round((scale * 60) / 100 * (b.store.equipmentHealth / 100) * (city.fxPerCnyBp / 1000));
}

export function loanOwedCents(b: Branch): number {
  return b.loans.reduce((a, l) => a + l.owedCents, 0);
}

// 分店净资产（当地货币）
export function branchNetWorthLocal(b: Branch): number {
  return b.cashCents + inventoryValueCents(b) + equipmentValueCents(b) - loanOwedCents(b);
}

// 分店净资产（折合人民币，用于解锁门槛与全局净资产）
export function branchNetWorthCny(s: GameState, cityId: string): number {
  const b = s.branches[cityId];
  if (!b) return 0;
  return toCnyCents(branchNetWorthLocal(b), CITY_BY_ID[b.cityId].fxPerCnyBp);
}

export function netWorthCents(s: GameState): number {
  let t = 0;
  for (const cityId of Object.keys(s.branches)) t += branchNetWorthCny(s, cityId);
  return t;
}

export function totalCashCny(s: GameState): number {
  let t = 0;
  for (const b of Object.values(s.branches)) t += toCnyCents(b.cashCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
  return t;
}

export function lifetime(s: GameState): { revenue: number; cost: number; days: number } {
  let revenue = 0, cost = 0;
  for (const b of Object.values(s.branches)) {
    for (const e of b.ledger) {
      if (!PNL_ACCOUNTS.includes(e.account)) continue;
      const cny = toCnyCents(e.amountCents, CITY_BY_ID[b.cityId].fxPerCnyBp);
      if (cny > 0) revenue += cny;
      else cost += -cny;
    }
  }
  return { revenue, cost, days: s.day };
}
