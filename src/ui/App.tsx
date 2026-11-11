import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, GameState } from "../game/types";
import { dispatch, type Action } from "../game/reducer";
import { checkPlan, forecastLine, pendingSettleCities, roughCapacity, estimateDemand } from "../game/engine/dayflow";
import { netWorthCents, totalCashCny } from "../game/engine/finance";
import { idbAdapter, loadGame, saveGame } from "../game/engine/save";
import { yuan } from "../game/utils";
import { WEATHER, CALENDAR, PERSONALITIES, BACKGROUNDS } from "../game/config";
import { CITY_BY_ID, CURRENCY_SYMBOL, toCnyCents } from "../game/data/cities";
import { CreateScreen, type CreateForm } from "./Create";
import { SettlementModal, GameOverOverlay } from "./Settlement";
import { OverviewPage, MarketPage, MenuPage, ResearchPage, StaffPage, DecorPage, MarketingPage, EventsPage, FinancePage, CityPage, SavePage } from "./Pages";
import { Confirm } from "./widgets";
import "./ui.css";

type NavId = "overview" | "market" | "menu" | "research" | "staff" | "decor" | "marketing" | "events" | "finance" | "city" | "save";

interface AppCtx {
  s: GameState;
  b: Branch;
  act: (a: Action) => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
  setNav: (n: NavId) => void;
}
const Ctx = createContext<AppCtx>(null as never);
export const useGame = () => useContext(Ctx);

export function curSym(cityId: string): string { return CURRENCY_SYMBOL[CITY_BY_ID[cityId]?.currency] ?? "元"; }
export function money(s: GameState, cents: number, cityId?: string): string {
  const cid = cityId ?? s.activeCityId;
  return `${yuan(cents)}${curSym(cid)}`;
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [nav, setNav] = useState<NavId>("overview");
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [showSettle, setShowSettle] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState<{ text: string; danger?: boolean; onOk: () => void } | null>(null);
  const toastId = useRef(1);
  const adapter = useMemo(() => idbAdapter(), []);

  useEffect(() => {
    (async () => {
      const res = await loadGame(adapter, "auto");
      if (res.ok && res.state) setState(res.state);
      if (res.error && res.error !== "存档不存在") setLoadErr(res.error);
      setLoading(false);
    })();
  }, [adapter]);

  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => { saveGame(adapter, "auto", state).catch(() => undefined); }, 600);
    return () => clearTimeout(t);
  }, [state, adapter]);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = toastId.current++;
    setToasts((ts) => [...ts, { id, msg, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4600);
  }, []);

  const act = useCallback((a: Action) => {
    setState((cur) => {
      const r = dispatch(cur, a);
      if (r.error) toast(r.error, "err");
      else if (r.message) toast(r.message);
      r.messages?.forEach((m) => toast(m));
      if (a.type === "SETTLE" && r.state && !r.error) setShowSettle(true);
      if (a.type === "NEW_DAY" || a.type === "NEW_GAME") setShowSettle(false);
      return r.state;
    });
  }, [toast]);

  if (loading) return <div className="boot">正在读取存档…</div>;
  if (!state) {
    return (
      <div>
        {loadErr && <div className="boot err">存档读取失败：{loadErr}</div>}
        <CreateScreen onStart={(f: CreateForm) => act({ type: "NEW_GAME", input: { ...f } })} />
      </div>
    );
  }

  const s = state;
  if (!s.branches[s.activeCityId]) s.activeCityId = Object.keys(s.branches)[0];
  const b = s.branches[s.activeCityId];
  const city = CITY_BY_ID[b.cityId];
  const check = checkPlan(s, b);
  const nw = netWorthCents(s);
  const globalCash = totalCashCny(s);
  const notSettled = pendingSettleCities(s);
  const lastReport = b.reports[0];
  const ctx: AppCtx = { s, b, act, toast, setNav };

  const flowBtns = s.over ? null : (
    <div className="flow">
      {b.phase === "planning" && (
        <>
          <button className="btn-primary" onClick={() => act({ type: "CONFIRM_PLAN" })} title={check.errors.join("；") || "确认本店菜单/排班/营业计划"}>
            确认{city.name}店计划{b.planConfirmedDirty ? " *" : ""}
          </button>
          <button className="btn" onClick={() => act({ type: "CLOSE_TODAY" })} title="本店今日歇业：不模拟营业、员工不上工无工资">今日歇业</button>
        </>
      )}
      {b.phase === "confirmed" && (
        <button className="btn-primary" onClick={() => act({ type: "SETTLE" })}>开始营业 · 打烊结算</button>
      )}
      {b.phase === "report" && (
        <>
          {!b.closedToday && !showSettle && <button className="btn" onClick={() => setShowSettle(true)}>查看{city.name}报表</button>}
          <button
            className="btn-primary"
            disabled={notSettled.length > 0}
            title={notSettled.length ? `还有分店未确认结算或歇业：${notSettled.join("、")}` : "推进到下一天（所有分店一起过夜）"}
            onClick={() => act({ type: "NEW_DAY" })}
          >
            推进到下一天{notSettled.length ? `（${notSettled.join("/")}未结算）` : ""}
          </button>
        </>
      )}
    </div>
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">今天也没倒闭<small>{city.name} · {s.boss.restaurantName}（{Object.keys(s.branches).length}家分店）</small></div>
          <div className="top-stats">
            <TopStat label={`第${s.day}天 ${CALENDAR.weekdayNames[s.date.weekday]}`} value={WEATHER.names[s.date.weather]} />
            <TopStat label="全部现金(合人民币)" value={`${yuan(globalCash)} 元`} tone={globalCash < 100000 ? "bad" : undefined} />
            <TopStat label={`${city.name}店现金`} value={money(s, b.cashCents)} tone={b.cashCents < 100000 ? "bad" : undefined} />
            <TopStat label={`${city.name}昨日利润`} value={lastReport ? `${yuan(toCnyCents(lastReport.netProfitCents, city.fxPerCnyBp))}元(合)` : "—"} tone={lastReport ? (lastReport.netProfitCents >= 0 ? "good" : "bad") : undefined} />
            <TopStat label="昨日客流" value={lastReport ? `${lastReport.served}/${lastReport.entered}桌` : "—"} />
            <TopStat label="口碑" value={(b.reputation / 10).toFixed(1)} />
            <TopStat label="集团净资产" value={`${yuan(nw)} 元`} />
          </div>
          {flowBtns}
        </header>

        <div className="main">
          <nav className="sidenav">
            {(
              [
                ["overview", "经营总览"],
                ["market", "市场采购"],
                ["menu", "菜单定价"],
                ["research", `菜品研究${s.study.activeResearch ? "(!)" : ""}`],
                ["staff", "员工管理"],
                ["decor", "店铺装修"],
                ["marketing", "营销"],
                ["events", `事件待办${s.events.pending.length ? "(!" + s.events.pending.length + ")" : ""}`],
                ["finance", "财务报表"],
                ["city", "城市扩张"],
                ["save", "存档设置"],
              ] as [NavId, string][]
            ).map(([id, label]) => (
              <button key={id} className={nav === id ? "on" : ""} onClick={() => setNav(id)}>{label}</button>
            ))}
            <div className="nav-foot">
              <div>难度：{{ easy: "简单", normal: "普通", hardcore: "硬核" }[s.boss.difficulty]}</div>
              <div>身世：{PERSONALITY_BG_NAMES[s.boss.background] ?? s.boss.background}</div>
              <div>性格：{PERSONALITY_NAMES[s.boss.personality] ?? s.boss.personality}</div>
            </div>
          </nav>

          <main className="content">
            {nav === "overview" && <OverviewPage />}
            {nav === "market" && <MarketPage />}
            {nav === "menu" && <MenuPage />}
            {nav === "research" && <ResearchPage />}
            {nav === "staff" && <StaffPage />}
            {nav === "decor" && <DecorPage />}
            {nav === "marketing" && <MarketingPage />}
            {nav === "events" && <EventsPage />}
            {nav === "finance" && <FinancePage />}
            {nav === "city" && <CityPage />}
            {nav === "save" && <SavePage adapter={adapter} setConfirm={(c) => setConfirmDlg(c)} />}
          </main>

          <aside className="rightpanel">
            <h4>{city.name}店 · 待办 / 预警</h4>
            {b.phase === "planning" && b.planConfirmedDirty && <div className="warnbox">本店营业计划未确认（有调整）</div>}
            {notSettled.filter((c) => c !== city.name).length > 0 && b.phase === "report" && (
              <div className="warnbox">其他分店未结算：{notSettled.filter((c) => c !== city.name).join("、")}（切换城市去确认/歇业）</div>
            )}
            {check.errors.map((e, i) => <div className="errbox" key={"e" + i}>{e}</div>)}
            {check.warnings.map((w, i) => <div className="warnbox" key={"w" + i}>{w}</div>)}
            {check.errors.length + check.warnings.length === 0 && <div className="okbox">一切就绪</div>}
            <h4>本店预测</h4>
            <div className="forecast">
              {forecastLine(s, b)}
              <br />
              按当前价格约 {estimateDemand(s, b).expected} 桌 ｜ 有效产能 ≈ {Math.floor(roughCapacity(s, b))} 桌{b.store.orderLimitCovers > 0 ? `（限单 ${b.store.orderLimitCovers}）` : ""}
            </div>
            <h4>进行中事件（全部城市）</h4>
            {s.events.pending.length === 0 && <div className="dim">无</div>}
            {s.events.pending.map((p) => (
              <div key={p.eventUid} className={"evtbox " + (p.blocking ? "blocking" : "")} onClick={() => setNav("events")}>
                <span><span className="tag">{CITY_BY_ID[p.cityId]?.name ?? p.cityId}</span><b>{p.title}</b></span>
                <span>{p.blocking ? "（需处理）" : ""}</span>
              </div>
            ))}
            {b.boosts.length > 0 && <>
              <h4>{city.name}店 客流加成/减益</h4>
              {b.boosts.map((x) => (
                <div key={x.id} className="boostbox">{x.label}：{(x.trafficBp / 100 - 100).toFixed(1)}% 至第{x.untilDay}天</div>
              ))}
            </>}
          </aside>
        </div>

        {showSettle && lastReport && b.phase === "report" && !b.closedToday && <SettlementModal report={lastReport} act={act} close={() => setShowSettle(false)} />}
        {s.over && <GameOverOverlay state={s} onRestart={() => setState(null)} />}

        {confirmDlg && (
          <Confirm text={confirmDlg.text} danger={confirmDlg.danger}
            onOk={() => { const f = confirmDlg.onOk; setConfirmDlg(null); f(); }}
            onCancel={() => setConfirmDlg(null)} />
        )}

        <div className="toasts">
          {toasts.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.msg}</div>)}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function TopStat(props: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={"topstat " + (props.tone ?? "")}>
      <span className="l">{props.label}</span>
      <span className="v">{props.value}</span>
    </div>
  );
}

const PERSONALITY_NAMES: Record<string, string> = Object.fromEntries(PERSONALITIES.map((p) => [p.id, p.name]));
const PERSONALITY_BG_NAMES: Record<string, string> = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b.name]));
