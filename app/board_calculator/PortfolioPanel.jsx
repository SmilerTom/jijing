'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchFundHistory } from '@/app/api/fund';
import * as qk from '@/app/lib/query-keys';
import { cn } from '@/lib/utils';
import { computeMetrics, correlation, slicePeriod, toAdjustedSeries } from './analytics.mjs';
import { mergeHeldPositions } from './decision.mjs';
import { pct, ratio, toneOf } from './PerformancePanel';
import styles from './page.module.css';

const MAX_FUNDS = 15;
const UNTAGGED = '未标注';
const money = (value) => (Number.isFinite(value) ? `¥${Math.round(value).toLocaleString('zh-CN')}` : '--');

export default function PortfolioPanel({ fundId, funds, holdings, groupHoldings, currentSeries }) {
  const positions = useMemo(() => mergeHeldPositions(holdings, groupHoldings), [holdings, groupHoldings]);
  const codes = useMemo(() => {
    const held = Object.keys(positions);
    const ordered = held.includes(fundId) ? [fundId, ...held.filter((code) => code !== fundId)] : held;
    return ordered.slice(0, MAX_FUNDS);
  }, [positions, fundId]);
  const queries = useQueries({
    queries: codes.map((code) => ({
      queryKey: qk.fundHistory(code, '1y'),
      queryFn: () => fetchFundHistory(code, '1y'),
      staleTime: 30 * 60 * 1000
    }))
  });
  const loading = queries.some((query) => query.isPending);
  const rows = codes.map((code, index) => {
    const fund = funds.find((item) => item.code === code);
    const series =
      code === fundId && currentSeries?.length
        ? slicePeriod(currentSeries, '1y')
        : toAdjustedSeries(queries[index]?.data);
    const lastNav = Number(fund?.gsz) || Number(fund?.dwjz) || Number(queries[index]?.data?.at(-1)?.value);
    const value = Number(positions[code]?.share) * (lastNav || NaN);
    return {
      code,
      name: fund?.name || code,
      sector: fund?.relatedSectorQuoteName || fund?.relatedSector || UNTAGGED,
      value,
      series,
      metrics: series?.length >= 2 ? computeMetrics(series) : null
    };
  });
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0), 0);
  const self = rows.find((row) => row.code === fundId);
  rows.forEach((row) => {
    row.weight = total > 0 && Number.isFinite(row.value) ? (row.value / total) * 100 : NaN;
    row.correlation = row.code === fundId || !self?.series ? null : correlation(self.series, row.series || []);
  });
  const sectors = Object.entries(
    rows.reduce((map, row) => {
      if (Number.isFinite(row.weight)) map[row.sector] = (map[row.sector] || 0) + row.weight;
      return map;
    }, {})
  ).sort((a, b) => b[1] - a[1]);
  const tagged = sectors.filter(([name]) => name !== UNTAGGED);
  const highCorr = rows.filter((row) => row.correlation !== null && row.correlation >= 0.8);
  const notes = [
    self && self.weight > 30 ? `本基金占组合 ${self.weight.toFixed(0)}%，单只集中度偏高。` : '',
    sectors[0] && sectors[0][0] !== UNTAGGED && sectors[0][1] > 50
      ? `「${sectors[0][0]}」方向合计 ${sectors[0][1].toFixed(0)}%，行业集中。`
      : '',
    sectors.some(([name]) => name === UNTAGGED) ? '部分基金缺少关联板块，行业集中度按已标注部分估算。' : '',
    highCorr.length ? `与 ${highCorr.map((row) => row.name).join('、')} 走势高度相关（≥ 0.8），分散效果有限。` : ''
  ].filter(Boolean);

  if (!codes.length) {
    return (
      <p className={styles.riskMuted}>还没有任何持仓。在首页录入持仓后，这里会显示组合占比、行业集中度和相关性。</p>
    );
  }
  return (
    <div className={styles.historyBlock}>
      <div className={styles.kpiMini}>
        <div>
          <span>组合市值（{codes.length} 只）</span>
          <b>{money(total)}</b>
        </div>
        <div>
          <span>本基金占比</span>
          <b>{self ? pct(self.weight).replace('+', '') : '未持有'}</b>
        </div>
        <div>
          <span>第一大方向</span>
          <b>{tagged[0] ? `${tagged[0][0]} ${tagged[0][1].toFixed(0)}%` : '未标注'}</b>
        </div>
      </div>
      {notes.length ? (
        <ul className={styles.noticeList}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.sectorBar} aria-label="行业方向占比">
        {sectors.map(([name, weight]) => (
          <span key={name} style={{ flexBasis: `${weight}%` }} title={`${name} ${weight.toFixed(1)}%`}>
            {weight >= 12 ? name : ''}
          </span>
        ))}
      </div>
      <div className={styles.tableScroll} role="region" aria-label="持仓对比，可横向滚动" tabIndex={0}>
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>基金</th>
              <th>占比</th>
              <th>近1年</th>
              <th>最大回撤</th>
              <th>波动</th>
              <th>夏普</th>
              <th>与本基金相关</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => (b.weight || 0) - (a.weight || 0))
              .map((row) => (
                <tr key={row.code} className={cn(row.code === fundId && styles.rowSelf)}>
                  <td>
                    {row.name}
                    <small className={styles.cellSub}>{row.code}</small>
                  </td>
                  <td>{pct(row.weight).replace('+', '')}</td>
                  <td className={toneOf(row.metrics?.totalReturn)}>{pct(row.metrics?.totalReturn)}</td>
                  <td>{pct(-row.metrics?.maxDrawdown)}</td>
                  <td>{pct(row.metrics?.volatility).replace('+', '')}</td>
                  <td>{ratio(row.metrics?.sharpe)}</td>
                  <td>{row.code === fundId ? '—' : ratio(row.correlation)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className={styles.bandHint}>
        {loading ? '正在加载各基金近 1 年净值… ' : ''}
        合并全局和各分组持仓，市值按最新估值或净值估算；方向取基金关联板块。最多统计 {MAX_FUNDS} 只。
      </p>
    </div>
  );
}
