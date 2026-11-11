import type { CityDef, DistrictDef } from "../types";

// 商圈档位基型（idx 越大店越大、租金越高；按城市租金/客流系数缩放）
const PROFILES: Omit<DistrictDef, "id" | "name" | "trafficModBp" | "rentModBp" | "segmentWeights">[] = [
  { seats: 22, stations: 2, rentCents: 20000, utilityCents: 8000, maintainCents: 3000, capacityMultBp: 10000, decorStart: 30, setupCostCents: 0 },
  { seats: 45, stations: 3, rentCents: 26000, utilityCents: 16000, maintainCents: 6000, capacityMultBp: 18000, decorStart: 35, setupCostCents: 1200000 },
  { seats: 80, stations: 4, rentCents: 45000, utilityCents: 32000, maintainCents: 13000, capacityMultBp: 32000, decorStart: 45, setupCostCents: 3600000 },
  { seats: 70, stations: 4, rentCents: 50000, utilityCents: 36000, maintainCents: 16000, capacityMultBp: 30000, decorStart: 55, setupCostCents: 4800000 },
];

const SEG_SETS = {
  community: { family: 320, office: 240, student: 140, influencer: 60, vip: 40, random: 200 },
  university: { student: 420, office: 160, family: 100, influencer: 140, vip: 20, random: 160 },
  cbd: { office: 340, influencer: 180, family: 160, student: 120, vip: 120, random: 80 },
  tourist: { influencer: 280, random: 300, office: 120, family: 140, student: 100, vip: 60 },
};

function mkDistricts(specs: [string, string, number, keyof typeof SEG_SETS][]): DistrictDef[] {
  return specs.map(([id, name, trafficBp, seg], idx) => {
    const p = PROFILES[idx];
    return {
      id, name, trafficModBp: trafficBp, segmentWeights: SEG_SETS[seg],
      rentModBp: Math.round((p.rentCents / PROFILES[0].rentCents) * 10000),
      seats: p.seats, stations: p.stations, rentCents: p.rentCents, utilityCents: p.utilityCents,
      maintainCents: p.maintainCents, capacityMultBp: p.capacityMultBp, decorStart: p.decorStart, setupCostCents: p.setupCostCents,
    };
  });
}

const CN = { first: ["张", "李", "王", "刘", "陈", "杨", "黄", "赵", "周", "吴", "徐", "孙"], last: ["伟", "芳", "磊", "敏", "静", "强", "军", "杰", "涛", "明", "雨欣", "志强"] };

export const CITIES: CityDef[] = [
  {
    id: "changsha", name: "长沙", currency: "CNY", fxPerCnyBp: 1000,
    baseDailyTraffic: 290,
    cuisineAffinityBp: { hunan: 3400, sichuan: 1400, cantonese: 700, western: 900, japanese: 800, french: 400, fastfood: 1200, dessert: 800, drink: 900 },
    priceSensBp: 1100, portionPrefBp: 1200, qualityExpect: 55, envExpect: 45,
    rentFactorBp: 9000, wageFactorBp: 8500, marketFactorBp: 8800, transportFactorBp: 9000,
    competitionBp: 12000, unlockNetWorthCents: 0, openCostCents: 0,
    positioning: "湘菜、辣味、夜宵、亲民价格、大份量、网红风",
    districts: mkDistricts([["community", "社区街铺", 6200, "community"], ["university", "大学城", 9000, "university"], ["cbd", "商业中心", 11500, "cbd"], ["tourist", "旅游区(五一商圈)", 11000, "tourist"]]),
    supplierNames: { mawangdui: "马王堆批发市场", frozen_co: "冻品供应链公司" },
    namePool: CN,
  },
  {
    id: "chengdu", name: "成都", currency: "CNY", fxPerCnyBp: 1000,
    baseDailyTraffic: 275,
    cuisineAffinityBp: { hunan: 1300, sichuan: 3500, cantonese: 700, western: 900, japanese: 800, french: 500, fastfood: 1000, dessert: 900, drink: 800 },
    priceSensBp: 1000, portionPrefBp: 1100, qualityExpect: 58, envExpect: 50,
    rentFactorBp: 9500, wageFactorBp: 8500, marketFactorBp: 9000, transportFactorBp: 9500,
    competitionBp: 13500, unlockNetWorthCents: 30000000, openCostCents: 3000000,
    positioning: "川菜、火锅、串串、麻辣、社交餐饮",
    districts: mkDistricts([["community", "老社区街铺", 6200, "community"], ["university", "大学城", 8800, "university"], ["cbd", "春熙路商圈", 12000, "cbd"], ["tourist", "宽窄巷子", 10800, "tourist"]]),
    supplierNames: { mawangdui: "蒙阳农产品批发市场", frozen_co: "蜀锦冻品供应链" },
    namePool: { first: ["李", "张", "王", "刘", "杨", "陈", "赵", "何"], last: ["磊", "霞", "强", "艳", "军", "花", "幺妹", "建刚"] },
  },
  {
    id: "foshan", name: "佛山", currency: "CNY", fxPerCnyBp: 1000,
    baseDailyTraffic: 235,
    cuisineAffinityBp: { hunan: 800, sichuan: 900, cantonese: 3600, western: 800, japanese: 700, french: 400, fastfood: 1000, dessert: 1000, drink: 800 },
    priceSensBp: 950, portionPrefBp: 900, qualityExpect: 62, envExpect: 55,
    rentFactorBp: 8800, wageFactorBp: 9000, marketFactorBp: 9500, transportFactorBp: 9000,
    competitionBp: 11000, unlockNetWorthCents: 50000000, openCostCents: 4000000,
    positioning: "粤菜、烧腊、煲仔饭、早茶、家庭用餐",
    districts: mkDistricts([["community", "老城区社区", 7000, "community"], ["university", "佛山大学带", 8200, "university"], ["cbd", "岭南天地商圈", 10500, "cbd"], ["tourist", "祖庙景区", 9800, "tourist"]]),
    supplierNames: { mawangdui: "中南农产品交易中心", frozen_co: "粤海冻品联供" },
    namePool: { first: ["梁", "陈", "黄", "李", "何", "罗", "吴", "赵"], last: ["志强", "淑芬", "俊杰", "阿娇", "国栋", "晓婷", "国华", "艳红"] },
  },
  {
    id: "shanghai", name: "上海", currency: "CNY", fxPerCnyBp: 1000,
    baseDailyTraffic: 310,
    cuisineAffinityBp: { hunan: 900, sichuan: 1000, cantonese: 1400, western: 2200, japanese: 1800, french: 1600, fastfood: 700, dessert: 1300, drink: 1100 },
    priceSensBp: 800, portionPrefBp: 850, qualityExpect: 72, envExpect: 75,
    rentFactorBp: 18000, wageFactorBp: 13000, marketFactorBp: 11000, transportFactorBp: 11500,
    competitionBp: 16000, unlockNetWorthCents: 150000000, openCostCents: 12000000,
    positioning: "精品中餐、创意料理、日料、法餐、高品质和品牌体验",
    districts: mkDistricts([["community", "徐汇社区", 6000, "community"], ["university", "复旦同济带", 7800, "university"], ["cbd", "静安南京西路", 12500, "cbd"], ["tourist", "外滩豫园", 11800, "tourist"]]),
    supplierNames: { mawangdui: "江桥批发市场", frozen_co: "沪臻冻品供应链" },
    namePool: { first: ["王", "张", "李", "陈", "周", "沈", "徐", "顾"], last: ["岚", "萍", "军", "洁", "超", "丽娜", "国平", "思怡"] },
  },
  {
    id: "tokyo", name: "东京", currency: "JPY", fxPerCnyBp: 20500, // 1元人民币=20.5日元（1人民币分=20.5日元“分”）
    baseDailyTraffic: 300,
    cuisineAffinityBp: { japanese: 3200, hunan: 500, sichuan: 700, cantonese: 800, western: 1600, french: 1000, fastfood: 1200, dessert: 1000, drink: 1000 },
    priceSensBp: 850, portionPrefBp: 750, qualityExpect: 75, envExpect: 70,
    rentFactorBp: 17000, wageFactorBp: 15000, marketFactorBp: 14000, transportFactorBp: 15000,
    competitionBp: 15000, unlockNetWorthCents: 250000000, openCostCents: 20000000,
    positioning: "拉面、寿司、咖喱饭、定食、出餐效率",
    districts: mkDistricts([["community", "下北泽住宅区", 6200, "community"], ["university", "早稻田学区", 8000, "university"], ["cbd", "丸之内", 12200, "cbd"], ["tourist", "浅草寺前", 11500, "tourist"]]),
    supplierNames: { mawangdui: "大田中央卸売市場", frozen_co: "東京コールドチェーン" },
    namePool: { first: ["佐藤", "铃木", "高桥", "田中", "渡边", "伊藤", "山本", "中村"], last: ["一郎", "良子", "翔太", "美咲", "健一", "直树", "葵", "大辅"] },
  },
  {
    id: "sf", name: "旧金山", currency: "USD", fxPerCnyBp: 140,
    baseDailyTraffic: 245,
    cuisineAffinityBp: { western: 2800, fastfood: 2000, hunan: 700, sichuan: 900, cantonese: 1300, japanese: 1300, french: 900, dessert: 1100, drink: 1200 },
    priceSensBp: 750, portionPrefBp: 900, qualityExpect: 68, envExpect: 65,
    rentFactorBp: 21000, wageFactorBp: 20000, marketFactorBp: 15000, transportFactorBp: 16000,
    competitionBp: 12500, unlockNetWorthCents: 400000000, openCostCents: 30000000,
    positioning: "汉堡、炸鸡、酸面包、加州融合料理、健康餐",
    districts: mkDistricts([["community", "日落区", 5800, "community"], ["university", "Berkeley带", 7600, "university"], ["cbd", "Financial District", 11000, "cbd"], ["tourist", "渔人码头", 10500, "tourist"]]),
    supplierNames: { mawangdui: "渔人码头食材市场", frozen_co: "湾区金冻品公司" },
    namePool: { first: ["詹姆斯", "迈克", "罗伯特", "大卫", "玛丽", "詹妮", "苏茜", "卡萝"], last: ["史密斯", "约翰逊", "威廉斯", "布朗", "琼斯", "加西亚", "米勒", "戴维"] },
  },
  {
    id: "ny", name: "纽约", currency: "USD", fxPerCnyBp: 140,
    baseDailyTraffic: 320,
    cuisineAffinityBp: { western: 2600, fastfood: 2200, french: 1200, japanese: 1200, cantonese: 1400, sichuan: 800, hunan: 500, dessert: 1100, drink: 1000 },
    priceSensBp: 800, portionPrefBp: 1300, qualityExpect: 70, envExpect: 68,
    rentFactorBp: 24000, wageFactorBp: 21000, marketFactorBp: 15500, transportFactorBp: 16500,
    competitionBp: 15500, unlockNetWorthCents: 500000000, openCostCents: 35000000,
    positioning: "牛排、披萨、汉堡、美式餐厅、西式大份量",
    districts: mkDistricts([["community", "皇后区住宅", 6400, "community"], ["university", "哥大带", 7800, "university"], ["cbd", "Midtown", 13000, "cbd"], ["tourist", "时代广场", 12500, "tourist"]]),
    supplierNames: { mawangdui: "Hunts Point 食材市场", frozen_co: "大苹果冻品供应链" },
    namePool: { first: ["安东尼", "迈克尔", "列奥", "弗兰克", "娜塔", "索菲", "莉娜", "文斯"], last: ["科莱奥", "德尼罗", "帕西诺", "亚当斯", "贝克尔", "弗里德", "约翰逊", "哥梅兹"] },
  },
  {
    id: "paris", name: "巴黎", currency: "EUR", fxPerCnyBp: 130,
    baseDailyTraffic: 265,
    cuisineAffinityBp: { french: 3300, western: 1500, japanese: 1100, cantonese: 800, sichuan: 600, hunan: 400, fastfood: 900, dessert: 1400, drink: 1300 },
    priceSensBp: 820, portionPrefBp: 800, qualityExpect: 78, envExpect: 80,
    rentFactorBp: 22000, wageFactorBp: 19000, marketFactorBp: 17000, transportFactorBp: 16000,
    competitionBp: 14000, unlockNetWorthCents: 600000000, openCostCents: 30000000,
    positioning: "法餐、咖啡、烘焙、甜点、精品餐饮",
    districts: mkDistricts([["community", "十一区生活街", 6000, "community"], ["university", "索邦学区", 7800, "university"], ["cbd", "香榭丽舍", 12000, "cbd"], ["tourist", "埃菲尔铁塔", 11800, "tourist"]]),
    supplierNames: { mawangdui: "兰吉斯批发市场", frozen_co: "巴黎冷鲜供应链" },
    namePool: { first: ["皮埃尔", "让", "路易", "马克", "苏菲", "克莱尔", "艾玛", "雨果"], last: ["杜邦", "马丁", "伯纳德", "拉封", "莫奈", "雷诺", "吉洛", "德洛尔"] },
  },
];

export const CITY_BY_ID: Record<string, CityDef> = Object.fromEntries(CITIES.map((c) => [c.id, c]));

// 商圈档案按城市系数折算（租金/水电/维护 × 城市租金系数；采购价 × 市场系数）
export function districtFor(city: CityDef, districtId: string): DistrictDef {
  return city.districts.find((d) => d.id === districtId) ?? city.districts[0];
}

export function scaledRent(cents: number, city: CityDef): number {
  return Math.round((cents * city.rentFactorBp) / 10000);
}

// 汇率换算：当地分 = 人民币分 × fx / 1000
export function toLocalCents(cnyCents: number, fxPerCnyBp: number): number {
  return Math.round((cnyCents * fxPerCnyBp) / 1000);
}
export function toCnyCents(localCents: number, fxPerCnyBp: number): number {
  return Math.round((localCents * 1000) / fxPerCnyBp);
}

export const CURRENCY_SYMBOL: Record<string, string> = { CNY: "元", JPY: "円", USD: "$", EUR: "€" };
