import { describe, expect, it } from "vitest";
import { dispatch, type Action } from "../reducer";
import type { GameState, PendingEvent } from "../types";
import { createNewGame, type NewGameInput } from "../engine/newGame";
import { cookDish, processExpiry, totalStock, addLot, marketCogsOfDish, availableStock } from "../engine/inventory";
import { speedFactorBp, qualityOfStaffCook, dailyWageCents, dailyStaffUpdate } from "../engine/staff";
import { settleDay, confirmPlan, newDay, checkPlan, estimateDemand, suggestPurchase, closeToday } from "../engine/dayflow";
import { computeInterviewScore, resolveEvent, findDef, createPending, EVENT_DEFS, tryDailyEvents } from "../engine/events";
import { dishUtility, portionCritChanceBp } from "../engine/simulation";
import { recommendQty, quoteBuy, supplierById } from "../engine/market";
import { memoryAdapter, saveGame, loadGame, migrate } from "../engine/save";
import { pnlForDay, netWorthCents } from "../engine/finance";
import { SEG_BY_ID } from "../data/segments";
import { ING_BY_ID } from "../data/ingredients";
import { DISH_BY_ID } from "../data/dishes";
import { CITY_BY_ID, toLocalCents } from "../data/cities";
import { STAFF } from "../config";

const baseInput: NewGameInput = {
  name: "测试老板", age: 30, restaurantName: "测试饭馆",
  background: "normal", personality: "frugal", philosophy: "品质至上",
  difficulty: "normal", cityId: "changsha", districtId: "community", seed: 20261001,
};

/** 当前分店 */
const B = (s: GameState) => s.branches[s.activeCityId];

function freshState(over: Partial<NewGameInput> = {}): GameState {
  const r = dispatch(null, { type: "NEW_GAME", input: { ...baseInput, ...over } });
  return r.state!;
}

function run(s: GameState, a: Action) {
  return dispatch(s, a);
}

function clearPending(s: GameState) {
  let guard = 0;
  while (s.events.pending.length > 0 && guard++ < 40) {
    const p = s.events.pending[0];
    if (p.defId === "interview_visitor") {
      resolveEvent(s, p.eventUid, "answer", { answers: "q_years_honest,q_soup_self,q_peak_noon" });
    } else {
      resolveEvent(s, p.eventUid, p.options[0]?.id ?? "default");
    }
  }
}

function settleThrough(s: GameState) {
  clearPending(s);
  const c = confirmPlan(s, B(s));
  if (!c.ok) throw new Error("计划确认失败: " + c.messages.join(";"));
  settleDay(s, B(s));
}

/** 结束一天：所有分店 确认→结算（确认不了的歇业），再全局推进 */
function advanceDay(s: GameState) {
  clearPending(s);
  for (const cid of Object.keys(s.branches)) {
    const bb = s.branches[cid];
    if (bb.phase === "planning") {
      const c = confirmPlan(s, bb);
      if (!c.ok) closeToday(s, bb);
    }
    if (bb.phase === "confirmed") settleDay(s, bb);
  }
  return newDay(s);
}

describe("测试与交付要求（需求十八）", () => {
  it("1. 采购后现金减少、库存增加（当日达供应商）", () => {
    const s = freshState();
    const cash0 = B(s).cashCents;
    const stock0 = totalStock(B(s), "pork_belly");
    const r = run(s, { type: "BUY", ingId: "pork_belly", qty: 6000, supplierId: "frozen_co" });
    expect(r.error).toBeUndefined();
    const s2 = r.state!;
    expect(B(s2).cashCents).toBeLessThan(cash0);
    expect(totalStock(B(s2), "pork_belly")).toBe(stock0 + 6000);
    const led = B(s2).ledger[B(s2).ledger.length - 1];
    expect(led.account).toBe("purchase");
    expect(led.cash).toBe(true);
    expect(led.amountCents).toBe(B(s2).cashCents - cash0);
  });

  it("2. 菜品制作后库存正确扣减", () => {
    const s = freshState();
    const dish = DISH_BY_ID["la_jiao_chao_rou"];
    const before = dish.recipe.map((r) => totalStock(B(s), r.ingId));
    const res = cookDish(B(s), "la_jiao_chao_rou");
    expect(res.ok).toBe(true);
    dish.recipe.forEach((r, i) => {
      expect(totalStock(B(s), r.ingId)).toBe(before[i] - r.qty);
    });
    expect(Number.isInteger(res.cogsCents)).toBe(true);
  });

  it("2b. 顾客按桌点单：一桌可点1~10道菜", () => {
    const s = freshState({ seed: 2222 });
    settleThrough(s);
    const r = B(s).reports[0];
    const dishes = r.dishStats.reduce((a, d) => a + d.sold, 0);
    expect(r.served).toBeGreaterThan(0);
    expect(dishes).toBeGreaterThan(r.served);
    expect(dishes).toBeLessThanOrEqual(r.served * 10);
    expect(dishes / r.served).toBeGreaterThanOrEqual(1.5);
  });

  it("2c. 自定义配料用量：扣料与成本按比例变化；份量差评概率随区域偏好升高", () => {
    const d = DISH_BY_ID["la_jiao_chao_rou"];
    const core = d.recipe[0];
    const s = freshState({ seed: 2323 });
    const r = run(s, { type: "SET_RECIPE", dishId: d.id, ingId: core.ingId, bp: 5000 });
    expect(r.error).toBeUndefined();
    const before = totalStock(B(r.state!), core.ingId);
    const res = cookDish(B(r.state!), d.id);
    expect(res.ok).toBe(true);
    expect(before - totalStock(B(r.state!), core.ingId)).toBe(Math.round((core.qty * 5000) / 10000));
    expect(marketCogsOfDish(B(r.state!), d.id)).toBeLessThan(marketCogsOfDish(B(s), d.id));
    expect(run(s, { type: "SET_RECIPE", dishId: d.id, ingId: core.ingId, bp: 30000 }).error).toBeTruthy();
    expect(run(s, { type: "SET_RECIPE", dishId: d.id, ingId: "sichuan_pepper", bp: 8000 }).error).toContain("不含");
    expect(portionCritChanceBp(9500, 1.5)).toBe(0);
    expect(portionCritChanceBp(4000, 1.5)).toBeGreaterThan(portionCritChanceBp(4000, 0.8));
    expect(portionCritChanceBp(4000, 1.2)).toBeGreaterThan(portionCritChanceBp(7000, 1.2));
  });

  it("3. 缺少食材时不能正常制作（且不扣任何库存）", () => {
    const s = freshState();
    B(s).inventory["chili_fresh"] = [];
    const porkBefore = totalStock(B(s), "pork_shoulder");
    const res = cookDish(B(s), "la_jiao_chao_rou");
    expect(res.ok).toBe(false);
    expect(res.missing.join()).toContain("小米椒");
    expect(totalStock(B(s), "pork_shoulder")).toBe(porkBefore);
  });

  it("4. 过期食材自动处理：每天出现过期的都会提醒，处置入账、不影响现金", () => {
    const s = freshState();
    addLot(B(s), "tofu", 500, 500, 1000, B(s).day - 1, "fridge");
    const spoil = processExpiry(B(s));
    expect(spoil.valueCents).toBeGreaterThan(0);
    expect(B(s).inventory["tofu"].every((l) => l.expiresDay >= B(s).day)).toBe(true);
    const s2 = freshState({ seed: 998 });
    addLot(B(s2), "milk", 900, 900, 1000, B(s2).day - 1, "fridge");
    settleThrough(s2);
    const cashBefore = B(s2).cashCents;
    newDay(s2);
    const evt = s2.events.pending.find((p) => p.defId === "expiry_alarm");
    expect(evt).toBeDefined();
    expect(B(s2).pendingSpoilage.length).toBeGreaterThan(0);
    expect(B(s2).cashCents).toBe(cashBefore);
    resolveEvent(s2, evt!.eventUid, "ignore");
    const spoilEntry = B(s2).ledger.find((e) => e.account === "spoil" && !e.cash && e.amountCents < 0);
    expect(spoilEntry).toBeDefined();
    expect(B(s2).cashCents).toBe(cashBefore);
    expect(B(s2).pendingSpoilage.length).toBe(0);
  });

  it("4b. 保质期按购买批次独立：老批次过期不牵连新批次", () => {
    const s = freshState({ seed: 4800 });
    B(s).inventory["salmon"] = [];
    const day1 = s.day;
    settleThrough(s);
    addLot(B(s), "salmon", 2000, 1000, 1000, s.day, "fridge", 1);          // 明日晨检过期
    addLot(B(s), "salmon", 1500, 1000, 1000, s.day + 2, "fridge", day1);   // 后日仍新鲜
    newDay(s);
    const evt = s.events.pending.find((p) => p.defId === "expiry_alarm");
    expect(evt).toBeDefined();
    expect(B(s).pendingSpoilage.length).toBe(1);
    expect(B(s).pendingSpoilage[0].qty).toBe(2000);
    expect(B(s).pendingSpoilage[0].purchasedDay).toBe(1);
    expect(String(evt!.data.detail)).toContain("第1天购入");
    expect(totalStock(B(s), "salmon")).toBe(1500);
  });

  it("5. 员工熟练度影响制作时间和品质", () => {
    expect(speedFactorBp(90, 0, 50)).toBeLessThan(speedFactorBp(20, 0, 50));
    const qHigh = qualityOfStaffCook(90, 0, 90, 60);
    expect(qHigh).toBeGreaterThan(qualityOfStaffCook(20, 0, 90, 60));
    expect(qualityOfStaffCook(90, 95, 90, 60)).toBeLessThan(qHigh);
  });

  it("5b. 当日未排班按放假处理：疲劳-50、压力清零", () => {
    const s = freshState({ seed: 5555 });
    const [rested, working] = B(s).staff;
    for (const e of B(s).staff) { e.satisfaction = 90; e.loyalty = 90; }
    rested.shifts = []; rested.fatigue = 80; rested.stress = 60;
    working.shifts = ["lunch"]; working.fatigue = 80; working.stress = 60;
    const left = dailyStaffUpdate(s, B(s), 100);
    expect(left.length).toBe(0);
    expect(rested.fatigue).toBe(30);
    expect(rested.stress).toBe(0);
    expect(working.fatigue).toBe(80 - STAFF.fatigueRestPerDay);
    expect(working.stress).toBe(60 + 1 - 4);
  });

  it("6. 不同售价影响销量", () => {
    const u1 = dishUtility(SEG_BY_ID["office"], "changsha", "la_jiao_chao_rou", 3800, 60, 10000);
    const u2 = dishUtility(SEG_BY_ID["office"], "changsha", "la_jiao_chao_rou", 7600, 60, 10000);
    expect(u1).toBeGreaterThan(u2);
    const sA = freshState({ seed: 777 });
    const sB = freshState({ seed: 777 });
    for (const m of Object.values(B(sB).menu)) m.priceCents = Math.round(m.priceCents * 10);
    settleThrough(sA);
    settleThrough(sB);
    expect(B(sB).reports[0].served).toBeLessThan(B(sA).reports[0].served);
  });

  it("7. 客流受产能约束；无厨师颗粒无收", () => {
    const s = freshState({ seed: 4242 });
    settleThrough(s);
    const r = B(s).reports[0];
    expect(r.served).toBeLessThanOrEqual(r.entered);
    expect(r.served).toBeLessThanOrEqual(r.potential);
    const slots = B(s).store.openSlots.length;
    expect(r.served).toBeLessThanOrEqual(Math.floor(B(s).store.seats * (240 / 42)) * slots + 1);
    const s2 = freshState({ seed: 4242 });
    B(s2).staff = B(s2).staff.filter((e) => e.role !== "cook");
    settleThrough(s2);
    expect(B(s2).reports[0].served).toBe(0);
  });

  it("7b. 限单生效；预警估算随价格与限单变化", () => {
    const s = freshState({ seed: 9001 });
    B(s).store.orderLimitCovers = 10;
    settleThrough(s);
    expect(B(s).reports[0].served).toBeLessThanOrEqual(10);
    const a = freshState({ seed: 9002 });
    const b = freshState({ seed: 9002 });
    for (const m of Object.values(B(b).menu)) m.priceCents = Math.round(m.priceCents * 1.8);
    expect(estimateDemand(b, B(b)).expected).toBeLessThan(estimateDemand(a, B(a)).expected);
    const c = freshState({ seed: 9002 });
    B(c).store.orderLimitCovers = 30;
    expect(estimateDemand(c, B(c)).capacity).toBeLessThanOrEqual(30);
  });

  it("7c. 厨师水平显著影响评价分布", () => {
    const good = freshState({ seed: 6060 });
    const poor = freshState({ seed: 6060 });
    for (const e of B(good).staff) if (e.role === "cook") e.skill = 95;
    for (const e of B(poor).staff) if (e.role === "cook") e.skill = 8;
    settleThrough(good);
    settleThrough(poor);
    const avg = (rs: { score: number }[]) => (rs.length ? rs.reduce((a, r) => a + r.score, 0) / rs.length : 3);
    expect(B(good).reports[0].reviews.length).toBeGreaterThan(2);
    expect(avg(B(good).reports[0].reviews)).toBeGreaterThan(avg(B(poor).reports[0].reviews));
    expect(B(good).reports[0].avgSatisfaction).toBeGreaterThan(B(poor).reports[0].avgSatisfaction);
  });

  it("7d. 未排班员工当日无工资；账目与排班一致", () => {
    const unit = freshState({ seed: 7770 });
    const idle = B(unit).staff[0];
    expect(dailyWageCents(idle)).toBeGreaterThan(0);
    idle.shifts = [];
    expect(dailyWageCents(idle)).toBe(0);
    const s = freshState({ seed: 7771 });
    B(s).staff[0].shifts = [];
    settleThrough(s);
    const expected = B(s).staff.reduce((a, e) => a + dailyWageCents(e, 8500), 0);
    expect(B(s).reports[0].wageCents).toBe(expected);
    const wageLed = B(s).ledger.filter((e) => e.day === s.day && e.account === "wage").reduce((a, e) => a + e.amountCents, 0);
    expect(wageLed).toBe(-expected);
  });

  it("8. 营业收入和成本正确进入财务报表", () => {
    const s = freshState({ seed: 20001 });
    settleThrough(s);
    const rpt = B(s).reports[0];
    const pnl = pnlForDay(B(s), rpt.day);
    expect(pnl.revenue).toBeGreaterThanOrEqual(rpt.revenueCents);
    expect(pnl.netCents).toBe(rpt.netProfitCents);
    const cogsLed = B(s).ledger.filter((e) => e.day === rpt.day && e.account === "cogs").reduce((a, e) => a + e.amountCents, 0);
    expect(cogsLed).toBe(-rpt.cogsCents);
    const wageLed = B(s).ledger.filter((e) => e.day === rpt.day && e.account === "wage").reduce((a, e) => a + e.amountCents, 0);
    expect(wageLed).toBe(-rpt.wageCents);
  });

  it("9. 身世医疗费与父母转账正确结算（含冷却）", () => {
    const s = freshState({ background: "miserable", seed: 551 });
    settleThrough(s);
    const fam = B(s).ledger.filter((e) => e.account === "family");
    expect(fam.length).toBeGreaterThan(0);
    expect(fam[fam.length - 1].amountCents).toBe(-100000);
    const t = freshState({ background: "tycoon", seed: 552 });
    B(t).cashCents = 100000;
    settleThrough(t);
    newDay(t);
    const call = t.events.pending.find((p) => p.defId === "parent_call");
    expect(call).toBeDefined();
    const amount = call!.data.amountCents as number;
    expect(amount).toBeGreaterThanOrEqual(5000000);
    expect(amount).toBeLessThanOrEqual(50000000);
    const cash0 = B(t).cashCents;
    resolveEvent(t, call!.eventUid, "accept");
    expect(B(t).cashCents).toBe(cash0 + amount);
    expect(t.events.transferCount).toBe(1);
    // 冷却期内不再重复触发
    B(t).cashCents = 100000;
    clearPending(t);
    settleThrough(t);
    newDay(t);
    expect(t.events.pending.some((p) => p.defId === "parent_call")).toBe(false);
  });

  it("9b. 营销：投放扣费只一次、归因不超实际、到期结案、折扣按折后价记账", async () => {
    let s: GameState | null = null;
    for (let seed = 700; seed < 760 && !s; seed++) {
      const t = freshState({ seed });
      const r = run(t, { type: "LAUNCH_MARKETING", defId: "short_video", tier: "mid", targetSeg: "student" });
      if (!r.error && r.state && B(r.state).marketing.active.some((c) => c.outcome === "success")) s = r.state;
    }
    expect(s).not.toBeNull();
    const camp = B(s!).marketing.active[0];
    const mkLed = B(s!).ledger.filter((e) => e.account === "marketing");
    expect(mkLed.length).toBe(1);
    expect(mkLed[0].amountCents).toBe(-camp.costCents);
    expect(B(s!).boosts.some((b) => b.id === "mk_" + camp.id && b.trafficBp > 10000)).toBe(true);
    settleThrough(s!);
    expect(B(s!).marketing.active[0].revenueExtraCents).toBeLessThanOrEqual(B(s!).reports[0].revenueCents);
    const closeIters = camp.endDay - s!.day + 2;
    for (let i = 0; i < closeIters; i++) advanceDay(s!);
    expect(B(s!).marketing.active.some((c) => c.id === camp.id)).toBe(false);
    const closed = B(s!).marketing.history.find((c) => c.id === camp.id);
    expect(closed).toBeDefined();
    expect(closed!.settledDays).toBeGreaterThan(0);

    let a: GameState | null = null;
    let b2: GameState | null = null;
    for (let seed = 800; seed < 880 && !b2; seed++) {
      const ta = freshState({ seed });
      const tb = freshState({ seed });
      const r = run(tb, { type: "LAUNCH_MARKETING", defId: "time_discount", tier: "mid", targetSeg: "all" });
      if (!r.error && r.state && B(r.state).marketing.active.some((c) => c.outcome === "success")) { a = ta; b2 = r.state; }
    }
    expect(b2).not.toBeNull();
    settleThrough(a!);
    settleThrough(b2!);
    const ra = B(a!).reports[0], rb = B(b2!).reports[0];
    const avgA = ra.served ? ra.revenueCents / ra.served : 0;
    const avgB = rb.served ? rb.revenueCents / rb.served : 0;
    expect(avgB).toBeLessThan(avgA);
    expect(B(b2!).ledger.filter((e) => e.account === "marketing").length).toBe(1);
  });

  it("9c. 营销约束：重复/节日窗口/定向", () => {
    const s = freshState({ seed: 950 });
    const r1 = run(s, { type: "LAUNCH_MARKETING", defId: "flyer", tier: "low", targetSeg: "all" });
    expect(r1.error).toBeUndefined();
    expect(run(r1.state!, { type: "LAUNCH_MARKETING", defId: "flyer", tier: "low", targetSeg: "all" }).error).toContain("正在执行中");
    const r3 = run(r1.state!, { type: "LAUNCH_MARKETING", defId: "festival", tier: "mid", targetSeg: "all" });
    if (r3.error) expect(r3.error).toContain("节假日");
    expect(run(r1.state!, { type: "LAUNCH_MARKETING", defId: "member", tier: "mid", targetSeg: "student" }).error).toContain("不支持定向");
  });

  it("9d. 过期食材卖给大学生：市价40%回收、口碑-5、损耗入账", () => {
    const s = freshState({ seed: 9101 });
    settleThrough(s);
    addLot(B(s), "carp", 40000, 1000, 1000, B(s).day - 1, "fridge");
    newDay(s);
    expect(B(s).pendingSpoilage.length).toBeGreaterThan(0);
    const evt = s.events.pending.find((p) => p.defId === "expiry_alarm");
    expect(evt).toBeDefined();
    const cash0 = B(s).cashCents;
    const rep0 = B(s).reputation;
    const mkt = B(s).market["carp"].priceCents;
    resolveEvent(s, evt!.eventUid, "sell_cheap");
    const rev = Math.round(Math.round((40000 * mkt) / 1000) * 4000 / 10000);
    expect(B(s).cashCents - cash0).toBe(rev);
    expect(B(s).reputation).toBe(rep0 - 50);
    expect(B(s).pendingSpoilage.length).toBe(0);
    expect(B(s).ledger.some((e) => e.day === s.day && e.account === "event" && e.amountCents === rev)).toBe(true);
    expect(B(s).ledger.some((e) => e.day === s.day && e.account === "spoil" && e.amountCents < 0)).toBe(true);
  });

  it("9e. 身世剧情：大孝子/原神/催婚结婚离婚/假父母", () => {
    const m = freshState({ background: "miserable", seed: 9301 });
    m.day = 10;
    createPending(m, B(m), findDef("pious_reporter")!);
    const rep0 = B(m).reputation;
    resolveEvent(m, m.events.pending.find((p) => p.defId === "pious_reporter")!.eventUid, "honest");
    expect(B(m).reputation).toBe(rep0 + 50);
    expect(B(m).boosts.some((b) => b.label.includes("大孝子"))).toBe(true);
    expect(m.story.piousGoodUntilDay).toBeGreaterThan(m.day);

    const ty = freshState({ background: "tycoon", seed: 9302 });
    ty.day = 10;
    createPending(ty, B(ty), findDef("fake_parents")!);
    const repT = B(ty).reputation;
    resolveEvent(ty, ty.events.pending.find((p) => p.defId === "fake_parents")!.eventUid, "test");
    expect(B(ty).reputation).toBe(repT + 50);

    const ty2 = freshState({ background: "tycoon", seed: 9305 });
    ty2.day = 10;
    createPending(ty2, B(ty2), findDef("fake_parents")!);
    const fp = ty2.events.pending.find((p) => p.defId === "fake_parents")!;
    const demand = fp.data.demandCents as number;
    const cashA = B(ty2).cashCents;
    resolveEvent(ty2, fp.eventUid, "pay", { amountCents: String(demand) });
    expect(B(ty2).cashCents).toBe(cashA - demand);

    const af = freshState({ background: "affluent", seed: 9303 });
    af.day = 20;
    createPending(af, B(af), findDef("marriage")!);
    resolveEvent(af, af.events.pending.find((p) => p.defId === "marriage")!.eventUid, "arrange");
    expect(af.story.marriageStatus).toBe("married");
    settleThrough(af);
    const fam = B(af).ledger.filter((e) => e.account === "family");
    expect(fam[fam.length - 1].amountCents).toBe(-50000);
    createPending(af, B(af), findDef("divorce")!);
    const cash0 = B(af).cashCents;
    resolveEvent(af, af.events.pending.find((p) => p.defId === "divorce")!.eventUid, "split");
    expect(af.story.marriageStatus).toBe("divorced");
    expect(cash0 - B(af).cashCents).toBe(Math.round((cash0 * 5000) / 10000));

    const g = freshState({ seed: 9304 });
    g.day = 10;
    createPending(g, B(g), findDef("genshin")!);
    const gCash = B(g).cashCents, gRep = B(g).reputation;
    resolveEvent(g, g.events.pending[0].eventUid, "play");
    expect(B(g).cashCents - gCash).toBe(500000);
    expect(B(g).reputation).toBe(gRep - 50);
  });

  it("9f. 当日建议购入（分店口径）：缺口取整、补货后消失", () => {
    const s = freshState({ seed: 9401 });
    B(s).inventory["pork_shoulder"] = [];
    const list = suggestPurchase(s, B(s));
    const rec = list.find((x) => x.ingId === "pork_shoulder");
    expect(rec).toBeDefined();
    expect(rec!.shortage % ING_BY_ID["pork_shoulder"].moq).toBe(0);
    const r = run(s, { type: "BUY", ingId: "pork_shoulder", qty: rec!.shortage, supplierId: "frozen_co" });
    expect(r.error).toBeUndefined();
    expect(suggestPurchase(r.state!, B(r.state!)).find((x) => x.ingId === "pork_shoulder")).toBeUndefined();
  });

  it("10. 采访隐藏分数严格符合规则", () => {
    expect(computeInterviewScore(["q_years"], ["q_years_honest"], 5)).toBe(1);
    expect(computeInterviewScore(["q_years"], ["q_years_honest"], 4000)).toBe(2);
    expect(computeInterviewScore(["q_years"], ["q_years_lie"], 5)).toBe(3);
    expect(computeInterviewScore(["q_why"], ["q_why_miserable"], 5)).toBe(5);
    expect(computeInterviewScore(["q_why"], ["q_why_normal"], 5)).toBe(2);
    expect(computeInterviewScore(["q_why"], ["q_why_affluent"], 5)).toBe(1);
    expect(computeInterviewScore(["q_why"], ["q_why_tycoon"], 5)).toBe(3);
    expect(computeInterviewScore(["q_why"], ["q_why_cold"], 5)).toBe(-1);
    expect(computeInterviewScore(["q_soup"], ["q_soup_self"], 5)).toBe(2);
    expect(computeInterviewScore(["q_soup"], ["q_soup_staff"], 5)).toBe(3);
    for (const a of ["q_peak_am", "q_peak_noon", "q_peak_pm", "q_peak_evening", "q_peak_midnight"]) {
      expect(computeInterviewScore(["q_peak"], [a], 5)).toBe(1);
    }
    expect(computeInterviewScore(["q_peak"], ["q_peak_bad"], 5)).toBe(2);
    expect(computeInterviewScore(["q_peak"], ["q_peak_great"], 5)).toBe(3);
    expect(computeInterviewScore(["q_challenge"], ["q_cha_none"], 5)).toBe(1);
    expect(computeInterviewScore(["q_challenge"], ["q_cha_tough"], 5)).toBe(2);
    expect(computeInterviewScore(["q_challenge"], ["q_cha_complain"], 5)).toBe(-10);
    expect(computeInterviewScore(["q_name"], ["q_name_wife"], 5)).toBe(3);
    expect(computeInterviewScore(["q_name"], ["q_name_mom"], 5)).toBe(3);
    expect(computeInterviewScore(["q_name"], ["q_name_ai"], 5)).toBe(1);
    expect(computeInterviewScore(["q_name"], ["q_name_yummy"], 5)).toBe(2);
    const s = freshState({ seed: 12345, background: "miserable" });
    const iv: PendingEvent = {
      eventUid: 901, defId: "interview_visitor", cityId: "changsha", title: "t", desc: "", blocking: false, createdAtDay: s.day,
      data: { q0: "q_why", q1: "q_soup", q2: "q_name", followers: 30000, matchBp: 9000, name: "测试" },
      options: [{ id: "answer", label: "答" }],
    };
    s.events.pending.push(iv);
    resolveEvent(s, 901, "answer", { answers: "q_why_miserable,q_soup_staff,q_name_mom" });
    expect(B(s).boosts.some((b) => b.label === "采访出圈" && b.trafficBp > 10000)).toBe(true);
    const s3 = freshState({ seed: 12347 });
    s3.events.pending.push({ ...iv, eventUid: 903, data: { ...iv.data, q0: "q_challenge", q1: "q_why", q2: "q_years" } });
    resolveEvent(s3, 903, "answer", { answers: "q_cha_complain,q_why_cold,q_years_honest" });
    expect(B(s3).boosts.some((b) => b.label === "采访翻车" && b.trafficBp < 10000)).toBe(true);
  });

  it("11. 小于1000粉丝探店博主不产生持续客流增益", () => {
    for (const opt of ["normal", "extra", "gift", "meal", "refuse"]) {
      const s = freshState({ seed: 31337 });
      const pe: PendingEvent = {
        eventUid: 501, defId: "blogger_dropin", cityId: "changsha", title: "t", desc: "", blocking: false, createdAtDay: s.day,
        data: { followers: 999, matchBp: 9000, quality: 95, name: "小透明", persistent: 0 },
        options: [{ id: "normal", label: "正常" }],
      };
      s.events.pending.push(pe);
      resolveEvent(s, 501, opt);
      // 粉丝<1000：不允许产生“探店持续客流增益”（拒绝接待的舆论反伤属于惩罚事件，另算）
      expect(B(s).boosts.filter((x) => x.id.startsWith("bl_")).length).toBe(0);
    }
    let gotBoost = false;
    for (let i = 0; i < 20 && !gotBoost; i++) {
      const s = freshState({ seed: 1000 + i });
      const pe: PendingEvent = {
        eventUid: 501, defId: "blogger_dropin", cityId: "changsha", title: "t", desc: "", blocking: false, createdAtDay: s.day,
        data: { followers: 80000, matchBp: 9000, quality: 95, name: "大博主", persistent: 1 },
        options: [{ id: "normal", label: "正常" }],
      };
      s.events.pending.push(pe);
      resolveEvent(s, 501, "normal");
      gotBoost = B(s).boosts.some((b) => b.persistent && b.trafficBp > 10000);
    }
    expect(gotBoost).toBe(true);
  });

  it("12. 存档后刷新浏览器可恢复完整游戏", async () => {
    const store = new Map<string, string>();
    const adapter = memoryAdapter(store);
    const s = freshState({ seed: 616 });
    settleThrough(s);
    newDay(s);
    run(s, { type: "BUY", ingId: "rice", qty: 3000, supplierId: "mawangdui" });
    await saveGame(adapter, "auto", s);
    const adapter2 = memoryAdapter(store);
    const loaded = await loadGame(adapter2, "auto");
    expect(loaded.ok).toBe(true);
    expect(loaded.state).toEqual(s);
    const r = run(loaded.state!, { type: "CONFIRM_PLAN" });
    expect(r.state).not.toBeNull();
  });

  it("13. 重复结算不重复记账", () => {
    const s = freshState({ seed: 8080 });
    expect(confirmPlan(s, B(s)).ok).toBe(true);
    expect(settleDay(s, B(s)).ok).toBe(true);
    const ledgerLen = B(s).ledger.length;
    const cash = B(s).cashCents;
    expect(settleDay(s, B(s)).ok).toBe(true);
    expect(B(s).ledger.length).toBe(ledgerLen);
    expect(B(s).cashCents).toBe(cash);
    expect(B(s).reports.length).toBe(1);
  });

  it("14. 现金/库存/财务全为整数且30天闭环可运营；无负库存", () => {
    const s = freshState({ seed: 314159 });
    for (let day = 0; day < 30; day++) {
      for (const ingId of ["pork_shoulder", "chili_fresh", "rice", "noodles", "scallion", "cooking_oil", "egg", "tofu"]) {
        const def = ING_BY_ID[ingId];
        if (totalStock(B(s), ingId) < def.capacityBase * 0.4) {
          const r = run(s, { type: "BUY", ingId, qty: def.unit === "piece" ? 24 : 2000, supplierId: "mawangdui" });
          if (r.error === "该店现金不足") break;
        }
      }
      const ck = checkPlan(s, B(s));
      if (ck.errors.some((e) => e.includes("现金为负"))) break;
      advanceDay(s);
      for (const bb of Object.values(s.branches)) {
        expect(Number.isInteger(bb.cashCents)).toBe(true);
        for (const lots of Object.values(bb.inventory)) {
          for (const l of lots) {
            expect(Number.isInteger(l.qty)).toBe(true);
            expect(l.qty).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(l.unitPriceCents)).toBe(true);
          }
        }
        for (const e of bb.ledger) expect(Number.isInteger(e.amountCents)).toBe(true);
      }
    }
    expect(s.day).toBeGreaterThanOrEqual(25);
    expect(B(s).reports.length).toBeGreaterThan(20);
  });

  it("15. 购物车：加购不扣现金、合行、持久化、一键购买、失败留存", async () => {
    const s = freshState({ seed: 4242 });
    const cash0 = B(s).cashCents;
    const a1 = run(s, { type: "CART_ADD", ingId: "beef", qty: 1000, supplierId: "frozen_co" });
    expect(B(a1.state!).cashCents).toBe(cash0);
    const a2 = run(a1.state!, { type: "CART_ADD", ingId: "beef", qty: 500, supplierId: "frozen_co" });
    expect(B(a2.state!).cart.length).toBe(1);
    expect(B(a2.state!).cart[0].qty).toBe(1500);
    expect(run(a2.state!, { type: "CART_ADD", ingId: "beef", qty: 300, supplierId: "frozen_co" }).error).toContain("起订量");
    const adapter = memoryAdapter();
    await saveGame(adapter, "slot2", a2.state!);
    const loaded = await loadGame(adapter, "slot2");
    expect(B(loaded.state!).cart).toEqual(B(a2.state!).cart);
    const beef0 = totalStock(B(loaded.state!), "beef");
    const co = run(loaded.state!, { type: "CART_CHECKOUT" });
    expect(co.error).toBeUndefined();
    expect(B(co.state!).cart.length).toBe(0);
    expect(totalStock(B(co.state!), "beef")).toBe(beef0 + 1500);
    expect(B(co.state!).cashCents).toBeLessThan(cash0);
    const m1 = run(s, { type: "CART_ADD", ingId: "milk", qty: 2000, supplierId: "mawangdui" });
    const m2 = run(m1.state!, { type: "CART_REMOVE", index: 0 });
    expect(B(m2.state!).cart.length).toBe(0);
  });

  it("16. 供应商规则：马王堆次日达、冻品当日达+运费，两家全品类可买", () => {
    const s = freshState({ seed: 4243 });
    expect(supplierById("fresh_shop")).toBeUndefined();
    expect(supplierById("group_buy")).toBeUndefined();
    const rice0 = totalStock(B(s), "rice");
    const r = run(s, { type: "BUY", ingId: "rice", qty: 5000, supplierId: "mawangdui" });
    expect(r.error).toBeUndefined();
    expect(totalStock(B(r.state!), "rice")).toBe(rice0);
    expect(B(r.state!).pendingDeliveries.length).toBe(1);
    const qM = quoteBuy(r.state!, B(r.state!), ING_BY_ID["beef"], 1000, supplierById("mawangdui")!);
    const qF = quoteBuy(r.state!, B(r.state!), ING_BY_ID["beef"], 1000, supplierById("frozen_co")!);
    expect(qM.goodsCents).toBeLessThan(qF.goodsCents);
    expect(qF.feeCents).toBeGreaterThan(0);
    // 蔬菜也可选冻品公司（当日达）
    expect(quoteBuy(r.state!, B(r.state!), ING_BY_ID["lettuce"], 1000, supplierById("frozen_co")!).goodsCents).toBeGreaterThan(0);
    settleThrough(r.state!);
    newDay(r.state!);
    expect(totalStock(B(r.state!), "rice")).toBeGreaterThan(rice0);
  });

  it("17. 自动购入：仅点击执行、补足目标库容、过期/停用拒绝、持久化", async () => {
    const s = freshState({ seed: 4400 });
    expect(run(s, { type: "AUTO_RESTOCK_RUN" }).error).toContain("尚未设置");
    expect(run(s, { type: "AUTO_RESTOCK_SAVE", items: [{ ingId: "rice", targetQty: 100 }], days: 3, supplierId: "mawangdui" }).error).toContain("没有有效");
    const sv = run(s, { type: "AUTO_RESTOCK_SAVE", items: [{ ingId: "rice", targetQty: 30000 }], days: 3, supplierId: "mawangdui" });
    expect(sv.error).toBeUndefined();
    expect(B(sv.state!).autoRestock.untilDay).toBe(sv.state!.day + 2);
    // 推进一天不自动买
    const ricePend = (x: GameState) => B(x).pendingDeliveries.filter((p) => p.ingId === "rice").reduce((a, p) => a + p.qty, 0);
    expect(ricePend(sv.state!)).toBe(0);
    advanceDay(sv.state!);
    expect(ricePend(sv.state!)).toBe(0);
    // 手动点击 → 补足
    const cash1 = B(sv.state!).cashCents;
    const rr = run(sv.state!, { type: "AUTO_RESTOCK_RUN" });
    expect(rr.error).toBeUndefined();
    expect(B(rr.state!).cashCents).toBeLessThan(cash1);
    expect(ricePend(rr.state!)).toBeGreaterThanOrEqual(30000 - totalStock(B(sv.state!), "rice") - 1000);
    const cash2 = B(rr.state!).cashCents;
    expect(B(run(rr.state!, { type: "AUTO_RESTOCK_RUN" }).state!).cashCents).toBe(cash2);
    const past = structuredClone(rr.state!);
    B(past).autoRestock.untilDay = past.day - 1;
    expect(run(past, { type: "AUTO_RESTOCK_RUN" }).error).toContain("已过期");
    const stopped = run(rr.state!, { type: "AUTO_RESTOCK_STOP" });
    expect(run(stopped.state!, { type: "AUTO_RESTOCK_RUN" }).error).toBeTruthy();
    const adapter = memoryAdapter();
    await saveGame(adapter, "slot3", rr.state!);
    const re = await loadGame(adapter, "slot3");
    expect(B(re.state!).autoRestock.items).toEqual(B(rr.state!).autoRestock.items);
  });

  it("18. 一键加入购物车：按本店缺口批量入车、可选供应商", () => {
    const s = freshState({ seed: 9800 });
    B(s).inventory["pork_shoulder"] = [];
    const r = run(s, { type: "CART_ADD_SUGGESTED", supplierId: "frozen_co" });
    expect(r.error).toBeUndefined();
    const beefRow = B(r.state!).cart.find((c) => c.ingId === "pork_shoulder");
    expect(beefRow).toBeDefined();
    expect(beefRow!.supplierId).toBe("frozen_co");
    expect(beefRow!.qty % ING_BY_ID["pork_shoulder"].moq).toBe(0);
    // 未购买：现金不变
    expect(B(r.state!).cashCents).toBe(B(s).cashCents);
  });

  it("19. 菜品研究：开局仅湘菜；学系→试做解锁（全局共享）；错料→实验菜", () => {
    const s = freshState({ seed: 9600 });
    expect(s.study.unlockedDishes.every((id) => DISH_BY_ID[id].cuisine === "hunan")).toBe(true);
    expect(run(s, { type: "TOGGLE_DISH", dishId: "ma_po_doufu" }).error).toContain("尚未研究");
    const lc = run(s, { type: "LEARN_CUISINE", cuisine: "sichuan" });
    expect(lc.error).toBeUndefined();
    expect(B(s).cashCents - B(lc.state!).cashCents).toBe(500000);
    const target = DISH_BY_ID["ma_po_doufu"];
    const rs = run(lc.state!, { type: "RESEARCH_START", dishId: "ma_po_doufu" });
    expect(B(lc.state!).cashCents - B(rs.state!).cashCents).toBe(20000);
    const sub = run(rs.state!, { type: "RESEARCH_SUBMIT", ings: target.recipe.map((r) => r.ingId) });
    expect(sub.message).toContain("研发完成");
    expect(sub.state!.study.unlockedDishes).toContain("ma_po_doufu");
    expect(run(sub.state!, { type: "TOGGLE_DISH", dishId: "ma_po_doufu" }).error).toBeUndefined();
    const rs2 = run(sub.state!, { type: "RESEARCH_START", dishId: "dan_dan_mian" });
    const sub2 = run(rs2.state!, { type: "RESEARCH_SUBMIT", ings: ["rice", "milk"] });
    expect(sub2.state!.study.unlockedDishes).not.toContain("dan_dan_mian");
    const expEvt = sub2.state!.events.pending.find((p) => p.defId === "experiment_result");
    expect(expEvt).toBeDefined();
    const repA = B(sub2.state!).reputation;
    resolveEvent(sub2.state!, expEvt!.eventUid, "serve");
    expect(Math.abs(B(sub2.state!).reputation - repA)).toBe(5);
    expect(run(sub2.state!, { type: "RESEARCH_START", dishId: "san_wen_yu_shou_si" }).error).toContain("尚未学习");
    expect(run(sub2.state!, { type: "LEARN_CUISINE", cuisine: "sichuan" }).error).toContain("已学习");
  });

  it("20. 市井事件：捐助/员工心事→三日变故(资助/安慰离职)/彩票/早退/骚扰", () => {
    const s = freshState({ seed: 9700 });
    createPending(s, B(s), findDef("yuzhou_flood")!);
    const cash0 = B(s).cashCents, rep0 = B(s).reputation;
    resolveEvent(s, s.events.pending.find((p) => p.defId === "yuzhou_flood")!.eventUid, "donate");
    expect(cash0 - B(s).cashCents).toBe(500000);
    expect(B(s).reputation).toBe(rep0 + 50);
    createPending(s, B(s), findDef("staff_troubled")!);
    const st = s.events.pending.find((p) => p.defId === "staff_troubled")!;
    const empId = Number(st.data.empId);
    resolveEvent(s, st.eventUid, "care");
    expect(s.scheduled.some((x) => x.defId === "staff_family_hardship" && Number(x.data.empId) === empId)).toBe(true);
    for (let i = 0; i < 3; i++) advanceDay(s);
    const fh = s.events.pending.find((p) => p.defId === "staff_family_hardship");
    expect(fh).toBeDefined();
    const emp = B(s).staff.find((x) => x.id === empId)!;
    const sat0 = emp.satisfaction;
    resolveEvent(s, fh!.eventUid, "money");
    expect(emp.satisfaction).toBe(Math.min(100, sat0 + 50));
    createPending(s, B(s), findDef("staff_family_hardship")!);
    const fh2 = s.events.pending.filter((p) => p.defId === "staff_family_hardship").pop()!;
    const goneId = Number(fh2.data.empId);
    const n0 = B(s).staff.length;
    resolveEvent(s, fh2.eventUid, "comfort");
    advanceDay(s);
    expect(B(s).staff.length).toBe(n0 - 1);
    expect(B(s).staff.some((x) => x.id === goneId)).toBe(false);
    createPending(s, B(s), findDef("lottery")!);
    const lot = s.events.pending.find((p) => p.defId === "lottery")!;
    const amt = Number(lot.data.amountCents);
    expect(amt).toBeGreaterThanOrEqual(5000);
    expect(amt).toBeLessThanOrEqual(1000000);
    const c1 = B(s).cashCents;
    resolveEvent(s, lot.eventUid, "cash");
    expect(B(s).cashCents - c1).toBe(amt);
    createPending(s, B(s), findDef("staff_early_leave")!);
    const el = s.events.pending.find((p) => p.defId === "staff_early_leave")!;
    const e2 = B(s).staff.find((x) => x.id === Number(el.data.empId))!;
    const sat2 = e2.satisfaction, rep2 = B(s).reputation;
    resolveEvent(s, el.eventUid, "allow");
    expect(e2.satisfaction).toBe(Math.min(100, sat2 + 20));
    expect(B(s).reputation).toBe(rep2 + 10);
    createPending(s, B(s), findDef("harassment")!);
    resolveEvent(s, s.events.pending.find((p) => p.defId === "harassment")!.eventUid, "ignore");
    expect(B(s).boosts.some((x) => x.trafficBp === 8000)).toBe(true);
    createPending(s, B(s), findDef("harassment")!);
    const rep3 = B(s).reputation;
    resolveEvent(s, s.events.pending.filter((p) => p.defId === "harassment").pop()!.eventUid, "police");
    expect(B(s).reputation).toBe(rep3 + 20);
  });

  it("21. 多城分店：门槛/开店/汇率周转/独立市场/成果共享/全球推进校验", () => {
    // 门槛校验：普通身世净资产不足以开成都店
    const n = freshState({ seed: 21001 });
    expect(run(n, { type: "OPEN_BRANCH", cityId: "chengdu" }).error).toContain("净资产不足");
    // 豪门：资金满足多城门槛
    const t = freshState({ background: "tycoon", seed: 12345 });
    expect(netWorthCents(t)).toBeGreaterThanOrEqual(CITY_BY_ID.chengdu.unlockNetWorthCents);
    const csCash0 = t.branches.changsha.cashCents;
    const open = run(t, { type: "OPEN_BRANCH", cityId: "chengdu" });
    expect(open.error).toBeUndefined();
    const s2 = open.state!;
    expect(Object.keys(s2.branches).sort()).toEqual(["changsha", "chengdu"]);
    expect(s2.activeCityId).toBe("chengdu");
    expect(s2.branches.changsha.cashCents).toBeLessThan(csCash0);
    const chb = s2.branches.chengdu;
    expect(chb.cashCents).toBe(0);
    expect(Object.keys(chb.inventory).length).toBe(0);
    // 市场独立：两城初始价按各自市场系数
    expect(chb.market["beef"].priceCents).not.toBe(s2.branches.changsha.market["beef"].priceCents);
    // 研究成果共享：湘菜在新店可上架
    expect(s2.study.unlockedDishes.includes("la_jiao_chao_rou")).toBe(true);
    // 切回长沙做资金周转
    const s3 = run(s2, { type: "SWITCH_CITY", cityId: "changsha" }).state!;
    const before = B(s3).cashCents;
    const tr = run(s3, { type: "TRANSFER_FUNDS", toCityId: "chengdu", cents: 10000000 });
    expect(tr.error).toBeUndefined();
    expect(tr.state!.branches.chengdu.cashCents).toBe(10000000);
    expect(tr.state!.branches.changsha.cashCents).toBe(before - 10000000);
    // 东京汇率：10万元人民币 → 205万日元（分口径 ×20.5）
    expect(toLocalCents(10000000, CITY_BY_ID.tokyo.fxPerCnyBp)).toBe(205000000);
    // 全球推进校验：成都未结算不能过夜
    settleThrough(s3); // 长沙结算（当前分店现金已调出仍可营业）
    const nd = newDay(s3);
    expect(nd.blocked).toContain("成都");
    closeToday(s3, s3.branches.chengdu);
    const nd2 = newDay(s3);
    expect(nd2.blocked).toBeUndefined();
    expect(s3.day).toBe(2);
  });

  it("23. 事件元数据完整且每个事件在每个分店都可能发生", () => {
    // 每个事件必须含：ID/标题/正文/类型/概率/冷却/选项，且默认允许重复触发
    for (const def of EVENT_DEFS) {
      expect(def.id).toBeTruthy();
      expect(def.title).toBeTruthy();
      expect(def.desc).toBeTruthy();
      expect(def.type && def.type.length > 0).toBe(true);
      expect(def.probBp >= 0).toBe(true);
      expect(typeof def.cooldownDays).toBe("number");
      const built = def.build(freshState({ seed: 7 }), B(freshState({ seed: 7 })));
      expect(built.options.length).toBeGreaterThanOrEqual(def.id === "interview_visitor" ? 1 : 2); // 采访为内嵌三题的单一回答入口
      for (const o of built.options) expect(o.label).toBeTruthy();
    }
    // 每个分店独立判定：双城存档跑大量事件骰，成都店也必须出现事件
    const t = freshState({ background: "tycoon", seed: 23000 });
    const s2 = run(t, { type: "OPEN_BRANCH", cityId: "chengdu" }).state!;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const b2 of Object.values(s2.branches)) b2.store.hygiene = 60; // 保持常规事件条件可用
      s2.events.cooldowns = {};
      s2.events.pending = [];
      tryDailyEvents(s2);
      for (const p of s2.events.pending) seen.add(p.cityId);
    }
    expect(seen.has("changsha")).toBe(true);
    expect(seen.has("chengdu")).toBe(true);
  });

  it("24. 新增市井事件效果：水管/暴雨/生日/猫/税收/白菜 的即时+持续效果", () => {
    const s = freshState({ seed: 24000 });
    const b = B(s);
    // 水管 A：-1800元、明日-5%
    createPending(s, b, findDef("pipe_burst")!);
    let uid = s.events.pending.find((p) => p.defId === "pipe_burst")!.eventUid;
    const cash0 = b.cashCents;
    resolveEvent(s, uid, "pro");
    expect(cash0 - b.cashCents).toBe(180000);
    expect(b.boosts.some((x) => x.trafficBp === 9500 && x.untilDay === s.day + 1)).toBe(true);
    // 水管 B：初始班底平均技能<45 → 500+额外1000
    createPending(s, b, findDef("pipe_burst")!);
    uid = s.events.pending.find((p) => p.defId === "pipe_burst")!.eventUid;
    const cash1 = b.cashCents;
    resolveEvent(s, uid, "diy");
    expect(cash1 - b.cashCents).toBe(150000);
    expect(b.boosts.some((x) => x.trafficBp === 9000)).toBe(true);
    // 暴雨：晴天不触发（条件），改雨天后可
    expect(findDef("storm_day")!.condition!(s, b)).toBe(false);
    s.date = { ...s.date, weather: "rain" };
    expect(findDef("storm_day")!.condition!(s, b)).toBe(true);
    createPending(s, b, findDef("storm_day")!);
    const rep0 = b.reputation;
    resolveEvent(s, s.events.pending.find((p) => p.defId === "storm_day")!.eventUid, "warm_set");
    expect(b.reputation).toBe(rep0 + 20); // 口碑+2
    expect(b.boosts.some((x) => x.trafficBp === 11200 && x.untilDay === s.day + 2)).toBe(true);
    // 员工生日 A：全员满意/忠诚+10，-300元
    createPending(s, b, findDef("staff_birthday")!);
    const satA = b.staff.map((e) => e.satisfaction);
    resolveEvent(s, s.events.pending.find((p) => p.defId === "staff_birthday")!.eventUid, "supper");
    b.staff.forEach((e, i) => expect(e.satisfaction).toBe(Math.min(100, satA[i] + 10)));
    // 猫 C：吉祥物 -100元、+15% 3天
    createPending(s, b, findDef("cat_manager")!);
    resolveEvent(s, s.events.pending.find((p) => p.defId === "cat_manager")!.eventUid, "mascot");
    expect(b.boosts.some((x) => x.trafficBp === 11500 && x.untilDay === s.day + 3)).toBe(true);
    // 税收梗 C：口碑变动在 -10~+30 之间且为 10 的倍数
    createPending(s, b, findDef("tax_flavor_review")!);
    const rep1 = b.reputation;
    resolveEvent(s, s.events.pending.find((p) => p.defId === "tax_flavor_review")!.eventUid, "joke_back");
    const dRep = b.reputation - rep1;
    expect(dRep % 10).toBe(0);
    expect(dRep).toBeGreaterThanOrEqual(-10);
    expect(dRep).toBeLessThanOrEqual(30);
    // 白菜 A：售卖入账 +500元
    createPending(s, b, findDef("giant_cabbage")!);
    const cash2 = b.cashCents;
    resolveEvent(s, s.events.pending.find((p) => p.defId === "giant_cabbage")!.eventUid, "limited_dish");
    expect(b.cashCents - cash2).toBe(50000);
    // 事件完成后从 pending 移除并进入历史（完成状态）
    expect(s.events.pending.some((p) => p.defId === "giant_cabbage")).toBe(false);
    expect(s.events.history.some((h) => h.defId === "giant_cabbage")).toBe(true);
  });

  it("22. v1 旧存档自动迁移为 v2 分店结构", () => {
    const v1 = {
      saveVersion: 1, rng: 5, seed: 5, createdAt: 0, day: 9,
      phase: "report",
      boss: { name: "老档", age: 30, restaurantName: "旧档馆", background: "normal", personality: "frugal", philosophy: "x", difficulty: "normal", credibilityRisk: 0 },
      date: { year: 2026, month: 3, dayOfMonth: 9, weekday: 2, season: "春", weather: "sunny" },
      location: { cityId: "changsha", districtId: "community" },
      store: { tier: "small", seats: 22, stations: 2, hygiene: 70, decor: 30, equipmentHealth: 90, kitchenFlow: 60, fridgeCapacityBp: 10000, openSlots: ["lunch"], orderLimitCovers: 0 },
      cashCents: 1234567, inventory: {}, nextLotId: 3, market: {}, menu: {},
      staff: [], nextEmpId: 4, candidatePool: [], poolGenerationDay: 1,
      reputation: 500, regulars: 3, reviews: [], boosts: [], bloggerLog: [],
      events: { nextUid: 2, pending: [], cooldowns: {}, history: [], parentCallCooldownUntil: 0, familyHelpUsed: false, transferredTotalCents: 0, transferCount: 0 },
      ledger: [], reports: [], settledDay: 9, lastReportDay: 9, planConfirmedDirty: false,
      negCashStreak: 0, unlockedCities: ["changsha"], achievements: [], notes: "",
      loans: [], pendingDeliveries: [], pendingSpoilage: [], purchasesToday: [], cart: [],
    };
    const res = migrate(v1 as unknown as GameState & { [k: string]: unknown });
    expect(res.ok).toBe(true);
    const v2 = res.state!;
    expect(v2.saveVersion).toBe(2);
    expect(v2.branches.changsha.cashCents).toBe(1234567);
    expect(v2.branches.changsha.phase).toBe("report");
    expect(v2.branches.changsha.day).toBe(9);
    expect(v2.activeCityId).toBe("changsha");
    // v1 档视为全部菜系已学、全部菜品已解锁（保持旧档可玩）
    expect(v2.study.unlockedDishes.length).toBeGreaterThan(40);
    expect(v2.study.learned.length).toBeGreaterThan(5);
  });
});
