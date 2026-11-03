'use client';

import { useEffect, useMemo, useState } from 'react';
import { CategoryScale, Chart as ChartJS, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { cn } from '@/lib/utils';
import { BAND_PERIODS, buildBandSeries, isBandConfigValid, normalizeBand, replayBandSignals } from './strategy.mjs';
import styles from './page.module.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

const HOLD_DRAWDOWN = 35.2;
const LEGEND = [
  { label: '净值（含分红）', color: 'var(--chart-1)', dash: 'none' },
  { label: '均线', color: 'var(--muted)', dash: '2 3' },
  { label: '卖出线', color: 'var(--chart-5)', dash: '6 3' },
  { label: '买回线', color: 'var(--chart-2)', dash: '6 3' }
];
const nav3 = (value) => (Number.isFinite(value) ? value.toFixed(3) : '--');
const money = (value) => `¥${Math.round(value).toLocaleString('zh-CN')}`;
const signed = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;

function useChartColors() {
  const [colors, setColors] = useState(null);
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const token = (name) => style.getPropertyValue(name).trim();
      setColors({
        nav: token('--chart-1'),
        muted: token('--muted'),
        upper: token('--chart-5'),
        lower: token('--chart-2'),
        grid: token('--border'),
        card: token('--card'),
        text: token('--text')
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

// 信号点里写“卖/买”，线尾写线名，不靠颜色区分
const bandLabels = (colors) => ({
  id: 'bandLabels',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((dataset, index) => {
      const points = chart.getDatasetMeta(index).data;
      if (dataset.markLetter) {
        ctx.fillStyle = colors.card;
        ctx.textAlign = 'center';
        dataset.data.forEach((value, at) => {
          if (value !== null) ctx.fillText(dataset.markLetter, points[at].x, points[at].y);
        });
      } else if (dataset.endLabel) {
        ctx.fillStyle = colors.text;
        ctx.textAlign = 'left';
        ctx.fillText(dataset.endLabel, chartArea.right + 6, points.at(-1).y);
      }
    });
    ctx.restore();
  }
});

function BandChart({ series, signals, period }) {
  const colors = useChartColors();
  const data = useMemo(() => {
    if (!colors) return null;
    const line = (label, key, color, dash, width = 1.5, endLabel) => ({
      label,
      endLabel,
      data: series.map((row) => row[key]),
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      borderDash: dash,
      pointRadius: 0,
      pointHoverRadius: 3
    });
    const marks = (label, type, color, letter) => {
      const byDate = new Map(signals.filter((item) => item.type === type).map((item) => [item.date, item.nav]));
      return {
        label,
        data: series.map((row) => byDate.get(row.date) ?? null),
        showLine: false,
        pointStyle: 'circle',
        pointRadius: 8,
        pointHoverRadius: 9,
        markLetter: letter,
        pointBackgroundColor: color,
        pointBorderColor: colors.card,
        pointBorderWidth: 2
      };
    };
    return {
      labels: series.map((row) => row.date),
      datasets: [
        marks('卖出信号', 'sell', colors.upper, '卖'),
        marks('买回信号', 'buy', colors.lower, '买'),
        line('净值', 'nav', colors.nav, [], 2),
        line(`${period} 日均线`, 'ma', colors.muted, [2, 3]),
        line('卖出线', 'upper', colors.upper, [6, 3], 1.5, '卖出线'),
        line('买回线', 'lower', colors.lower, [6, 3], 1.5, '买回线')
      ]
    };
  }, [colors, period, series, signals]);
  const options = useMemo(
    () =>
      colors && {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { right: 44 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.raw !== null,
            callbacks: { label: (item) => `${item.dataset.label} ${Number(item.raw).toFixed(3)}` }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: colors.muted,
              maxTicksLimit: 6,
              autoSkipPadding: 24,
              maxRotation: 0,
              callback(value) {
                return this.getLabelForValue(value).slice(0, 7);
              }
            }
          },
          y: { grid: { color: colors.grid }, ticks: { color: colors.muted, maxTicksLimit: 6 } }
        }
      },
    [colors]
  );
  const plugins = useMemo(() => (colors ? [bandLabels(colors)] : []), [colors]);
  if (!data) return null;
  return (
    <div className={styles.bandChart}>
      <Line
        data={data}
        options={options}
        plugins={plugins}
        role="img"
        aria-label={`净值、${period} 日均线和上下轨走势；共 ${signals.length} 次信号，明细见历史信号表。`}
      />
    </div>
  );
}

export default function ValuationBandPanel({
  fundId,
  strategy,
  state,
  history,
  loading,
  failed,
  split,
  onPeriod,
  onField,
  onReset
}) {
  const config = normalizeBand(strategy);
  const period = config.bandPeriod;
  const tested = BAND_PERIODS[period];
  const effective = isBandConfigValid(config)
    ? config
    : { ...config, bandSell: tested.sell, bandBuy: tested.buy, minHoldDays: 30 };
  const { bandSell, bandBuy, minHoldDays } = effective;
  const series = useMemo(
    () => buildBandSeries(history, { bandPeriod: period, bandSell, bandBuy }),
    [history, period, bandSell, bandBuy]
  );
  const signals = useMemo(() => replayBandSignals(series, minHoldDays), [series, minHoldDays]);
  const maLabel = `${period} 日均线`;
  const isTested =
    Number(config.bandSell) === tested.sell &&
    Number(config.bandBuy) === tested.buy &&
    Number(config.corePercent) === 70 &&
    Number(config.minHoldDays) === 30;
  const latest = series.at(-1);
  const ma = state.ma ?? latest?.ma;
  const hasBand = Number.isFinite(ma);
  const deviation = state.deviation ?? (hasBand ? (latest.nav / ma - 1) * 100 : null);
  const usable = Object.keys(BAND_PERIODS).filter((key) => Number(key) <= (history?.length ?? 0));
  const corePercent = Number(config.corePercent);
  const validCore = corePercent > 0 && corePercent < 100;
  const fields = [
    { key: 'corePercent', label: '底仓比例', suffix: '%', min: 1, max: 99, step: 1, hint: '这部分始终不交易' },
    {
      key: 'bandSell',
      label: '高于均线多少卖',
      suffix: '%',
      min: 0.1,
      max: 199,
      step: 0.1,
      hint: `按 ${maLabel} 计算`
    },
    { key: 'bandBuy', label: '低于均线多少买回', suffix: '%', min: 0.1, max: 89, step: 0.1, hint: '卖出后才生效' },
    { key: 'minHoldDays', label: '最少持有', suffix: '天', min: 0, max: 3650, step: 1, hint: '每笔成交后按日历天计算' }
  ];

  return (
    <div className={styles.bandPanel}>
      <div className={styles.bandStats}>
        {[
          ['净值', nav3(state.nav ?? latest?.nav), state.quoteDate || latest?.date || '待更新'],
          [maLabel, nav3(ma), hasBand ? `偏离 ${signed(deviation)}` : '数据不足'],
          ['卖出线', nav3(state.upper ?? latest?.upper), `均线 +${bandSell}%`],
          ['买回线', nav3(state.lower ?? latest?.lower), `均线 −${bandBuy}%`]
        ].map(([label, value, sub]) => (
          <div key={label} className={styles.bandStat}>
            <i>{label}</i>
            <b>{value}</b>
            <small>{sub}</small>
          </div>
        ))}
      </div>

      <div className={styles.bandCard}>
        <div className={styles.bandCardHead}>
          <h3 className={styles.bandHeading}>净值与估值带</h3>
          <ul className={styles.bandLegend}>
            {LEGEND.map((item) => (
              <li key={item.label}>
                <svg width="20" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="20" y2="2" stroke={item.color} strokeWidth="2" strokeDasharray={item.dash} />
                </svg>
                {item.label}
              </li>
            ))}
            <li>
              <i className={cn(styles.bandMark, styles.bandMarkSell)}>卖</i>卖出信号
            </li>
            <li>
              <i className={cn(styles.bandMark, styles.bandMarkBuy)}>买</i>买回信号
            </li>
          </ul>
        </div>
        {series.length ? (
          <BandChart series={series} signals={signals} period={period} />
        ) : (
          <p className={styles.bandEmpty} role={failed ? 'alert' : 'status'}>
            {loading
              ? '正在加载历史净值…'
              : failed
                ? '历史净值更新失败，已暂停生成新信号，刷新成功后自动恢复。'
                : `这只基金的净值历史不足 ${period} 个交易日，暂不生成信号。${usable.length ? `可在下方改用 ${usable.join('、')} 日均线。` : ''}`}
          </p>
        )}
        {failed && series.length ? (
          <p className={styles.strategyNote} role="alert">
            历史净值更新失败，图中是上次成功获取的数据。
          </p>
        ) : null}
      </div>

      <div className={styles.bandColumns}>
        <div className={styles.bandCard}>
          <div className={styles.bandCardHead}>
            <h3 className={styles.bandHeading}>策略设置</h3>
            <button type="button" className={styles.segButton} onClick={onReset} aria-label="恢复默认策略">
              默认
            </button>
          </div>
          <div role="group" aria-labelledby={`${fundId}-band-period`}>
            <p id={`${fundId}-band-period`} className={styles.bandLabel}>
              均线周期
            </p>
            <div className={styles.periodGrid}>
              {Object.keys(BAND_PERIODS).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cn(styles.segButton, Number(key) === period && styles.segActive)}
                  aria-pressed={Number(key) === period}
                  aria-label={`${key} 日均线`}
                  onClick={() => onPeriod(Number(key))}
                >
                  {key} 日
                </button>
              ))}
            </div>
            <small className={styles.bandHint}>
              切换周期时，上下轨换成该周期回测用的参数：+{tested.sell}% / −{tested.buy}%。
            </small>
          </div>
          <div className={styles.bandFields}>
            {fields.map((field) => (
              <label key={field.key} className={styles.strategyField} htmlFor={`${fundId}-${field.key}`}>
                <span>{field.label}</span>
                <span className={styles.strategyInputWrap}>
                  <input
                    id={`${fundId}-${field.key}`}
                    className={styles.strategyInput}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={strategy[field.key]}
                    onChange={(event) => onField(field.key, event.target.value)}
                    aria-describedby={`${fundId}-${field.key}-hint`}
                  />
                  <em>{field.suffix}</em>
                </span>
                <small id={`${fundId}-${field.key}-hint`}>{field.hint}</small>
              </label>
            ))}
          </div>
          <p className={styles.bandLabel}>
            仓位拆分{split ? (state.phase === 'waitingBuy' ? '（假设卖出已记入持仓）' : '（按当前持仓估算）') : ''}
          </p>
          {validCore ? (
            <>
              <div className={styles.bandBar} aria-hidden="true">
                <i style={{ width: `${corePercent}%` }} />
                <i className={state.phase === 'waitingBuy' ? styles.bandBarCash : styles.bandBarSleeve} />
              </div>
              <div className={styles.bandSplit}>
                <span>
                  底仓 {corePercent}%{split ? ` · ${money(split.core)}` : ''} · 不交易
                </span>
                <span>
                  {state.phase === 'waitingBuy' ? '机动仓（现金）' : '机动仓'} {100 - corePercent}%
                  {split ? ` · ${money(split.sleeve)}` : ''}
                </span>
              </div>
            </>
          ) : null}
        </div>

        <div className={styles.bandCard}>
          <h3 className={styles.bandHeading}>当前参数下的历史信号</h3>
          <div
            className={cn(styles.tableScroll, styles.bandSignals)}
            role="region"
            aria-label="历史信号，可横向滚动"
            tabIndex={0}
          >
            <table className={styles.miniTable}>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>动作</th>
                  <th>净值</th>
                  <th>偏离均线</th>
                </tr>
              </thead>
              <tbody>
                {signals.length ? (
                  [...signals].reverse().map((item) => (
                    <tr key={item.date}>
                      <td>{item.date}</td>
                      <td className={item.type === 'sell' ? styles.up : styles.down}>
                        {item.type === 'sell' ? '卖出机动仓' : '买回机动仓'}
                      </td>
                      <td>{nav3(item.nav)}</td>
                      <td>{signed(item.deviation)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className={styles.emptyCell}>
                      {series.length ? '当前参数下没有触发信号' : '暂无数据'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className={styles.bandLabel}>回测提醒（8 只基金，5 年滚动窗口）</p>
          <p className={styles.bandEvidence}>
            {isTested ? '' : '当前设置没有回测过，以下是该周期默认参数（70% 底仓、最少持有 30 天）的结果。'}
            相比一直持有：中位年化少 {tested.lessReturn}%，只有 {tested.winRate}% 的窗口跑赢；中位最大回撤{' '}
            {tested.drawdown}%，持有为 {HOLD_DRAWDOWN}%；5 年约 {tested.trades} 笔交易（含建仓 2
            笔）。这条规则不保证多赚。
          </p>
        </div>
      </div>
    </div>
  );
}
