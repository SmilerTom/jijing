'use client';

import { useState } from 'react';
import { PERIODS } from './analytics.mjs';
import styles from './page.module.css';

export const pct = (value, digits = 2) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%` : '--';
export const ratio = (value) => (Number.isFinite(value) ? value.toFixed(2) : '--');
export const toneOf = (value) => (value > 0 ? styles.up : value < 0 ? styles.down : undefined);

function Metric({ label, value, tone, sub, hint }) {
  return (
    <div className={styles.metric} title={hint}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

export default function PerformancePanel({ byPeriod, years, worst, xirrValue, loading, failed, benchmarkFailed }) {
  const available = PERIODS.filter(([key]) => byPeriod[key]);
  const [picked, setPicked] = useState('1y');
  const period = byPeriod[picked] ? picked : available.at(-1)?.[0];
  const metrics = period ? byPeriod[period] : null;
  const bench = metrics?.benchmark;
  return (
    <section className={styles.advisorCard} aria-labelledby="performance-title">
      <div className={styles.cardHeadRow}>
        <h3 id="performance-title" className={styles.advisorCardTitle}>
          业绩与风险
        </h3>
        <div className={styles.periodSwitch} role="group" aria-label="统计区间">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              disabled={!byPeriod[key]}
              onClick={() => setPicked(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!metrics ? (
        <p className={styles.riskMuted} role={failed ? 'alert' : 'status'}>
          {loading ? '正在加载完整净值历史…' : failed ? '净值历史加载失败，暂无法计算业绩指标。' : '净值历史不足。'}
        </p>
      ) : (
        <>
          <div className={styles.metricGrid}>
            <Metric
              label="区间收益"
              value={pct(metrics.totalReturn)}
              tone={toneOf(metrics.totalReturn)}
              sub={bench ? `沪深 300 ${pct(bench.totalReturn)}` : '基准待加载'}
            />
            <Metric
              label="超额收益"
              value={pct(bench?.excessReturn)}
              tone={toneOf(bench?.excessReturn)}
              sub={bench ? `跑赢天数 ${bench.winRate.toFixed(0)}%` : '--'}
              hint="区间收益减去沪深 300 同期收益"
            />
            <Metric
              label="年化收益"
              value={pct(metrics.annualReturn)}
              tone={toneOf(metrics.annualReturn)}
              sub={`${metrics.start.slice(2)} 起 · ${metrics.days} 天`}
            />
            <Metric
              label="最大回撤"
              value={pct(-metrics.maxDrawdown)}
              tone={metrics.maxDrawdown > 0 ? styles.down : undefined}
              sub={
                metrics.drawdown.recoveryDays !== null
                  ? `${metrics.drawdown.recoveryDays} 天修复`
                  : metrics.maxDrawdown > 0
                    ? '尚未修复'
                    : '--'
              }
              hint={`${metrics.drawdown.peakDate} 高点 → ${metrics.drawdown.troughDate} 低点`}
            />
            <Metric
              label="年化波动"
              value={pct(metrics.volatility).replace('+', '')}
              sub={bench ? `跟踪误差 ${pct(bench.trackingError).replace('+', '')}` : '--'}
            />
            <Metric
              label="夏普比率"
              value={ratio(metrics.sharpe)}
              sub={`索提诺 ${ratio(metrics.sortino)}`}
              hint="无风险利率按 2% 计"
            />
            <Metric label="Beta" value={ratio(bench?.beta)} sub={`信息比率 ${ratio(bench?.infoRatio)}`} />
            <Metric
              label="卡玛比率"
              value={ratio(metrics.calmar)}
              sub={Number.isFinite(xirrValue) ? `我的资金年化 ${pct(xirrValue)}` : '无交易记录算资金年化'}
              hint="年化收益 ÷ 最大回撤；资金年化按交易记录计算（XIRR）"
            />
          </div>
          {benchmarkFailed ? <p className={styles.riskMuted}>沪深 300 数据加载失败，相对指标暂缺。</p> : null}
          <details className={styles.moreFold}>
            <summary>年度收益与最差区间</summary>
            <div className={styles.foldGrid}>
              <div className={styles.tableScroll} role="region" aria-label="自然年收益" tabIndex={0}>
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>年份</th>
                      <th>本基金</th>
                      <th>沪深 300</th>
                      <th>超额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...years].reverse().map((item) => (
                      <tr key={item.year}>
                        <td>
                          {item.year}
                          {item.partial ? '*' : ''}
                        </td>
                        <td className={toneOf(item.fund)}>{pct(item.fund)}</td>
                        <td className={toneOf(item.benchmark)}>{pct(item.benchmark)}</td>
                        <td className={toneOf(item.fund - item.benchmark)}>
                          {item.benchmark === null ? '--' : pct(item.fund - item.benchmark)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={styles.riskMuted}>* 不满整年</p>
              </div>
              <div>
                <h4 className={styles.paneTitle}>历史最差区间</h4>
                <ul className={styles.plainList}>
                  {worst.map((item) => (
                    <li key={item.size}>
                      <span>连续 {item.size} 个交易日</span>
                      <b className={styles.down}>{pct(item.change)}</b>
                      <small>
                        {item.start} → {item.end}
                      </small>
                    </li>
                  ))}
                </ul>
                <p className={styles.riskMuted}>用来估计极端行情下的承受压力，不代表未来一定会再现。</p>
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
