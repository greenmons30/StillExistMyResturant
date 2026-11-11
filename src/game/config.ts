// ==================================================================
// 全部游戏平衡参数集中于此（需求十六）。UI 组件不得硬编码规则数值。
// 金额=分(int)，比例=基点(bp, 10000=100%)
// ==================================================================

export const SAVE_VERSION = 2;

export const CUISINES = {
  hunan: "湘菜", sichuan: "川菜", cantonese: "粤菜", western: "西餐",
  japanese: "日料", french: "法餐", fastfood: "快餐", dessert: "甜品", drink: "饮品",
} as const;

// ---------------- 日历 ----------------
export const CALENDAR = {
  startYear: 2026, startMonth: 3, startDay: 1, startWeekday: 0, // 2026-03-01 周一
  weekdayNames: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  seasonByMonth: ["", "冬", "冬", "春", "春", "春", "夏", "夏", "夏", "秋", "秋", "秋", "冬"] as const,
};

// ---------------- 天气 ----------------
export const WEATHER = {
  ids: ["sunny", "cloudy", "rain", "storm", "heat", "cold"] as const,
  names: { sunny: "晴", cloudy: "多云", rain: "小雨", storm: "暴雨", heat: "高温", cold: "寒潮" } as Record<string, string>,
  // 季节下的天气权重
  seasonWeights: {
    "春": { sunny: 3800, cloudy: 3200, rain: 2000, storm: 600, heat: 200, cold: 200 },
    "夏": { sunny: 3000, cloudy: 2200, rain: 1800, storm: 1200, heat: 1600, cold: 200 },
    "秋": { sunny: 4000, cloudy: 3000, rain: 1600, storm: 500, heat: 400, cold: 500 },
    "冬": { sunny: 3000, cloudy: 3400, rain: 1800, storm: 300, heat: 100, cold: 1400 },
  } as Record<string, Record<string, number>>,
  trafficBp: { sunny: 10000, cloudy: 9500, rain: 8200, storm: 5200, heat: 7800, cold: 8600 },
  // 天气对市场价格的影响（分类->基点加成，作用于采购单位价）
  priceEffect: {
    storm: { seafood: 800, vegetable: 500 },
    rain: { vegetable: 150 },
    heat: { dairy: 200, fruit: -150 },
    cold: { meat: 250, vegetable: 200 },
    sunny: {}, cloudy: {},
  } as Record<string, Partial<Record<string, number>>>,
};

// ---------------- 市场 ----------------
export const MARKET = {
  // 价格上下限 = 基准价 ±25%/+150%
  floorBp: 7500, ceilBp: 25000,
  trendMaxBp: 60,                // 每日趋势变化上限
  trendMeanRevertBp: 8,          // 趋势向 0 回归
  supplyTightChanceBp: 120,      // 供应紧张概率
  supplyShortChanceBp: 45,       // 缺货概率
  // 批量折扣：达到数量(基础单位比例，相对MOQ倍数) -> 额外折扣
  bulkTiers: [
    { moqMultiples: 10, discountBp: 9700 },
    { moqMultiples: 30, discountBp: 9400 },
  ],
  priceHistoryLen: 30,
};

// ---------------- 供应商（仅两家） ----------------
export const SUPPLIERS = [
  { id: "mawangdui", name: "马王堆批发市场", priceModBp: 9200, deliveryDays: 1, feeCents: 0, minCents: 0, categories: null },
  { id: "frozen_co", name: "冻品供应链公司", priceModBp: 9600, deliveryDays: 0, feeCents: 3000, minCents: 0, categories: null },
] as const;

// ---------------- 客流与需求 ----------------
export const DEMAND = {
  weekdayTrafficBp: [8500, 8500, 9000, 9500, 11000, 12000, 10500], // 周一..周日
  seasonTrafficBp: { "春": 10000, "夏": 10500, "秋": 10000, "冬": 9000 } as Record<string, number>,
  // 进店率 = base * repFactor * holiday/event/boost
  enterRateBp: 6800,
  repFactorBaseBp: 6000,         // 口碑500时 = 6000+500*0.8 => 见函数
  repFactorPerRepBp: 8,          // 每点口碑(0-1000) +8bp
  holidayBp: 13000,              // 节假日客流
  holidays: ["03-08", "05-01", "05-20", "06-01", "10-01", "12-24", "12-25", "01-01"],
  slotShareBp: { breakfast: 1500, lunch: 3400, dinner: 3300, night: 1800 } as Record<string, number>,
  dishSkipBp: 1500,              // 进店后不点单概率基数
  noiseBp: 800,                  // 需求噪声
  // —— 点单深度：一桌 1~10 道菜 ——
  partySize: {                   // 各客群一桌人数
    student: [1, 2], office: [1, 2], family: [2, 4],
    influencer: [1, 3], vip: [2, 4], random: [1, 3],
  } as Record<string, [number, number]>,
  orderMaxDishes: 10,            // 单桌最多菜品数
  marginalDecayBp: 3500,         // 每多点一道，边际效用衰减
  extraDishSkipBp: 2200,         // 放弃继续加点的概率
  avgDishesPerTableBp: 24000,    // 产能折算用：平均每桌约2.4道菜
  portionFit: {
    // 顾客份量偏好 vs 菜品份量：偏离满意度惩罚
    perPctPenalty: 0.06,
  },
  // 效用模型: util = cuisineMatch*1.6 + flavor/22 + quality/30 + portion + pop
  //            - priceSens * (price/ref - 1)
  priceRefMix: 0.75,             // 参考价 = 建议价中值
  walkawayUtil: -0.6,            // 效用低于此值弃单
};

// ---------------- 产能 ----------------
export const CAPACITY = {
  slotMinutes: 240,              // 每时段 4 小时
  dineMinutes: 38,               // 顾客堂食时长
  seatClearMin: 4,               // 翻台间隔
  serverCoverPerSlot: 26,        // 每服务员每时段可服务人数
  prepSupportBp: 3000,           // 切配对产线贡献 0.3 条线
  managerEffBp: 30,              // 店长在班 +3% 产能
  skillSpeedSlopeBpPerPoint: -5, // 每点熟练度 -0.5% 制作时间
  skillSpeedBaseBp: 1250,
  difficultySlowBp: 4,           // 每点难度增加时间(基于厨师技能差)
  fatigueOver: 60,               // 疲劳超此值开始降效
  fatiguePenaltyBpPerPoint: 8,
  errorBaseBp: 30,               // 基础错误率
  errorPerLowSkillBp: 1.2,       // 每点(100-技能)增加
  errorPerFatigueBp: 3,
  rushWaitPerOrder: 0.9,         // 队列等待分钟/订单/产线
  closeBufferMin: 20,            // 打烊缓冲（超出则弃单）
  makeablePrepBp: 4000,          // 适合预制的菜品：出餐时间40%（提前熬制）
  batchParallelBp: 25000,        // 每条产线可同时照看 2.5 道菜（猛火+蒸柜+备台面并行，250%）
};

// ---------------- 满意度/口碑 ----------------
export const SATISFACTION = {
  weightsBp: { quality: 3200, priceValue: 2200, portion: 1400, wait: 1400, env: 1000, hygiene: 800 },
  // 每项映射 0..1 后加权
  repGainPerSatisfiedBp: 2,      // 平均满意度每超 60 一分 → 口碑增量
  repDecayPerDayBp: 600,         // 向 500 回归（基点/日）
  badReviewChanceBp: 3000,       // 不满意(40-)留差评概率
  goodReviewChanceBp: 1500,
  reviewCap: 120,
  regularChanceBpPerSat: 30,     // 满意度>60 后每分转回头客概率基数
  regularMax: 800,
};

// ---------------- 员工 ----------------
export const STAFF = {
  wageByRole: {
    cook: { base: 8000, slope: 220 },     // 分/日 = base + skill*slope/100*...
    prep: { base: 5500, slope: 150 },
    server: { base: 4500, slope: 110 },
    manager: { base: 12000, slope: 240 },
    cleaner: { base: 3500, slope: 70 },
  } as Record<string, { base: number; slope: number }>,
  overtimeBp: 1500,
  slotHoursWageBp: 2500,         // 每班次附加工资 = baseWage*25%?（排班成本）
  xpPerServedDish: 6,
  xpLevelGap: [0, 100, 260, 480, 760, 1100, 1500, 1980, 2540, 3200], // 等级阈值
  skillGainPerXp: 120,           // 每120xp +1熟练度，随技能衰减
  fatiguePerSlot: 9,
  fatigueRestPerDay: 16,
  fatigueRestNoShift: 50,        // 当日完全未排班：疲劳 -50、压力清零（放假待遇）
  stressPerLowStaffBp: 400,      // 人手不足压力
  satDecayLowWageBp: 200,
  leaveChanceBpBase: 10,         // 日离职基础概率
  leaveByBadSatisfactionBp: 600, // 满意度<30 时
  trainingCostCents: 30000,      // 每次培训 300 元
  trainingDays: 2,
  trainingSkillGain: 4,
  hireFeeBp: 5000,               // 招聘费 = 日薪*5
  poolSize: 8,
  poolRefreshDays: 3,
};

// ---------------- 库存 ----------------
export const INVENTORY = {
  storageLossBp: 150,            // 每日正常储存损耗（生鲜）
  freezerLossBp: 20,
  hygieneDecayPerSlot: 3,
  hygienePerCover: 0.02,
  hygieneRestoreCleaner: 10,
  equipmentDecayPerDay: 20,      // bp：每日设备健康度衰减(÷100 → 每天约0.2~1)
};

// ---------------- 门店规模 = 商圈档位（见 data/cities.ts 各城市 districts 阶梯） ----------------

// ---------------- 装修 ----------------
export const DECOR = {
  upgradeOptions: [
    { level: 1, label: "基础翻新", costCents: 300000, decor: 15, hygiene: 10 },
    { level: 2, label: "风格装修", costCents: 1200000, decor: 25, hygiene: 15 },
    { level: 3, label: "精品设计", costCents: 3500000, decor: 20, hygiene: 20 },
    { level: 4, label: "后厨扩建：炉灶+1", costCents: 2500000, decor: 5, hygiene: 5, station: 1,
      effectNote: "产能核心：每口炉灶可同时照看 2.5 道菜（batchParallel），炉灶数决定厨房产线上限" },
  ],
  rentModPerDecorBp: 3,
};

// ---------------- 财务 ----------------
export const FINANCE = {
  // 困难度全局系数
  difficultyBp: {
    easy: { costBp: 8500, demandNoiseBp: 6000, repDecayBp: 300 },
    normal: { costBp: 10000, demandNoiseBp: 8000, repDecayBp: 600 },
    hardcore: { costBp: 11500, demandNoiseBp: 11000, repDecayBp: 900 },
  } as Record<string, { costBp: number; demandNoiseBp: number; repDecayBp: number }>,
  minCashOpsCents: 0,            // 现金<=0 触发危机
  bankruptcyGraceDays: 3,        // 连续现金<0 天数 → 破产
  loanMaxCents: 30000000,
  loanRateBpMonthly: 80,         // 月息 0.8%
};

// ---------------- 老板身世 ----------------
export const BACKGROUNDS = [
  { id: "miserable", name: "凄惨", desc: "父母双亡，爷爷奶奶带大。爷爷离世，奶奶重病。资金紧、负担重，但容易获得同情与帮助。", startCashCents: 3000000, dailyFixedCents: 100000, fixedMemo: "奶奶医疗费" },
  { id: "normal", name: "普通", desc: "普通家庭，普通成长。没有额外负担，也没有外援。", startCashCents: 10000000, dailyFixedCents: 0, fixedMemo: "" },
  { id: "affluent", name: "优渥", desc: "家境较好，起步从容。家人偶尔建议，商业人脉可动用。", startCashCents: 50000000, dailyFixedCents: 0, fixedMemo: "" },
  { id: "tycoon", name: "豪门", desc: "家庭资产A9。资金雄厚，但现金危机时父母会来电（附带家庭要求）。", startCashCents: 1000000000, dailyFixedCents: 0, fixedMemo: "" },
] as const;

export const TYCOON = {
  triggerCashCents: 1000000,     // 可用现金 ≤1 万触发父母来电
  transferMinCents: 5000000,     // 5万
  transferMaxCents: 50000000,    // 50万
  cooldownDays: 14,
  acceptConditionChanceBp: 5500, // 附带家庭要求概率（如放弃扩张/回家相亲）
};

// ---------------- 性格（效果+代价均可计算） ----------------
export const PERSONALITIES = [
  { id: "frugal", name: "精打细算", desc: "采购价-2%，损耗-25%；代价：营销效果-15%，顾客小气感知(满意度-2)。", mods: { purchasePriceBp: 9800, spoilBp: 7500, marketingBp: 8500, satisfactionAdd: -2 } },
  { id: "hospitable", name: "热情好客", desc: "满意度+4，口碑增益+25%；代价：食材消耗+5%。", mods: { satisfactionAdd: 4, repGainBp: 12500, utilityBp: 10500 } },
  { id: "strict", name: "严格苛刻", desc: "出品品质+5，错误率-40%；代价：员工满意度-0.6/日，离职风险+30%。", mods: { qualityAdd: 5, errorRateAddBp: -200, staffSatAdd: -60, leaveRiskBp: 13000 } },
  { id: "easygoing", name: "随性佛系", desc: "员工满意度+0.4/日，疲劳-20%；代价：产能-5%，错误率+10%。", mods: { staffSatAdd: 40, fatigueBp: 8000, capacityBp: 9500, errorRateAddBp: 100 } },
  { id: "ambitious", name: "野心勃勃", desc: "成长速度+30%，营销/传播效果+15%；代价：工资要求+8%。", mods: { xpGainBp: 13000, marketingBp: 11500, wageBp: 10800 } },
  { id: "social", name: "社交达人", desc: "回头客概率+35%，口碑衰减-30%；代价：产能-3%（聊天摸鱼）。", mods: { repGainBp: 11000, repDecayBp: 7000, capacityBp: 9700, marketingBp: 11000 } },
  { id: "perfectionist", name: "完美主义", desc: "品质+7，损耗-30%；代价：制作时间+12%，水电+15%。", mods: { qualityAdd: 7, spoilBp: 7000, prepTimeBp: 11200, utilityBp: 11500 } },
  { id: "adventurer", name: "冒险主义", desc: "顾客对高价容忍+25%，事件机遇/风险+30%；代价：需求波动+50%。", mods: { priceElasticityBp: 7500, eventRiskBp: 13000, demandNoiseBp: 15000 } },
] as const;

export const PHILOSOPHIES = ["薄利多销", "品质至上", "烟火气", "网红流量", "稳扎稳打", "顾客就是上帝"];

import type { DifficultyId, PersonalityId, PersonalityMods } from "./types";

export function getMods(p: PersonalityId): PersonalityMods {
  const def = PERSONALITIES.find((x) => x.id === p)!;
  return { ...DEFAULT_MODS, ...def.mods } as PersonalityMods;
}

export function getDiff(d: DifficultyId) {
  return FINANCE.difficultyBp[d];
}

export const DEFAULT_MODS: import("./types").PersonalityMods = {
  purchasePriceBp: 10000, qualityAdd: 0, satisfactionAdd: 0, prepTimeBp: 10000,
  capacityBp: 10000, errorRateAddBp: 0, spoilBp: 10000, repGainBp: 10000,
  repDecayBp: 10000, marketingBp: 10000, wageBp: 10000, utilityBp: 10000,
  staffSatAdd: 0, fatigueBp: 10000, leaveRiskBp: 10000, eventRiskBp: 10000,
  demandNoiseBp: 10000, priceElasticityBp: 10000, xpGainBp: 10000,
};

// ---------------- 营销系统（需求九） ----------------
export const STORY_EVENTS = {
  // 凄惨：中国大孝子·记者采访
  pious: {
    honestRepCents: 50, honestBoostBp: 11200, honestDays: 5,
    playPiousBp: 5000, playPiousRep: 30, playPiousBoostBp: 10500, playPiousDays: 3,
    hideSuccessBp: 5500, hideGoodRep: 200, hideGoodBoostBp: 11500, hideGoodDays: 7,
    hideBadRep: -20, hideBadDays: 7,
  },
  // 普通：原来你也玩原神
  genshin: { playRep: -50, playCashCents: 500000, nopeRep: 50 },
  // 优渥：催婚/结婚/离婚
  marriage: { arrangeFeeCents: 50000, arrangeRepPerDay: 1, gayRep: -10, gayReviewDays: 60 },
  divorce: { repairRep: 5, splitBp: 5000 },
  // 豪门：抱错假父母
  fakeParents: {
    demandMinCents: 300000, demandMaxCents: 5000000, denyRep: -20, testRep: 50,
    rejectRep: -30, acceptCapBp: 8000,
  },
  // 过期食材折价卖给大学生（每天都可能触发提醒事件，不处理会累积）
  spoilSale: { priceBp: 4000, repCost: -50 },
};

export const MARKETING = {
  maxActive: 3,                  // 同时在执行的营销上限
  tiers: [
    { id: "low", name: "试水", costMultBp: 6000, effectBp: 6000, quality: 40 },
    { id: "mid", name: "常规", costMultBp: 10000, effectBp: 10000, quality: 60 },
    { id: "high", name: "豪推", costMultBp: 22000, effectBp: 15000, quality: 80 },
  ] as readonly { id: string; name: string; costMultBp: number; effectBp: number; quality: number }[],
  campaigns: [
    { id: "short_video", name: "发布短视频", desc: "拍后厨烟火气与招牌菜发同城号，赌一次内容质量。", costCents: 10000, days: 3, boostAddBp: 900, baseSuccessBp: 5200, flopBp: 800, segTargetable: true },
    { id: "flyer", name: "发放传单", desc: "门口与周边小区发传单，便宜但效果有限。", costCents: 3000, days: 2, boostAddBp: 450, baseSuccessBp: 6000, flopBp: 200, segTargetable: false },
    { id: "invite_blogger", name: "邀请博主探店", desc: "付费请探店博主到店拍摄传播，波动大。", costCents: 200000, days: 7, boostAddBp: 2600, baseSuccessBp: 4800, flopBp: 1800, segTargetable: true },
    { id: "time_discount", name: "限时折扣", desc: "全场 85 折（按折扣后真实收入记账，不重复计原价）。", costCents: 20000, days: 3, boostAddBp: 300, baseSuccessBp: 8200, flopBp: 0, segTargetable: false, discountBp: 8500 },
    { id: "combo", name: "套餐促销", desc: "主推菜+饮品套餐，约 9 折让利，拉高客单转化。", costCents: 30000, days: 5, boostAddBp: 700, baseSuccessBp: 6500, flopBp: 400, segTargetable: false, discountBp: 9000 },
    { id: "member", name: "会员优惠", desc: "会员折扣权益：主要提升回头客转化，客流小幅提升。", costCents: 50000, days: 10, boostAddBp: 350, baseSuccessBp: 9000, flopBp: 100, segTargetable: false, memberMultBp: 14000 },
    { id: "festival", name: "节日营销", desc: "临近节假日投放氛围与海报，客流脉冲最强（需节日前后3天内）。", costCents: 120000, days: 2, boostAddBp: 3000, baseSuccessBp: 7000, flopBp: 600, segTargetable: true, requireHoliday: true },
  ] as readonly {
    id: string; name: string; desc: string; costCents: number; days: number;
    boostAddBp: number; baseSuccessBp: number; flopBp: number; segTargetable: boolean;
    discountBp?: number; memberMultBp?: number; requireHoliday?: boolean;
  }[],
  // 归因模型：结案时按各活动预估增量订单的份额，拆分「超出基准需求的实际增量」
};

// ---------------- 配料用量自定义（偷工减料/加料） ----------------
export const RECIPE_TUNING = {
  minBp: 0, maxBp: 20000,
  fillComfortBp: 9000,           // ≥90% 视为标准，不扣不骂
  qualityCutBp: 2500,            // 份量每缩100%扣25品质（线性）：fill 40% → −12.5
  qualityMoreBonusBp: 800,       // 加料每+100% → +4 品质（封顶）
  qualityMoreCap: 5,
  coreLowBp: 6000,               // 主料（配方第一项）低于60%：额外惩罚
  coreLowQuality: 6,
  critBaseBp: 8000,              // 差评概率 = gap × 0.8 × (区域份量偏好系数+0.5)
  critMaxBp: 6500,
};

// ---------------- 菜品研究（学菜系 + 试做） ----------------
export const RESEARCH = {
  // 菜系学费（分）；开局湘菜免费全解锁，其余须先学菜系再逐道研究
  cuisineCostCents: {
    sichuan: 500000, cantonese: 700000, dessert: 500000, drink: 200000,
    western: 1000000, fastfood: 500000, japanese: 2000000, french: 5000000,
  } as Record<string, number>,
  perTryCents: 20000,            // 每次研究 200 元
  fallbackIngredientG: 200,      // 失败实验：每种选中的配料消耗 200g（不足则全扣）
  expGoodBp: 5000,               // 送顾客吃：50% 好评 / 50% 差评
  expRepDelta: 5,                // 显示口径 ±0.5 口碑（内部 0-1000 计 5）
};

// ---------------- 事件全局 ----------------
export const EVENTS = {
  dailyRollBp: 4200,             // 每天最多尝试触发事件的概率(基础类别)
  pendingExpireDays: 3,
  complaintPayChanceBp: 3500,    // 十倍索赔的特殊分支概率
};

// ---------------- 博主 ----------------
export const BLOGGER = {
  visitChanceBp: 800,
  followerMin: 300, followerMax: 200000,
  persistentFollowerMin: 1000,   // 低于此粉丝不产生持续客流增益
  boostTrafficBp: 12000,         // 基础探店增益 +20%
  boostDays: 5,
  extraPortionBp: 1400,          // 加量：额外消耗
  signatureFreeChance: "赠送招牌菜",
};

// ---------------- 采访 ----------------
export const INTERVIEW = {
  goodThreshold: 10,             // ≥10 短期客流增益
  badThreshold: 0,               // <0 客流下降
  goodBoostBp: 12500, goodDays: 7,
  badPenaltyBp: 8500, badDays: 4,
  lieYearsCredibilityRisk: 50,
};

// ---------------- 初始菜单（长沙首发） ----------------
export const CHANGSHA_STARTER_MENU = [
  "la_jiao_chao_rou", "duo_jiao_yu_tou", "hong_shao_rou", "yi_wan_xiang",
  "changsha_mi_fen", "gan_bian_si_ji_dou", "tang_cu_pai_gu", "kou_wei_xia", "xiao_chao_huang_niu",
];
