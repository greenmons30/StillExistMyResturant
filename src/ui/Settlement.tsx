import type { Action } from "../game/reducer";
import type { DayReport, GameState } from "../game/types";
import { Modal } from "./widgets";
import { yuan } from "../game/utils";
import { WEATHER } from "../game/config";
import { CITY_BY_ID, CURRENCY_SYMBOL, toCnyCents } from "../game/data/cities";

export function SettlementModal(props: { report: DayReport; act: (a: Action) => void; close: () => void }) {
  const r = props.report;
  const city = CITY_BY_ID[r.cityId];
  const cur = CURRENCY_SYMBOL[city.currency] ?? "元";
  const m = (cents: number) => `${yuan(cents)}${cur}`;
  return (
    <Modal
      title={`${city.name}店 第${r.day}日经营报表 · ${r.dateLabel} · ${WEATHER.names[r.weather]}`}
      wide
      onClose={props.close}
      footer={
        <>
          <button className="btn" onClick={props.close}>关闭</button>
        </>
      }
    >
      <div className="settle-grid">
        <div className="settle-col">
          <h5>客流漏斗（桌）</h5>
          <table className="tbl mini">
            <tbody>
              <tr><td>潜在客流</td><td className="num">{r.potential}</td></tr>
              <tr><td>进店顾客（桌）</td><td className="num">{r.entered}</td></tr>
              <tr><td>完成接待（桌）</td><td className="num">{r.served}</td></tr>
              <tr><td>弃单（等待/嫌贵/限单拒客）</td><td className="num bad">{r.lostToWait}</td></tr>
              <tr><td>缺料流失</td><td className="num warn">{r.lostNoStock}</td></tr>
              <tr><td>平均满意度</td><td className="num">{r.avgSatisfaction}/100</td></tr>
              <tr><td>口碑</td><td className="num">{(r.rep / 10).toFixed(1)}（{r.repDelta >= 0 ? "+" : ""}{r.repDelta / 10}）</td></tr>
            </tbody>
          </table>
          <h5>当日损益（{city.currency}）</h5>
          <table className="tbl mini">
            <tbody>
              <tr><td>营业收入</td><td className="num good">{m(r.revenueCents)}</td></tr>
              <tr><td>食材消耗成本</td><td className="num">{m(-r.cogsCents)}</td></tr>
              <tr><td>员工工资</td><td className="num">{m(-r.wageCents)}</td></tr>
              <tr><td>房租</td><td className="num">{m(-r.rentCents)}</td></tr>
              <tr><td>水电燃气</td><td className="num">{m(-r.utilityCents)}</td></tr>
              <tr><td>损耗报废</td><td className="num">{m(-r.spoilCents)}</td></tr>
              {r.familyCents > 0 && <tr><td>家庭固定支出</td><td className="num">{m(-r.familyCents)}</td></tr>}
              <tr><td>其他成本</td><td className="num">{m(-r.otherCostCents)}</td></tr>
              <tr className="total"><td>净利润</td><td className={"num " + (r.netProfitCents >= 0 ? "good" : "bad")}>{m(r.netProfitCents)}</td></tr>
              <tr><td>期末现金</td><td className="num">{m(r.cashEndCents)}（折合 {yuan(toCnyCents(r.cashEndCents, city.fxPerCnyBp))} 元）</td></tr>
            </tbody>
          </table>
          <p className="dim" style={{ fontSize: 11, lineHeight: 1.6 }}>注：损益按权责发生制——买食材的钱在付款时已从现金流出（见“财务报表·现金流”的采购付款行），但那时只是现金换成库存；做成菜卖出才计入这里的“食材消耗成本”，未消耗的原料仍是库存资产，现金不会二次扣减。</p>
          <h5>明日预测</h5>
          <div className="forecast">{r.forecast.label}，潜在客流约 {r.forecast.est} 桌</div>
        </div>
        <div className="settle-col">
          <h5>出菜明细（桌均 1~10 道）</h5>
          <table className="tbl">
            <thead>
              <tr><th>菜品</th><th className="num">销量</th><th className="num">收入</th><th className="num">食材成本</th><th className="num">贡献毛利</th><th className="num">均分</th></tr>
            </thead>
            <tbody>
              {r.dishStats.length === 0 && <tr><td colSpan={6} className="dim center">今日无销售——检查排班、菜单与库存</td></tr>}
              {r.dishStats.map((d) => (
                <tr key={d.dishId}>
                  <td>{d.name}</td>
                  <td className="num">{d.sold}</td>
                  <td className="num">{yuan(d.revenueCents)}</td>
                  <td className="num">{yuan(d.cogsCents)}</td>
                  <td className={"num " + (d.contributionCents >= 0 ? "good" : "bad")}>{yuan(d.contributionCents)}</td>
                  <td className="num">{d.ratingCount ? (d.ratingSum / d.ratingCount / 10).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h5>顾客评价</h5>
          {r.reviews.length === 0 && <div className="dim">今日无新评价</div>}
          <ul className="reviews">
            {r.reviews.map((rv, i) => (
              <li key={i}><span className={"stars s" + rv.score}>{"★".repeat(rv.score)}{"☆".repeat(5 - rv.score)}</span> {rv.text}<small>（{rv.segName} · {rv.dishName}）</small></li>
            ))}
          </ul>
          <h5>员工成长</h5>
          {r.staffGrowth.length === 0 && <div className="dim">今日无人熟练度提升（人手不足或订单太少都会影响经验积累）</div>}
          <ul className="grow">
            {r.staffGrowth.map((g, i) => <li key={i}>{g.name}：熟练度 {g.skill - g.xpGain} → <b>{g.skill}</b>（+{g.xpGain}）</li>)}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

export function GameOverOverlay(props: { state: GameState; onRestart: () => void }) {
  const s = props.state;
  const totalCny = Object.values(s.branches).reduce((a, b) => a + toCnyCents(b.cashCents, CITY_BY_ID[b.cityId]?.fxPerCnyBp ?? 1000), 0);
  return (
    <Modal title="破产清算">
      <p className="gameover-text">
        《今天也没倒闭》——很遗憾，这次倒了。<br />
        营业 {s.day} 天，{Object.keys(s.branches).length} 家分店，最终集团现金折合 {yuan(totalCny)} 元，
        累计接受家庭转账 {s.events.transferCount} 笔共 {yuan(s.events.transferredTotalCents)} 元。<br />
        老板 {s.boss.name} 关上了卷帘门，把「旺铺转让」的红纸贴在了每一家店的玻璃上。
      </p>
      <div className="modal-foot">
        <button className="btn-primary" onClick={props.onRestart}>重新开始</button>
      </div>
    </Modal>
  );
}
