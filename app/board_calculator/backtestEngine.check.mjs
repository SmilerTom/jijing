import assert from 'node:assert/strict';
import { optimizeRobust, prepare, simulate, todaySignal } from './backtestEngine.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed += 1;
};
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const fund = (nav, tiers = [[0, null, 0]], buyFee = 0) =>
  prepare({
    code: 't',
    buyFee,
    tiers,
    nav,
    dates: nav.map((_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10))
  });

check('一直持有（底仓 100%）等于净值涨幅', () => {
  const r = simulate(fund([1, 1.1, 1.2, 1.5]), { n: 2, core: 100 });
  near(r.stats.total, (1.5 / 1.1 - 1) * 100); // 从均线可算出的第 2 天起算
  near(r.stats.total, r.hold.total);
});

check('整仓：一次卖出全部机动仓，按成本算出本笔盈亏', () => {
  const r = simulate(
    fund([1, 1, 1, 1.2, 1.0, 0.9, 1.1]),
    { n: 2, sell: 5, buy: 5, core: 0, batch: 1, interval: 0, buyback: 'ma' },
    { capital: 1000 }
  );
  const sell = r.log.find((t) => t.type === 'sell');
  near(sell.amount, 1200);
  near(sell.pnl, 200);
  near(sell.pnlRate, 20);
});

check('分批：每次只卖初始机动仓的一部分', () => {
  const r = simulate(
    fund([1, 1, 1.2, 1.3, 1.4]),
    { n: 2, sell: 1, buy: 50, core: 50, batch: 0.2, interval: 0 },
    { capital: 1000 }
  );
  r.log.filter((t) => t.type === 'sell').forEach((t) => near(t.amount, 100));
});

check('回撤止损清仓，站上均线后按底仓比例买回', () => {
  const nav = [
    ...Array(20).fill(1),
    ...Array.from({ length: 20 }, (_, i) => 1 - (i + 1) * 0.02),
    ...Array.from({ length: 20 }, (_, i) => 0.6 + (i + 1) * 0.03)
  ];
  const r = simulate(fund(nav), { n: 5, sell: 50, buy: 50, core: 100, stop: 10 });
  assert.deepEqual(
    r.log.slice(0, 2).map((t) => t.type),
    ['stop', 'reenter']
  );
  assert.ok(r.stats.dd < 12 && r.hold.dd > 35);
  const withYield = simulate(fund(nav), { n: 5, sell: 50, buy: 50, core: 100, stop: 10, cashYield: 10 });
  assert.ok(withYield.stats.total > r.stats.total);
});

check('赎回费按持有天数先进先出计算', () => {
  const r = simulate(
    fund(
      [1, 1, 1, 1.2, 1.0, 1.2],
      [
        [0, 7, 0.015],
        [7, null, 0]
      ]
    ),
    { n: 2, sell: 5, buy: 5, core: 0, batch: 1, interval: 0, buyback: 'ma' },
    { capital: 1000 }
  );
  const sells = r.log.filter((t) => t.type === 'sell');
  near(sells[0].fee, 0); // 期初持仓视为长期持有
  assert.ok(sells[1].fee > 0); // 买回后 1 天内又卖出，收 1.5%
});

check('稳健寻优要求两段都有足够仓位，并给出样本内外结果', () => {
  const nav = Array.from({ length: 400 }, (_, i) => 1 + 0.3 * Math.sin(i / 15) + i / 800);
  let last;
  for (const step of optimizeRobust(fund(nav), { cashYield: 1.5 }, { topN: 3 })) last = step;
  assert.ok(last.best.length > 0);
  last.best.forEach((b) => {
    assert.ok(b.inSample.exposure >= 60 && b.outSample.exposure >= 60);
    near(b.score, Math.min(b.inSample.calmar, b.outSample.calmar));
  });
});

check('今日信号：今天估值超过卖出线时给出卖出，未超过时不操作', () => {
  const base = fund(Array(8).fill(1));
  const params = { n: 3, sell: 5, buy: 5, core: 70, batch: 1, interval: 0 };
  const hot = todaySignal(base, params, { date: '2025-01-09', nav: 1.2, estimated: true });
  assert.equal(hot.appended, true);
  assert.deepEqual(
    hot.trades.map((t) => t.type),
    ['sell']
  );
  near(hot.trades[0].share, (0.3 * 1.2) / 1.2, 1e-9); // 卖出整个机动仓，占当时组合 30%
  near(hot.deviation, (1.2 / ((1 + 1 + 1.2) / 3) - 1) * 100); // 均线含今天的估值
  const calm = todaySignal(base, params, { date: '2025-01-09', nav: 1.01, estimated: true });
  assert.equal(calm.trades.length, 0);
  assert.ok(calm.toUpper > 0);
  const official = todaySignal(base, params, { date: '2025-01-08', nav: 1, estimated: false });
  assert.equal(official.appended, false);
});

check('今日信号：间隔未满时说明还需等几天', () => {
  const base = fund([1, 1, 1, 1.2, 1.0, 1.0]);
  const s = todaySignal(
    base,
    { n: 2, sell: 5, buy: 5, core: 0, batch: 1, interval: 30 },
    { date: '2025-01-07', nav: 0.9, estimated: true }
  );
  assert.equal(s.trades.length, 0);
  assert.ok(s.waitDays > 0);
  assert.ok(s.state.cashShare > 0.99);
});

console.log(`回测引擎检查：${passed} 项通过`);
