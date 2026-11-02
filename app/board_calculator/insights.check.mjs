import assert from 'node:assert/strict';
import {
  attributeMove,
  buildExposure,
  classifyAnnouncement,
  evaluateDecision,
  outflowStreak,
  recordDecision,
  recordSignal,
  settleSignals,
  summarizeSignals
} from './insights.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed++;
  console.log(`PASS ${name}`);
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

check('公告按影响分级，旧公告和恢复类不算需要行动', () => {
  const today = '2026-11-02';
  assert.equal(classifyAnnouncement('关于基金经理变更的公告', '2026-11-01', today).level, 'action');
  assert.equal(classifyAnnouncement('关于暂停大额申购业务的公告', '2026-11-01', today).level, 'action');
  assert.equal(classifyAnnouncement('关于基金合同终止及清算的公告', '2026-10-30', today).tag, '清盘风险');
  assert.equal(classifyAnnouncement('关于基金经理变更的公告', '2026-09-01', today).level, 'judge');
  assert.equal(classifyAnnouncement('关于恢复大额申购业务的公告', '2026-11-01', today).level, 'judge');
  assert.equal(classifyAnnouncement('2026年第3季度报告', '2026-10-27', today).level, 'judge');
  assert.equal(
    classifyAnnouncement('关于旗下基金调整业绩比较基准并修订基金合同的公告', '2026-10-30', today).tag,
    '合同变更'
  );
  assert.equal(classifyAnnouncement('基金招募说明书更新', '2026-10-30', today).level, 'general');
});

check('归因只算有行情的重仓股，样本不足不估算', () => {
  const stocks = [
    { code: 'a', name: 'A', weight: '10%', change: -5 },
    { code: 'b', name: 'B', weight: '9%', change: 2 },
    { code: 'c', name: 'C', weight: '8%', change: -1 },
    { code: 'd', name: 'D', weight: '7%', change: null }
  ];
  const result = attributeMove({ fundPct: -1, stocks, reportDate: '2026-09-30' });
  near(result.contribution, -0.5 + 0.18 - 0.08);
  near(result.other, -1 - (-0.5 + 0.18 - 0.08));
  near(result.coveredWeight, 27);
  assert.equal(result.top[0].name, 'A');
  assert.equal(attributeMove({ fundPct: -1, stocks: stocks.slice(0, 2) }), null);
  assert.equal(attributeMove({ fundPct: NaN, stocks }), null);
});

check('组合穿透合并板块和重复重仓股', () => {
  const exposure = buildExposure([
    { name: '基金1', value: 6000, sector: '人工智能', stocks: [{ code: 'x', name: 'X', weight: '10%' }] },
    { name: '基金2', value: 2000, sector: '人工智能', stocks: [{ code: 'x', name: 'X', weight: '5%' }] },
    { name: '基金3', value: 2000, sector: '', stocks: [] },
    { name: '空仓', value: 0, sector: '医药', stocks: [] }
  ]);
  assert.equal(exposure.fundCount, 3);
  assert.equal(exposure.sectors[0].name, '人工智能');
  near(exposure.sectors[0].share, 0.8);
  assert.equal(exposure.concentrated, true);
  near(exposure.overlaps[0].value, 700);
  assert.deepEqual(exposure.overlaps[0].funds, ['基金1', '基金2']);
  near(exposure.disclosedShare, 0.07);
  assert.equal(buildExposure([]), null);
});

check('信号去重、满 5 个交易日才结算，结果固定', () => {
  let log = recordSignal(null, { status: 'stop', date: '2026-10-01', nav: 2 });
  log = recordSignal(log, { status: 'stop', date: '2026-10-03', nav: 1.9 });
  assert.equal(log.signals.length, 1);
  log = recordSignal(log, { status: 'watch', date: '2026-10-03', nav: 1.9 });
  assert.equal(log.signals.length, 1);
  log = recordSignal(log, { status: 'stop', date: '2026-10-10', nav: 1.8 });
  assert.equal(log.signals.length, 2);
  const navs = ['02', '05', '06', '07', '08'].map((day, index) => ({
    date: `2026-10-${day}`,
    nav: 1.9 - index * 0.02
  }));
  const settled = settleSignals(log, navs);
  assert.equal(settled.signals[0].outcome.date, '2026-10-08');
  assert.equal(settled.signals[0].outcome.hit, true);
  assert.equal(settled.signals[1].outcome, undefined);
  assert.deepEqual(settleSignals(settled, navs), settled);
  const summary = summarizeSignals(settled);
  assert.equal(summary.settled, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.hitRate, 1);
  assert.equal(summary.enoughSamples, false);
});

check('记录决定后可对比之后的净值', () => {
  const log = recordDecision(null, { ratio: 0.5, status: 'stop', date: '2026-10-01', nav: 2, at: 'x' });
  assert.equal(summarizeSignals(log).decisions[0].ratio, 0.5);
  const result = evaluateDecision(log.decisions[0], 1.8);
  near(result.change, -10);
  near(result.avoided, 5);
  assert.equal(evaluateDecision({ nav: 0 }, 1), null);
});

check('资金连续流出天数', () => {
  const result = outflowStreak([{ net: 5 }, { net: -1 }, { net: -2 }]);
  assert.equal(result.days, 2);
  assert.equal(result.total, -3);
  assert.equal(outflowStreak([{ net: -1 }, { net: 1 }]).days, 0);
});

console.log(`洞察检查：${passed} 项通过`);
