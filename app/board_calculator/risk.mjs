import lodash from 'lodash';

const { isArray, isString } = lodash;

const finite = (value) => Number.isFinite(value);
const pct = (value, digits = 2) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%`;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + (next - sorted[base]) * (position - base);
};
const movingAverage = (values, end, size) => (end + 1 >= size ? mean(values.slice(end + 1 - size, end + 1)) : NaN);

/** 按日期升序整理净值序列，过滤无效值 */
export function toNavSeries(history = []) {
  if (!isArray(history)) return [];
  const byDate = new Map();
  history.forEach((item) => {
    const nav = Number(item?.unitNetValue ?? item?.value);
    if (isString(item?.date) && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && nav > 0) byDate.set(item.date, nav);
  });
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, nav]) => ({ date, nav }));
}

/** 风险等级：按最高值回落占止损线的比例划分 */
export function classifyRisk(state = {}) {
  const drawdown = Number(state.drawdown);
  const stopLine = Number(state.stopDrawdown);
  if (state.status === 'stopped') return { level: 'neutral', title: '止损后暂停跟踪' };
  if (state.status === 'cooldown') return { level: 'neutral', title: `冷静期 · 还剩 ${state.remainingDays} 天` };
  if (!finite(drawdown) || !(stopLine > 0)) return { level: 'neutral', title: '风险待评估' };
  const remaining = stopLine - drawdown;
  const ratio = Math.min(1, drawdown / stopLine);
  if (state.status === 'stop')
    return {
      level: 'high',
      title: '高风险 · 已触发止损，提示卖出',
      ratio,
      drawdown,
      stopLine,
      remaining,
      summary: `已超过止损线 ${Math.abs(remaining).toFixed(2)}%，止损优先于补仓`
    };
  return {
    level: ratio >= 0.7 ? 'mid' : 'low',
    title: ratio >= 0.7 ? '中风险 · 接近止损线' : '低风险 · 运行正常',
    ratio,
    drawdown,
    stopLine,
    remaining,
    summary: `较跟踪最高 ${Number(state.peakNav).toFixed(4)} 回落，距止损线还差 ${remaining.toFixed(2)}%`
  };
}

/** 跟踪起点之后近 N 个交易日相对最高值的回落幅度，用于走势小图 */
export function drawdownSeries(navs, peakNav, size = 10, startDate = '') {
  let peak = peakNav > 0 ? peakNav : 0;
  const series = navs
    .filter((item) => item.date >= startDate)
    .map(({ date, nav }) => {
      peak = Math.max(peak, nav);
      return { date, drawdown: Math.max(0, (1 - nav / peak) * 100) };
    });
  return series.slice(-size);
}

/** 基金自身的风险走势提醒：连续下跌、回落加速、板块弱于大盘 */
export function buildRiskAlerts({ navs = [], sectorName, sectorPct, benchmarkPct } = {}) {
  const alerts = [];
  const values = navs.map((item) => item.nav);
  let downDays = 0;
  for (let index = values.length - 1; index > 0 && values[index] < values[index - 1]; index -= 1) downDays += 1;
  if (downDays >= 2) {
    const start = values[values.length - 1 - downDays];
    alerts.push({
      tone: 'down',
      icon: 'trend',
      text: `连续 ${downDays} 个交易日下跌，累计 ${pct((values.at(-1) / start - 1) * 100)}`
    });
  }
  if (values.length >= 11) {
    const recent = (values.at(-1) / values.at(-6) - 1) * 100;
    const previous = (values.at(-6) / values.at(-11) - 1) * 100;
    if (recent <= -2 && recent < previous - 1)
      alerts.push({
        tone: 'warn',
        icon: 'speed',
        text: `跌势加快：近 5 日 ${pct(recent)}，前 5 日 ${pct(previous)}`
      });
  }
  if (finite(sectorPct) && finite(benchmarkPct) && sectorPct < benchmarkPct - 0.5)
    alerts.push({
      tone: 'neutral',
      icon: 'sector',
      text: `${sectorName || '所属板块'}最新交易日 ${pct(sectorPct)}，弱于沪深 300（${pct(benchmarkPct)}）`
    });
  return alerts;
}

const describeSignal = ({ above, ret5Bucket }) =>
  `收盘在 20 日均线${above ? '上方' : '下方'}且 5 日${ret5Bucket === 0 ? '涨跌在 ±3% 内' : ret5Bucket > 0 ? '涨幅超 3%' : '跌幅超 3%'}`;
const signalAt = (closes, index) => {
  const ma20 = movingAverage(closes, index, 20);
  const ret5 = (closes[index] / closes[index - 5] - 1) * 100;
  return { above: closes[index] > ma20, ret5Bucket: ret5 > 3 ? 1 : ret5 < -3 ? -1 : 0 };
};

/**
 * 板块趋势：5 项依据打分 + 同类信号下的历史次日涨跌频率和 5 日收益分布
 * @param {{date:string, close:number}[]} klines 升序日 K
 * @param {{date:string, net:number}[]} flows 升序主力净流入（元）
 */
export function analyzeSectorTrend({ klines = [], flows = [], sectorPct, benchmarkPct } = {}) {
  const closes = klines.map((item) => Number(item.close)).filter((value) => value > 0);
  if (closes.length < 30) return null;
  const last = closes.length - 1;
  const close = closes[last];
  const ma5 = movingAverage(closes, last, 5);
  const ma20 = movingAverage(closes, last, 20);
  const evidence = [];

  const maStance = close > ma20 && ma5 > ma20 ? 'bull' : close < ma20 && ma5 < ma20 ? 'bear' : 'neutral';
  evidence.push({
    key: 'ma',
    label: '均线位置',
    stance: maStance,
    text: `收盘${close > ma5 ? '高于' : '低于'} MA5、${close > ma20 ? '高于' : '低于'} MA20，MA5 ${ma5 > ma20 ? '高于' : '低于'} MA20`
  });

  const momentum = (index) => (closes[index] / closes[index - 20] - 1) * 100;
  const currentMomentum = momentum(last);
  const pastMomentum = [];
  for (let index = Math.max(20, last - 250); index < last; index += 1) pastMomentum.push(momentum(index));
  const rank = pastMomentum.filter((value) => value < currentMomentum).length / Math.max(1, pastMomentum.length);
  evidence.push({
    key: 'momentum',
    label: '20 日动量',
    stance: rank >= 0.7 ? 'bull' : rank <= 0.3 ? 'bear' : 'neutral',
    text: `${pct(currentMomentum)}，${
      rank <= 0.01
        ? '为近一年最低'
        : rank >= 0.99
          ? '为近一年最高'
          : `处于近一年${rank >= 0.5 ? `前 ${Math.round((1 - rank) * 100)}%` : `后 ${Math.round(rank * 100)}%`}`
    }`
  });

  let upDays = 0;
  for (let index = last - 9; index <= last; index += 1) if (closes[index] > closes[index - 1]) upDays += 1;
  evidence.push({
    key: 'days',
    label: '近 10 日涨跌',
    stance: upDays >= 6 ? 'bull' : upDays <= 4 ? 'bear' : 'neutral',
    text: `${upDays} 涨 ${10 - upDays} 跌`
  });

  const netFlows = flows.map((item) => Number(item.net)).filter(finite);
  if (netFlows.length) {
    const today = netFlows.at(-1);
    let streak = 0;
    for (let index = netFlows.length - 1; index >= 0 && Math.sign(netFlows[index]) === Math.sign(today); index -= 1)
      streak += 1;
    const sum3 = netFlows.slice(-3).reduce((sum, value) => sum + value, 0);
    evidence.push({
      key: 'flow',
      label: '主力资金',
      stance: today > 0 && sum3 > 0 ? 'bull' : today < 0 && sum3 < 0 ? 'bear' : 'neutral',
      text: `最新净${today >= 0 ? '流入' : '流出'} ${Math.abs(today / 1e8).toFixed(1)} 亿${streak >= 2 ? `，连续 ${streak} 日${today >= 0 ? '流入' : '流出'}` : ''}`
    });
  }

  if (finite(sectorPct) && finite(benchmarkPct)) {
    const gap = sectorPct - benchmarkPct;
    evidence.push({
      key: 'relative',
      label: '相对大盘',
      stance: gap > 0.5 ? 'bull' : gap < -0.5 ? 'bear' : 'neutral',
      text: `最新交易日 ${pct(sectorPct)}，${gap >= 0 ? '强于' : '弱于'}沪深 300（${pct(benchmarkPct)}）`
    });
  }

  const bull = evidence.filter((item) => item.stance === 'bull').length;
  const bear = evidence.filter((item) => item.stance === 'bear').length;
  const direction = bull - bear >= 2 ? 'up' : bear - bull >= 2 ? 'down' : 'flat';

  const signal = signalAt(closes, last);
  const matched = [];
  const all = [];
  for (let index = 20; index + 5 <= last; index += 1) {
    const sample = { next: closes[index + 1] > closes[index], forward5: (closes[index + 5] / closes[index] - 1) * 100 };
    all.push(sample);
    const current = signalAt(closes, index);
    if (current.above === signal.above && current.ret5Bucket === signal.ret5Bucket) matched.push(sample);
  }
  const samples = matched.length >= 20 ? matched : all;
  const forward5 = samples.map((item) => item.forward5).sort((a, b) => a - b);

  return {
    direction,
    label: direction === 'up' ? '短期上行' : direction === 'down' ? '短期下行' : '震荡',
    bull,
    bear,
    neutral: evidence.length - bull - bear,
    evidence,
    stats: {
      upRate: samples.filter((item) => item.next).length / Math.max(1, samples.length),
      sampleSize: samples.length,
      matchedSignal: samples === matched,
      signalText: describeSignal(signal),
      years: Math.max(1, Math.round(closes.length / 250)),
      medianForward5: quantile(forward5, 0.5)
    }
  };
}

const mulberry32 = (seed) => () => {
  let value = (seed += 0x6d2b79f5);
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

/**
 * 未来 N 日走势区间：近 60 日波动率定宽度，板块同类信号的 5 日中位收益定方向，
 * 固定种子模拟路径，保证同一输入结果稳定。
 */
export function forecastFund({ navs = [], startNav, drift5 = 0, stopNav, days = 5, paths = 2000 } = {}) {
  const values = navs.map((item) => item.nav).slice(-61);
  const start = Number(startNav) > 0 ? Number(startNav) : values.at(-1);
  if (values.length < 21 || !(start > 0)) return null;
  const returns = values.slice(1).map((value, index) => Math.log(value / values[index]));
  const avg = mean(returns);
  const sigma = Math.sqrt(returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (returns.length - 1));
  if (!(sigma > 0)) return null;
  const rawDrift = finite(drift5) ? Math.log(1 + drift5 / 100) / 5 : 0;
  const drift = Math.max(-sigma * 0.5, Math.min(sigma * 0.5, rawDrift));
  const random = mulberry32(20260917);
  const normal = () => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
  const byDay = Array.from({ length: days }, () => []);
  let touched = 0;
  for (let path = 0; path < paths; path += 1) {
    let level = 0;
    let hit = false;
    for (let day = 0; day < days; day += 1) {
      level += drift - (sigma * sigma) / 2 + sigma * normal();
      const change = (Math.exp(level) - 1) * 100;
      byDay[day].push(change);
      if (stopNav > 0 && start * Math.exp(level) <= stopNav) hit = true;
    }
    if (hit) touched += 1;
  }
  const bands = byDay.map((changes) => {
    const sorted = [...changes].sort((a, b) => a - b);
    return {
      p10: quantile(sorted, 0.1),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.9)
    };
  });
  const final = byDay.at(-1);
  const median = bands.at(-1).p50;
  return {
    days,
    startNav: start,
    bands,
    median,
    low: bands.at(-1).p10,
    high: bands.at(-1).p90,
    annualVol: sigma * Math.sqrt(250) * 100,
    sampleDays: returns.length,
    belowStop: stopNav > 0 && start <= stopNav,
    touchStop: stopNav > 0 && start > stopNav ? touched / paths : null,
    scenarios: {
      up: final.filter((value) => value > 2).length / paths,
      flat: final.filter((value) => value >= -2 && value <= 2).length / paths,
      down: final.filter((value) => value < -2).length / paths
    },
    label: median > 1 ? '偏强' : median < -1 ? '偏弱' : '震荡'
  };
}

const BULL_WORDS = [
  '利好',
  '大涨',
  '涨超',
  '涨停',
  '走强',
  '反弹',
  '新高',
  '增长',
  '净流入',
  '增持',
  '回购',
  '扶持',
  '支持',
  '突破'
];
const BEAR_WORDS = [
  '利空',
  '大跌',
  '跌超',
  '跌停',
  '跳水',
  '走弱',
  '下跌',
  '暴跌',
  '新低',
  '下滑',
  '亏损',
  '净流出',
  '减持',
  '处罚',
  '立案',
  '风险'
];

/** 资讯倾向：按标题关键词粗分，仅作阅读提示 */
export function classifyNews(title = '') {
  const text = String(title);
  const bull = BULL_WORDS.filter((word) => text.includes(word)).length;
  const bear = BEAR_WORDS.filter((word) => text.includes(word)).length;
  return bull > bear ? 'bull' : bear > bull ? 'bear' : 'neutral';
}

/** 板块名转资讯搜索关键词：去掉指数公司前缀和“指数”后缀 */
export function sectorKeyword(label = '') {
  const raw = String(label).trim();
  const keyword = raw
    .replace(/^(中证|国证|上证|深证|中华|沪深|申万|中信|CS)/, '')
    .replace(/(主题)?(全收益)?(指数)?$/, '')
    .replace(/[()（）]/g, ' ')
    .trim();
  return keyword.length >= 2 && !/^\d+$/.test(keyword) ? keyword : raw.replace(/指数$/, '');
}
