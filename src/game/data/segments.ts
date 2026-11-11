import type { SegmentDef } from "../types";

// 顾客群体：预算/偏好/敏感度均为整数
export const SEGMENTS: SegmentDef[] = [
  {
    id: "student", name: "学生党", budgetCents: 2500, budgetSpreadBp: 4000,
    cuisineWeightsBp: { hunan: 1500, sichuan: 1300, cantonese: 700, western: 900, japanese: 900, french: 200, fastfood: 1800, dessert: 1000, drink: 1100 },
    priceSensBp: 1600, portionPrefBp: 1000, envRequire: 30, waitTolMin: 28, qualityRequire: 45, repurchaseBp: 900,
  },
  {
    id: "office", name: "上班族", budgetCents: 4200, budgetSpreadBp: 3500,
    cuisineWeightsBp: { hunan: 1200, sichuan: 1100, cantonese: 1000, western: 1000, japanese: 1100, french: 400, fastfood: 1000, dessert: 700, drink: 800 },
    priceSensBp: 1000, portionPrefBp: 950, envRequire: 50, waitTolMin: 20, qualityRequire: 60, repurchaseBp: 1100,
  },
  {
    id: "family", name: "家庭顾客", budgetCents: 8000, budgetSpreadBp: 3000,
    cuisineWeightsBp: { hunan: 1100, sichuan: 1000, cantonese: 1500, western: 800, japanese: 600, french: 300, fastfood: 900, dessert: 900, drink: 600 },
    priceSensBp: 900, portionPrefBp: 1300, envRequire: 60, waitTolMin: 25, qualityRequire: 62, repurchaseBp: 1400,
  },
  {
    id: "influencer", name: "网红打卡客", budgetCents: 6000, budgetSpreadBp: 5000,
    cuisineWeightsBp: { hunan: 1200, sichuan: 1000, cantonese: 800, western: 1400, japanese: 1500, french: 900, fastfood: 600, dessert: 1400, drink: 1200 },
    priceSensBp: 700, portionPrefBp: 800, envRequire: 80, waitTolMin: 32, qualityRequire: 65, repurchaseBp: 500,
  },
  {
    id: "vip", name: "高消费顾客", budgetCents: 15000, budgetSpreadBp: 4000,
    cuisineWeightsBp: { hunan: 800, sichuan: 700, cantonese: 1400, western: 1500, japanese: 1600, french: 1800, fastfood: 200, dessert: 1000, drink: 800 },
    priceSensBp: 450, portionPrefBp: 850, envRequire: 85, waitTolMin: 16, qualityRequire: 80, repurchaseBp: 1000,
  },
  {
    id: "random", name: "随机客", budgetCents: 4000, budgetSpreadBp: 6000,
    cuisineWeightsBp: { hunan: 1100, sichuan: 1100, cantonese: 1000, western: 1000, japanese: 1000, french: 700, fastfood: 1100, dessert: 900, drink: 900 },
    priceSensBp: 1000, portionPrefBp: 1000, envRequire: 50, waitTolMin: 22, qualityRequire: 55, repurchaseBp: 800,
  },
];

export const SEG_BY_ID: Record<string, SegmentDef> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]));

// 员工名字池与特质
export const EMP_FIRST_NAMES = ["张", "李", "王", "刘", "陈", "杨", "黄", "赵", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "罗", "高", "林"];
export const EMP_LAST_NAMES = ["伟", "芳", "娜", "敏", "静", "磊", "强", "军", "杰", "涛", "明", "超", "霞", "平", "刚", "桂英", "建国", "建华", "忆莲", "国庆", "雨欣", "志强", "海燕", "德华"];
export const EMP_TRAITS = ["手速快", "味感灵", "夜猫子", "洁癖", "话痨", "老好人", "较真", "乐观", "沉默寡言", "认死理"];
export const EMP_SPECIALTIES: Record<string, string[]> = {
  cook: ["猛火快炒", "卤味", "面点", "海鲜处理", "凉菜", "甜品"],
  prep: ["刀工", "备料", "腌肉", "摆盘"],
  server: ["记忆菜单", "催单", "带位", "打包"],
  manager: ["排班", "盘点", "客诉处理"],
  cleaner: ["深度清洁", "除味", "洗碗快"],
};

export const REVIEW_GOOD = [
  "锅气十足，下次还来！", "这个价能吃到这种品质，良心。", "辣得过瘾，长沙胃被治愈了。",
  "上菜快，服务好，好评。", "份量实在，打工人的福音。", "环境比想象中好，拍照出片。",
  "肉很新鲜，汤底浓郁。", "老板人Nice，加了小菜。",
];
export const REVIEW_BAD = [
  "等太久了，饭点别来。", "感觉不如以前，有点咸。", "份量缩水了？", "排队一小时，不值。",
  "有根头发，恶心。", "服务员爱答不理。", "价格涨了品质没跟上。", "太油了，踩雷。",
];
export const REVIEW_MID = [
  "中规中矩，路过可以吃。", "还行吧，没什么惊喜。", "性价比一般。", "味道可以，环境一般。",
];

// 按差评驱动因素分类的评价语料（{dish} {wait} 为占位符）
export const REVIEW_Q_GOOD = [
  "锅气十足，后厨是有真功夫的！", "食材吃得出来新鲜，厨师火候拿捏到位。",
  "{dish}的水平在这个价位很能打。", "师傅手艺稳，出品一致性好，回头客预定。",
  "辣得层次分明，后厨有点东西。",
];
export const REVIEW_Q_BAD = [
  "{dish}味道寡淡，后厨水平堪忧。", "肉不新鲜，火候也差口气。", "出品不稳定，这次翻车了。",
  "吃得出是赶工出来的，没有锅气。", "厨师估计是新手，咸淡都没调匀。",
];
export const REVIEW_W_BAD = [
  "等了{wait}分钟才吃上，饿过劲了。", "高峰期排队完全没管理，等太久弃单。", "上菜慢到汤都凉透。",
  "等待时间劝退，饭点别来受罪。",
];
export const REVIEW_P_BAD = [
  "{dish}不值这个价，涨价品质没跟上。", "菜单价格劝退，打工人与这家无缘。", "同样的钱隔壁能加个菜。",
  "看价格以为是精品店，吃完只觉亏得慌。",
];
export const REVIEW_PORTION_BAD = [
  "份量敷衍，两筷子就没了。", "这个量是给猫吃的吗？", "盘子很大菜很少，差评。",
];
export const REVIEW_H_BAD = [
  "桌子黏手，卫生细节差。", "后厨看着不太放心，建议做明厨亮灶。", "地面滑溜溜，卫生要扣分。",
];
