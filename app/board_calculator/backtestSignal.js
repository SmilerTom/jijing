import { isObject } from 'lodash';
import { storageStore } from '@/app/stores/storageStore';
import { toAdjustedSeries } from './analytics.mjs';
import { DEFAULTS, prepare } from './backtestEngine.mjs';
import { parseRedemptionTiers } from './decision.mjs';

export const SIGNAL_TITLE = { sell: '卖出', buy: '买回', stop: '止损清仓', reenter: '重新买入' };

const pct = (value, digits = 2) =>
  Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}%` : '--';

export const backtestStorageKey = (fundId) => `board-backtest:${fundId}`;

/** 本基金均线带策略设置 → 回测参数，作为第一次打开时的起点（交易间隔默认 0，不沿用策略的持有天数） */
function paramsFromStrategy(fundId) {
  const saved = storageStore.getItem(`board-calculator:${fundId}`, null)?.strategy;
  if (!isObject(saved)) return {};
  const num = (value) => (Number.isFinite(Number(value)) && value !== '' ? Number(value) : undefined);
  const mapped = {
    n: num(saved.bandPeriod),
    sell: num(saved.bandSell),
    buy: num(saved.bandBuy),
    core: num(saved.corePercent),
    batch: 1,
    buyback: 'lower'
  };
  return Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined));
}

/** 回测标签保存的参数；没保存过时按本基金策略设置生成 */
export function loadBacktestParams(fundId) {
  const saved = storageStore.getItem(backtestStorageKey(fundId), null);
  return { ...DEFAULTS, cashYield: 1.5, ...paramsFromStrategy(fundId), ...(isObject(saved) ? saved : {}) };
}

export const cleanBacktestParams = (params) => ({
  ...params,
  n: Math.max(2, Math.round(Number(params.n) || DEFAULTS.n)),
  sell: Math.max(0.1, Number(params.sell) || 0.1),
  buy: Math.max(0, Number(params.buy) || 0),
  core: Math.min(100, Math.max(0, Number(params.core) || 0)),
  interval: Math.max(0, Number(params.interval) || 0),
  stop: Math.min(90, Math.max(0, Number(params.stop) || 0)),
  cashYield: Math.max(0, Number(params.cashYield) || 0),
  trendLookback: Math.max(1, Math.round(Number(params.trendLookback) || 20)),
  timeoutDays: Math.max(1, Math.round(Number(params.timeoutDays) || 60))
});

/** 净值历史 + 赎回费规则 + 申购费率 → 回测引擎输入；历史不足 30 天返回 null */
export function prepareBacktestData(history, redeemRows, fundRate) {
  const series = toAdjustedSeries(history);
  if (series.length < 30) return null;
  const tiers = parseRedemptionTiers(redeemRows);
  return prepare({
    dates: series.map((row) => row.date),
    nav: series.map((row) => row.nav),
    tiers: tiers
      ? tiers.map((tier) => [tier.minDays, Number.isFinite(tier.maxDays) ? tier.maxDays : null, tier.rate])
      : [[0, null, 0]],
    buyFee: Number(fundRate) / 100 || 0
  });
}

/** 今日信号 → 结论、原因和色调；positionValue 为 0 时只显示占持仓比例 */
export function describeSignal(signal, params, positionValue) {
  const trade = signal.trades[0];
  const money = (value) => `¥${Math.round(value).toLocaleString('zh-CN')}`;
  const amountText = (share) =>
    positionValue > 0
      ? `约 ${money(share * positionValue)}（持仓的 ${(share * 100).toFixed(0)}%）`
      : `约占持仓的 ${(share * 100).toFixed(0)}%`;
  let headline = '不操作';
  let reason = '净值在买回线和卖出线之间，按规则不交易。';
  let tone = 'calm';
  if (trade) {
    headline = `${SIGNAL_TITLE[trade.type]} ${amountText(trade.share)}`;
    tone = trade.type === 'sell' || trade.type === 'stop' ? 'sell' : 'buy';
    reason =
      trade.type === 'sell'
        ? `净值高于 ${params.n} 日均线 ${signal.deviation.toFixed(2)}%，超过卖出线 +${params.sell}%。`
        : trade.type === 'buy'
          ? params.buyback === 'ma'
            ? `净值回到 ${params.n} 日均线附近（${pct(signal.deviation)}），满足“回到均线买回”。`
            : `净值低于均线 ${Math.abs(signal.deviation).toFixed(2)}%，到达买回线 −${params.buy}%。`
          : trade.type === 'stop'
            ? `净值从跟踪高点回落超过 ${params.stop}%，触发回撤止损，含底仓全部卖出。`
            : `止损后净值重新站上 ${params.n} 日均线，按底仓比例买回。`;
    if (trade.pnl !== null)
      reason += ` 这部分按回测成本估算${trade.pnl >= 0 ? '盈利' : '亏损'} ${pct(trade.pnlRate)}。`;
  } else if (signal.state.stopped) {
    reason = `回测处于止损后空仓状态，等净值重新站上 ${params.n} 日均线再买回（当前偏离 ${pct(signal.deviation)}）。`;
  } else if (signal.waitDays > 0 && (signal.price >= signal.upper || signal.price <= signal.lower)) {
    headline = '已到线，暂不操作';
    reason = `距上次交易还没满 ${params.interval} 天，还需等 ${signal.waitDays} 天。`;
    tone = 'warn';
  } else if (signal.trendBlocks && signal.price >= signal.upper) {
    headline = '已到卖出线，暂不卖';
    reason = `开启了趋势过滤，${params.n} 日均线仍在向上，按规则不卖出。`;
    tone = 'warn';
  } else if (signal.price >= signal.upper && signal.state.sleeveShare < 0.001) {
    reason = '已高于卖出线，但回测里机动仓已经卖完，没有可卖的部分。';
  } else if (signal.price <= signal.lower && signal.state.cashShare < 0.001) {
    reason = '已低于买回线，但回测里没有待买回的现金，机动仓本来就在手。';
  }
  return { headline, reason, tone };
}
