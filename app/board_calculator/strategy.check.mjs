import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildStrategyPrompt,
  DEFAULT_STRATEGY,
  normalizeStrategy,
  calculateStrategyState,
  calculateTrackedHolding,
  createStrategyCycle,
  confirmStrategyTrade,
  observeStrategyPeak,
  getStrategyQuote,
  isStrategyCycle
} from './strategy.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed++;
  console.log(`PASS ${name}`);
};
const now = new Date(2026, 8, 10, 12);
const cycle = createStrategyCycle(1, '2026-09-01');
const evaluate = (options = {}) =>
  calculateStrategyState({ cycle, currentNav: 1, quoteDate: '2026-09-10', now, ...options });

check('当天正式净值尚未公布时，使用当日估值触发盘中预警', () => {
  const quote = getStrategyQuote(
    { dwjz: 1, jzrq: '2026-09-09', gsz: 1.25, gszzl: 25, gztime: '2026-09-10 10:00' },
    [],
    { preferEstimate: true, now }
  );
  assert.equal(quote.nav, 1.25);
  assert.equal(quote.estimated, true);
  assert.equal(evaluate({ currentNav: quote.nav, quoteDate: quote.date, estimated: true }).status, 'sell');
});
check('正式净值读取默认不掺入估值，防止影响账户和持久化最高值', () => {
  assert.deepEqual(getStrategyQuote({ dwjz: 1, jzrq: '2026-09-09', gsz: 2, gztime: '2026-09-10 10:00' }), {
    date: '2026-09-09',
    nav: 1
  });
});
check('当天正式净值公布后优先复核，不能再次叠加当天估算涨幅', () => {
  const quote = getStrategyQuote(
    { dwjz: 1.22, jzrq: '2026-09-10', gsz: 1.5, gszzl: 25, gztime: '2026-09-10 10:00' },
    [],
    { preferEstimate: true, now }
  );
  assert.deepEqual(quote, { date: '2026-09-10', nav: 1.22 });
  assert.equal(evaluate({ currentNav: quote.nav, quoteDate: quote.date }).estimated, false);
});
check('历史数据已含当天正式净值时，也覆盖缓存中的估值', () => {
  const quote = getStrategyQuote(
    { dwjz: 1, jzrq: '2026-09-09', gsz: 1.5, gztime: '2026-09-10 10:00' },
    [{ date: '2026-09-10', unitNetValue: 1.21 }],
    { preferEstimate: true, now }
  );
  assert.deepEqual(quote, { date: '2026-09-10', nav: 1.21 });
});
check('昨日估值、未来日期、无时间戳及无效净值均不能用于当日预警', () => {
  const formal = { dwjz: 1, jzrq: '2026-09-09', gsz: 1.5, gztime: '2026-09-10 10:00' };
  for (const invalid of [
    { gztime: '2026-09-09 15:00' },
    { gztime: '2026-09-11 10:00' },
    { gztime: null },
    { gztime: '2026-09-10' },
    { gsz: '' },
    { gsz: -1 },
    { gsz: Infinity },
    { noValuation: true }
  ]) {
    assert.deepEqual(getStrategyQuote({ ...formal, ...invalid }, [], { preferEstimate: true, now }), {
      date: '2026-09-09',
      nav: 1
    });
  }
  assert.equal(
    getStrategyQuote({ ...formal, gztime: '2026-09-10 14:00' }, [], {
      preferEstimate: true,
      now: new Date('2026-09-10T12:00:00+08:00')
    }).estimated,
    undefined
  );
});
check('只提供涨跌幅而缺少估算净值时不在策略层猜测复利基准', () => {
  assert.deepEqual(
    getStrategyQuote({ dwjz: 1, jzrq: '2026-09-09', gszzl: 25, gztime: '2026-09-10 10:00' }, [], {
      preferEstimate: true,
      now
    }),
    { date: '2026-09-09', nav: 1 }
  );
});
check('估值创新高不写入正式最高值，也不改变基准和冷静期', () => {
  const before = JSON.stringify(cycle);
  const estimatedQuote = { nav: 2, date: '2026-09-10', estimated: true };
  const observed = observeStrategyPeak(cycle, estimatedQuote);
  assert.deepEqual(observed, cycle);
  const signal = evaluate({ cycle: observed, currentNav: 2, estimated: true });
  assert.equal(signal.peakNav, 1);
  assert.equal(signal.drawdown, 0);
  assert.equal(JSON.stringify(cycle), before);
  assert.equal(observeStrategyPeak(cycle, { nav: 1.5, date: '2026-09-10' }).peakNav, 1.5);
});
check('估值买回和止损仍遵循阶段、最高值回撤和冷静期', () => {
  const sold = { ...cycle, phase: 'waitingBuy', anchorNav: 1.2, peakNav: 1.2 };
  assert.equal(evaluate({ cycle: sold, currentNav: 1.14, estimated: true }).status, 'buy');
  assert.equal(evaluate({ cycle: sold, currentNav: 1.05, estimated: true }).status, 'stop');
  assert.equal(
    evaluate({ cycle: { ...sold, lastTradeAt: now.toISOString() }, currentNav: 1.05, estimated: true }).status,
    'cooldown'
  );
});
check('估值提示显示预警标签及时间，正式复核也标明日期', () => {
  const estimatedPrompt = buildStrategyPrompt({
    strategyState: evaluate({ currentNav: 1.25, estimated: true, quoteTime: '2026-09-10 10:00' })
  });
  assert.match(estimatedPrompt.label, /估值预警/);
  assert.match(estimatedPrompt.detail, /10:00.*不代表成交/);
  assert.match(buildStrategyPrompt({ strategyState: evaluate({ currentNav: 1.25 }) }).detail, /正式净值复核/);
});
check('没有正式基准时即使有估值也不生成交易信号', () => {
  assert.equal(evaluate({ cycle: null, currentNav: 1.25, estimated: true }).status, 'pending');
});
const confirm = (state, status, nav, date = now) => confirmStrategyTrade({ cycle: state, status, nav, now: date });

check('四项默认设置，旧目标收益率迁移且删除旧均线参数', () => {
  assert.deepEqual(DEFAULT_STRATEGY, { riseRate: 20, buyDropRate: 5, stopDrawdown: 10, cooldownDays: 3 });
  assert.deepEqual(normalizeStrategy({ targetRate: 25, maPeriod: 20 }), { ...DEFAULT_STRATEGY, riseRate: 25 });
  assert.equal(normalizeStrategy({ cooldownDays: 0 }).cooldownDays, 0);
});
check('上涨到线提示卖出，但发提示不改变基准和阶段', () => {
  const before = JSON.stringify(cycle);
  assert.equal(evaluate({ currentNav: 1.2 }).status, 'sell');
  assert.equal(JSON.stringify(cycle), before);
});
check('未确认卖出，不提前提示买回', () => {
  assert.equal(evaluate({ currentNav: 0.95 }).status, 'watch');
});
check('从最高值回落10%止损，不是成本跌幅', () => {
  assert.equal(evaluate({ cycle: { ...cycle, peakNav: 1.2 }, currentNav: 1.08 }).status, 'stop');
});
check('回撤以最高净值为分母', () => {
  const state = evaluate({
    cycle: { ...cycle, peakNav: 1.5 },
    currentNav: 1.4,
    strategy: { riseRate: 100, stopDrawdown: 8 }
  });
  assert.equal(state.status, 'watch');
  assert.ok(Math.abs(state.drawdown - 100 / 15) < 1e-10);
});
check('卖出确认采用实际成交净值，保存后进入等待买回', () => {
  const sold = confirm(cycle, 'sell', 1.23);
  assert.equal(sold.phase, 'waitingBuy');
  assert.equal(sold.anchorNav, 1.23);
  assert.equal(evaluate({ cycle: JSON.parse(JSON.stringify(sold)) }).status, 'cooldown');
});
check('完整循环：已卖出→跌5%→已买入→新一轮', () => {
  const sold = confirm(cycle, 'sell', 1.2);
  const config = { cooldownDays: 0 };
  assert.equal(evaluate({ cycle: sold, currentNav: 1.14, strategy: config }).status, 'buy');
  const bought = confirm(sold, 'buy', 1.13);
  assert.equal(bought.phase, 'holding');
  assert.equal(bought.anchorNav, 1.13);
  assert.equal(bought.peakNav, 1.2);
  assert.equal(evaluate({ cycle: bought, currentNav: 1.21, strategy: config }).status, 'watch');
});
check('上涨时等待买回阶段不会再次减仓', () => {
  const sold = confirm(cycle, 'sell', 1.2);
  assert.equal(evaluate({ cycle: sold, currentNav: 1.5, strategy: { cooldownDays: 0 } }).status, 'watch');
});
check('同触发补仓和止损时止损优先', () => {
  const sold = { ...confirm(cycle, 'sell', 1.2), peakNav: 1.5 };
  assert.equal(evaluate({ cycle: sold, currentNav: 1.1, strategy: { cooldownDays: 0 } }).status, 'stop');
});
check('止损确认后暂停补仓，实际重买确认才恢复', () => {
  const stopped = confirm(cycle, 'stop', 0.9);
  assert.equal(evaluate({ cycle: stopped, currentNav: 0.5 }).status, 'stopped');
  const resumed = confirm(stopped, 'resume', 0.8);
  assert.equal(resumed.phase, 'holding');
  assert.equal(resumed.peakNav, 0.8);
  assert.equal(resumed.anchorNav, 0.8);
});
check('冷静3天：9月10日确认、9月13日再检查', () => {
  const sold = confirm(cycle, 'sell', 1.2);
  assert.equal(evaluate({ cycle: sold, now: new Date(2026, 8, 12, 23) }).remainingDays, 1);
  assert.equal(
    evaluate({ cycle: sold, currentNav: 1.14, quoteDate: '2026-09-13', now: new Date(2026, 8, 13) }).status,
    'buy'
  );
});
check('0天允许立即复查，但实际成交日期之前的净值不可触发', () => {
  const sold = confirm(cycle, 'sell', 1.2);
  assert.equal(
    evaluate({ cycle: sold, currentNav: 1.1, quoteDate: '2026-09-09', strategy: { cooldownDays: 0 } }).status,
    'pending'
  );
});
check('无净值、未来净值或缺失周期时不生成提醒', () => {
  for (const currentNav of [null, '', 0, -1, Infinity]) assert.equal(evaluate({ currentNav }).status, 'pending');
  assert.equal(evaluate({ cycle: null }).status, 'pending');
  assert.equal(evaluate({ quoteDate: '2026-09-11' }).status, 'pending');
});
check('空值、负数、超范围与非整数冷静期暂停提醒', () => {
  for (const strategy of [
    { riseRate: '' },
    { riseRate: 0 },
    { buyDropRate: 100 },
    { stopDrawdown: -1 },
    { cooldownDays: 1.2 },
    { cooldownDays: Infinity }
  ]) {
    assert.equal(evaluate({ currentNav: 1.5, strategy }).status, 'invalid');
  }
});
check('损坏周期不静默清空冷静期', () => {
  for (const invalid of [
    {},
    { ...cycle, phase: 'bad' },
    { ...cycle, peakNav: 0.5 },
    { ...cycle, lastTradeAt: 'bad' }
  ]) {
    assert.equal(isStrategyCycle(invalid), false);
    assert.equal(evaluate({ cycle: invalid }).status, 'invalidCycle');
  }
});
check('拒绝无效实际成交净值和错误确认顺序', () => {
  for (const nav of ['', 0, -1, Infinity, 1000001]) assert.throws(() => confirm(cycle, 'sell', nav));
  assert.throws(() => confirm(cycle, 'buy', 1));
  assert.throws(() => confirm(cycle, 'resume', 1));
  assert.throws(() => confirm(cycle, 'unknown', 1));
});
check('历史报价按日期选最新值，不用过期的持仓缓存覆盖', () => {
  const quote = getStrategyQuote({ dwjz: 1.1, jzrq: '2026-09-01' }, [
    { date: '2026-09-10', unitNetValue: 1.3 },
    { date: '2026-09-09', unitNetValue: 1.2 }
  ]);
  assert.deepEqual(quote, { date: '2026-09-10', nav: 1.3 });
});
check('最高值仅统计开始跟踪后的记录，补足离线期间高点', () => {
  const next = observeStrategyPeak(cycle, { nav: 1.3, date: '2026-09-10' }, [
    { date: '2026-08-31', unitNetValue: 2 },
    { date: '2026-09-02', unitNetValue: 1.5 },
    { date: '2026-09-11', unitNetValue: 3 }
  ]);
  assert.equal(next.peakNav, 1.5);
  assert.equal(next.anchorNav, 1);
});
check('面板各区域不再读取已删除的均线和分份补仓字段', () => {
  const source = readFileSync(new URL('./FundTradingBoard.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /strategy\.(maPeriod|cashTranches|sellRatio|lockRiseRate)|strategyState\.movingAverage/);
});
check('驾驶舱和顶部提示共用四项策略文案', () => {
  assert.match(buildStrategyPrompt({ strategyState: evaluate({ currentNav: 1.2 }) }).detail, /确认/);
  assert.equal(buildStrategyPrompt({ strategyState: { status: 'stopped' } }).label, '止损后暂停');
  assert.equal(buildStrategyPrompt({ strategyState: { status: 'invalid' } }).label, '请检查设置');
});
console.log(`策略检查：${passed} 项通过；继续检查原有持仓计算。`);

assert.deepEqual(calculateTrackedHolding({ amount: 1200, rate: 20, basisNav: 2, currentNav: 2.2 }), {
  amount: 1320,
  profit: 320,
  rate: 32,
  principal: 1000,
  share: 600,
  cost: 5 / 3
});
assert.deepEqual(calculateTrackedHolding({ amount: 1000, basisNav: 2, currentNav: 2 }), {
  amount: 1000,
  profit: 0,
  rate: 0,
  principal: 1000,
  share: 500,
  cost: 2
});
