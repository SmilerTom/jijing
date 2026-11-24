'use client';

import { isArray } from 'lodash';
import { pct } from './PerformancePanel';
import styles from './page.module.css';

const latest = (block, name) => {
  const series = isArray(block?.series) ? block.series : [];
  const item = name ? series.find((entry) => entry?.name === name) : series[0];
  const data = isArray(item?.data) ? item.data : [];
  const value = data.at(-1);
  return Number.isFinite(Number(value?.y ?? value)) ? Number(value?.y ?? value) : null;
};
const lastCategory = (block) => (isArray(block?.categories) ? block.categories.at(-1) : '');

/** 基金档案：经理、规模、费率、资产配置、持有人、同类排名与评分 */
export default function ProfilePanel({ profile, tiers, loading, failed, onRetry }) {
  if (loading) return <p className={styles.riskMuted}>正在加载基金档案…</p>;
  if (failed || !profile)
    return (
      <p className={styles.riskMuted} role="status">
        基金档案加载失败。
        <button type="button" className={styles.riskLink} onClick={onRetry}>
          重试
        </button>
      </p>
    );
  const manager = isArray(profile.Data_currentFundManager) ? profile.Data_currentFundManager[0] : null;
  const scaleSeries = isArray(profile.Data_fluctuationScale?.series) ? profile.Data_fluctuationScale.series : [];
  const scale = scaleSeries.at(-1);
  const rank = isArray(profile.Data_rateInSimilarType) ? profile.Data_rateInSimilarType.at(-1) : null;
  const rankPercent = isArray(profile.Data_rateInSimilarPersent)
    ? Number(profile.Data_rateInSimilarPersent.at(-1)?.[1])
    : null;
  const evaluation = profile.Data_performanceEvaluation;
  const fee = Number(profile.fund_Rate);
  const sourceFee = Number(profile.fund_sourceRate);
  const facts = [
    [
      '基金经理',
      manager ? `${manager.name} · 任职 ${manager.workTime}` : '--',
      manager ? `在管 ${manager.fundSize}` : ''
    ],
    [
      '基金规模',
      Number.isFinite(Number(scale?.y)) ? `${Number(scale.y).toFixed(2)} 亿` : '--',
      scale ? `${lastCategory(profile.Data_fluctuationScale)} · 环比 ${scale.mom}` : ''
    ],
    [
      '申购费率',
      Number.isFinite(fee) ? `${fee.toFixed(2)}%` : '--',
      Number.isFinite(sourceFee) && sourceFee !== fee ? `原费率 ${sourceFee.toFixed(2)}%` : ''
    ],
    [
      '同类排名',
      rank ? `${rank.y} / ${rank.sc}` : '--',
      Number.isFinite(rankPercent) ? `超过 ${rankPercent.toFixed(0)}% 同类` : ''
    ],
    [
      '资产配置',
      Number.isFinite(latest(profile.Data_assetAllocation, '股票占净比'))
        ? `股票 ${latest(profile.Data_assetAllocation, '股票占净比').toFixed(1)}%`
        : '--',
      `债券 ${pct(latest(profile.Data_assetAllocation, '债券占净比')).replace('+', '')} · 现金 ${pct(latest(profile.Data_assetAllocation, '现金占净比')).replace('+', '')}`
    ],
    [
      '持有人结构',
      Number.isFinite(latest(profile.Data_holderStructure, '机构持有比例'))
        ? `机构 ${latest(profile.Data_holderStructure, '机构持有比例').toFixed(1)}%`
        : '--',
      lastCategory(profile.Data_holderStructure) ? `截至 ${lastCategory(profile.Data_holderStructure)}` : ''
    ]
  ];
  return (
    <div className={styles.historyBlock}>
      <dl className={styles.factGrid}>
        {facts.map(([label, value, sub]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
            {sub ? <dd className={styles.factSub}>{sub}</dd> : null}
          </div>
        ))}
      </dl>
      {isArray(evaluation?.categories) && isArray(evaluation?.data) ? (
        <div>
          <h4 className={styles.paneTitle}>东方财富综合评分 {evaluation.avr}</h4>
          <ul className={styles.scoreList}>
            {evaluation.categories.map((name, index) => (
              <li key={name}>
                <span>{name}</span>
                <span className={styles.scoreBar} aria-hidden="true">
                  <i style={{ width: `${Math.min(100, Number(evaluation.data[index]) || 0)}%` }} />
                </span>
                <b>{Number(evaluation.data[index]).toFixed(0)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tiers?.length ? (
        <div>
          <h4 className={styles.paneTitle}>赎回费</h4>
          <ul className={styles.plainList}>
            {tiers.map((tier) => (
              <li key={tier.minDays}>
                <span>
                  {tier.maxDays === Infinity ? `持有 ≥ ${tier.minDays} 天` : `持有 ${tier.minDays}–${tier.maxDays} 天`}
                </span>
                <b>{(tier.rate * 100).toFixed(2)}%</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className={styles.bandHint}>数据来自东方财富基金档案，规模、配置和持有人按最近一期报告。</p>
    </div>
  );
}
