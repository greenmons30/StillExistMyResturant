import { useState } from "react";
import { BACKGROUNDS, PERSONALITIES, PHILOSOPHIES } from "../game/config";
import { CITY_BY_ID, scaledRent, toLocalCents } from "../game/data/cities";
import type { BackgroundId, DifficultyId, PersonalityId } from "../game/types";
import { yuan } from "../game/utils";

export interface CreateForm {
  name: string; age: number; restaurantName: string;
  background: BackgroundId; personality: PersonalityId; philosophy: string;
  difficulty: DifficultyId; cityId: string; districtId: string;
}

export function CreateScreen(props: { onStart: (f: CreateForm) => void }) {
  const [f, setF] = useState<CreateForm>({
    name: "", age: 28, restaurantName: "", background: "normal", personality: "frugal",
    philosophy: PHILOSOPHIES[1], difficulty: "normal", cityId: "changsha", districtId: "community",
  });
  const [err, setErr] = useState("");
  const bg = BACKGROUNDS.find((b) => b.id === f.background)!;
  const city = CITY_BY_ID[f.cityId];
  const startable = city.districts.slice(0, 2); // 起步只能选小商圈，更大的靠“店铺装修→迁址升级”

  const submit = () => {
    if (!f.name.trim()) return setErr("请填写老板姓名");
    if (!f.restaurantName.trim()) return setErr("请填写餐馆名称");
    if (f.age < 18 || f.age > 70) return setErr("老板年龄需在18-70之间");
    props.onStart(f);
  };

  return (
    <div className="create-wrap">
      <div className="create-hero">
        <h1>今天也没倒闭</h1>
        <p className="sub">硬核餐饮经营模拟器 · 第一站：长沙（后续可扩张八城）</p>
      </div>
      <div className="create-grid">
        <section className="card">
          <div className="card-head"><span>基本信息</span></div>
          <div className="card-body form-col">
            <label>老板姓名 <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：李思远" /></label>
            <label>年龄 <input type="number" value={f.age} onChange={(e) => setF({ ...f, age: Number(e.target.value) })} /></label>
            <label>餐馆名称 <input value={f.restaurantName} onChange={(e) => setF({ ...f, restaurantName: e.target.value })} placeholder="例如：湘味小灶" /></label>
            <label>经营理念
              <select value={f.philosophy} onChange={(e) => setF({ ...f, philosophy: e.target.value })}>
                {PHILOSOPHIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label>游戏难度
              <select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value as DifficultyId })}>
                <option value="easy">简单（成本-15%，波动小）</option>
                <option value="normal">普通</option>
                <option value="hardcore">硬核（成本+15%，口碑衰减快）</option>
              </select>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span>老板身世（决定初始资金与家庭事件线）</span></div>
          <div className="card-body bg-list">
            {BACKGROUNDS.map((b) => (
              <label key={b.id} className={"bg-item " + (f.background === b.id ? "sel" : "")}>
                <input type="radio" checked={f.background === b.id} onChange={() => setF({ ...f, background: b.id })} />
                <div>
                  <b>{b.name}</b><span className="money"> 初始经营资金 {yuan(b.startCashCents)} 元</span>
                  {b.dailyFixedCents > 0 && <span className="bad"> ｜每日固定支出 {yuan(b.dailyFixedCents)} 元（{b.fixedMemo}）</span>}
                  <p>{b.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span>老板性格（效果与代价均参与计算）</span></div>
          <div className="card-body pers-grid">
            {PERSONALITIES.map((p) => (
              <label key={p.id} className={"pers-item " + (f.personality === p.id ? "sel" : "")}>
                <input type="radio" checked={f.personality === p.id} onChange={() => setF({ ...f, personality: p.id })} />
                <div><b>{p.name}</b><p>{p.desc}</p></div>
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span>起步选址：{city.name} · {city.positioning}</span></div>
          <div className="card-body">
            <p className="dim">起步只能从较小的商圈开始，更大的商圈通过“店铺装修 → 迁址升级”扩张（座位/炉灶随商圈提升）：</p>
            <div className="dist-row">
              {city.districts.map((d, i) => (
                <label key={d.id} className={"dist-item " + (f.districtId === d.id ? "sel" : "") + (i > 1 ? " locked" : "")}>
                  <input type="radio" disabled={i > 1} checked={f.districtId === d.id} onChange={() => setF({ ...f, districtId: d.id })} />
                  <div>
                    <b>{d.name}</b>
                    <p>客流 {(d.trafficModBp / 100).toFixed(0)}% ｜ {d.seats}座 {d.stations}灶</p>
                    <p>日租 {yuan(toLocalCents(scaledRent(d.rentCents, city), city.fxPerCnyBp))}{i > 1 ? "（需迁址解锁）" : ""}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </section>
      </div>
      {err && <div className="form-err">{err}</div>}
      <div className="create-foot">
        <button className="btn-primary big" onClick={submit}>开张！今天也没倒闭</button>
      </div>
    </div>
  );
}
