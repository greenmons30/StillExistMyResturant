import type { IngredientDef } from "../types";

// 食材库：金额=分/采购单位；重量类以 g 为基础单位，采购单位 kg
const D = (
  id: string, name: string, category: IngredientDef["category"],
  basePriceCents: number, shelfDays: number, storage: IngredientDef["storage"],
  opt: Partial<IngredientDef> = {},
): IngredientDef => ({
  id, name, category,
  unit: "g",
  purchaseName: "kg",
  perPurchase: 1000,
  basePriceCents, shelfDays, storage,
  moq: opt.unit === "piece" ? 6 : 500,
  capacityBase: opt.capacityBase ?? 20000,
  randAmpBp: opt.randAmpBp ?? 350,
  seasonAmpBp: opt.seasonAmpBp ?? 1200,
  trendBp: opt.trendBp ?? 25,
  ...opt,
});

export const INGREDIENTS: IngredientDef[] = [
  // 肉类
  D("pork_belly", "五花肉", "meat", 2800, 3, "fridge", { seasonAmpBp: 1500, randAmpBp: 420, capacityBase: 15000 }),
  D("pork_ribs", "排骨", "meat", 3800, 3, "fridge", { seasonAmpBp: 1400, randAmpBp: 450, capacityBase: 12000 }),
  D("pork_mince", "猪肉末", "meat", 1900, 2, "fridge", { seasonAmpBp: 1400, capacityBase: 12000 }),
  D("pork_shoulder", "梅花肉", "meat", 2100, 3, "fridge", { seasonAmpBp: 1300, capacityBase: 12000 }),
  D("beef", "牛肉", "meat", 5800, 3, "fridge", { seasonAmpBp: 1200, randAmpBp: 500, capacityBase: 10000 }),
  D("sausage", "腊肠", "meat", 5200, 30, "fridge", { randAmpBp: 200, seasonAmpBp: 800 }),
  // 禽类
  D("chicken_whole", "整鸡", "poultry", 1300, 3, "fridge", { seasonAmpBp: 1000, capacityBase: 15000 }),
  D("chicken_breast", "鸡胸肉", "poultry", 1400, 3, "fridge", { seasonAmpBp: 900, capacityBase: 15000 }),
  D("duck_breast", "鸭胸", "poultry", 2400, 3, "fridge", { seasonAmpBp: 900, capacityBase: 8000 }),
  // 水产
  D("carp", "草鱼", "seafood", 1000, 2, "fridge", { randAmpBp: 600, seasonAmpBp: 1800, capacityBase: 12000 }),
  D("shrimp", "鲜虾", "seafood", 6200, 2, "fridge", { randAmpBp: 800, seasonAmpBp: 2000, capacityBase: 6000 }),
  D("salmon", "三文鱼", "seafood", 6800, 2, "fridge", { randAmpBp: 500, seasonAmpBp: 1000, capacityBase: 5000 }),
  // 蔬菜调料(植物)
  D("potato", "土豆", "vegetable", 300, 21, "dry", { seasonAmpBp: 600, capacityBase: 40000 }),
  D("tomato", "番茄", "vegetable", 500, 5, "dry", { seasonAmpBp: 1800, randAmpBp: 500, capacityBase: 25000 }),
  D("cabbage", "大白菜", "vegetable", 220, 6, "dry", { seasonAmpBp: 1500, capacityBase: 30000 }),
  D("lettuce", "生菜", "vegetable", 600, 3, "fridge", { seasonAmpBp: 1600, capacityBase: 15000 }),
  D("green_bean", "四季豆", "vegetable", 650, 4, "fridge", { seasonAmpBp: 1400, capacityBase: 12000 }),
  D("radish", "白萝卜", "vegetable", 200, 12, "dry", { seasonAmpBp: 1200, capacityBase: 30000 }),
  D("bamboo_shoot", "竹笋", "vegetable", 900, 5, "fridge", { seasonAmpBp: 1500, capacityBase: 8000 }),
  D("mushroom", "香菇", "vegetable", 1800, 5, "fridge", { seasonAmpBp: 1200, capacityBase: 8000 }),
  D("ginger", "生姜", "seasoning", 900, 15, "dry", { seasonAmpBp: 1000, capacityBase: 8000 }),
  D("garlic", "大蒜", "seasoning", 1300, 20, "dry", { seasonAmpBp: 1500, capacityBase: 10000 }),
  D("scallion", "小葱", "seasoning", 700, 3, "fridge", { seasonAmpBp: 1200, randAmpBp: 500, capacityBase: 6000 }),
  D("chili_fresh", "小米椒", "seasoning", 1600, 6, "fridge", { seasonAmpBp: 2000, randAmpBp: 600, capacityBase: 8000 }),
  D("tofu", "豆腐", "vegetable", 500, 2, "fridge", { seasonAmpBp: 800, capacityBase: 10000 }),
  // 调料干货
  D("soy_sauce", "酱油", "seasoning", 1200, 300, "dry", { randAmpBp: 150, seasonAmpBp: 300, capacityBase: 30000 }),
  D("vinegar", "香醋", "seasoning", 800, 300, "dry", { randAmpBp: 150, seasonAmpBp: 300, capacityBase: 20000 }),
  D("doubanjiang", "豆瓣酱", "seasoning", 1500, 180, "dry", { randAmpBp: 200, seasonAmpBp: 400, capacityBase: 15000 }),
  D("chili_powder", "辣椒面", "seasoning", 2200, 180, "dry", { randAmpBp: 300, seasonAmpBp: 800, capacityBase: 10000 }),
  D("sichuan_pepper", "花椒", "seasoning", 8500, 365, "dry", { randAmpBp: 500, seasonAmpBp: 1200, capacityBase: 4000 }),
  D("curry", "咖喱块", "seasoning", 3600, 240, "dry", { randAmpBp: 200, capacityBase: 8000 }),
  D("cooking_wine", "料酒", "seasoning", 750, 365, "dry", { randAmpBp: 120, capacityBase: 20000 }),
  D("sugar", "白糖", "seasoning", 620, 720, "dry", { randAmpBp: 100, seasonAmpBp: 200, capacityBase: 30000 }),
  D("salt", "食盐", "seasoning", 300, 1800, "dry", { randAmpBp: 60, seasonAmpBp: 100, capacityBase: 30000 }),
  D("cooking_oil", "食用油", "seasoning", 1150, 365, "dry", { randAmpBp: 250, seasonAmpBp: 600, capacityBase: 40000 }),
  D("peanut", "花生米", "seasoning", 1700, 120, "dry", { seasonAmpBp: 800, capacityBase: 10000 }),
  // 谷物
  D("rice", "大米", "grain", 680, 365, "dry", { randAmpBp: 150, seasonAmpBp: 400, capacityBase: 60000 }),
  D("noodles", "面条", "grain", 800, 90, "dry", { randAmpBp: 150, seasonAmpBp: 400, capacityBase: 30000 }),
  D("flour", "面粉", "grain", 520, 180, "dry", { randAmpBp: 150, seasonAmpBp: 400, capacityBase: 50000 }),
  D("bread", "吐司面包", "bakery", 2400, 4, "dry", { randAmpBp: 200, capacityBase: 8000 }),
  // 乳制品
  D("milk", "牛奶", "dairy", 900, 6, "fridge", { randAmpBp: 250, seasonAmpBp: 600, capacityBase: 20000 }),
  D("cream", "淡奶油", "dairy", 3200, 5, "fridge", { randAmpBp: 300, capacityBase: 8000 }),
  D("butter", "黄油", "dairy", 4800, 60, "fridge", { randAmpBp: 250, capacityBase: 6000 }),
  D("cheese", "芝士片", "dairy", 6500, 30, "fridge", { randAmpBp: 250, capacityBase: 5000 }),
  D("egg", "鸡蛋", "dairy", 130, 15, "fridge", {
    unit: "piece", purchaseName: "个", perPurchase: 1, moq: 12, capacityBase: 400, randAmpBp: 300, seasonAmpBp: 800,
  }),
  // 水果
  D("lemon", "柠檬", "fruit", 900, 8, "fridge", { seasonAmpBp: 1200, capacityBase: 8000 }),
  D("orange", "橙子", "fruit", 700, 10, "fridge", { seasonAmpBp: 1400, capacityBase: 12000 }),
  D("strawberry", "草莓", "fruit", 3200, 3, "fridge", { randAmpBp: 700, seasonAmpBp: 2500, capacityBase: 5000 }),
  // 饮原料
  D("coffee_beans", "咖啡豆", "beverage", 9800, 180, "dry", { randAmpBp: 300, seasonAmpBp: 500, capacityBase: 6000 }),
  D("tea_leaves", "茶叶", "beverage", 16000, 365, "dry", { randAmpBp: 200, seasonAmpBp: 400, capacityBase: 4000 }),
  D("cocoa", "可可粉", "beverage", 5200, 365, "dry", { randAmpBp: 150, capacityBase: 4000 }),
];

export const ING_BY_ID: Record<string, IngredientDef> = Object.fromEntries(
  INGREDIENTS.map((i) => [i.id, i]),
);
