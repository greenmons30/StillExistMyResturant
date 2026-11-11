// 整数财务/数量工具：全部以“分”和基础单位(g/ml/个)计算，避免浮点误差

export function yuan(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
  return (neg ? "-" : "") + s;
}

export function toCents(yuanNum: number): number {
  return Math.round(yuanNum * 100);
}

// qty 个基础单位，单价 centsPerPurchase 分/采购单位，perPurchase 换算
export function costCents(qty: number, centsPerPurchase: number, perPurchase: number): number {
  return Math.round((qty * centsPerPurchase) / perPurchase);
}

export function qtyText(qty: number, unit: "g" | "piece"): string {
  if (unit === "piece") return `${qty}个`;
  if (qty >= 1000) return `${(qty / 1000).toFixed(qty % 1000 === 0 ? 0 : 1)}kg`;
  return `${qty}g`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function bpApply(cents: number, bp: number): number {
  // 基点乘法，四舍五入到整数分
  return Math.round((cents * bp) / 10000);
}

export function pctBp(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part * 10000) / total);
}
