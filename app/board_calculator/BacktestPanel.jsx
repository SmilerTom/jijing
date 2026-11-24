'use client';

import { pct, ratio, toneOf } from './PerformancePanel';
import styles from './page.module.css';

function CurveChart({ result }) {
  const { curve, hold } = result;
  if (curve.length < 2) return null;
  const values = [...curve, ...hold].map((row) => row.nav);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index) => (index / (curve.length - 1)) * 600;
  const y = (value) => 8 + ((max - value) / span) * 124;
  const line = (rows) => rows.map((row, index) => `${x(index).toFixed(1)},${y(row.nav).toFixed(1)}`).join(' ');
  return (
    <figure className={styles.curveFigure}>
      <svg
        className={styles.curveChart}
        viewBox="0 0 600 140"
        preserveAspectRatio="none"
        role="img"
        aria-label={`策略净值 ${pct(result.strategy.totalReturn)}，一直持有 ${pct(result.holding.totalReturn)}`}
      >
        <polyline points={line(hold)} className={styles.curveHold} />
        <polyline points={line(curve)} className={styles.curveStrategy} />
      </svg>
      <figcaption className={styles.forecastLegend}>
        <span>
          <i className={styles.legendStrategy} />
          按当前策略
        </span>
        <span>
          <i className={styles.legendHold} />
          一直持有
        </span>
        <span>
          {curve[0].date} → {curve.at(-1).date}
        </span>
      </figcaption>
    </figure>
  );
}

export default function BacktestPanel({ result, bandMode, feeKnown, loading }) {
  if (!result) {
    return (
      <p className={styles.riskMuted} role="status">
        {loading ? '正在加载完整净值历史…' : '历史数据不足，暂无法回测当前参数。'}
      </p>
    );
  }
  const { strategy, holding } = result;
  const better = result.edge >= 0;
  const rows = [
    ['区间收益', pct(strategy.totalReturn), pct(holding.totalReturn)],
    ['年化收益', pct(strategy.annualReturn), pct(holding.annualReturn)],
    ['最大回撤', pct(-strategy.maxDrawdown), pct(-holding.maxDrawdown)],
    ['年化波动', pct(strategy.volatility).replace('+', ''), pct(holding.volatility).replace('+', '')],
    ['夏普比率', ratio(strategy.sharpe), ratio(holding.sharpe)]
  ];
  return (
    <div className={styles.historyBlock}>
      <p className={styles.backtestVerdict}>
        按当前参数回放 {strategy.start} 至 {strategy.end}，策略比一直持有
        <b className={toneOf(result.edge)}>
          {better ? '多' : '少'}赚 {Math.abs(result.edge).toFixed(2)} 个百分点
        </b>
        ，最大回撤
        {strategy.maxDrawdown <= holding.maxDrawdown
          ? `低 ${(holding.maxDrawdown - strategy.maxDrawdown).toFixed(2)} 个百分点`
          : `高 ${(strategy.maxDrawdown - holding.maxDrawdown).toFixed(2)} 个百分点`}
        。
      </p>
      <CurveChart result={result} />
      <div className={styles.tableScroll} role="region" aria-label="策略与一直持有对比" tabIndex={0}>
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>指标</th>
              <th>当前策略</th>
              <th>一直持有</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, mine, hold]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{mine}</td>
                <td>{hold}</td>
              </tr>
            ))}
            <tr>
              <td>交易次数</td>
              <td>{result.trades}</td>
              <td>0</td>
            </tr>
            <tr>
              <td>申赎费用（占初始资金）</td>
              <td>{pct(result.fees).replace('+', '')}</td>
              <td>0.00%</td>
            </tr>
            <tr>
              <td>{bandMode ? '机动仓空仓时间' : '空仓时间'}</td>
              <td>{result.cashShare.toFixed(0)}%</td>
              <td>0%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={styles.bandHint}>
        {bandMode
          ? '底仓始终持有，机动仓按信号卖出、买回。'
          : '按全部仓位执行：涨到卖出线卖出，回落到买回线买回，触发止损后不再买回。'}
        已扣申购费{feeKnown ? '和按持有天数的赎回费' : '；赎回费规则暂未获取，按 0 计'}
        ；空仓资金不计利息。历史回放不代表未来收益。
      </p>
    </div>
  );
}
