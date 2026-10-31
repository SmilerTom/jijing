import assert from 'node:assert/strict';
import {
  analyzeSectorTrend,
  buildRiskAlerts,
  classifyNews,
  classifyRisk,
  drawdownSeries,
  forecastFund,
  sectorKeyword,
  toNavSeries
} from './risk.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed++;
  console.log(`PASS ${name}`);
};
const day = (index) => new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
const series = (values) => values.map((nav, index) => ({ date: day(index), nav }));

check('按回落占止损线比例划分风险等级', () => {
  assert.equal(classifyRisk({ status: 'watch', drawdown: 2, stopDrawdown: 10, peakNav: 1 }).level, 'low');
  const mid = classifyRisk({ status: 'watch', drawdown: 7.4, stopDrawdown: 10, peakNav: 1.286 });
  assert.equal(mid.level, 'mid');
  assert.match(mid.summary, /2\.60%/);
  assert.equal(classifyRisk({ status: 'stop', drawdown: 10.6, stopDrawdown: 10 }).level, 'high');
  assert.equal(classifyRisk({ status: 'pending' }).level, 'neutral');
});

check('净值序列去重、过滤并按日期排序', () => {
  const navs = toNavSeries([
    { date: '2024-01-03', unitNetValue: '1.2' },
    { date: '2024-01-01', value: 1 },
    { date: 'bad', value: 1 },
    { date: '2024-01-02', value: 0 }
  ]);
  assert.deepEqual(navs, [
    { date: '2024-01-01', nav: 1 },
    { date: '2024-01-03', nav: 1.2 }
  ]);
});

check('回落序列以跟踪最高值为基准', () => {
  const points = drawdownSeries(series([1, 0.95, 0.9]), 1.2, 2);
  assert.equal(points.length, 2);
  assert.ok(Math.abs(points[1].drawdown - 25) < 1e-9);
});

check('连续下跌和板块弱于大盘生成提醒', () => {
  const alerts = buildRiskAlerts({
    navs: series([1, 1, 1, 1, 1, 1, 0.99, 0.97, 0.95, 0.93, 0.9]),
    sectorName: '人工智能',
    sectorPct: -2.1,
    benchmarkPct: -0.4
  });
  assert.match(alerts[0].text, /连续 5 个交易日下跌/);
  assert.ok(alerts.some((item) => item.text.includes('跌势加快')));
  assert.ok(alerts.some((item) => item.text.includes('弱于沪深 300')));
});

check('持续下跌的板块判为短期下行，并给出同类信号样本', () => {
  const closes = Array.from(
    { length: 400 },
    (_, index) => 100 + 10 * Math.sin(index / 9) - (index > 380 ? (index - 380) * 1.5 : 0)
  );
  const klines = closes.map((close, index) => ({ date: day(index), close }));
  const trend = analyzeSectorTrend({
    klines,
    flows: [{ net: -1e9 }, { net: -2e9 }, { net: -3e9 }],
    sectorPct: -2,
    benchmarkPct: 0
  });
  assert.equal(trend.direction, 'down');
  assert.ok(trend.stats.sampleSize >= 20);
  assert.ok(trend.stats.upRate >= 0 && trend.stats.upRate <= 1);
  assert.equal(analyzeSectorTrend({ klines: klines.slice(0, 10) }), null);
});

check('走势预测结果稳定，区间有序且情景概率合计为 1', () => {
  const navs = series(Array.from({ length: 61 }, (_, index) => 1 + 0.02 * Math.sin(index)));
  const first = forecastFund({ navs, drift5: -1, stopNav: 0.95 });
  const second = forecastFund({ navs, drift5: -1, stopNav: 0.95 });
  assert.deepEqual(first, second);
  assert.ok(first.low < first.median && first.median < first.high);
  const { up, flat, down } = first.scenarios;
  assert.ok(Math.abs(up + flat + down - 1) < 1e-9);
  assert.ok(first.touchStop >= 0 && first.touchStop <= 1);
  assert.equal(forecastFund({ navs: navs.slice(0, 5) }), null);
  const below = forecastFund({ navs, stopNav: 5 });
  assert.equal(below.belowStop, true);
  assert.equal(below.touchStop, null);
});

check('资讯标题按关键词粗分倾向', () => {
  assert.equal(classifyNews('AI 算力板块午后跳水，多只龙头跌超 5%'), 'bear');
  assert.equal(classifyNews('板块大涨，资金净流入'), 'bull');
  assert.equal(classifyNews('基金合同修订公告'), 'neutral');
});

check('板块名转资讯关键词', () => {
  assert.equal(sectorKeyword('中证人工智能主题指数'), '人工智能');
  assert.equal(sectorKeyword('中证500指数'), '中证500');
});

console.log(`${passed} checks passed`);
