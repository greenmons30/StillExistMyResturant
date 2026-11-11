import React, { useEffect, useRef, useState } from "react";

export function Card(props: { title?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <div className={"card " + (props.className ?? "")}>
      {props.title && (
        <div className="card-head">
          <span>{props.title}</span>
          <span className="card-actions">{props.actions}</span>
        </div>
      )}
      <div className="card-body">{props.children}</div>
    </div>
  );
}

export function Stat(props: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={"stat tone-" + (props.tone ?? "")}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function Bar(props: { value: number; max?: number; color?: string }) {
  const max = props.max ?? 100;
  const pct = Math.max(0, Math.min(100, (props.value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: pct + "%", background: props.color }} />
    </div>
  );
}

export function Modal(props: { title: string; children: React.ReactNode; onClose?: () => void; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className={"modal" + (props.wide ? " wide" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{props.title}</span>
          {props.onClose && <button className="btn-x" onClick={props.onClose}>✕</button>}
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Confirm(props: { text: string; danger?: boolean; onOk: () => void; onCancel: () => void }) {
  return (
    <Modal title={props.danger ? "危险操作确认" : "确认"} onClose={props.onCancel} footer={
      <>
        <button className="btn" onClick={props.onCancel}>取消</button>
        <button className={"btn " + (props.danger ? "btn-danger" : "btn-primary")} onClick={props.onOk}>确认</button>
      </>
    }>
      <p style={{ lineHeight: 1.7 }}>{props.text}</p>
    </Modal>
  );
}

// 可排序 + 搜索的表格壳
export function useTableSort<T>(rows: T[], initialKey?: keyof T) {
  const [sortKey, setSortKey] = useState<keyof T | null>(initialKey ?? null);
  const [asc, setAsc] = useState(false);
  const sorted = React.useMemo(() => {
    if (sortKey === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return asc ? av - bv : bv - av;
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [rows, sortKey, asc]);
  const toggle = (k: keyof T) => {
    if (sortKey === k) setAsc(!asc);
    else { setSortKey(k); setAsc(false); }
  };
  return { sorted, sortKey, asc, toggle };
}

export function Th(props: { label: string; sortKey?: string; active?: string | null; asc?: boolean; onSort?: (k: string) => void }) {
  return (
    <th className={props.sortKey ? "sortable" : ""} onClick={() => props.sortKey && props.onSort?.(props.sortKey)}>
      {props.label}{props.sortKey && props.active === props.sortKey ? (props.asc ? " ▲" : " ▼") : ""}
    </th>
  );
}

export function useDebounce<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function NumberInput(props: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [local, setLocal] = useState(String(props.value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(String(props.value)); }, [props.value]);
  return (
    <span className="num-input">
      <input
        value={local}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setLocal(String(props.value)); }}
        onChange={(e) => {
          setLocal(e.target.value);
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) props.onChange(Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, n)));
        }}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </span>
  );
}
