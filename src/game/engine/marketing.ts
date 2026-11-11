// 营销系统：7项活动的报价、成功率判定与启动（分店独立）
import type { Branch, GameState, MarketingCampaign } from "../types";
import { MARKETING } from "../config";
import { CITY_BY_ID, toLocalCents } from "../data/cities";
import { SEG_BY_ID } from "../data/segments";
import { chance, nextRandom } from "../rng";
import { clamp } from "../utils";
import { estimateExpectedOrders } from "./simulation";

export interface CampaignDef {
  id: string; name: string; desc: string; costCents: number; days: number;
  boostAddBp: number; baseSuccessBp: number; flopBp: number; segTargetable: boolean;
  discountBp?: number; memberMultBp?: number; requireHoliday?: boolean;
}

export function campaignById(id: string): CampaignDef | undefined {
  return MARKETING.campaigns.find((c) => c.id === id) as CampaignDef | undefined;
}

export function tierById(id: string) {
  return MARKETING.tiers.find((t) => t.id === id) ?? MARKETING.tiers[1];
}

export function nearHoliday(s: GameState): boolean {
  const target = Date.UTC(s.date.year, s.date.month - 1, s.date.dayOfMonth);
  for (const h of DEMAND_HOLIDAY_MD) {
    const [mm, dd] = h.split("-").map(Number);
    for (const y of [s.date.year - 1, s.date.year, s.date.year + 1]) {
      for (const off of [-2, -1, 0, 1, 2]) {
        if (Date.UTC(y, mm - 1, dd) === target + off * 86400000) return true;
      }
    }
  }
  return false;
}

import { DEMAND } from "../config";
const DEMAND_HOLIDAY_MD: readonly string[] = DEMAND.holidays;

// 受众匹配度：指定客群在其商圈的占比折算；"all" 为大众投放
export function audienceMatchBp(s: GameState, b: Branch, targetSeg: string): number {
  void s;
  if (targetSeg === "all") return 4200;
  const city = CITY_BY_ID[b.cityId];
  const dist = city.districts.find((d) => d.id === b.districtId) ?? city.districts[0];
  const w = dist.segmentWeights[targetSeg] ?? 60;
  return clamp(w * 13, 800, 6500);
}

export interface CampaignQuote {
  costCents: number;             // 当地货币
  costCnyCents: number;          // 人民币口径
  successBp: number;
  matchBp: number;
  boostIfSuccessBp: number;
  estUpliftOrders: number;
  error?: string;
}

export function quoteCampaign(s: GameState, b: Branch, defId: string, tierId: string, targetSeg: string): CampaignQuote {
  const def = campaignById(defId)!;
  const tier = tierById(tierId);
  const city = CITY_BY_ID[b.cityId];
  const costCny = Math.round((def.costCents * tier.costMultBp) / 10000);
  const costCents = toLocalCents(costCny, city.fxPerCnyBp);
  const match = audienceMatchBp(s, b, targetSeg);
  const quality = tier.quality + Math.round((b.reputation - 500) / 20);
  const comp = Math.round((city.competitionBp - 10000) / 4);
  let successBp = Math.round(def.baseSuccessBp + (quality - 50) * 45 + (match - 4200) * 0.7 - comp);
  successBp = clamp(successBp, 800, 9000);
  const boostAdd = Math.round(
    def.boostAddBp * (tier.effectBp / 10000) * (0.55 + (match / 10000) * 0.5) * (0.75 + b.reputation / 2000),
  );
  const boostIfSuccessBp = 10000 + boostAdd;
  const current = estimateExpectedOrders(s, b, { marketing: true }).expected;
  const projected = estimateExpectedOrders(s, b, {
    marketing: true,
    extraBoostBp: boostIfSuccessBp,
    extraDiscountBp: def.discountBp && def.discountBp !== 10000 ? def.discountBp : undefined,
  }).expected;
  const uplift = Math.max(1, projected - current);
  return { costCents, costCnyCents: costCny, successBp, matchBp: match, boostIfSuccessBp, estUpliftOrders: uplift };
}

export function launchCampaign(s: GameState, b: Branch, defId: string, tierId: string, targetSeg: string): { ok: boolean; error?: string; message?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段启动营销" };
  const def = campaignById(defId);
  if (!def) return { ok: false, error: "未知营销活动" };
  const tier = tierById(tierId);
  if (targetSeg !== "all" && !SEG_BY_ID[targetSeg]) return { ok: false, error: "未知目标客群" };
  if (!def.segTargetable && targetSeg !== "all") return { ok: false, error: `${def.name}不支持定向客群` };
  if (def.requireHoliday && !nearHoliday(s)) return { ok: false, error: "节日营销需要在节假日前后3天内投放" };
  if (b.marketing.active.some((c) => c.defId === defId)) return { ok: false, error: `「${def.name}」本店正在执行中` };
  if (b.marketing.active.length >= MARKETING.maxActive) return { ok: false, error: `同时进行中的营销最多 ${MARKETING.maxActive} 项` };
  const q = quoteCampaign(s, b, defId, tierId, targetSeg);
  if (b.cashCents < q.costCents) return { ok: false, error: "本店现金不足以投放该营销" };

  const outcomeRoll = Math.floor(nextRandom(s) * 10000);
  const outcome: MarketingCampaign["outcome"] =
    outcomeRoll < q.successBp ? "success" : chance(s, def.flopBp) ? "flop" : "noeffect";

  let appliedBoost = 0;
  if (outcome === "success" && def.boostAddBp > 0) appliedBoost = q.boostIfSuccessBp;
  if (outcome === "flop" && def.flopBp > 0) appliedBoost = Math.max(8800, 10000 - Math.round((q.boostIfSuccessBp - 10000) * 0.35));

  b.cashCents -= q.costCents;
  b.ledger.push({ day: s.day, account: "marketing", amountCents: -q.costCents, cash: true, memo: `营销：${def.name}（${tier.name}${targetSeg !== "all" ? `·定向${SEG_BY_ID[targetSeg].name}` : ""}）` });

  if (appliedBoost !== 0) {
    const campId = b.marketing.nextId;
    b.boosts.push({
      id: "mk_" + campId,
      label: `营销·${def.name}`,
      trafficBp: appliedBoost,
      untilDay: s.day + def.days - 1,
      persistent: true,
    });
  }

  const camp: MarketingCampaign = {
    id: b.marketing.nextId++,
    defId,
    name: def.name,
    tier: tier.id,
    targetSeg,
    startDay: s.day,
    endDay: s.day + def.days - 1,
    costCents: q.costCents,
    appliedBoostBp: appliedBoost,
    discountBp: outcome === "success" && def.discountBp ? def.discountBp : 10000,
    memberMultBp: outcome === "success" && def.memberMultBp ? def.memberMultBp : 10000,
    upliftExpected: q.estUpliftOrders,
    baselineRegulars: b.regulars,
    outcome,
    servedExtra: 0,
    revenueExtraCents: 0,
    grossExtraCents: 0,
    newRegulars: 0,
    settledDays: 0,
  };
  b.marketing.active.push(camp);
  const msg =
    outcome === "success"
      ? `「${def.name}」投放成功：预计客流 ${appliedBoost > 10000 ? "+" : ""}${((appliedBoost - 10000) / 100).toFixed(1)}%${def.discountBp ? `，折扣已生效（${def.discountBp / 100}折）` : ""}，共 ${def.days} 天。`
      : outcome === "flop"
        ? `「${def.name}」翻车了……内容没做起来还被嘲了一句，短期内客流不升反降，${Math.floor(q.costCnyCents / 100)} 元打了水漂。`
        : `「${def.name}」发出去了，但没什么水花（成功判定未通过），${Math.floor(q.costCnyCents / 100)} 元成本沉没。`;
  return { ok: true, message: msg };
}
