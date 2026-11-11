import { useMemo, useState } from "react";
import { useGame, money, curSym } from "./App";
import { Card, Stat, Bar, Modal, Th, NumberInput, Confirm } from "./widgets";
import { yuan, qtyText } from "../game/utils";
import { ALL_SLOTS, type GameState, type IngredientCategory, type SlotId } from "../game/types";
import { INGREDIENTS, ING_BY_ID } from "../game/data/ingredients";
import { DISHES, DISH_BY_ID } from "../game/data/dishes";
import { SUPPLIER_LIST, quoteBuy, recommendQty, trendLabel, supplierById, supDisplayName } from "../game/engine/market";
import { capacityFor, totalStock, marketCogsOfDish, canMakeDish, recipeFillBp, availableStock } from "../game/engine/inventory";
import { ROLE_NAMES, wageForRole, dailyWageCents, localWage, hasSchedulingManager } from "../game/engine/staff";
import { roughCapacity, slotLabel, estimateDemand, suggestPurchase } from "../game/engine/dayflow";
import { netWorthCents, branchNetWorthLocal, equipmentValueCents, loanOwedCents, lifetime, pnlForDay, cashflowForDay } from "../game/engine/finance";
import { DECOR, CUISINES, STAFF, CALENDAR, RECIPE_TUNING, RESEARCH } from "../game/config";
import type { CuisineId } from "../game/types";
import { CITY_BY_ID, toCnyCents, toLocalCents } from "../game/data/cities";
import { zhEvent, zhOption, defType } from "../game/engine/events";
import { quoteCampaign, campaignById, tierById, nearHoliday } from "../game/engine/marketing";
import { SEGMENTS } from "../game/data/segments";
import { INTERVIEW_QUESTIONS } from "../game/engine/events";
import { LEARNABLE_CUISINES, dishesOfCuisine, isDishSellable } from "../game/engine/research";
import { listSlots, loadGame, saveGame, deleteSlot, AUTO_SLOT, MANUAL_SLOTS, type StorageAdapter } from "../game/engine/save";

// ============ 城市切换 ============
export function CitySwitch() {
  const { s, act } = useGame();
  return (
    <div className="city-switch">
      <span className="dim">城市：</span>
      {Object.keys(s.branches).map((cid) => (
        <button key={cid} className={"btn-xs " + (s.activeCityId === cid ? "on" : "")} onClick={() => act({ type: "SWITCH_CITY", cityId: cid })}>
          {CITY_BY_ID[cid].name}
        </button>
      ))}
      <span className="dim">｜ {s.activeCityId} 记账货币：{CITY_BY_ID[s.activeCityId].currency}（{curSym(s.activeCityId)}）</span>
    </div>
  );
}

// ============ 经营总览 ============
export function OverviewPage() {
  const { s, b, act, setNav } = useGame();
  const [onlyNeeded, setOnlyNeeded] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const nw = netWorthCents(s);
  const last = b.reports[0];
  const neededSet = useMemo(() => {
    const set = new Set<string>();
    for (const mi of Object.values(b.menu)) {
      if (!mi.active || !isDishSellable(s, mi.dishId)) continue;
      const dish = DISH_BY_ID[mi.dishId];
      if (dish) for (const r2 of dish.recipe) set.add(r2.ingId);
    }
    return set;
  }, [b.menu, s.study]);
  const city = CITY_BY_ID[b.cityId];
  const dem = estimateDemand(s, b);
  const autoActive = b.autoRestock.enabled && s.day <= b.autoRestock.untilDay && b.autoRestock.items.length > 0;
  return (
    <div className="page">
      <CitySwitch />
      <div className="stat-row">
        <Stat label={`${city.name}店现金`} value={money(s, b.cashCents)} sub={`折合 ${yuan(toCnyCents(b.cashCents, city.fxPerCnyBp))} 元 · 点击周转`} tone={b.cashCents < 200000 ? "bad" : "good"} />
        <Stat label="集团现金(全部店折合)" value={`${yuan(Object.values(s.branches).reduce((a, x) => a + toCnyCents(x.cashCents, CITY_BY_ID[x.cityId].fxPerCnyBp), 0))} 元`} sub={`共 ${Object.keys(s.branches).length} 家分店`} />
        <Stat label="库存食材价值" value={money(s, Object.values(b.inventory).flat().reduce((a, l) => a + Math.round((l.qty * l.unitPriceCents) / l.perPurchase), 0))} sub={`${Object.values(b.inventory).flat().length} 个批次`} />
        <Stat label="员工" value={`${b.staff.length} 人`} sub={`今日应发工资 ${money(s, b.staff.reduce((a, e) => a + dailyWageCents(e), 0))}（未排班当日无薪）`} />
        <Stat label="口碑" value={(b.reputation / 10).toFixed(1)} sub={`回头客 ${b.regulars}`} tone={b.reputation >= 600 ? "good" : b.reputation < 400 ? "bad" : undefined} />
        <Stat label="集团净资产" value={`${yuan(nw)} 元`} sub={`${city.name}店 ${money(s, branchNetWorthLocal(b))}`} />
        <div className="stat clickable" onClick={() => setTransfer(true)}>
          <div className="stat-label">资金周转</div>
          <div className="stat-value">⇄</div>
          <div className="stat-sub">按汇率在分店间调拨现金</div>
        </div>
      </div>
      {transfer && <TransferModal close={() => setTransfer(false)} />}
      <div className="grid2">
        <Card title={`本店：${city.name}·${city.districts.find((d) => d.id === b.districtId)?.name} ｜ 第${s.day}天 ${s.date.year}-${pad(s.date.month)}-${pad(s.date.dayOfMonth)} ${CALENDAR.weekdayNames[s.date.weekday]} · ${s.date.season}`}>
          <div className="ov-line">老板：{s.boss.name}（{s.boss.age}岁） · 身世：{BG_NAME(s)} · 性格：{P_NAME(s)}</div>
          <div className="ov-line">营业时段：{b.store.openSlots.map(slotLabel).join(" / ")}{b.store.orderLimitCovers > 0 ? ` ｜ 限单 ${b.store.orderLimitCovers} 桌/日` : ""}</div>
          <div className="ov-line">今日预估：约 <b>{dem.expected}</b> 桌（潜在客流 {dem.potential} 桌） ｜ 有效产能 ≈ {Math.floor(dem.capacity)} 桌 ｜ 粗估 {roughCapacity(s, b)} 桌</div>
          <div className="ov-line">卫生 {b.store.hygiene}/100 · 设备 {b.store.equipmentHealth}/100 · 环境 {b.store.decor}/100 · 炉灶 {b.store.stations}（每灶并行约2.5道）</div>
          <div className="btn-row">
            <button className="btn-primary" onClick={() => setNav("market")}>去本店市场采购</button>
            <button className="btn" onClick={() => setNav("menu")}>菜单定价</button>
            <button className="btn" onClick={() => setNav("staff")}>排班管理</button>
          </div>
        </Card>
        <Card title={`${city.name}店昨日回顾`}>
          {!last && <div className="dim">本店开业第一天，先周转资金、采购、上架菜品，确认计划后开始营业。</div>}
          {last && (
            <div>
              <div className="ov-line">接待 {last.served}/{last.entered} 桌，弃单 {last.lostToWait}，缺料流失 {last.lostNoStock}</div>
              <div className="ov-line">营收 {money(s, last.revenueCents)}，食材成本 {money(s, last.cogsCents)}，净利润 <b className={last.netProfitCents >= 0 ? "good" : "bad"}>{money(s, last.netProfitCents)}</b></div>
              <div className="ov-line">最佳贡献：{last.topDish ?? "—"}，满意度 {last.avgSatisfaction}/100</div>
              <ul className="reviews">
                {last.reviews.slice(0, 4).map((r, i) => <li key={i}>{r.text}<small>（{r.dishName}）</small></li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>
      <Card title={`${city.name}店利润走势（最近5天 · 柱=净利润，线=趋势；当地货币）`}>
        <ProfitChart b={b} />
      </Card>
      <Card
        title="本店库存速览（临期提醒）"
        actions={
          <>
            <label className="chk">
              <input type="checkbox" checked={onlyNeeded} onChange={() => setOnlyNeeded(!onlyNeeded)} />
              只看在售菜品所需原料
            </label>
            {onlyNeeded && (
              <>
                <button className="btn-xs" onClick={() => setAutoOpen(true)}>设置自动购入</button>
                <button
                  className="btn-xs ok"
                  disabled={!autoActive || b.phase !== "planning"}
                  title={autoActive ? `补足到目标库容（有效至第${b.autoRestock.untilDay}天）` : "尚未设置自动购入"}
                  onClick={() => act({ type: "AUTO_RESTOCK_RUN" })}
                >
                  自动购入
                </button>
                {autoActive && <span className="tag good">已设 {b.autoRestock.items.length} 种 · 至第{b.autoRestock.untilDay}天</span>}
              </>
            )}
          </>
        }
      >
        <table className="tbl">
          <thead><tr><th>食材</th><th>库存</th><th>容量</th><th>批次明细（购入日 · 剩余保质期）</th><th>状态</th></tr></thead>
          <tbody>
            {INGREDIENTS.filter((d) => !onlyNeeded || neededSet.has(d.id)).map((d) => {
              const lots = (b.inventory[d.id] ?? []).filter((l) => l.qty > 0);
              const t = totalStock(b, d.id);
              const cap = capacityFor(b, d);
              const nearest = lots.length ? Math.min(...lots.map((l) => l.expiresDay)) - s.day : null;
              return (
                <tr key={d.id} className={nearest !== null && nearest <= 1 ? "row-danger" : nearest !== null && nearest <= 3 ? "row-warn" : ""}>
                  <td>{d.name}</td>
                  <td className="num">{qtyText(t, d.unit)}</td>
                  <td style={{ width: 120 }}><Bar value={cap ? (t / cap) * 100 : 0} color={t / cap > 0.8 ? "#e0745a" : undefined} /></td>
                  <td className="dim" style={{ maxWidth: 300, fontSize: 11 }}>
                    {lots.length === 0 ? "—" : [...lots].sort((x, y) => x.expiresDay - y.expiresDay).map((l) =>
                      `${qtyText(l.qty, d.unit)}·第${l.purchasedDay ?? "?"}天入·剩${Math.max(0, l.expiresDay - s.day)}天`).join("；")}
                  </td>
                  <td>{t === 0 ? <span className="dim">缺货</span> : nearest !== null && nearest <= 1 ? <span className="bad">即将过期</span> : <span className="good">正常</span>}</td>
                </tr>
              );
            }).slice(0, 200)}
          </tbody>
        </table>
      </Card>
      {autoOpen && <AutoRestockModal neededSet={neededSet} close={() => setAutoOpen(false)} />}
    </div>
  );
}

function BG_NAME(s: GameState): string { return ({ miserable: "凄惨", normal: "普通", affluent: "优渥", tycoon: "豪门" } as Record<string, string>)[s.boss.background]; }
function P_NAME(s: GameState): string {
  const map: Record<string, string> = { frugal: "精打细算", hospitable: "热情好客", strict: "严格苛刻", easygoing: "随性佛系", ambitious: "野心勃勃", social: "社交达人", perfectionist: "完美主义", adventurer: "冒险主义" };
  return map[s.boss.personality] ?? s.boss.personality;
}

// ============ 资金周转 ============
function TransferModal(props: { close: () => void }) {
  const { s, b, act } = useGame();
  const others = Object.keys(s.branches).filter((c) => c !== b.cityId);
  const [to, setTo] = useState(others[0] ?? "");
  const [amt, setAmt] = useState(100000);
  if (others.length === 0) {
    return <Modal title="资金周转" onClose={props.close}><div className="dim">只有一家分店，暂无周转对象。开设新分店后即可按汇率互转。</div></Modal>;
  }
  const fromCity = CITY_BY_ID[b.cityId];
  const toCity = CITY_BY_ID[to];
  const receive = toLocalCents(toCnyCents(amt, fromCity.fxPerCnyBp), toCity.fxPerCnyBp);
  return (
    <Modal title={`资金周转：从${fromCity.name}店调出`} onClose={props.close} footer={
      <>
        <button className="btn" onClick={props.close}>取消</button>
        <button className="btn-primary" disabled={amt <= 0 || amt > b.cashCents} onClick={() => { act({ type: "TRANSFER_FUNDS", toCityId: to, cents: Math.round(amt) }); props.close(); }}>确认周转</button>
      </>
    }>
      <div className="legend">现金跟店走：各分店持有当地货币，跨店调拨按汇率折算（1 元人民币 = {(toCity.fxPerCnyBp / 1000).toFixed(2)} {toCity.currency}）。</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <span className="dim">目标分店：</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}>{others.map((c) => <option key={c} value={c}>{CITY_BY_ID[c].name}店</option>)}</select>
      </div>
      <div className="btn-row">
        <span className="dim">调出金额（{fromCity.currency}）：</span>
        <NumberInput value={amt / 100} min={0} max={b.cashCents / 100} step={100} onChange={(v) => setAmt(Math.round(v * 100))} suffix="元" />
        <span>→ {toCity.name}到账 <b>{yuan(receive)}{curSym(to)}</b></span>
      </div>
      <p className="dim">本店现有 {money(s, b.cashCents)}。</p>
    </Modal>
  );
}

// ============ 自动购入设置 ============
function AutoRestockModal(props: { neededSet: Set<string>; close: () => void }) {
  const { s, b, act } = useGame();
  const ings = INGREDIENTS.filter((d) => props.neededSet.has(d.id));
  const init = (): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const d of ings) {
      const saved = b.autoRestock.items.find((i) => i.ingId === d.id);
      const cur2 = availableStock(b, d.id);
      const moqCeil = Math.max(d.moq, Math.ceil(cur2 / d.moq) * d.moq);
      m[d.id] = saved ? saved.targetQty : moqCeil;
    }
    return m;
  };
  const [targets, setTargets] = useState<Record<string, number>>(init);
  const [days, setDays] = useState(7);
  const [supplier, setSupplier] = useState(b.autoRestock.supplierId || "mawangdui");
  return (
    <Modal title="设置自动购入" wide onClose={props.close} footer={
      <>
        <button className="btn" onClick={props.close}>取消</button>
        {b.autoRestock.enabled && <button className="btn-danger" onClick={() => { act({ type: "AUTO_RESTOCK_STOP" }); props.close(); }}>停用</button>}
        <button className="btn-primary" onClick={() => {
          const items = ings.map((d) => ({ ingId: d.id, targetQty: Math.max(0, Math.round(targets[d.id] ?? 0)) })).filter((x) => x.targetQty >= ING_BY_ID[x.ingId].moq);
          act({ type: "AUTO_RESTOCK_SAVE", items, days, supplierId: supplier });
          props.close();
        }}>保存并启用</button>
      </>
    }>
      <div className="legend">为在售菜品所需原料设定「目标库容」与「时长」。<b>自动购入不会在开局自动执行</b>：需在库存速览点击「自动购入」按钮，才会把库存低于目标值的食材一键补购到目标库容。</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <span className="dim">时长（天）：</span>
        {[3, 7, 14, 30].map((x) => <button key={x} className={"btn-xs " + (days === x ? "on" : "")} onClick={() => setDays(x)}>{x}天</button>)}
        <NumberInput value={days} min={1} max={365} onChange={setDays} suffix="天" />
        <span className="dim" style={{ marginLeft: 12 }}>供应商：</span>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          {SUPPLIER_LIST.map((sp) => <option key={sp.id} value={sp.id}>{supDisplayName(b.cityId, sp.id)}{sp.deliveryDays ? "（次日达）" : "（当日达+运费）"}</option>)}
        </select>
      </div>
      <table className="tbl">
        <thead><tr><th>食材</th><th className="num">当前库存</th><th className="num">容量</th><th>目标库容</th><th className="num">起订量</th></tr></thead>
        <tbody>
          {ings.map((d) => {
            const stock = totalStock(b, d.id);
            const cap = capacityFor(b, d);
            return (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="num">{qtyText(stock, d.unit)}</td>
                <td className="num dim">{qtyText(cap, d.unit)}</td>
                <td>
                  <NumberInput
                    value={Math.round(targets[d.id] ?? 0)}
                    min={0} max={Math.max(d.moq, cap)} step={d.unit === "piece" ? 6 : 500}
                    onChange={(v) => setTargets((t) => ({ ...t, [d.id]: v }))}
                    suffix={d.unit === "g" ? "g" : "个"}
                  />
                </td>
                <td className="num dim">{qtyText(d.moq, d.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ings.length === 0 && <div className="dim center">当前没有在售菜品。</div>}
    </Modal>
  );
}

function ProfitChart(props: { b: GameState["branches"][string] }) {
  const days = [...props.b.reports].slice(0, 5).reverse();
  if (days.length === 0) return <div className="dim center">完成第一天营业结算后显示利润走势。</div>;
  const W = 360, H = 168, zeroY = 86;
  const stepW = (W - 24) / days.length;
  const maxAbs = Math.max(100000, ...days.map((d) => Math.abs(d.netProfitCents)));
  const scale = 52 / maxAbs;
  const bars = days.map((d, i) => {
    const cx = 12 + stepW * i + stepW / 2;
    const h = Math.round(d.netProfitCents * scale);
    return { d, cx, y: h >= 0 ? zeroY - Math.max(h, 1) : zeroY, height: Math.max(2, Math.abs(h)), netY: zeroY - h };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <line x1={8} y1={zeroY} x2={W - 8} y2={zeroY} stroke="#333a47" strokeWidth={1} />
      {bars.map((b2, i) => (
        <g key={i}>
          <rect x={b2.cx - Math.min(22, stepW * 0.32)} y={b2.y} width={Math.min(44, stepW * 0.64)} height={b2.height}
            fill={b2.d.netProfitCents >= 0 ? "#47b781" : "#e0655a"} opacity={0.55} rx={2} />
          <text x={b2.cx} y={b2.d.netProfitCents >= 0 ? b2.netY - 6 : b2.netY + b2.height + 12} textAnchor="middle" fontSize={10}
            fill={b2.d.netProfitCents >= 0 ? "#47b781" : "#e0655a"}>
            {b2.d.netProfitCents >= 0 ? "+" : ""}{(b2.d.netProfitCents / 100).toFixed(0)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="#4f8cff" strokeWidth={2} points={bars.map((b2) => `${b2.cx},${b2.netY}`).join(" ")} />
      {bars.map((b2, i) => <circle key={"p" + i} cx={b2.cx} cy={b2.netY} r={3} fill="#4f8cff" />)}
      {bars.map((b2, i) => <text key={"t" + i} x={b2.cx} y={H - 4} textAnchor="middle" fontSize={9} fill="#7f8a9d">第{b2.d.day}天</text>)}
    </svg>
  );
}

// ============ 市场采购 ============
export function MarketPage() {
  const { s, b, act } = useGame();
  const [tab, setTab] = useState<"market" | "cart">("market");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<IngredientCategory | "all">("all");
  const [bulkSup, setBulkSup] = useState("mawangdui");
  const rows = INGREDIENTS.filter((d) => (cat === "all" || d.category === cat) && d.name.includes(q));
  return (
    <div className="page">
      <CitySwitch />
      <div className="mkt-tabbar">
        <button className={"btn-xs " + (tab === "market" ? "on" : "")} onClick={() => setTab("market")}>食材市场</button>
        <button className={"btn-xs " + (tab === "cart" ? "on" : "")} onClick={() => setTab("cart")}>购物车（{b.cart.length}）</button>
        {tab === "market" && (
          <span className="bulk-add">
            <select value={bulkSup} onChange={(e) => setBulkSup(e.target.value)}>
              {SUPPLIER_LIST.map((sp) => <option key={sp.id} value={sp.id}>{supDisplayName(b.cityId, sp.id)}{sp.deliveryDays ? "（次日达）" : "（当日达+运费）"}</option>)}
            </select>
            <button className="btn-xs ok" disabled={b.phase !== "planning"}
              title="按本店昨日销量缺口，将所有建议量一次加入购物车"
              onClick={() => act({ type: "CART_ADD_SUGGESTED", supplierId: bulkSup })}>
              一键加入购物车（缺料建议）
            </button>
          </span>
        )}
        <span className="spacer" />
        {tab === "market" && (
          <>
            <input className="search" placeholder="搜索食材" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cat} onChange={(e) => setCat(e.target.value as IngredientCategory)}>
              <option value="all">全部品类</option>
              {(["meat", "poultry", "seafood", "vegetable", "seasoning", "grain", "dairy", "fruit", "bakery", "beverage"] as IngredientCategory[]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
      </div>
      {tab === "market" ? (
        <Card title={`${CITY_BY_ID[b.cityId].name}食材市场`}>
          <div className="legend">各城价格与趋势独立演化（本地季节相位/随机流不同）。采购减少本店现金、形成库存资产；制作菜品时才计入消耗成本。建议量按本店昨日消耗×1.2 − 现有可用库存，仅缺料时出现。</div>
          <table className="tbl">
            <thead>
              <tr>
                <Th label="食材" /><Th label="现价" /><Th label="趋势" /><Th label="供应" /><Th label="库存/容量" />
                <Th label="建议采购" /><Th label="数量" /><Th label="供应商" /><Th label="预估支出" /><Th label="" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => <MarketRow key={d.id} ingId={d.id} />)}
              {rows.length === 0 && <tr><td colSpan={10} className="dim center">没有符合条件的食材</td></tr>}
            </tbody>
          </table>
        </Card>
      ) : (
        <CartView />
      )}
    </div>
  );
}

// 小工具占位（避免误引用）

function MarketRow(props: { ingId: string }) {
  const { s, b, act } = useGame();
  const d = ING_BY_ID[props.ingId];
  const m = b.market[d.id];
  const [sup, setSup] = useState("mawangdui");
  const [qty, setQty] = useState<number>(d.moq);
  const supObj = supplierById(sup)!;
  const q = quoteBuy(s, b, d, qty, supObj);
  const stock = totalStock(b, d.id);
  const cap = capacityFor(b, d);
  const rec = recommendQty(b, d);
  const overs = stock + qty > cap;
  const cashBad = b.cashCents < q.totalCents;
  const inCart = b.cart.some((c) => c.ingId === d.id && c.supplierId === sup);
  const canAdd = b.phase === "planning" && qty >= d.moq;
  return (
    <tr className={m.supply === 0 ? "row-danger" : undefined}>
      <td>{d.name}<small className="dim"> {d.purchaseName} {d.shelfDays}天保质期</small>{m.eventTag && <span className="tag warn">{m.eventTag}</span>}</td>
      <td className="num">{yuan(m.priceCents)}<small className="dim">/{d.purchaseName}</small></td>
      <td>{trendLabel(m)}</td>
      <td>{m.supply === 0 ? <span className="bad">缺货</span> : m.supply === 1 ? <span className="warn">紧张</span> : <span className="good">充足</span>}</td>
      <td className="num">{qtyText(stock, d.unit)} / {qtyText(cap, d.unit)}</td>
      <td className="num">{rec > 0 ? qtyText(rec, d.unit) : <span className="dim">无需补货</span>}</td>
      <td>
        <NumberInput value={qty} min={d.moq} step={d.unit === "piece" ? 6 : 500} onChange={setQty} suffix={d.unit === "g" ? "g" : "个"} />
        {rec > 0 && <button className="btn-xs" onClick={() => setQty(rec)}>用建议量</button>}
      </td>
      <td>
        <select value={sup} onChange={(e) => setSup(e.target.value)}>
          {SUPPLIER_LIST.filter((sp) => !sp.categories || sp.categories.includes(d.category)).map((sp) => (
            <option key={sp.id} value={sp.id}>{supDisplayName(b.cityId, sp.id)}{sp.deliveryDays ? `(${sp.deliveryDays}日达)` : "(当日达)"}</option>
          ))}
        </select>
      </td>
      <td className={cashBad ? "num bad" : "num"}>
        {yuan(q.goodsCents)}{q.feeCents ? `+运费${yuan(q.feeCents)}` : ""}
        {q.discountBp !== 10000 && <span className="tag good">批量{q.discountBp / 100}%</span>}
        {overs && <span className="bad"> 超容量</span>}
      </td>
      <td>
        <button className={"btn-xs " + (canAdd ? "ok" : "")} disabled={!canAdd}
          title={supObj.deliveryDays ? `${supObj.deliveryDays}日后送达本店` : "当日送达本店"}
          onClick={() => act({ type: "CART_ADD", ingId: d.id, qty, supplierId: sup })}>
          {inCart ? "追加" : "加入购车"}
        </button>
      </td>
    </tr>
  );
}

function CartView() {
  const { s, b, act } = useGame();
  let grandTotal = 0;
  const rows = b.cart.map((c, idx) => {
    const d = ING_BY_ID[c.ingId];
    const sp = supplierById(c.supplierId);
    const q = sp ? quoteBuy(s, b, d, c.qty, sp) : null;
    if (q) grandTotal += q.totalCents;
    return (
      <tr key={idx}>
        <td>{d?.name ?? c.ingId}</td>
        <td className="num">{qtyText(c.qty, d?.unit ?? "g")}</td>
        <td>{sp ? supDisplayName(b.cityId, sp.id) : c.supplierId}{sp?.deliveryDays ? <span className="dim">（{sp.deliveryDays}日达）</span> : <span className="dim">（当日达）</span>}</td>
        <td className="num">{q ? yuan(q.goodsCents) : "—"}{q?.feeCents ? <span className="dim"> +运费{yuan(q.feeCents)}</span> : ""}</td>
        <td className="num">{q ? yuan(q.totalCents) : "—"}</td>
        <td><button className="btn-xs danger" onClick={() => act({ type: "CART_REMOVE", index: idx })}>移除</button></td>
      </tr>
    );
  });
  return (
    <Card title={`${CITY_BY_ID[b.cityId].name}店 · 采购购物车`} actions={
      <>
        <span className="dim">合计预估 <b className={b.cashCents < grandTotal ? "bad" : "good"}>{money(s, grandTotal)}</b> ｜ 本店现金 {money(s, b.cashCents)}</span>
        <button className="btn-xs" disabled={b.cart.length === 0} onClick={() => { if (window.confirm("清空购物车？仅移除待购条目，不影响现金。")) act({ type: "CART_CLEAR" }); }}>清空</button>
        <button className="btn-primary" disabled={b.cart.length === 0} onClick={() => act({ type: "CART_CHECKOUT" })}>一键购买</button>
      </>
    }>
      <div className="legend">购物车随存档保存，除非手动移除或购买成功。结算失败（缺货/容量不足/现金不足）的条目留在车内。到货入本店仓库，受本店容量限制。</div>
      {b.cart.length === 0 ? (
        <div className="dim center">购物车为空。可在“食材市场”逐个加入，或用顶部「一键加入购物车」按缺口批量加入。</div>
      ) : (
        <table className="tbl">
          <thead><tr><Th label="食材" /><Th label="数量" /><Th label="供应商" /><Th label="货款" /><Th label="小计" /><Th label="" /></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      )}
    </Card>
  );
}

// ============ 菜单定价 ============
export function MenuPage() {
  const { s, b, act } = useGame();
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [asc, setAsc] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const city = CITY_BY_ID[b.cityId];
  const lastStats: Record<string, { sold: number }> = {};
  for (const d of b.reports[0]?.dishStats ?? []) lastStats[d.dishId] = { sold: d.sold };

  let rows = DISHES.filter((d) => d.name.includes(q) && (!onlyActive || b.menu[d.id]?.active));
  const statsOf = (id: string) => lastStats[id]?.sold ?? 0;
  const keyVal = (d: (typeof DISHES)[number], k: string): number | string => {
    const mi = b.menu[d.id];
    switch (k) {
      case "name": return d.name;
      case "cuisine": return d.cuisine;
      case "cost": return marketCogsOfDish(b, d.id);
      case "price": return mi?.priceCents ?? 0;
      case "margin": {
        const price = mi?.priceCents ?? 1;
        return Math.round(((price - marketCogsOfDish(b, d.id)) / Math.max(1, price)) * 10000);
      }
      case "sold": return statsOf(d.id);
      default: return d.name;
    }
  };
  if (sortKey) {
    rows = [...rows].sort((a, c) => {
      const av = keyVal(a, sortKey), bv = keyVal(c, sortKey);
      const r = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return asc ? r : -r;
    });
  }
  const toggleSort = (k: string) => { if (sortKey === k) setAsc(!asc); else { setSortKey(k); setAsc(false); } };

  return (
    <div className="page">
      <CitySwitch />
      <Card title={`菜单与定价（${city.name}店，定价货币 ${city.currency}；建议价按当地汇率折算）`} actions={
        <>
          <input className="search" placeholder="搜索菜品" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="chk"><input type="checkbox" checked={onlyActive} onChange={() => setOnlyActive(!onlyActive)} />仅在售</label>
        </>
      }>
        <div className="legend">售价影响效用与销量（顾客价格敏感度 × 城市消费习惯，海外城市按当地货币定价——东京按円、纽约按$）。菜品研究成功后所有分店共享解锁。缺关键食材无法出餐。点菜名打开详情可调整配料用量。</div>
        <table className="tbl">
          <thead>
            <tr>
              <Th label="菜品" sortKey="name" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label="菜系" sortKey="cuisine" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label="份量/用时" /><Th label="建议价(合人民币)" />
              <Th label="动态食材成本" sortKey="cost" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label={`售价(${curSym(b.cityId)})`} sortKey="price" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label="毛利率" sortKey="margin" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label="昨日销量" sortKey="sold" active={sortKey} asc={asc} onSort={toggleSort} />
              <Th label="备料" /><Th label="在售" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const mi = b.menu[d.id];
              const sellable = isDishSellable(s, d.id);
              const cost = marketCogsOfDish(b, d.id);
              const margin = mi ? Math.round(((mi.priceCents - cost) / Math.max(1, mi.priceCents)) * 100) : 0;
              const makeable = sellable && canMakeDish(b, d.id);
              const fill = recipeFillBp(b, d.id);
              return (
                <tr key={d.id} className={!mi?.active || !sellable ? "row-off" : undefined}>
                  <td><a className="link" onClick={() => setDetail(d.id)}>{d.name}</a></td>
                  <td>{CUISINES[d.cuisine]}</td>
                  <td className="num dim">{d.portionG}g · {d.prepMin}分{d.makeable ? " 可预制" : ""}{fill !== 10000 && <span className="tag warn">用料{(fill / 100).toFixed(0)}%</span>}</td>
                  <td className="num dim">{yuan(d.suggestLowCents)}~{yuan(d.suggestHighCents)}</td>
                  <td className="num">{yuan(cost)}</td>
                  <td>
                    <NumberInput value={mi ? mi.priceCents / 100 : 0} min={0.5} step={0.5}
                      onChange={(v) => act({ type: "SET_PRICE", dishId: d.id, priceCents: Math.round(v * 100) })}
                      suffix={curSym(b.cityId)} />
                  </td>
                  <td className={"num " + (margin >= 55 ? "good" : margin < 25 ? "bad" : "")}>{margin}%</td>
                  <td className="num">{statsOf(d.id) || "—"}</td>
                  <td>{!sellable ? <span className="tag">未研究</span> : makeable ? <span className="good">可出餐</span> : <span className="bad">缺料</span>}</td>
                  <td>
                    {!sellable ? (
                      <span className="tag" title="去“菜品研究”解锁">🔒 需研究</span>
                    ) : (
                      <button className={"btn-xs " + (mi?.active ? "on" : "")} onClick={() => act({ type: "TOGGLE_DISH", dishId: d.id })}>
                        {mi?.active ? "在售" : "上架"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {detail && <DishDetail dishId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PurchaseSuggestCardRemoved() { void suggestPurchase; }
void PurchaseSuggestCardRemoved;

function DishDetail(props: { dishId: string; onClose: () => void }) {
  const { s, b, act } = useGame();
  const d = DISH_BY_ID[props.dishId];
  const mi = b.menu[props.dishId];
  const mod = mi?.recipeBp ?? {};
  const stat = b.reports[0]?.dishStats.find((x) => x.dishId === d.id);
  const fill = recipeFillBp(b, d.id);
  const curCost = marketCogsOfDish(b, d.id);
  const city = CITY_BY_ID[b.cityId];
  const modified = fill !== 10000;
  return (
    <Modal title={`${d.name} · ${d.desc}`} onClose={props.onClose} wide footer={
      <>
        {modified && <button className="btn" disabled={b.phase !== "planning"} onClick={() => act({ type: "RESET_RECIPE", dishId: d.id })}>恢复标准配方</button>}
        <button className="btn-primary" onClick={props.onClose}>完成</button>
      </>
    }>
      <p className="dim">{d.category === "main" ? "主菜" : d.category} ｜ 技术难度 {d.difficulty} ｜ 基础口味 {d.baseFlavor} ｜ 辣度/热度 {d.heat} ｜ 标准份量 {d.portionG}g ｜ 研究状态：{isDishSellable(s, d.id) ? "已解锁（各分店可用）" : "🔒 未研究"}</p>
      <div className="legend">
        自行调整每种配料用量（{(RECIPE_TUNING.minBp / 100).toFixed(0)}%~{(RECIPE_TUNING.maxBp / 100).toFixed(0)}%）：整份用料 <b className={fill < RECIPE_TUNING.fillComfortBp ? "bad" : "good"}>{(fill / 100).toFixed(0)}%</b>。
        缩料省成本但掉锅气、主料砍狠重罚；本地份量偏好 {(city.portionPrefBp / 100).toFixed(0)}%{city.portionPrefBp >= 1100 ? "（大份量城市，被抓易挨骂）" : city.portionPrefBp <= 900 ? "（精品城市较宽容）" : ""}。
      </div>
      <table className="tbl">
        <thead><tr><th>配料</th><th className="num">标准用量</th><th className="num">实际用量</th><th className="num">本店现价成本</th><th className="num">本店库存</th><th>用量 %</th></tr></thead>
        <tbody>
          {d.recipe.map((r) => {
            const def = ING_BY_ID[r.ingId];
            const bp = mod[r.ingId] ?? 10000;
            const effQty = Math.round((r.qty * bp) / 10000);
            const cost = Math.round((effQty * b.market[r.ingId].priceCents) / def.perPurchase);
            return (
              <tr key={r.ingId} className={bp < 7000 ? "row-warn" : undefined}>
                <td>{def.name}{d.recipe[0].ingId === r.ingId && <span className="tag">主料</span>}</td>
                <td className="num dim">{qtyText(r.qty, def.unit)}</td>
                <td className={"num " + (bp !== 10000 ? (bp < 10000 ? "bad" : "good") : "")}>{qtyText(effQty, def.unit)}</td>
                <td className="num">{yuan(cost)}</td>
                <td className="num">{totalStock(b, r.ingId) >= effQty ? qtyText(totalStock(b, r.ingId), def.unit) : <span className="bad">不足</span>}</td>
                <td>
                  <NumberInput value={Math.round(bp / 100)} min={0} max={200} step={5}
                    onChange={(v) => act({ type: "SET_RECIPE", dishId: d.id, ingId: r.ingId, bp: Math.round(v * 100) })} suffix="%" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>调整后每份食材成本 <b>{yuan(curCost)}</b> 元（标准 {yuan(d.recipe.reduce((a, r) => a + Math.round((r.qty * b.market[r.ingId].priceCents) / ING_BY_ID[r.ingId].perPurchase), 0))} 元）
        ｜ 本店售价 {yuan(mi?.priceCents ?? 0)}{curSym(b.cityId)}，毛利率 {mi ? Math.round(((mi.priceCents - curCost) / Math.max(1, mi.priceCents)) * 100) : 0}%</p>
      {stat && <p className="dim">本店昨日：售 {stat.sold} 份，收入 {yuan(stat.revenueCents)} 元，贡献毛利 {yuan(stat.contributionCents)} 元，均分 {stat.ratingCount ? (stat.ratingSum / stat.ratingCount / 10).toFixed(1) : "—"}</p>}
    </Modal>
  );
}

// ============ 菜品研究 ============
export function ResearchPage() {
  const { s, b, act } = useGame();
  const [selected, setSelected] = useState<string[]>([]);
  const active = s.study.activeResearch ? DISH_BY_ID[s.study.activeResearch] : null;
  const stockIngs = INGREDIENTS.filter((d) => availableStock(b, d.id) > 0);
  return (
    <div className="page">
      <CitySwitch />
      {active && (
        <Card title={`正在研究：${active.name}（${CUISINES[active.cuisine]}）—— 在本店库存中选配料`} actions={
          <button className="btn-xs danger" onClick={() => { setSelected([]); act({ type: "RESEARCH_CANCEL" }); }}>放弃（学费不退）</button>
        }>
          <div className="legend">配方线索：「{active.desc || active.name}」。所选配料种类与配方<b>完全一致</b>且本店库存足够一份样品 → 研发成功（所有分店共享）；否则得到“令人困惑的实验菜”（事件处理）。已选 {selected.length} 种。</div>
          <div className="ing-pick">
            {stockIngs.map((d) => (
              <label key={d.id} className={"pick-item " + (selected.includes(d.id) ? "sel" : "")}>
                <input type="checkbox" checked={selected.includes(d.id)}
                  onChange={() => setSelected((cur) => cur.includes(d.id) ? cur.filter((x) => x !== d.id) : [...cur, d.id])} />
                <span>{d.name}<small className="dim">（{qtyText(availableStock(b, d.id), d.unit)}）</small></span>
              </label>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <span className="dim">已选：{selected.map((id) => ING_BY_ID[id].name).join("、") || "（无）"}</span>
            <button className="btn-primary" disabled={selected.length === 0}
              onClick={() => { act({ type: "RESEARCH_SUBMIT", ings: selected }); setSelected([]); }}>开火试做</button>
          </div>
        </Card>
      )}
      <Card title="菜系学习（学费按当前店当地货币折算，一次学习全局有效）">
        <div className="mkt-grid">
          {LEARNABLE_CUISINES.map((c) => {
            const learned = s.study.learned.includes(c);
            const costCny = RESEARCH.cuisineCostCents[c];
            const costLocal = toLocalCents(costCny, CITY_BY_ID[b.cityId].fxPerCnyBp);
            return (
              <div key={c} className={"mkt-item " + (learned ? "sel" : "")}>
                <b>{CUISINES[c]}</b>
                <p>学费 {yuan(costCny)} 元（本店支付 {yuan(costLocal)}{curSym(b.cityId)}） ｜ 菜品数 {dishesOfCuisine(c).length}</p>
                <p className="dim">{s.study.unlockedDishes.filter((id) => DISH_BY_ID[id].cuisine === c).length} / {dishesOfCuisine(c).length} 道已研究</p>
                {learned ? <span className="tag good">已学习</span>
                  : <button className="btn-xs ok" disabled={b.phase !== "planning" || b.cashCents < costLocal}
                    onClick={() => {
                      if (costCny >= 1000000 && !window.confirm(`支付 ${yuan(costCny)} 元（由${CITY_BY_ID[b.cityId].name}店现金承担）学习「${CUISINES[c]}」？`)) return;
                      act({ type: "LEARN_CUISINE", cuisine: c as CuisineId });
                    }}>拜师学习</button>}
              </div>
            );
          })}
        </div>
        <div className="legend">研究费：200 元/次（当地货币）。研究成果（学习/解锁）所有分店共享。</div>
      </Card>
      <Card title="菜品研究目录">
        {LEARNABLE_CUISINES.map((c) => {
          const learned = s.study.learned.includes(c);
          const dishes = dishesOfCuisine(c);
          return (
            <div key={c} style={{ marginBottom: 12 }}>
              <div className="dim" style={{ marginBottom: 4 }}>
                <b style={{ color: "var(--text)" }}>{CUISINES[c]}</b>
                {!learned && <span className="tag">未学习 · 学费 {yuan(RESEARCH.cuisineCostCents[c])} 元</span>}
              </div>
              <div className="btn-row">
                {dishes.map((d) => {
                  const un = s.study.unlockedDishes.includes(d.id);
                  return un
                    ? <span key={d.id} className="tag good">{d.name} ✓</span>
                    : <button key={d.id} className="btn-xs" disabled={!learned || !!s.study.activeResearch || b.phase !== "planning"}
                        title={learned ? `研究「${d.name}」（200元/次）线索：${d.desc || d.name}` : "先学习该菜系"}
                        onClick={() => act({ type: "RESEARCH_START", dishId: d.id })}>研究：{d.name}</button>;
                })}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ============ 员工管理 ============
export function StaffPage() {
  const { s, b, act } = useGame();
  const [confirmFire, setConfirmFire] = useState<number | null>(null);
  const city = CITY_BY_ID[b.cityId];
  const schedMgr = hasSchedulingManager(b, s.day);
  return (
    <div className="page">
      <CitySwitch />
      {schedMgr && (
        <div className="okbox">排班店长「{schedMgr.name}」在岗：每天开局自动接管本店排班——保障各时段厨师/服务员覆盖，疲劳&gt;50 者优先轮休（同日限量），无需你手动排班。</div>
      )}
      <Card title={`${city.name}店在编员工（${b.staff.length}人）`}>
        <div className="legend">工资按当地行情与当日排班计：完全未排班 = 当日工资 0（放假：疲劳-50、压力清零）。</div>
        <table className="tbl">
          <thead>
            <tr><th>姓名</th><th>岗位</th><th>熟练度</th><th>等级</th><th>日工资</th><th>体力/疲劳</th><th>压力</th><th>满意/忠诚</th><th>特质/专长</th><th>排班</th><th>培训</th><th>操作</th></tr>
          </thead>
          <tbody>
            {b.staff.map((e) => (
              <tr key={e.id} className={e.fatigue > 80 ? "row-warn" : undefined}>
                <td>{e.name}{e.trainingUntilDay > s.day ? <span className="tag">培训中</span> : ""}{e.pendingLeaveDay ? <span className="tag bad">明离职</span> : ""}</td>
                <td>{ROLE_NAMES[e.role]}</td>
                <td><Bar value={e.skill} /><span className="num">{e.skill}</span></td>
                <td className="num">Lv{e.level}</td>
                <td className="num">{yuan(dailyWageCents(e))}{e.shifts.length === 0 && <span className="tag">当日无薪</span>}</td>
                <td><Bar value={100 - e.fatigue} color={e.fatigue > 80 ? "#e0745a" : "#5aa9e0"} />{e.fatigue}</td>
                <td>{e.stress}</td>
                <td>{e.satisfaction}/{e.loyalty}</td>
                <td className="dim">{e.trait}·{e.specialty}{e.role === "manager" && e.specialty === "排班" ? "⭐" : ""}</td>
                <td>
                  {ALL_SLOTS.map((sl) => (
                    <label key={sl} className="chk mini">
                      <input type="checkbox" checked={e.shifts.includes(sl)}
                        onChange={() => {
                          const shifts: SlotId[] = e.shifts.includes(sl) ? e.shifts.filter((x) => x !== sl) : [...e.shifts, sl];
                          act({ type: "ASSIGN_SHIFTS", empId: e.id, shifts });
                        }} />{slotLabel(sl)}
                    </label>
                  ))}
                </td>
                <td><button className="btn-xs" disabled={b.phase !== "planning" || e.trainingUntilDay > s.day} onClick={() => act({ type: "TRAIN", empId: e.id })}>{yuan(Math.round(STAFF.trainingCostCents * (1 + e.skill / 100)))}元 培训2天+4</button></td>
                <td><button className="btn-xs danger" disabled={b.phase !== "planning"} onClick={() => setConfirmFire(e.id)}>请离</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title={`${city.name}招聘市场（每${STAFF.poolRefreshDays}天刷新 · 下次第${b.poolGenerationDay + STAFF.poolRefreshDays}天；工资随当地行情）`}>
        {b.candidatePool.length === 0 && <div className="dim">候选池刷新中……</div>}
        <table className="tbl">
          <thead><tr><th>姓名</th><th>岗位</th><th>熟练度</th><th>期望日薪</th><th>招聘费</th><th>特质/专长</th><th>操作</th></tr></thead>
          <tbody>
            {b.candidatePool.map((c) => (
              <tr key={c.poolId}>
                <td>{c.name}</td>
                <td>{ROLE_NAMES[c.role]}</td>
                <td><Bar value={c.skill} /><span className="num">{c.skill}</span></td>
                <td className="num">{yuan(c.wageCents)}（市场参考 {yuan(localWage(s, b.cityId, c.role, c.skill))}）</td>
                <td className="num">{yuan(c.hireFeeCents)}</td>
                <td className="dim">{c.trait}·{c.specialty}{c.role === "manager" && c.specialty === "排班" ? <span className="tag good">排班店长⭐</span> : ""}</td>
                <td><button className="btn-xs ok" disabled={b.phase !== "planning"} onClick={() => act({ type: "HIRE", poolId: c.poolId })}>录用</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim">每店候选池都会刷出一名「排班」特长的店长候选；上岗后自动接管该店排班与轮休。</p>
      </Card>
      {confirmFire !== null && (
        <Confirm danger
          text={`确定辞退 ${b.staff.find((x) => x.id === confirmFire)?.name}？需支付一周工资 ${yuan((b.staff.find((x) => x.id === confirmFire)?.baseWageCents ?? 0) * 7)} 元当地货币遣散费。`}
          onCancel={() => setConfirmFire(null)}
          onOk={() => { act({ type: "FIRE", empId: confirmFire }); setConfirmFire(null); }} />
      )}
    </div>
  );
}

// ============ 装修与规模（商圈阶梯） ============
export function DecorPage() {
  const { s, b, act } = useGame();
  const [cf, setCf] = useState<null | { label: string; danger?: boolean; run: () => void }>(null);
  const city = CITY_BY_ID[b.cityId];
  const idx = city.districts.findIndex((d) => d.id === b.districtId);
  const next = city.districts[idx + 1];
  return (
    <div className="page">
      <CitySwitch />
      <div className="stat-row">
        <Stat label="所在商圈" value={city.districts[idx].name} sub={`${b.store.seats}座 ${b.store.stations}灶`} />
        <Stat label="环境档次" value={String(b.store.decor)} sub="影响进店与满意度" />
        <Stat label="卫生" value={`${b.store.hygiene}/100`} tone={b.store.hygiene < 50 ? "bad" : "good"} />
        <Stat label="设备健康" value={`${b.store.equipmentHealth}/100`} tone={b.store.equipmentHealth < 40 ? "bad" : undefined} sub="影响产能上限与出错率" />
      </div>
      <Card title={`门店规模（${city.name}商圈阶梯）：迁往下一商圈需支付盘店/装修启动费`}>
        <table className="tbl">
          <thead><tr><th>商圈</th><th className="num">客流系数</th><th className="num">座位/炉灶</th><th className="num">日租(本店口径)</th><th>状态/操作</th></tr></thead>
          <tbody>
            {city.districts.map((d, i) => (
              <tr key={d.id} className={i > idx + 1 ? "row-off" : undefined}>
                <td>{d.name}</td>
                <td className="num">{(d.trafficModBp / 100).toFixed(0)}%</td>
                <td className="num">{d.seats} / {d.stations}</td>
                <td className="num">{yuan(toLocalCents(Math.round((d.rentCents * city.rentFactorBp) / 10000), city.fxPerCnyBp))}{curSym(city.id)}</td>
                <td>
                  {i === idx ? <span className="tag good">当前</span>
                    : i === idx + 1 ? (
                      <button className="btn-xs ok" disabled={b.phase !== "planning"}
                        onClick={() => setCf({
                          danger: true,
                          label: `迁往「${d.name}」：支付启动费 ${yuan(toLocalCents(d.setupCostCents, city.fxPerCnyBp))}${curSym(b.cityId)}，日租升至 ${yuan(toLocalCents(Math.round((d.rentCents * city.rentFactorBp) / 10000), city.fxPerCnyBp))}${curSym(b.cityId)}/日，座位${d.seats} 炉灶${d.stations}。确认扩张？`,
                          run: () => act({ type: "MOVE_DISTRICT", districtId: d.id }),
                        })}>迁入（{yuan(toLocalCents(d.setupCostCents, city.fxPerCnyBp))}{curSym(b.cityId)}）</button>
                    ) : <span className="dim">需先迁入上一档</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="装修升级">
        <table className="tbl">
          <thead><tr><th>方案</th><th className="num">费用(人民币)</th><th>效果</th><th></th></tr></thead>
          <tbody>
            {DECOR.upgradeOptions.map((o) => (
              <tr key={o.level}>
                <td>{o.label}</td>
                <td className="num">{yuan(o.costCents)} 元（本店支付 {yuan(toLocalCents(o.costCents, city.fxPerCnyBp))}{curSym(b.cityId)}）</td>
                <td className="dim">环境+{o.decor} 卫生+{o.hygiene}{"station" in o && o.station ? ` 炉灶+${o.station} → 厨房产线理论上限提高，配合厨师/排班可显著增加出餐量` : ""}</td>
                <td>
                  <button className="btn-xs ok" disabled={b.phase !== "planning" || b.cashCents < toLocalCents(o.costCents, city.fxPerCnyBp)}
                    onClick={() => setCf({ label: `花费 ${yuan(toLocalCents(o.costCents, city.fxPerCnyBp))}${curSym(b.cityId)} 执行「${o.label}」？`, run: () => act({ type: "DECOR_UPGRADE", level: o.level }) })}>施工</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="营业时段与限单">
        <div className="btn-row">
          {ALL_SLOTS.map((sl) => {
            const on = b.store.openSlots.includes(sl);
            return (
              <button key={sl} className={"btn-xs " + (on ? "on" : "")} disabled={b.phase !== "planning"}
                onClick={() => {
                  const slots = on ? b.store.openSlots.filter((x) => x !== sl) : [...b.store.openSlots, sl];
                  if (slots.length === 0) return;
                  act({ type: "SET_OPEN_SLOTS", slots: slots as SlotId[] });
                }}>
                {slotLabel(sl)}
              </button>
            );
          })}
          <button className="btn" disabled={b.phase !== "planning"} onClick={() => setCf({ label: "常规设备保养 500 元，设备健康 +10。确认？", run: () => act({ type: "TAKE_REPAIR" }) })}>设备保养 500元</button>
        </div>
        <LimitOrdersRow />
      </Card>
      {cf && <Confirm danger={cf.danger} text={cf.label} onCancel={() => setCf(null)} onOk={() => { cf.run(); setCf(null); }} />}
    </div>
  );
}

function LimitOrdersRow() {
  const { s, b, act } = useGame();
  const [v, setV] = useState(b.store.orderLimitCovers);
  return (
    <div className="btn-row" style={{ marginTop: 10 }}>
      <span className="dim">限单（当日最大接待桌数，0=不限）：</span>
      <NumberInput value={v} min={0} max={2000} step={5} onChange={setV} suffix="桌" />
      <button className="btn-xs ok" disabled={b.phase !== "planning" || v === b.store.orderLimitCovers} onClick={() => act({ type: "SET_ORDER_LIMIT", covers: v })}>应用限单</button>
      {b.store.orderLimitCovers > 0 && (
        <button className="btn-xs" disabled={b.phase !== "planning"} onClick={() => { setV(0); act({ type: "SET_ORDER_LIMIT", covers: 0 }); }}>取消限单</button>
      )}
      <span className="dim">当前：{b.store.orderLimitCovers > 0 ? `${b.store.orderLimitCovers} 桌/日` : "不限"}</span>
    </div>
  );
}

// ============ 营销 ============
export function MarketingPage() {
  const { s, b, act } = useGame();
  const [defId, setDefId] = useState<string | null>(null);
  const [tier, setTier] = useState("mid");
  const [seg, setSeg] = useState("all");
  const [cf, setCf] = useState<null | { label: string; run: () => void }>(null);
  const activeIds = new Set(b.marketing.active.map((c) => c.defId));
  return (
    <div className="page">
      <CitySwitch />
      <Card title={`${CITY_BY_ID[b.cityId].name}店营销（预算=内容质量；受众匹配、本店口碑、当地竞争影响成功率与幅度；促销按折后真实收入记账）`}>
        <div className="mkt-grid">
          {MARKETING_CAMPAIGNS.map((d) => {
            const q = quoteCampaign(s, b, d.id, tier, d.segTargetable ? seg : "all");
            const isActive = activeIds.has(d.id);
            const holidayBlocked = !!d.requireHoliday && !nearHoliday(s);
            return (
              <div key={d.id} className={"mkt-item " + (defId === d.id ? "sel" : "")} onClick={() => setDefId(d.id)}>
                <b>{d.name}</b>
                <p className="dim">{d.desc}</p>
                <p>预算 {yuan(q.costCents)}{curSym(b.cityId)}（≈{yuan(q.costCnyCents)}元）｜ {d.days} 天</p>
                <p>理论成功率 <b>{(q.successBp / 100).toFixed(0)}%</b> ｜ 受众匹配 {(q.matchBp / 100).toFixed(0)}%</p>
                <p>{d.discountBp ? `全场 ${d.discountBp / 100} 折（折后价即实收）` : `客流基准 +${(d.boostAddBp / 100).toFixed(0)}%`}{d.memberMultBp ? " ｜ 回头客×1.4" : ""}</p>
                <p className={isActive || holidayBlocked ? "bad" : "dim"}>
                  {isActive ? "本店执行中" : holidayBlocked ? "需临近节假日" : `成功时预估日均 +${q.estUpliftOrders} 桌`}
                </p>
              </div>
            );
          })}
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <span className="dim">预算档位：</span>
          {MARKETING_TIERS.map((t) => <button key={t.id} className={"btn-xs " + (tier === t.id ? "on" : "")} onClick={() => setTier(t.id)}>{t.name}</button>)}
          <span className="dim">目标受众：</span>
          <select value={defId && campaignById(defId)?.segTargetable ? seg : "all"} disabled={!defId || !campaignById(defId)?.segTargetable} onChange={(e) => setSeg(e.target.value)}>
            <option value="all">大众投放</option>
            {SEGMENTS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button className="btn-primary" disabled={b.phase !== "planning" || !defId}
            onClick={() => {
              if (!defId) return;
              const d = campaignById(defId)!;
              const t = tierById(tier);
              const cost = Math.round((d.costCents * t.costMultBp) / 10000);
              if (cost >= 100000) setCf({ label: `大额营销确认：${CITY_BY_ID[b.cityId].name}店投入约 ${yuan(cost)} 元投放「${d.name}（${t.name}）」。资金即刻扣除、不可撤回，成功与否由引擎判定。确认？`, run: () => act({ type: "LAUNCH_MARKETING", defId, tier, targetSeg: d.segTargetable ? seg : "all" }) });
              else act({ type: "LAUNCH_MARKETING", defId, tier, targetSeg: d.segTargetable ? seg : "all" });
            }}>
            投放营销
          </button>
        </div>
      </Card>
      <Card title={`本店执行中的营销（${b.marketing.active.length}）`}>
        {b.marketing.active.length === 0 && <div className="dim center">暂无进行中的营销。</div>}
        {b.marketing.active.length > 0 && (
          <table className="tbl">
            <thead><tr><th>活动</th><th>档位/受众</th><th className="num">投入</th><th>实际效果</th><th className="num">剩余天数</th><th className="num">归因增量桌</th><th className="num">归因增量销售</th><th className="num">归因增量毛利</th></tr></thead>
            <tbody>
              {b.marketing.active.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="dim">{tierById(c.tier).name} · {c.targetSeg === "all" ? "大众" : SEGMENTS.find((x) => x.id === c.targetSeg)?.name ?? c.targetSeg}</td>
                  <td className="num">{yuan(c.costCents)}</td>
                  <td>
                    {c.outcome === "success" && <span className="tag good">生效 {c.appliedBoostBp ? `${((c.appliedBoostBp - 10000) / 100).toFixed(1)}%客流` : ""}{c.discountBp !== 10000 ? ` ${c.discountBp / 100}折` : ""}{c.memberMultBp !== 10000 ? " 会员转化↑" : ""}</span>}
                    {c.outcome === "flop" && <span className="tag bad">翻车 {(c.appliedBoostBp - 10000) / 100}%</span>}
                    {c.outcome === "noeffect" && <span className="tag">无水花（沉没成本）</span>}
                  </td>
                  <td className="num">{Math.max(0, c.endDay - s.day + 1)} 天</td>
                  <td className="num">{c.servedExtra}</td>
                  <td className="num">{yuan(c.revenueExtraCents)}</td>
                  <td className="num">{yuan(c.grossExtraCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="本店结案报告">
        {b.marketing.history.length === 0 && <div className="dim center">暂无已结案营销。</div>}
        {b.marketing.history.length > 0 && (
          <table className="tbl">
            <thead><tr><th>活动</th><th className="num">投入</th><th className="num">增量桌</th><th className="num">增量销售</th><th className="num">增量毛利</th><th className="num">毛利−投入</th><th className="num">回头客留存</th><th>结果</th></tr></thead>
            <tbody>
              {b.marketing.history.map((c) => {
                const net = c.grossExtraCents - c.costCents;
                return (
                  <tr key={c.id}>
                    <td>{c.name}<small className="dim"> 第{c.startDay}~{c.endDay}天</small></td>
                    <td className="num">{yuan(c.costCents)}</td>
                    <td className="num">{c.servedExtra}</td>
                    <td className="num">{yuan(c.revenueExtraCents)}</td>
                    <td className="num">{yuan(c.grossExtraCents)}</td>
                    <td className={"num " + (net >= 0 ? "good" : "bad")}>{yuan(net)}</td>
                    <td className="num">{c.newRegulars}</td>
                    <td>{c.outcome === "success" ? <span className="good">生效</span> : c.outcome === "flop" ? <span className="bad">翻车</span> : <span className="dim">未起量</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {cf && <Confirm text={cf.label} onCancel={() => setCf(null)} onOk={() => { cf.run(); setCf(null); }} />}
    </div>
  );
}

import { MARKETING } from "../game/config";
const MARKETING_CAMPAIGNS = MARKETING.campaigns;
const MARKETING_TIERS = MARKETING.tiers;

// ============ 事件 ============
export function EventsPage() {
  const { s, act } = useGame();
  const [answers, setAnswers] = useState<Record<number, Record<string, string>>>({});
  const [amt, setAmt] = useState<Record<number, number>>({});
  return (
    <div className="page">
      <Card title={`待处理事件（${s.events.pending.length}，全部城市；无需切换，看城市标签）`}>
        {s.events.pending.length === 0 && <div className="dim center">今日无待办事件。</div>}
        {s.events.pending.map((p) => {
          const isInterview = p.defId === "interview_visitor";
          return (
            <div key={p.eventUid} className="event-card">
              <div className="event-title">
                <span className="tag">{CITY_BY_ID[p.cityId]?.name ?? p.cityId}</span>
                {defType(p.defId) && <span className="tag">{defType(p.defId)}</span>}
                {p.title}{p.blocking && <span className="tag bad">阻塞该店确认</span>}
              </div>
              <p>{p.desc}</p>
              {p.data.detail != null && String(p.data.detail) !== "" && <p className="dim">{String(p.data.detail)}</p>}
              {isInterview ? (
                <InterviewForm
                  uid={p.eventUid}
                  qIds={[String(p.data.q0), String(p.data.q1), String(p.data.q2)]}
                  bg={s.boss.background}
                  answers={answers[p.eventUid] ?? {}}
                  setAnswers={(a) => setAnswers((all) => ({ ...all, [p.eventUid]: a }))}
                  onSubmit={(ansStr) => act({ type: "RESOLVE_EVENT", uid: p.eventUid, optionId: "answer", payload: { answers: ansStr } })}
                />
              ) : (
                <div className="btn-row">
                  {p.options.map((o) => o.payloadKey === "amount" ? (
                    <span key={o.id} className="btn-row" style={{ gap: 5 }}>
                      <span className="dim">{o.label}：</span>
                      <NumberInput value={amt[p.eventUid] ?? 0} min={0} step={100} onChange={(v) => setAmt((m) => ({ ...m, [p.eventUid]: v }))} suffix="元(当地)" />
                      <button className="btn-xs ok"
                        onClick={() => act({ type: "RESOLVE_EVENT", uid: p.eventUid, optionId: o.id, payload: { amountCents: String(Math.round((amt[p.eventUid] ?? 0) * 100)) } })}>支付</button>
                    </span>
                  ) : (
                    <button key={o.id} className="btn-xs ok" onClick={() => act({ type: "RESOLVE_EVENT", uid: p.eventUid, optionId: o.id })}>{o.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
      <Card title="博主记录">
        {s.bloggerLog.length === 0 && <div className="dim">还没有博主来过。</div>}
        <table className="tbl">
          <thead><tr><th>日期</th><th>城市</th><th>类型</th><th>博主</th><th>粉丝</th><th>受众匹配</th><th>应对</th></tr></thead>
          <tbody>
            {s.bloggerLog.map((bl, i) => (
              <tr key={i}><td>第{bl.day}天</td><td>{CITY_BY_ID[bl.cityId]?.name ?? bl.cityId}</td><td>{bl.kind}</td><td>{bl.name}</td>
                <td className="num">{bl.followers.toLocaleString()}{bl.followers < 1000 && bl.kind === "探店" ? <span className="tag">粉丝不足1000·无持续加成</span> : ""}</td>
                <td className="num">{(bl.audienceMatchBp / 100).toFixed(0)}%</td><td>{bl.response}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="事件历史">
        <table className="tbl">
          <thead><tr><th>日期</th><th>城市</th><th>类型</th><th>事件</th><th>处理</th><th>状态</th></tr></thead>
          <tbody>
            {s.events.history.slice(-30).reverse().map((h, i) => (
              <tr key={i}><td>第{h.day}天</td><td>{CITY_BY_ID[h.cityId]?.name ?? h.cityId}</td><td>{defType(h.defId)}</td><td>{zhEvent(h.defId)}</td><td className="dim">{zhOption(h.defId, h.optionId)}</td><td className="good">已完成</td></tr>
            ))}
            {s.events.history.length === 0 && <tr><td colSpan={6} className="dim center">暂无记录</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function InterviewForm(props: {
  uid: number; qIds: string[]; bg: string;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  onSubmit: (ansStr: string) => void;
}) {
  const qs = props.qIds.map((id) => INTERVIEW_QUESTIONS.find((q) => q.id === id)!).filter(Boolean);
  const allAnswered = qs.every((q) => props.answers[q.id]);
  return (
    <div className="interview">
      {qs.map((q) => (
        <div key={q.id} className="iq">
          <div className="iq-title">Q：{q.text}</div>
          {q.options
            .filter((o) => !q.bgScoped || o.id === `q_why_${props.bg}` || o.id === "q_why_cold")
            .map((o) => (
              <label key={o.id} className="radio">
                <input type="radio" name={"q" + props.uid + q.id} checked={props.answers[q.id] === o.id}
                  onChange={() => props.setAnswers({ ...props.answers, [q.id]: o.id })} />
                {o.label}
              </label>
            ))}
        </div>
      ))}
      <button className="btn-primary" disabled={!allAnswered}
        onClick={() => props.onSubmit(qs.map((q) => props.answers[q.id]).join(","))}>回答完毕</button>
      <p className="dim">博主将回答剪成视频发布，效果取决于传播时机的把握……</p>
    </div>
  );
}

// ============ 财务 ============
export function FinancePage() {
  const { s, b } = useGame();
  const [day, setDay] = useState<number>(b.reports[0]?.day ?? s.day);
  const city = CITY_BY_ID[b.cityId];
  const nwB = branchNetWorthLocal(b);
  const lt = lifetime(s);
  const pnl = pnlForDay(b, day);
  const cf = cashflowForDay(b, day);
  const [acctFilter, setAcctFilter] = useState("all");
  const ledgerView = useMemo(
    () => b.ledger.filter((e) => acctFilter === "all" || e.account === acctFilter).slice(-120).reverse(),
    [b.ledger, acctFilter],
  );
  const totalCny = Object.values(s.branches).reduce((a, x) => a + toCnyCents(x.cashCents, CITY_BY_ID[x.cityId].fxPerCnyBp), 0);
  return (
    <div className="page">
      <CitySwitch />
      <div className="stat-row">
        <Stat label={`${city.name}店现金`} value={money(s, b.cashCents)} sub={`折合 ${yuan(toCnyCents(b.cashCents, city.fxPerCnyBp))} 元`} tone={b.cashCents < 100000 ? "bad" : "good"} />
        <Stat label="本店库存资产" value={money(s, netInv(b))} />
        <Stat label="本店设备残值" value={money(s, equipmentValueCents(b))} />
        <Stat label="本店负债" value={money(s, loanOwedCents(b))} tone={loanOwedCents(b) > 0 ? "warn" : undefined} />
        <Stat label="本店净资产" value={money(s, nwB)} sub={`折合 ${yuan(toCnyCents(nwB, city.fxPerCnyBp))} 元`} />
        <Stat label="集团现金(折合)" value={`${yuan(totalCny)} 元`} />
        <Stat label="累计营收/成本(集团,折合元)" value={`${yuan(lt.revenue)} / ${yuan(lt.cost)}`} sub={`${lt.days} 天`} />
      </div>
      <Card title={`${city.name}店日损益表`} actions={
        <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {b.reports.map((r) => <option key={r.day} value={r.day}>第{r.day}天（{r.dateLabel}）</option>)}
        </select>
      }>
        <div className="grid2">
          <table className="tbl">
            <thead><tr><th>科目</th><th className="num">金额（{curSym(city.id)}）</th></tr></thead>
            <tbody>
              {pnl.rows.map((r) => <tr key={r.account}><td>{r.name}</td><td className={"num " + (r.cents >= 0 ? "good" : "")}>{yuan(r.cents)}</td></tr>)}
              <tr className="total"><td>净利润</td><td className={"num " + (pnl.netCents >= 0 ? "good" : "bad")}>{yuan(pnl.netCents)}</td></tr>
            </tbody>
          </table>
          <table className="tbl">
            <thead><tr><th>现金流科目</th><th className="num">金额（{curSym(city.id)}）</th></tr></thead>
            <tbody>
              {cf.rows.map((r) => <tr key={r.account}><td>{r.name}</td><td className={"num " + (r.cents >= 0 ? "good" : "")}>{yuan(r.cents)}</td></tr>)}
              <tr className="total"><td>现金净变动</td><td className={"num " + (cf.netCents >= 0 ? "good" : "bad")}>{yuan(cf.netCents)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="dim">采购/周转（现金流出）形成库存资产或跨店调拨，只有被菜品消耗时才计入损益；过期与报废单独计损耗。</p>
      </Card>
      <Card title="本店总账（最近120条）" actions={
        <select value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)}>
          <option value="all">全部科目</option>
          <option value="revenue">营业收入</option><option value="purchase">采购付款</option>
          <option value="cogs">食材消耗</option><option value="wage">工资</option>
          <option value="rent">房租</option><option value="utility">水电</option>
          <option value="family">家庭支出</option><option value="event">事件损益</option>
          <option value="transferIn">转账注入</option><option value="transferOut">周转转出</option>
          <option value="spoil">损耗</option><option value="refund">退款赔偿</option>
          <option value="marketing">营销</option><option value="research">菜品研究</option>
          <option value="other">其他</option>
        </select>
      }>
        <table className="tbl">
          <thead><tr><th>日</th><th>科目</th><th className="num">金额</th><th>现金</th><th>备注</th></tr></thead>
          <tbody>
            {ledgerView.map((e, i) => (
              <tr key={i}><td>第{e.day}天</td><td>{e.account}</td>
                <td className={"num " + (e.amountCents >= 0 ? "good" : "")}>{yuan(e.amountCents)}</td>
                <td>{e.cash ? "现金" : "应计"}</td><td className="dim">{e.memo}</td></tr>
            ))}
            {ledgerView.length === 0 && <tr><td colSpan={5} className="dim center">暂无记录</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function netInv(b: GameState["branches"][string]): number {
  return Object.values(b.inventory).flat().reduce((a, l) => a + Math.round((l.qty * l.unitPriceCents) / l.perPurchase), 0);
}

// ============ 城市扩张 ============
export function CityPage() {
  const { s, act, toast } = useGame();
  const worth = netWorthCents(s);
  const opened = Object.keys(s.branches);
  return (
    <div className="page">
      <Card title="城市地图（第二阶段：多城经营。净资产达到门槛即可开设分店，仍需支付加盟费+押金）">
        <div className="stat-row" style={{ marginBottom: 10 }}>
          <Stat label="集团净资产（全部店折合）" value={`${yuan(worth)} 元`} tone="good" sub={`现金合计 ${yuan(Object.values(s.branches).reduce((a, x) => a + toCnyCents(x.cashCents, CITY_BY_ID[x.cityId].fxPerCnyBp), 0))} 元`} />
        </div>
        <table className="tbl">
          <thead><tr><th>城市</th><th>货币/汇率</th><th className="num">基础客流</th><th>定位</th><th className="num">解锁门槛(净资产)</th><th className="num">开干成本</th><th>状态</th></tr></thead>
          <tbody>
            {CITY_LIST.map((c) => {
              const isOpen = opened.includes(c.id);
              const meetWorth = worth >= c.unlockNetWorthCents;
              return (
                <tr key={c.id} className={!isOpen && !meetWorth ? "row-off" : undefined}>
                  <td><b>{c.name}</b><div className="dim">{c.districts.map((d) => d.name).join(" → ")}</div></td>
                  <td>{c.currency}<div className="dim">1元={(c.fxPerCnyBp / 1000).toFixed(2)}{c.currency}</div></td>
                  <td className="num">{c.baseDailyTraffic}</td>
                  <td className="dim">{c.positioning}</td>
                  <td className="num">{yuan(c.unlockNetWorthCents)}</td>
                  <td className="num">{yuan(c.openCostCents + c.districts[0].setupCostCents)}</td>
                  <td>
                    {isOpen ? (
                      <button className={"btn-xs " + (s.activeCityId === c.id ? "on" : "")} onClick={() => act({ type: "SWITCH_CITY", cityId: c.id })}>
                        {s.activeCityId === c.id ? "当前" : "切换"}
                      </button>
                    ) : meetWorth ? (
                      <button className="btn-xs ok" onClick={() => {
                        toast(`准备在${c.name}开分店：费用将从【${CITY_BY_ID[s.activeCityId].name}】店现金支出（按汇率折算）`);
                        act({ type: "OPEN_BRANCH", cityId: c.id });
                      }}>开设分店</button>
                    ) : <span className="bad">未达标</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="dim">新分店初始 0 现金 0 库存 0 员工：先「资金周转」调启动资金，再招聘、采购、上架（研究已解锁的菜品所有店共享，定价各店独立按当地货币）。市场趋势与供应商价格各地独立演化。</p>
      </Card>
      <Card title="各分店概况">
        <table className="tbl">
          <thead><tr><th>分店</th><th>商圈</th><th className="num">现金(当地)</th><th className="num">现金(折合元)</th><th className="num">口碑</th><th className="num">昨日净利(当地)</th><th className="num">员工</th></tr></thead>
          <tbody>
            {opened.map((cid) => {
              const bb = s.branches[cid];
              const lastR = bb.reports[0];
              return (
                <tr key={cid}>
                  <td>{CITY_BY_ID[cid].name}店</td>
                  <td>{CITY_BY_ID[cid].districts.find((d) => d.id === bb.districtId)?.name}</td>
                  <td className="num">{yuan(bb.cashCents)}{curSym(cid)}</td>
                  <td className="num">{yuan(toCnyCents(bb.cashCents, CITY_BY_ID[cid].fxPerCnyBp))}</td>
                  <td className="num">{(bb.reputation / 10).toFixed(1)}</td>
                  <td className="num">{lastR ? `${lastR.netProfitCents >= 0 ? "+" : ""}${yuan(lastR.netProfitCents)}${curSym(cid)}` : "—"}</td>
                  <td className="num">{bb.staff.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

import { CITIES } from "../game/data/cities";
const CITY_LIST = CITIES;

// ============ 存档 ============
export function SavePage(props: { adapter: StorageAdapter; setConfirm: (c: { text: string; danger?: boolean; onOk: () => void }) => void }) {
  const { s, act, toast } = useGame();
  const [slots, setSlots] = useState<{ slot: string; savedAt: number; day: number; cashCnyCents: number; restaurant: string }[]>([]);
  const refresh = async () => setSlots(await listSlots(props.adapter));
  useMemo(() => { refresh(); }, []);
  return (
    <div className="page">
      <Card title="存档系统">
        <div className="legend">自动存档：每次操作后写入 IndexedDB（刷新/关闭浏览器不丢失）。手动存档可保存多个快照；读取会覆盖当前进度。v1旧档自动迁移为多分店结构。</div>
        <table className="tbl">
          <thead><tr><th>存档位</th><th>餐馆</th><th>天数</th><th>现金(折合)</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            {slots.map((sl) => (
              <tr key={sl.slot}>
                <td>{sl.slot === AUTO_SLOT ? "自动存档" : sl.slot}</td>
                <td>{sl.restaurant}</td>
                <td>第{sl.day}天</td>
                <td className="num">{yuan(sl.cashCnyCents)}元</td>
                <td className="dim">{sl.savedAt ? new Date(sl.savedAt).toLocaleString() : "—"}</td>
                <td className="btn-row">
                  {sl.slot !== AUTO_SLOT && <button className="btn-xs" onClick={() => props.setConfirm({
                    text: "读取该存档将覆盖当前进度（当前进度不会自动保存），确认？", danger: true,
                    onOk: async () => {
                      const res = await loadGame(props.adapter, sl.slot);
                      if (res.ok && res.state) { act({ type: "LOAD_STATE", state: res.state }); toast("存档已读取" + (res.migrated ? "（已迁移旧版本）" : "")); }
                      else toast(res.error ?? "读取失败", "err");
                    },
                  })}>读取</button>}
                  <button className="btn-xs danger" onClick={() => props.setConfirm({
                    text: `删除存档「${sl.slot}」？此操作不可恢复。`, danger: true,
                    onOk: async () => { await deleteSlot(props.adapter, sl.slot); refresh(); toast("已删除"); },
                  })}>删除</button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && <tr><td colSpan={6} className="dim center">暂无存档</td></tr>}
          </tbody>
        </table>
        <div className="btn-row">
          {MANUAL_SLOTS.map((slot) => (
            <button key={slot} className="btn" onClick={async () => { await saveGame(props.adapter, slot, s); refresh(); toast(`已保存到 ${slot}`); }}>
              手动保存到 {slot}
            </button>
          ))}
        </div>
      </Card>
      <Card title="危险区">
        <button className="btn-danger" onClick={() => props.setConfirm({
          text: "开始新游戏将丢弃当前进度（自动存档会被覆盖）。请先手动保存重要进度。确认放弃当前餐馆？", danger: true,
          onOk: () => act({ type: "NEW_GAME_RESET" }),
        })}>放弃当前进度，重新开局</button>
        <p className="dim">存档版本：v{s.saveVersion}。金额按当地货币整数分存储，跨城按汇率整数换算，库存按批次独立记录购入日。</p>
      </Card>
    </div>
  );
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
