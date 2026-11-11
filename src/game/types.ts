// ============ 核心数据类型：所有金额=当地货币“分”(整数)，数量=基础单位整数 ============
// 多城模型：每个城市一家分店(Branch)，各自持有现金/库存/市场/菜单价格/员工/账目；
// 研究解锁、老板剧情、日期为全局共享。海外城市以当地货币记账，跨城周转按汇率换算。

export type IngredientCategory =
  | "meat" | "poultry" | "seafood" | "vegetable" | "seasoning"
  | "grain" | "dairy" | "fruit" | "bakery" | "beverage";

export type StorageKind = "dry" | "fridge" | "freezer";

export interface IngredientDef {
  id: string;
  name: string;
  category: IngredientCategory;
  unit: "g" | "piece";
  purchaseName: string;
  perPurchase: number;
  basePriceCents: number;        // 基准价（人民币分/采购单位，各城按市场系数折算当地价）
  shelfDays: number;
  storage: StorageKind;
  moq: number;
  capacityBase: number;
  randAmpBp: number;
  seasonAmpBp: number;
  trendBp: number;
}

export interface SupplierDef {
  id: string;
  name: string;                  // 默认名；各城市显示名见 cities.ts supplierNames
  priceModBp: number;
  deliveryDays: number;
  feeCents: number;
  minCents: number;
  categories: IngredientCategory[] | null;
}

export interface Lot {
  id: number;
  ingId: string;
  qty: number;
  unitPriceCents: number;
  perPurchase: number;
  expiresDay: number;
  storage: StorageKind;
  purchasedDay?: number;
}

export interface MarketEntry {
  priceCents: number;
  trendBp: number;
  history: number[];
  supply: 0 | 1 | 2;
  eventTag: string | null;
  eventUntilDay: number;
}

// ---------------- 菜品 ----------------
export type CuisineId =
  | "hunan" | "sichuan" | "cantonese" | "western"
  | "japanese" | "french" | "fastfood" | "dessert" | "drink";

export type DishCategory = "main" | "staple" | "snack" | "soup" | "dessert" | "drink";

export interface RecipeItem { ingId: string; qty: number; }

export interface DishDef {
  id: string;
  name: string;
  cuisine: CuisineId;
  category: DishCategory;
  desc: string;
  recipe: RecipeItem[];
  portionG: number;
  prepMin: number;
  difficulty: number;
  baseFlavor: number;
  baseQuality: number;
  heat: number;
  makeable: boolean;
  keepMin: number;
  suggestLowCents: number;       // 建议售价区间（人民币分）
  suggestHighCents: number;
}

export interface MenuItemState {
  dishId: string;
  priceCents: number;            // 当地货币分（各分店独立定价）
  active: boolean;
  recipeBp?: Record<string, number>;
}

// ---------------- 城市与客群 ----------------
export type SlotId = "breakfast" | "lunch" | "dinner" | "night";
export const ALL_SLOTS: SlotId[] = ["breakfast", "lunch", "dinner", "night"];

export interface DistrictDef {
  id: string;
  name: string;
  trafficModBp: number;
  rentModBp: number;
  segmentWeights: Record<string, number>;
  seats: number;                 // 商圈对应的门店规模
  stations: number;
  rentCents: number;             // 日租（人民币分，按城市租金系数折算后为当地价）
  utilityCents: number;
  maintainCents: number;
  capacityMultBp: number;
  decorStart: number;
  setupCostCents: number;        // 迁入该商圈的盘店/装修启动费（人民币分）
}

export interface CityDef {
  id: string;
  name: string;
  currency: string;              // CNY/JPY/USD/EUR
  fxPerCnyBp: number;            // 换算：当地分 = 人民币分 × fx / 1000（CNY=1000）
  baseDailyTraffic: number;
  cuisineAffinityBp: Record<CuisineId, number>;
  priceSensBp: number;
  portionPrefBp: number;
  qualityExpect: number;
  envExpect: number;
  rentFactorBp: number;
  wageFactorBp: number;
  marketFactorBp: number;
  transportFactorBp: number;
  competitionBp: number;
  unlockNetWorthCents: number;   // 解锁所需净资产（人民币分）
  openCostCents: number;         // 开分店加盟费/押金（人民币分）
  districts: DistrictDef[];
  positioning: string;
  supplierNames: Record<string, string>; // 供应商 id → 本地化店名
  namePool: { first: string[]; last: string[] }; // 本地化员工姓名池
}

export interface SegmentDef {
  id: string;
  name: string;
  budgetCents: number;
  budgetSpreadBp: number;
  cuisineWeightsBp: Record<CuisineId, number>;
  priceSensBp: number;
  portionPrefBp: number;
  envRequire: number;
  waitTolMin: number;
  qualityRequire: number;
  repurchaseBp: number;
}

// ---------------- 老板 ----------------
export type BackgroundId = "miserable" | "normal" | "affluent" | "tycoon";
export type PersonalityId =
  | "frugal" | "hospitable" | "strict" | "easygoing"
  | "ambitious" | "social" | "perfectionist" | "adventurer";
export type DifficultyId = "easy" | "normal" | "hardcore";

export interface PersonalityMods {
  purchasePriceBp: number;
  qualityAdd: number;
  satisfactionAdd: number;
  prepTimeBp: number;
  capacityBp: number;
  errorRateAddBp: number;
  spoilBp: number;
  repGainBp: number;
  repDecayBp: number;
  marketingBp: number;
  wageBp: number;
  utilityBp: number;
  staffSatAdd: number;
  fatigueBp: number;
  leaveRiskBp: number;
  eventRiskBp: number;
  demandNoiseBp: number;
  priceElasticityBp: number;
  xpGainBp: number;
}

export interface BackgroundDef {
  id: BackgroundId;
  name: string;
  desc: string;
  startCashCents: number;
  dailyFixedCents: number;
  fixedMemo: string;
}

export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  desc: string;
  mods: Partial<PersonalityMods>;
}

export interface BossState {
  name: string;
  age: number;
  restaurantName: string;
  background: BackgroundId;
  personality: PersonalityId;
  philosophy: string;
  difficulty: DifficultyId;
  credibilityRisk: number;
}

// ---------------- 员工 ----------------
export type RoleId = "cook" | "prep" | "server" | "manager" | "cleaner";

export interface Employee {
  id: number;
  name: string;
  role: RoleId;
  skill: number;
  xp: number;
  level: number;
  baseWageCents: number;         // 当地货币分/日
  overtimeRateBp: number;
  shifts: SlotId[];
  fatigue: number;
  stress: number;
  satisfaction: number;
  loyalty: number;
  trait: string;
  specialty: string;
  trainingUntilDay: number;
  pendingLeaveDay?: number;
}

export interface CandidateDef {
  poolId: number;
  name: string;
  role: RoleId;
  skill: number;
  wageCents: number;             // 期望日薪（当地货币分）
  hireFeeCents: number;
  trait: string;
  specialty: string;
}

// ---------------- 门店（分店物理属性） ----------------
export interface StoreState {
  seats: number;
  stations: number;
  hygiene: number;
  decor: number;
  equipmentHealth: number;
  kitchenFlow: number;
  fridgeCapacityBp: number;
  openSlots: SlotId[];
  orderLimitCovers: number;
  capacityMultBp: number;
  rentCents: number;             // 当地分/日（含城市系数）
  utilityCents: number;
  maintainCents: number;
}

// ---------------- 财务 ----------------
export type AccountId =
  | "revenue" | "refund" | "cogs" | "wage" | "rent" | "utility" | "marketing"
  | "repair" | "family" | "event" | "spoil" | "purchase" | "transferIn" | "transferOut"
  | "training" | "research" | "other";

export interface LedgerEntry {
  day: number;
  account: AccountId;
  amountCents: number;
  cash: boolean;
  memo: string;
}

export interface DishDayStat {
  dishId: string;
  name: string;
  sold: number;
  revenueCents: number;
  cogsCents: number;
  contributionCents: number;
  spoilCents: number;
  ratingSum: number;
  ratingCount: number;
}

export interface ReviewItem {
  day: number;
  segName: string;
  dishName: string;
  score: number;
  text: string;
}

export interface DayReport {
  day: number;
  cityId: string;
  dateLabel: string;
  weather: WeatherId;
  potential: number;
  entered: number;
  served: number;
  lostToWait: number;
  lostNoStock: number;
  revenueCents: number;
  cogsCents: number;
  wageCents: number;
  rentCents: number;
  utilityCents: number;
  spoilCents: number;
  compCents: number;
  eventCents: number;
  familyCents: number;
  otherCostCents: number;
  netProfitCents: number;
  cashEndCents: number;
  rep: number;
  repDelta: number;
  avgSatisfaction: number;
  dishStats: DishDayStat[];
  topDish: string | null;
  reviews: ReviewItem[];
  staffGrowth: { name: string; skill: number; xpGain: number }[];
  forecast: { label: string; est: number };
}

export type WeatherId = "sunny" | "cloudy" | "rain" | "storm" | "heat" | "cold";

export interface EventOption {
  id: string;
  label: string;
  payloadKey?: string;
}

export interface PendingEvent {
  eventUid: number;
  defId: string;
  cityId: string;                // 事件发生的城市
  title: string;
  desc: string;
  blocking: boolean;
  createdAtDay: number;
  data: Record<string, number | string>;
  options: EventOption[];
}

export interface Boost {
  id: string;
  label: string;
  trafficBp: number;
  untilDay: number;
  persistent: boolean;
}

export interface BloggerVisitRecord {
  day: number;
  cityId: string;
  kind: "探店" | "采访";
  name: string;
  followers: number;
  audienceMatchBp: number;
  contentQuality: number;
  response: string;
  outcome: string;
}

// ---------------- 营销 ----------------
export interface MarketingCampaign {
  id: number;
  defId: string;
  name: string;
  tier: string;
  targetSeg: string;
  startDay: number;
  endDay: number;
  costCents: number;
  appliedBoostBp: number;
  discountBp: number;
  memberMultBp: number;
  upliftExpected: number;
  baselineRegulars: number;
  outcome: "success" | "flop" | "noeffect";
  servedExtra: number;
  revenueExtraCents: number;
  grossExtraCents: number;
  newRegulars: number;
  settledDays: number;
}

export interface MarketingState {
  nextId: number;
  active: MarketingCampaign[];
  history: MarketingCampaign[];
}

// ---------------- 购物车 / 自动购入 / 剧情 / 研究 ----------------
export interface CartItem {
  ingId: string;
  qty: number;
  supplierId: string;
}

export interface AutoRestockItem { ingId: string; targetQty: number; }
export interface AutoRestockConfig {
  enabled: boolean;
  untilDay: number;
  items: AutoRestockItem[];
  supplierId: string;
}

export type MarriageStatus = "single" | "married" | "divorced";

export interface StoryState {
  marriageStatus: MarriageStatus;
  piousGoodUntilDay: number;
  piousFakeUntilDay: number;
  gayUntilDay: number;
}

export interface SpoiledLot {
  ingId: string;
  qty: number;
  unitPriceCents: number;
  perPurchase: number;
  purchasedDay: number;
  expiredDay: number;
}

export interface StudyState {
  learned: CuisineId[];
  unlockedDishes: string[];
  activeResearch: string | null;
}

export interface ScheduledEvent {
  triggerDay: number;
  cityId: string;
  defId: string;
  data: Record<string, number | string>;
}

// 当日建议购入（分店）
export interface PurchaseSuggestion {
  ingId: string;
  name: string;
  demand: number;
  stock: number;
  shortage: number;
  estCostCents: number;
}

export interface Loan {
  id: number;
  principalCents: number;
  owedCents: number;
  rateBp: number;
  monthlyDueDay: number;
}

// ---------------- 分店 ----------------
export type BranchPhase = "planning" | "confirmed" | "report";

export interface Branch {
  cityId: string;
  districtId: string;
  day: number;                   // 与全局日期同步（库存到期判断用）
  phase: BranchPhase;
  closedToday: boolean;
  planConfirmedDirty: boolean;

  store: StoreState;
  cashCents: number;             // 当地货币分
  loans: Loan[];
  negCashStreak: number;

  inventory: Record<string, Lot[]>;
  nextLotId: number;
  market: Record<string, MarketEntry>;
  purchasesToday: { ingId: string; qty: number; supplierId: string; costCents: number; arriveDay: number }[];
  cart: CartItem[];
  autoRestock: AutoRestockConfig;
  pendingDeliveries: { ingId: string; qty: number; unitPriceCents: number; perPurchase: number; arriveDay: number; expiresDay: number; storage: StorageKind }[];
  pendingSpoilage: SpoiledLot[];

  menu: Record<string, MenuItemState>;
  staff: Employee[];
  nextEmpId: number;
  candidatePool: CandidateDef[];
  poolGenerationDay: number;

  reputation: number;
  regulars: number;
  reviews: ReviewItem[];
  boosts: Boost[];
  marketing: MarketingState;

  ledger: LedgerEntry[];
  reports: DayReport[];
  settledDay: number;
  lastReportDay: number;
}

// ---------------- 游戏状态 ----------------
export interface GameDate {
  year: number;
  month: number;
  dayOfMonth: number;
  weekday: number;
  season: "春" | "夏" | "秋" | "冬";
  weather: WeatherId;
}

export interface GameState {
  saveVersion: number;
  rng: number;
  seed: number;
  createdAt: number;
  day: number;                   // 全局日期（所有分店同一天推进）
  date: GameDate;
  over: boolean;                 // 破产结局
  negCashStreak: number;         // 全局资金（折合人民币）连续为负天数

  boss: BossState;
  story: StoryState;
  study: StudyState;

  activeCityId: string;          // 当前查看/操作的城市
  unlockedCities: string[];      // 已开分店的城市
  branches: Record<string, Branch>;

  events: {
    nextUid: number;
    pending: PendingEvent[];
    cooldowns: Record<string, number>;
    history: { defId: string; cityId: string; day: number; optionId: string }[];
    parentCallCooldownUntil: number;
    familyHelpUsed: boolean;
    transferredTotalCents: number;
    transferCount: number;
  };
  scheduled: ScheduledEvent[];
  bloggerLog: BloggerVisitRecord[];
  achievements: string[];
  notes: string;
}
