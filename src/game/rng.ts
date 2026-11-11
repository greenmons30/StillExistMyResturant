// 确定性伪随机（mulberry32），状态存于 state.rng，可存档、可测试

export function nextRandom(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rndInt(s: { rng: number }, lo: number, hi: number): number {
  // 闭区间整数
  if (hi < lo) return lo;
  return lo + Math.floor(nextRandom(s) * (hi - lo + 1));
}

export function rndPick<T>(s: { rng: number }, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(s) * arr.length) % arr.length];
}

export function chance(s: { rng: number }, bp: number): boolean {
  return nextRandom(s) * 10000 < bp;
}

// 以权重挑选：weights 与 items 等长，整数权重
export function rndWeighted<T>(s: { rng: number }, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += Math.max(0, w | 0);
  if (total <= 0) return items[0];
  let r = Math.floor(nextRandom(s) * total);
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i] | 0);
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

// 近似正态噪声（两均匀差），返回 -1..1
export function noise(s: { rng: number }): number {
  return nextRandom(s) + nextRandom(s) - 1;
}
