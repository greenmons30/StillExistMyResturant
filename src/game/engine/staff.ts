// 员工：招聘/辞退/排班/培训、疲劳压力满意度、经验递减成长、离职判定、店长自动排班（分店独立）
import type { Branch, CandidateDef, Employee, GameState, RoleId, SlotId } from "../types";
import { STAFF, getMods } from "../config";
import { CITY_BY_ID } from "../data/cities";
import { EMP_TRAITS } from "../data/segments";
import { rndInt, rndPick, chance } from "../rng";
import { clamp } from "../utils";

export const ROLE_NAMES: Record<RoleId, string> = {
  cook: "厨师", prep: "切配员", server: "服务员", manager: "店长", cleaner: "清洁员",
};

// 人民币口径的基础日薪（分）
export function wageForRole(role: RoleId, skill: number): number {
  const w = STAFF.wageByRole[role];
  return Math.round(w.base + (w.slope * skill * 100) / 100);
}

// 城市工资系数后的当地日薪（分）
export function localWage(s: GameState, cityId: string, role: RoleId, skill: number): number {
  const city = CITY_BY_ID[cityId];
  return Math.round((wageForRole(role, skill) * city.wageFactorBp) / 10000);
}

function localName(s: GameState, cityId: string): string {
  const pool = CITY_BY_ID[cityId]?.namePool ?? { first: ["张"], last: ["伟"] };
  return rndPick(s, pool.first) + rndPick(s, pool.last);
}

const ROLE_ROTATION: RoleId[] = ["manager", "cook", "cook", "prep", "server", "server", "cook", "cleaner"];

export function genCandidates(s: GameState, b: Branch): CandidateDef[] {
  const pool: CandidateDef[] = [];
  for (let i = 0; i < STAFF.poolSize; i++) {
    const role = ROLE_ROTATION[i % ROLE_ROTATION.length];
    const skill = clamp(rndInt(s, 18, 88), 5, 95);
    const want = Math.round(localWage(s, b.cityId, role, skill) * (1000 + rndInt(s, -50, 200)) / 1000);
    const isSchedulingManager = role === "manager" && i === 0; // 每家分店候选池必有“会排班的店长”
    const specList = { cook: ["猛火快炒", "卤味", "面点", "海鲜处理", "凉菜", "甜品"], prep: ["刀工", "备料", "腌肉", "摆盘"], server: ["记忆菜单", "催单", "带位", "打包"], manager: ["排班", "盘点", "客诉处理"], cleaner: ["深度清洁", "除味", "洗碗快"] }[role];
    pool.push({
      poolId: s.day * 1000 + b.cityId.charCodeAt(0) * 7 + i,
      name: localName(s, b.cityId),
      role, skill, wageCents: want,
      hireFeeCents: Math.round((want * STAFF.hireFeeBp) / 10000),
      trait: rndPick(s, EMP_TRAITS),
      specialty: isSchedulingManager ? "排班" : rndPick(s, specList),
    });
  }
  return pool;
}

export function hire(s: GameState, b: Branch, poolId: number): { ok: boolean; error?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段操作员工" };
  const c = b.candidatePool.find((x) => x.poolId === poolId);
  if (!c) return { ok: false, error: "该候选人已不存在（每3天刷新）" };
  if (b.cashCents < c.hireFeeCents) return { ok: false, error: "该店现金不足以支付招聘费" };
  b.cashCents -= c.hireFeeCents;
  b.ledger.push({ day: s.day, account: "other", amountCents: -c.hireFeeCents, cash: true, memo: `招聘${ROLE_NAMES[c.role]}${c.name}` });
  b.candidatePool = b.candidatePool.filter((x) => x.poolId !== poolId);
  b.staff.push({
    id: b.nextEmpId++, name: c.name, role: c.role, skill: c.skill, xp: 0, level: 1,
    baseWageCents: c.wageCents, overtimeRateBp: STAFF.overtimeBp, shifts: [...["lunch", "dinner"]] as SlotId[],
    fatigue: rndInt(s, 0, 10), stress: rndInt(s, 0, 10), satisfaction: rndInt(s, 55, 75),
    loyalty: rndInt(s, 50, 70), trait: c.trait, specialty: c.specialty, trainingUntilDay: 0,
  });
  b.planConfirmedDirty = true;
  return { ok: true };
}

export function fire(s: GameState, b: Branch, empId: number): { ok: boolean; error?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段操作员工" };
  const e = b.staff.find((x) => x.id === empId);
  if (!e) return { ok: false, error: "员工不存在" };
  const severance = e.baseWageCents * 7;
  if (b.cashCents < severance) return { ok: false, error: `现金不足支付遣散费 ${Math.floor(severance / 100)}元` };
  b.cashCents -= severance;
  b.ledger.push({ day: s.day, account: "other", amountCents: -severance, cash: true, memo: `辞退${e.name}遣散费` });
  b.staff = b.staff.filter((x) => x.id !== empId);
  b.planConfirmedDirty = true;
  return { ok: true };
}

export function assignShifts(b: Branch, empId: number, shifts: SlotId[]): { ok: boolean; error?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段排班" };
  const e = b.staff.find((x) => x.id === empId);
  if (!e) return { ok: false, error: "员工不存在" };
  e.shifts = shifts;
  b.planConfirmedDirty = true;
  return { ok: true };
}

export function trainEmployee(s: GameState, b: Branch, empId: number): { ok: boolean; error?: string } {
  if (b.phase !== "planning") return { ok: false, error: "只能在计划阶段安排培训" };
  const e = b.staff.find((x) => x.id === empId);
  if (!e) return { ok: false, error: "员工不存在" };
  if (e.trainingUntilDay > s.day) return { ok: false, error: "正在培训中" };
  const cost = Math.round(STAFF.trainingCostCents * (1 + e.skill / 100));
  if (b.cashCents < cost) return { ok: false, error: "培训费用不足" };
  b.cashCents -= cost;
  b.ledger.push({ day: s.day, account: "training", amountCents: -cost, cash: true, memo: `${e.name}培训` });
  e.trainingUntilDay = s.day + STAFF.trainingDays;
  b.planConfirmedDirty = true;
  return { ok: true };
}

// 营业日工作影响：熟练度按递减曲线成长，疲劳累积
export function applyWorkImpact(s: GameState, b: Branch, servedDishes: number, workedRoles: Record<RoleId, number>, heavy: boolean): { name: string; skill: number; xpGain: number }[] {
  const mods = getMods(s.boss.personality);
  const growth: { name: string; skill: number; xpGain: number }[] = [];
  for (const e of b.staff) {
    if (e.trainingUntilDay === s.day + 1) {
      e.skill = clamp(e.skill + STAFF.trainingSkillGain, 0, 100);
      e.trainingUntilDay = 0;
    }
    const n = workedRoles[e.role] ?? 0;
    if (n <= 0 || e.shifts.length === 0) continue;
    const share = Math.max(1, Math.floor(servedDishes / n));
    const baseXp = e.role === "cook" || e.role === "prep" ? share * STAFF.xpPerServedDish
      : e.role === "server" ? Math.round(share * STAFF.xpPerServedDish * 0.5) : 4;
    e.xp += Math.max(1, Math.round(baseXp * mods.xpGainBp / 10000));
    let gained = 0;
    while (gained < 2 && e.skill < 100 && e.xp >= 60 + e.skill * 2) {
      e.xp -= 60 + e.skill * 2;
      e.skill++;
      gained++;
    }
    e.level = levelOf(e.xp + e.skill * 80);
    e.fatigue = clamp(e.fatigue + Math.round(e.shifts.length * STAFF.fatiguePerSlot * mods.fatigueBp / 10000) + (heavy ? 6 : 0), 0, 100);
    if (e.fatigue > 80) e.stress = clamp(e.stress + 8, 0, 100);
    if (gained > 0) growth.push({ name: e.name, skill: e.skill, xpGain: gained });
  }
  return growth;
}

export function levelOf(xp: number): number {
  let lv = 1;
  for (let i = 1; i < STAFF.xpLevelGap.length; i++) if (xp >= STAFF.xpLevelGap[i]) lv = i + 1;
  return clamp(lv, 1, 10);
}

// 休息恢复、不满演化、离职判定（NEW_DAY 调用）
export function dailyStaffUpdate(s: GameState, b: Branch, shortHandedBp: number): Employee[] {
  const mods = getMods(s.boss.personality);
  const left: Employee[] = [];
  for (const e of b.staff) {
    const noShiftToday = e.shifts.length === 0;
    if (noShiftToday) {
      e.fatigue = clamp(e.fatigue - STAFF.fatigueRestNoShift, 0, 100);
      e.stress = 0;
    } else {
      e.fatigue = clamp(e.fatigue - STAFF.fatigueRestPerDay, 0, 100);
      e.stress = clamp(e.stress + Math.round(shortHandedBp / 100) - 4, 0, 100);
    }
    const market = localWage(s, b.cityId, e.role, e.skill);
    if (e.baseWageCents < market) e.satisfaction = clamp(e.satisfaction - STAFF.satDecayLowWageBp / 100, 0, 100);
    e.satisfaction = clamp(e.satisfaction + mods.staffSatAdd / 100 + (e.fatigue > 80 ? -3 : 1), 0, 100);
    if (e.satisfaction > 70) e.loyalty = clamp(e.loyalty + 1, 0, 100);
    let leaveBp = STAFF.leaveChanceBpBase;
    if (e.satisfaction < 30) leaveBp += STAFF.leaveByBadSatisfactionBp;
    if (e.loyalty < 25) leaveBp += 400;
    leaveBp = Math.round(leaveBp * mods.leaveRiskBp / 10000);
    if (chance(s, leaveBp)) {
      e.loyalty = 0;
      left.push(e);
    }
  }
  if (left.length) b.staff = b.staff.filter((x) => !left.includes(x));
  return left;
}

export function speedFactorBp(skill: number, fatigue: number, difficulty: number): number {
  let bp = 12500; // 基础125%
  bp += Math.round(-skill * 50);
  bp += Math.round((difficulty - 50) * 4);
  if (fatigue > 60) bp += Math.round((fatigue - 60) * 80);
  return clamp(bp, 6000, 22000);
}

export function qualityOfStaffCook(skill: number, fatigue: number, equipmentHealth: number, kitchenFlow: number): number {
  let q = (skill - 50) / 2;
  if (fatigue > 70) q -= (fatigue - 70) / 4;
  q += (equipmentHealth - 70) / 8;
  q += (kitchenFlow - 50) / 10;
  return Math.round(q * 10) / 10;
}

export function onDuty(s: GameState, b: Branch, slot: string, role: RoleId): Employee[] {
  return b.staff.filter((e) => e.role === role && e.shifts.includes(slot as SlotId) && e.trainingUntilDay <= s.day);
}

export function dailyWageCents(e: Employee, modsMultBp = 10000): number {
  if (e.shifts.length === 0) return 0;
  const slotPremium = Math.round((e.baseWageCents * STAFF.slotHoursWageBp) / 10000 / 4) * e.shifts.length;
  return Math.round(((e.baseWageCents + slotPremium) * modsMultBp) / 10000);
}

// ===== 特殊员工：排班店长 =====
export function hasSchedulingManager(b: Branch, day: number): Employee | undefined {
  return b.staff.find((e) => e.role === "manager" && e.specialty === "排班" && e.trainingUntilDay <= day);
}

// 店长接管排班：保障各时段厨师/服务员覆盖与产能；疲劳>50 优先休息最高疲劳者（同日限量）；覆盖所有营业时段
export function autoScheduleByManager(s: GameState, b: Branch): string[] {
  const mgr = hasSchedulingManager(b, s.day);
  const msgs: string[] = [];
  if (!mgr) return msgs;
  const slots = b.store.openSlots;
  if (slots.length === 0) return msgs;
  mgr.shifts = [...slots];

  const workers = b.staff.filter((e) => e !== mgr && e.trainingUntilDay <= s.day);
  const cooks = workers.filter((e) => e.role === "cook");
  const servers = workers.filter((e) => e.role === "server");
  const preps = workers.filter((e) => e.role === "prep");
  const cleaners = workers.filter((e) => e.role === "cleaner");

  // 1) 休息规则：疲劳>50 优先休息数值最高者；每日最多休息 40% 的在岗人员；
  //    且必须保证每个营业时段至少 1 名厨师、1 名服务员（人手够才允许休）。
  const restCandidates = workers
    .filter((e) => e.fatigue > 50 && (e.role === "cook" || e.role === "server" || e.role === "prep" || e.role === "cleaner"))
    .sort((a, b2) => b2.fatigue - a.fatigue);
  const maxRest = Math.floor(workers.length * 0.4);
  let rested = 0;
  const resting = new Set<number>();
  const countOn = (list: Employee[], slot: SlotId) => list.filter((e) => !resting.has(e.id) && e.shifts.includes(slot)).length;
  for (const e of restCandidates) {
    if (rested >= maxRest) break;
    const pool = e.role === "cook" ? cooks : e.role === "server" ? servers : [];
    // 假设该员工在所有它当前覆盖的时段都要休息，检查覆盖底线
    const willRestSlots = e.shifts.length > 0 ? e.shifts : slots;
    let ok = true;
    for (const sl of willRestSlots) {
      if (e.role === "cook" && countOn(cooks, sl) <= 1) { ok = false; break; }
      if (e.role === "server" && countOn(servers, sl) <= 1) { ok = false; break; }
      void pool;
    }
    if (ok) { resting.add(e.id); rested++; msgs.push(`${e.name}（疲劳${e.fatigue}）被店长安排休息`); }
  }

  // 2) 重新分配班次：按营业时段与客流权重轮转覆盖，人人有班、时段不断档
  const active = (list: Employee[]) => list.filter((e) => !resting.has(e.id));
  const spread = (list: Employee[], per: number, offset: number) => {
    const act = active(list);
    act.forEach((e, i) => {
      const sh: SlotId[] = [];
      for (let k = 0; k < Math.min(per, slots.length); k++) sh.push(slots[(i + k + offset) % slots.length]);
      e.shifts = [...new Set(sh)];
    });
    // 保底覆盖：某时段无人则把最闲的补上
    for (let si = 0; si < slots.length; si++) {
      if (act.length > 0 && !act.some((e) => e.shifts.includes(slots[si]))) {
        const least = [...act].sort((a, b2) => a.shifts.length - b2.shifts.length)[0];
        least.shifts.push(slots[si]);
      }
    }
  };
  spread(cooks, 2, 0);
  spread(servers, 2, 1);
  spread(preps, slots.length, 0);
  spread(cleaners, Math.min(2, slots.length), 0);
  for (const id of resting) {
    const e = workers.find((x) => x.id === id);
    if (e) e.shifts = [];
  }
  b.planConfirmedDirty = true;
  if (msgs.length) msgs.unshift("排班店长已接管本店今日班次：");
  return msgs;
}
