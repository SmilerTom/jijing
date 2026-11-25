'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchFundHistory, fetchFundPingzhongdata, fetchFundTradeRules } from '@/app/api/fund';
import * as qk from '@/app/lib/query-keys';
import { storageStore, useStorageStore } from '@/app/stores/storageStore';
import { cn } from '@/lib/utils';
import { optimizeRobust, robustComboCount, simulate, todaySignal } from './backtestEngine.mjs';
import { resolvePosition } from './decision.mjs';
import {
  backtestStorageKey,
  cleanBacktestParams,
  describeSignal,
  loadBacktestParams,
  prepareBacktestData
} from './backtestSignal';
import { getStrategyQuote } from './strategy.mjs';
import { MIN_SPAN, panRange, zoomAround } from './ValuationBandPanel';
import styles from './page.module.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const RANGES = [
  ['all', '全部'],
  ['5', '近5年'],
  ['3', '近3年'],
  ['1', '近1年']
];
const TYPE = { sell: '卖出', buy: '买回', stop: '止损清仓', reenter: '重新买入' };
const BATCHES = [
  [1, '全部机动仓'],
  [0.5, '1/2'],
  [0.333333, '1/3'],
  [0.2, '1/5'],
  [0.1, '1/10']
];
const PRESETS = [
  ['hold', '一直持有', { core: 100, stop: 0 }],
  [
    'band',
    '整仓均线带',
    { n: 10, sell: 5, buy: 5, core: 70, batch: 1, interval: 30, buyback: 'lower', trend: false, stop: 0 }
  ],
  [
    'daily',
    '带外逐日 1/5',
    { n: 10, sell: 5, buy: 5, core: 70, batch: 0.2, interval: 0, buyback: 'lower', trend: false, stop: 0 }
  ],
  ['guard', '持有 + 20% 止损', { core: 100, stop: 20, n: 60 }]
];

const pct = (value, digits = 2) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%` : '--';
const yuan = (value) =>
  Number.isFinite(value)
    ? `¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : '--';
const signedYuan = (value) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${yuan(value)}` : '—';
const ratio = (value) => (Number.isFinite(value) ? value.toFixed(2) : '--');
const tone = (value) => (value > 0 ? styles.up : value < 0 ? styles.down : undefined);
/** 画布不支持 color-mix，把主题色 #rrggbb 转成带透明度的 rgba */
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m
    ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
    : `rgba(128, 128, 128, ${a})`;
};
const pctTick = (value) => `${value > 0 ? '+' : ''}${Number(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;

function useColors() {
  const [colors, setColors] = useState(null);
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const token = (name) => style.getPropertyValue(name).trim();
      setColors({
        nav: token('--chart-1'),
        sell: token('--chart-5'),
        buy: token('--chart-4'),
        muted: token('--muted'),
        grid: token('--border'),
        card: token('--card'),
        text: token('--text'),
        danger: token('--danger'),
        primary: token('--primary')
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

function NumberField({ id, label, value, onChange, min, max, step, suffix }) {
  return (
    <label className={styles.labField} htmlFor={id}>
      <span>{label}</span>
      <span className={styles.labInput}>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  );
}

function chartOptions(colors, format, tooltip) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: colors.muted, maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 16 }
      },
      y: {
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { color: colors.muted, maxTicksLimit: 5, callback: format }
      }
    }
  };
}

function Legend({ items }) {
  const dash = { solid: '', dotted: '2 4', dashed: '10 4', dashdot: '10 3 2 3' };
  return (
    <ul className={styles.labLegend}>
      {items.map(([color, label, kind = 'solid']) => (
        <li key={label}>
          {kind === 'mark' ? (
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="4.5" fill={color} />
            </svg>
          ) : (
            <svg width="24" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                stroke={color}
                strokeWidth={kind === 'solid' ? 3 : 2}
                strokeDasharray={dash[kind]}
              />
            </svg>
          )}
          {label}
        </li>
      ))}
    </ul>
  );
}

/** 今日信号卡：按当前回测参数和今天的估值（或最新正式净值）给出规则信号与依据 */
function SignalCard({ signal, params, positionValue, quoteTime }) {
  if (!signal) return null;
  const { headline, reason, tone: toneName } = describeSignal(signal, params, positionValue);
  const sleeveState =
    signal.state.cashShare > 0.001
      ? `机动仓已卖出一部分，现金占 ${(signal.state.cashShare * 100).toFixed(0)}%`
      : '机动仓全部持有';
  const facts = [
    [`偏离 ${params.n} 日均线`, `${pct(signal.deviation)}（卖出线 +${params.sell}% / 买回线 −${params.buy}%）`],
    ['距卖出线 / 买回线', `${pct(signal.toUpper)} / ${pct(signal.toLower)}`],
    [
      '回测持仓状态',
      signal.state.stopped ? '止损后空仓' : `底仓 ${(signal.state.coreShare * 100).toFixed(0)}% · ${sleeveState}`
    ],
    ...(signal.stopLine ? [['距止损线', pct((signal.stopLine / signal.price - 1) * 100)]] : []),
    ...(signal.waitDays > 0 ? [['交易间隔', `还需 ${signal.waitDays} 天`]] : []),
    ...(params.trend ? [['趋势过滤', signal.trendBlocks ? '均线向上，暂不卖出' : '均线未向上，可以卖出']] : [])
  ];
  return (
    <section className={cn(styles.signalCard, styles[`signal_${toneName}`])} aria-labelledby="bt-signal-title">
      <p className={styles.signalEyebrow}>
        今日信号 · {signal.date}{' '}
        {signal.estimated
          ? `按盘中估值 ${quoteTime || ''}，收盘可能变化`
          : signal.appended
            ? '按最新正式净值'
            : '按当日正式净值'}
      </p>
      <h4 id="bt-signal-title" role="status">
        {headline}
      </h4>
      <p className={styles.signalReason}>{reason}</p>
      <dl className={styles.signalFacts}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <small className={styles.riskMuted}>
        按下方回测参数的规则信号，假设过去都按同一规则操作；你的实际仓位不同时，请按实际情况换算。15:00
        前提交按当日净值成交。仅供参考，不构成投资建议。
      </small>
    </section>
  );
}

export default function BacktestLab({ fundId, fund = null, masked = false }) {
  const colors = useColors();
  const storageKey = backtestStorageKey(fundId);
  const [params, setParams] = useState(() => loadBacktestParams(fundId));
  const [range, setRange] = useState('all');
  const [view, setView] = useState(null);
  const [rebase, setRebase] = useState(true);
  const [optimizer, setOptimizer] = useState({ status: 'idle', done: 0, total: 0, best: [] });
  const runRef = useRef(0);
  const chartBoxRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    try {
      storageStore.setItem(storageKey, JSON.stringify(params));
    } catch {}
  }, [params, storageKey]);
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    []
  );

  const historyQuery = useQuery({
    queryKey: qk.fundHistory(fundId, 'all'),
    queryFn: () => fetchFundHistory(fundId, 'all'),
    staleTime: 10 * 60 * 1000
  });
  const rulesQuery = useQuery({
    queryKey: qk.fundTradeRules(fundId),
    queryFn: () => fetchFundTradeRules(fundId),
    staleTime: 24 * 60 * 60 * 1000
  });
  const profileQuery = useQuery({
    queryKey: ['boardFundProfile', fundId],
    queryFn: () => fetchFundPingzhongdata(fundId),
    staleTime: 60 * 60 * 1000
  });
  const data = useMemo(
    () => prepareBacktestData(historyQuery.data, rulesQuery.data?.redeemRows, profileQuery.data?.fund_Rate),
    [historyQuery.data, rulesQuery.data, profileQuery.data]
  );

  const from = useMemo(() => {
    if (!data || range === 'all') return 0;
    const last = data.dates.at(-1);
    const cutoff = `${Number(last.slice(0, 4)) - Number(range)}${last.slice(4)}`;
    return Math.max(
      0,
      data.dates.findIndex((date) => date >= cutoff)
    );
  }, [data, range]);
  const clean = useMemo(() => cleanBacktestParams(params), [params]);
  const result = useMemo(() => (data ? simulate(data, clean, { from }) : null), [data, clean, from]);
  const { holdings, groupHoldings } = useStorageStore();
  const quote = useMemo(
    () => getStrategyQuote(fund, historyQuery.data || [], { preferEstimate: true }),
    [fund, historyQuery.data]
  );
  const signal = useMemo(
    () => (data && quote ? todaySignal(data, clean, quote, { from }) : null),
    [data, clean, quote, from]
  );
  const position = useMemo(() => resolvePosition(fundId, holdings, groupHoldings), [fundId, holdings, groupHoldings]);
  const positionValue =
    !masked && Number(position?.share) > 0 && quote?.nav > 0 ? Number(position.share) * quote.nav : 0;

  // 区间或周期变化后，缩放回到全部
  const windowKey = result ? `${result.start}-${result.end}` : '';
  const [seenKey, setSeenKey] = useState(windowKey);
  if (seenKey !== windowKey) {
    setSeenKey(windowKey);
    setView(null);
  }
  const length = result ? result.end - result.start + 1 : 0;
  const shown = view || { start: 0, end: Math.max(0, length - 1) };
  const zoomed = view !== null;
  const setShown = (next) => setView(next.start === 0 && next.end === length - 1 ? null : next);

  const update = (key, value) => setParams((current) => ({ ...current, [key]: value }));
  const applyPreset = (preset) => setParams((current) => ({ ...current, ...preset }));

  const charts = useMemo(() => {
    if (!result || !colors || !data) return null;
    const { start, log, curve, holdCurve } = result;
    const lo = start + shown.start;
    const hi = start + shown.end;
    const labels = data.dates.slice(lo, hi + 1);
    const ma = data.ma(clean.n);
    const base = rebase ? lo : start;
    const navBase = data.nav[base];
    const toPct = (value, b) => (Number.isFinite(value) ? (value / b - 1) * 100 : null);
    const pick = (fn) => labels.map((_, k) => fn(lo + k));
    const byIndex = new Map(log.map((trade) => [trade.i, trade]));
    const mark = (type) => pick((i) => (byIndex.get(i)?.type === type ? toPct(data.nav[i], navBase) : null));
    const markSet = (type, color, style, rotation = 0) => ({
      label: TYPE[type],
      data: mark(type),
      showLine: false,
      pointStyle: style,
      rotation,
      pointRadius: 6,
      pointHoverRadius: 8,
      backgroundColor: color,
      borderColor: colors.card,
      borderWidth: 1.5
    });
    const line = (label, values, color, extra = {}) => ({
      label,
      data: values,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.4,
      pointRadius: 0,
      pointHoverRadius: 3,
      ...extra
    });
    const navTooltip = {
      filter: (item) => item.raw !== null,
      callbacks: {
        title: (items) => `${items[0].label}（相对 ${data.dates[base]}）`,
        label(item) {
          const i = lo + item.dataIndex;
          const trade = byIndex.get(i);
          if (trade && item.dataset.label === TYPE[trade.type]) {
            return `${TYPE[trade.type]} ${yuan(trade.amount)}${trade.pnl !== null ? `，盈亏 ${signedYuan(trade.pnl)}（${pct(trade.pnlRate)}）` : ''}`;
          }
          if (item.dataset.label === '净值涨跌')
            return `净值涨跌 ${pct(item.raw)}，偏离均线 ${pct((data.nav[i] / ma[i] - 1) * 100)}`;
          return `${item.dataset.label} ${pct(item.raw)}`;
        }
      }
    };
    const nav = {
      data: {
        labels,
        datasets: [
          markSet('sell', colors.sell, 'triangle'),
          markSet('buy', colors.buy, 'triangle', 180),
          markSet('stop', colors.danger, 'crossRot'),
          markSet('reenter', colors.primary, 'circle'),
          line(
            '净值涨跌',
            pick((i) => toPct(data.nav[i], navBase)),
            colors.nav,
            { borderWidth: 2.2 }
          ),
          line(
            '均线',
            pick((i) => toPct(ma[i], navBase)),
            colors.muted,
            { borderDash: [2, 4], borderWidth: 1.2 }
          ),
          line(
            '卖出线',
            pick((i) => toPct(ma[i] * (1 + clean.sell / 100), navBase)),
            colors.sell,
            { borderDash: [10, 4], borderWidth: 1.5 }
          ),
          line(
            '买回线',
            pick((i) => toPct(ma[i] * (1 - clean.buy / 100), navBase)),
            colors.buy,
            {
              borderDash: [10, 3, 2, 3],
              borderWidth: 1.5,
              fill: '-1',
              backgroundColor: alpha(colors.nav, 0.06)
            }
          )
        ]
      },
      options: chartOptions(colors, pctTick, navTooltip)
    };
    const offset = base - start;
    const equity = {
      data: {
        labels,
        datasets: [
          line(
            '当前参数',
            Array.from(curve.slice(shown.start, shown.end + 1), (v) => toPct(v, curve[offset])),
            colors.primary,
            { borderWidth: 2.4 }
          ),
          line(
            '一直持有',
            Array.from(holdCurve.slice(shown.start, shown.end + 1), (v) => toPct(v, holdCurve[offset])),
            colors.text,
            {
              borderWidth: 1.6,
              borderDash: [10, 3, 2, 3]
            }
          )
        ]
      },
      options: chartOptions(colors, pctTick, {
        callbacks: {
          title: (items) => `${items[0].label}（相对 ${data.dates[base]}）`,
          label: (item) => `${item.dataset.label} 收益率 ${pct(item.raw)}`
        }
      })
    };
    const drawdown = (values) => {
      let peak = -Infinity;
      return Array.from(values, (v) => {
        peak = Math.max(peak, v);
        return -(1 - v / peak) * 100;
      }).slice(shown.start, shown.end + 1);
    };
    const dd = {
      data: {
        labels,
        datasets: [
          line('当前参数', drawdown(curve), colors.primary, {
            fill: 'origin',
            backgroundColor: alpha(colors.danger, 0.14)
          }),
          line('一直持有', drawdown(holdCurve), colors.text, { borderDash: [10, 3, 2, 3], borderWidth: 1.2 })
        ]
      },
      options: chartOptions(colors, (v) => `${Math.round(v)}%`, {
        callbacks: { label: (item) => `${item.dataset.label} 距最高点 ${pct(item.raw, 1)}` }
      })
    };
    return {
      nav,
      equity,
      dd,
      rangeText: `${labels[0]} 至 ${labels.at(-1)} · ${labels.length} 个交易日`,
      base: data.dates[base]
    };
  }, [result, colors, data, shown.start, shown.end, rebase, clean.n, clean.sell, clean.buy]);

  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el || !length) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 1;
      setView((current) => {
        const next = zoomAround(
          current || { start: 0, end: length - 1 },
          event.deltaY > 0 ? 1.25 : 0.8,
          anchor,
          length
        );
        return next.start === 0 && next.end === length - 1 ? null : next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [length]);

  const zoomTo = (days) =>
    setShown(days && days < length ? { start: length - days, end: length - 1 } : { start: 0, end: length - 1 });
  const onKeyDown = (event) => {
    const span = shown.end - shown.start + 1;
    const step = Math.max(1, Math.round(span / 8));
    const actions = {
      '+': () => setShown(zoomAround(shown, 2 / 3, 1, length)),
      '=': () => setShown(zoomAround(shown, 2 / 3, 1, length)),
      '-': () => setShown(zoomAround(shown, 1.5, 1, length)),
      ArrowLeft: () => setShown(panRange(shown, -step, length)),
      ArrowRight: () => setShown(panRange(shown, step, length)),
      Home: () => setShown({ start: 0, end: length - 1 })
    };
    if (!actions[event.key]) return;
    event.preventDefault();
    actions[event.key]();
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || !zoomed) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, view: shown, width: event.currentTarget.clientWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId || !drag.width) return;
    const span = drag.view.end - drag.view.start + 1;
    const delta = Math.round((-(event.clientX - drag.x) / drag.width) * span);
    if (delta) setShown(panRange(drag.view, delta, length));
  };
  const endDrag = (event) => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null;
  };

  const runOptimizer = () => {
    if (!data) return;
    const run = ++runRef.current;
    const iterator = optimizeRobust(
      data,
      { cashYield: clean.cashYield, trendLookback: clean.trendLookback, timeoutDays: clean.timeoutDays },
      { from, topN: 5 }
    );
    setOptimizer({ status: 'running', done: 0, total: robustComboCount(), best: [] });
    const pump = () => {
      if (run !== runRef.current) return;
      const deadline = performance.now() + 40;
      let step;
      do {
        step = iterator.next();
      } while (!step.done && !step.value.best && performance.now() < deadline);
      const value = step.value;
      if (value?.best) {
        setOptimizer({
          status: 'done',
          done: value.total,
          total: value.total,
          best: value.best,
          mid: data.dates[value.mid]
        });
        return;
      }
      if (value) setOptimizer((current) => ({ ...current, done: value.done }));
      setTimeout(pump, 0);
    };
    pump();
  };

  if (historyQuery.isPending) return <p className={styles.riskMuted}>正在加载完整净值历史…</p>;
  if (historyQuery.isError || !data)
    return (
      <p className={styles.riskMuted} role="status">
        {historyQuery.isError ? '净值历史加载失败。' : '净值历史不足 30 个交易日，暂不回测。'}
        {historyQuery.isError ? (
          <button type="button" className={styles.riskLink} onClick={() => historyQuery.refetch()}>
            重试
          </button>
        ) : null}
      </p>
    );

  const s = result?.stats;
  const h = result?.hold;
  const exits = result ? result.log.filter((t) => t.pnl !== null) : [];
  const feeTotal = result ? result.log.reduce((sum, t) => sum + t.fee, 0) : 0;
  let lastExitNav = null;
  const logRows = result
    ? result.log.map((t) => {
        let change = null;
        if (t.pnl !== null) {
          change = t.pnlRate;
          lastExitNav = t.nav;
        } else if (lastExitNav) change = (t.nav / lastExitNav - 1) * 100;
        return { ...t, change };
      })
    : [];

  return (
    <div className={styles.lab}>
      <SignalCard signal={signal} params={clean} positionValue={positionValue} quoteTime={quote?.time} />

      <section className={styles.labSection} aria-labelledby={`${fundId}-bt-opt`}>
        <div className={styles.labSectionHead}>
          <h4 id={`${fundId}-bt-opt`} className={styles.paneTitle}>
            稳健寻优
          </h4>
          <button
            type="button"
            className={styles.segButton}
            onClick={runOptimizer}
            disabled={optimizer.status === 'running'}
          >
            {optimizer.status === 'running'
              ? `计算中 ${Math.round((optimizer.done / optimizer.total) * 100)}%`
              : '开始寻优'}
          </button>
        </div>
        <p className={styles.riskMuted}>
          遍历 {robustComboCount().toLocaleString('zh-CN')} 组参数（含 0/15/25% 止损），分别回放前 70% 和后 30%
          历史，两段平均仓位都不低于
          60%，按两段中较差的卡玛比率排序。回测区间、现金年化和方向回看沿用下方设置，点「应用」后下方参数和图表随之更新。
        </p>
        {optimizer.status === 'running' ? (
          <div className={styles.labProgress} aria-hidden="true">
            <i style={{ width: `${(optimizer.done / optimizer.total) * 100}%` }} />
          </div>
        ) : null}
        {optimizer.status === 'done' ? (
          optimizer.best.length ? (
            <div className={styles.tableScroll} role="region" aria-label="寻优结果" tabIndex={0}>
              <table className={styles.miniTable}>
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>前段年化 / 回撤</th>
                    <th>后段年化 / 回撤</th>
                    <th>后段持有</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {optimizer.best.map((item, index) => {
                    const p = item.params;
                    return (
                      <tr key={index}>
                        <td>
                          {p.n}日 +{p.sell}/−{p.buy}% · 底仓{p.core}% ·{' '}
                          {p.batch >= 1 ? '整仓' : `1/${Math.round(1 / p.batch)}`}
                          {p.interval ? ` · 隔${p.interval}天` : ''}
                          {p.buyback === 'ma' ? ' · 回均线买' : ''}
                          {p.trend ? ' · 趋势过滤' : ''}
                          {p.stop ? ` · 止损${p.stop}%` : ''}
                        </td>
                        <td>
                          <span className={tone(item.inSample.annual)}>{pct(item.inSample.annual, 1)}</span> /{' '}
                          {item.inSample.dd.toFixed(1)}%
                        </td>
                        <td>
                          <span className={tone(item.outSample.annual)}>{pct(item.outSample.annual, 1)}</span> /{' '}
                          {item.outSample.dd.toFixed(1)}%
                        </td>
                        <td>
                          {pct(item.holdOut.annual, 1)} / {item.holdOut.dd.toFixed(1)}%
                        </td>
                        <td>
                          <button type="button" className={styles.segButton} onClick={() => applyPreset(p)}>
                            应用
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className={styles.riskMuted}>
                后段从 {optimizer.mid} 开始。参数越多越容易贴合历史，后段也稳定的组合才更可信。
              </p>
            </div>
          ) : (
            <p className={styles.riskMuted}>没有两段都满足仓位要求的组合，试试选更长的区间。</p>
          )
        ) : null}
      </section>

      <div className={styles.labToolbar}>
        <span className={styles.labGroupLabel}>回测区间</span>
        <div className={styles.labSeg} role="group" aria-label="回测区间">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>
              {label}
            </button>
          ))}
        </div>
        <span className={styles.labGroupLabel}>套用</span>
        <div className={styles.labSeg} role="group" aria-label="快速套用">
          {PRESETS.map(([key, label, preset]) => (
            <button key={key} type="button" onClick={() => applyPreset(preset)}>
              {label}
            </button>
          ))}
          {optimizer.best[0] ? (
            <button type="button" onClick={() => applyPreset(optimizer.best[0].params)}>
              稳健推荐
            </button>
          ) : null}
        </div>
      </div>

      <details className={styles.labParams} open>
        <summary>策略参数</summary>
        <div className={styles.labGrid}>
          <NumberField
            id={`${fundId}-bt-core`}
            label="底仓比例"
            value={params.core}
            onChange={(v) => update('core', v)}
            min="0"
            max="100"
            step="5"
            suffix="%"
          />
          <label className={styles.labField} htmlFor={`${fundId}-bt-batch`}>
            <span>每次交易</span>
            <select
              id={`${fundId}-bt-batch`}
              value={String(
                BATCHES.reduce((a, [b]) => (Math.abs(b - params.batch) < Math.abs(a - params.batch) ? b : a), 1)
              )}
              onChange={(event) => update('batch', Number(event.target.value))}
            >
              {BATCHES.map(([value, label]) => (
                <option key={value} value={String(value)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            id={`${fundId}-bt-n`}
            label="均线周期"
            value={params.n}
            onChange={(v) => update('n', v)}
            min="2"
            max="500"
            step="1"
            suffix="日"
          />
          <NumberField
            id={`${fundId}-bt-sell`}
            label="高于均线卖出"
            value={params.sell}
            onChange={(v) => update('sell', v)}
            min="0.5"
            max="80"
            step="0.5"
            suffix="%"
          />
          <NumberField
            id={`${fundId}-bt-buy`}
            label="低于均线买回"
            value={params.buy}
            onChange={(v) => update('buy', v)}
            min="0"
            max="60"
            step="0.5"
            suffix="%"
          />
          <NumberField
            id={`${fundId}-bt-interval`}
            label="至少间隔"
            value={params.interval}
            onChange={(v) => update('interval', v)}
            min="0"
            max="365"
            step="1"
            suffix="天"
          />
          <label className={styles.labField} htmlFor={`${fundId}-bt-buyback`}>
            <span>买回规则</span>
            <select
              id={`${fundId}-bt-buyback`}
              value={params.buyback}
              onChange={(event) => update('buyback', event.target.value)}
            >
              <option value="lower">跌到买回线</option>
              <option value="ma">回到均线</option>
              <option value="timeout">买回线或超时</option>
            </select>
          </label>
          {params.buyback === 'timeout' ? (
            <NumberField
              id={`${fundId}-bt-timeout`}
              label="超时买回"
              value={params.timeoutDays}
              onChange={(v) => update('timeoutDays', v)}
              min="1"
              max="720"
              step="1"
              suffix="天"
            />
          ) : null}
          <NumberField
            id={`${fundId}-bt-stop`}
            label="回撤止损（0 关）"
            value={params.stop}
            onChange={(v) => update('stop', v)}
            min="0"
            max="90"
            step="1"
            suffix="%"
          />
          <NumberField
            id={`${fundId}-bt-cash`}
            label="现金年化"
            value={params.cashYield}
            onChange={(v) => update('cashYield', v)}
            min="0"
            max="10"
            step="0.1"
            suffix="%"
          />
          <label className={styles.labCheck}>
            <input
              type="checkbox"
              checked={Boolean(params.trend)}
              onChange={(event) => update('trend', event.target.checked)}
            />
            均线向上时不卖
          </label>
          {params.trend ? (
            <NumberField
              id={`${fundId}-bt-lookback`}
              label="方向回看"
              value={params.trendLookback}
              onChange={(v) => update('trendLookback', v)}
              min="1"
              max="250"
              step="1"
              suffix="日"
            />
          ) : null}
        </div>
      </details>

      {!result ? (
        <p className={styles.riskMuted}>区间太短或均线周期比区间还长，请缩短周期或选更长的区间。</p>
      ) : (
        <>
          <p className={styles.labVerdict}>
            {data.dates[result.start]} 至 {data.dates[result.end]}：收益比一直持有
            <b className={tone(s.total - h.total)}>
              {s.total >= h.total ? ' 多 ' : ' 少 '}
              {Math.abs(s.total - h.total).toFixed(1)} 个百分点
            </b>
            ，最大回撤
            <b className={s.dd <= h.dd ? styles.down : styles.up}>
              {s.dd <= h.dd ? ' 低 ' : ' 高 '}
              {Math.abs(h.dd - s.dd).toFixed(1)} 个百分点
            </b>
            。
          </p>
          <div className={styles.tableScroll} role="region" aria-label="当前参数与一直持有对比" tabIndex={0}>
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>方案</th>
                  <th>区间收益</th>
                  <th>年化</th>
                  <th>最大回撤</th>
                  <th>卡玛</th>
                  <th>夏普</th>
                  <th>交易</th>
                  <th>平均仓位</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['当前参数', s],
                  ['一直持有', { ...h, exposure: 100 }]
                ].map(([label, m]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className={tone(m.total)}>{pct(m.total)}</td>
                    <td className={tone(m.annual)}>{pct(m.annual)}</td>
                    <td className={styles.down}>{pct(-m.dd)}</td>
                    <td>{ratio(m.calmar)}</td>
                    <td>{ratio(m.sharpe)}</td>
                    <td>{m.trades}</td>
                    <td>{Number.isFinite(m.exposure) ? `${m.exposure.toFixed(0)}%` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {charts ? (
            <>
              <div className={styles.labZoom}>
                <span className={styles.labGroupLabel}>图表</span>
                <div className={styles.labSeg} role="group" aria-label="图表缩放">
                  <button
                    type="button"
                    onClick={() => setShown(zoomAround(shown, 0.5, 1, length))}
                    disabled={shown.end - shown.start + 1 <= MIN_SPAN}
                  >
                    放大
                  </button>
                  <button type="button" onClick={() => setShown(zoomAround(shown, 2, 1, length))} disabled={!zoomed}>
                    缩小
                  </button>
                  <button type="button" onClick={() => zoomTo(60)}>
                    看近60日
                  </button>
                  <button type="button" onClick={() => zoomTo(250)}>
                    看近1年
                  </button>
                  <button type="button" onClick={() => zoomTo(0)} disabled={!zoomed}>
                    看全部
                  </button>
                </div>
                <label className={styles.labCheck}>
                  <input type="checkbox" checked={rebase} onChange={(event) => setRebase(event.target.checked)} />
                  可见区间起点为 0%
                </label>
                <small className={styles.riskMuted}>
                  {charts.rangeText} · {charts.base} 为 0% · 拖动平移，Ctrl/⌘ + 滚轮缩放
                </small>
              </div>
              <Legend
                items={[
                  [colors.nav, '净值涨跌'],
                  [colors.muted, '均线', 'dotted'],
                  [colors.sell, '卖出线', 'dashed'],
                  [colors.buy, '买回线', 'dashdot'],
                  [colors.sell, '▲ 卖出', 'mark'],
                  [colors.buy, '▼ 买回', 'mark'],
                  [colors.danger, '✕ 止损', 'mark'],
                  [colors.primary, '● 重新买入', 'mark']
                ]}
              />
              <div
                ref={chartBoxRef}
                className={cn(styles.labChart, zoomed && styles.labChartZoomed)}
                tabIndex={0}
                role="group"
                aria-label={`净值涨跌、均线、卖出线、买回线和买卖点，${charts.rangeText}。左右方向键平移，加减号缩放，Home 显示全部。`}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={() => setView(null)}
              >
                <Line data={charts.nav.data} options={charts.nav.options} />
              </div>
              <Legend
                items={[
                  [colors.primary, '当前参数收益率'],
                  [colors.text, '一直持有收益率', 'dashdot']
                ]}
              />
              <div className={cn(styles.labChart, styles.labChartMid)}>
                <Line data={charts.equity.data} options={charts.equity.options} />
              </div>
              <div className={cn(styles.labChart, styles.labChartLow)} aria-label="距最高点的回撤">
                <Line data={charts.dd.data} options={charts.dd.options} />
              </div>
            </>
          ) : null}

          <section className={styles.labSection} aria-labelledby={`${fundId}-bt-log`}>
            <h4 id={`${fundId}-bt-log`} className={styles.paneTitle}>
              交易记录
            </h4>
            <p className={styles.riskMuted}>
              {result.log.length
                ? `卖出 ${exits.length} 次，盈利 ${exits.filter((t) => t.pnl > 0).length} 次 · 已实现盈亏 ${signedYuan(result.log.at(-1).realized)} · 费用 ${yuan(feeTotal)} · 期末总收益率 ${pct(s.total)}（按初始 1 万元）`
                : '当前参数在区间内没有交易。'}
            </p>
            {logRows.length ? (
              <div
                className={cn(styles.tableScroll, styles.labLog)}
                role="region"
                aria-label="交易记录，可滚动"
                tabIndex={0}
              >
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>操作</th>
                      <th>金额</th>
                      <th title="卖出：相对买入成本；买回：相对上次卖出价">涨跌幅</th>
                      <th>盈亏</th>
                      <th>费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...logRows].reverse().map((t) => (
                      <tr key={`${t.i}-${t.type}`}>
                        <td>{t.d}</td>
                        <td className={t.type === 'buy' || t.type === 'reenter' ? styles.down : styles.up}>
                          {TYPE[t.type]}
                        </td>
                        <td>{yuan(t.amount)}</td>
                        <td className={tone(t.change)}>{t.change === null ? '—' : pct(t.change)}</td>
                        <td className={tone(t.pnl)}>{t.pnl === null ? '—' : signedYuan(t.pnl)}</td>
                        <td>{t.fee > 0.005 ? `¥${t.fee.toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className={styles.riskMuted}>
              卖出的涨跌幅是本笔收益率（相对买入成本），买回的涨跌幅是相对上次卖出价。按当日正式净值成交，申购费{' '}
              {(Number(profileQuery.data?.fund_Rate) || 0).toFixed(2)}%，赎回费
              {rulesQuery.data?.redeemRows?.length ? '按持有天数分档' : '规则未获取，按 0 计'}
              ；历史回放不代表未来收益，不构成投资建议。
            </p>
          </section>
        </>
      )}
    </div>
  );
}
