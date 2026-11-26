import assert from 'node:assert/strict';
import { optimizeRobust, prepare, robustComboCount, similarOutlook, simulate, todaySignal } from './backtestEngine.mjs';

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

check('稳健寻优只用前段选参：改动后段行情不影响选出的参数，后段只做检验', () => {
  const nav = Array.from({ length: 400 }, (_, i) => 1 + 0.3 * Math.sin(i / 15) + i / 800);
  const run = (series) => {
    let last;
    for (const step of optimizeRobust(fund(series), { cashYield: 1.5 }, { topN: 3 })) last = step;
    return last;
  };
  const base = run(nav);
  assert.ok(base.best.length > 0);
  base.best.forEach((b) => {
    assert.ok(b.inSample.exposure >= 60);
    near(b.score, b.inSample.calmar);
    assert.ok(b.outSample);
  });
  // 后段改成单边下跌：排序和参数必须完全一样，只有后段成绩变化
  const crashed = nav.map((v, i) => (i > base.mid ? v * (1 - (i - base.mid) / 400) : v));
  const other = run(crashed);
  assert.deepEqual(
    other.best.map((b) => b.params),
    base.best.map((b) => b.params)
  );
  assert.notDeepEqual(
    other.best.map((b) => b.outSample.annual),
    base.best.map((b) => b.outSample.annual)
  );
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

check('顺势：跌破下轨卖出机动仓，重新站上上轨买回', () => {
  const r = simulate(
    fund([1, 1, 1, 0.9, 0.85, 1.0, 1.2]),
    { direction: 'trend', n: 2, sell: 5, buy: 5, core: 0, batch: 1, interval: 0 },
    { capital: 1000 }
  );
  assert.deepEqual(
    r.log.map((t) => t.type),
    ['sell', 'buy']
  );
  assert.ok(r.log[0].dev <= -5 && r.log[1].dev >= 5);
});

check('每日交易寻优只用 5/10/20 日均线、不设间隔，逆势和顺势都会出现', () => {
  const nav = Array.from({ length: 300 }, (_, i) => 1 + 0.2 * Math.sin(i / 6) + i / 600);
  let last;
  for (const step of optimizeRobust(fund(nav), {}, { topN: 50, mode: 'daily' })) last = step;
  assert.equal(last.total, robustComboCount('daily'));
  assert.ok(last.best.length > 0);
  last.best.forEach((b) => {
    assert.ok([5, 10, 20].includes(b.params.n));
    assert.equal(b.params.interval, 0);
  });
});

check('历史同类情况：只用今天之前走完的样本，并给出全部交易日基准', () => {
  const nav = Array.from({ length: 200 }, (_, i) => 1 + 0.1 * Math.sin(i / 5));
  const data = fund(nav);
  const o = similarOutlook(data, 150, 5);
  assert.ok(o && o.neighbors >= 30);
  const h = o.horizons[5];
  assert.ok(h.similar.count >= 15 && h.base.count > h.similar.count);
  near(h.edge, h.similar.mean - h.base.mean);
  // 改动 150 之后的净值不影响结果
  const changed = fund(nav.map((v, i) => (i > 150 ? v * 3 : v)));
  assert.deepEqual(similarOutlook(changed, 150, 5), o);
});

check('相对上次成交价：较上次成交涨够卖、跌够买，成交后基准随之更新', () => {
  // 均线周期 2：从第 2 天起算，基准 1.0；1.06 卖（+6%），1.0 买（较 1.06 跌 5.7%），1.07 卖
  const r = simulate(
    fund([1, 1, 1.03, 1.06, 1.04, 1.0, 1.07]),
    { trigger: 'last', n: 2, sell: 5, buy: 5, core: 0, batch: 0.5, interval: 0 },
    { capital: 1000 }
  );
  assert.deepEqual(
    r.log.map((t) => [t.type, t.nav]),
    [
      ['sell', 1.06],
      ['buy', 1.0],
      ['sell', 1.07]
    ]
  );
});

check('当日涨跌幅：只看相对昨天的涨跌，累计上涨但单日不够时不交易', () => {
  const r = simulate(
    fund([1, 1, 1.02, 1.04, 1.06, 1.1, 1.0]),
    { trigger: 'day', n: 2, sell: 3, buy: 3, core: 0, batch: 0.5, interval: 0 },
    { capital: 1000 }
  );
  // 1.06→1.1 为 +3.8% 卖；1.1→1.0 为 −9.1% 买；之前每天 +2% 不触发
  assert.deepEqual(
    r.log.map((t) => t.type),
    ['sell', 'buy']
  );
  assert.equal(r.log[0].nav, 1.1);
});

check('今日信号按触发方式给出基准：上次成交价 / 昨天净值', () => {
  const base = fund([1, 1, 1.03, 1.06, 1.04]);
  const last = todaySignal(
    base,
    { trigger: 'last', n: 2, sell: 5, buy: 5, core: 0, batch: 0.5, interval: 0 },
    { date: '2025-01-06', nav: 1.0, estimated: true }
  );
  near(last.base, 1.06); // 上次在 1.06 卖出
  assert.equal(last.trades[0].type, 'buy');
  const day = todaySignal(
    base,
    { trigger: 'day', n: 2, sell: 3, buy: 3, core: 0, batch: 0.5, interval: 0 },
    { date: '2025-01-06', nav: 1.0, estimated: true }
  );
  near(day.base, 1.04);
  near(day.metric, (1.0 / 1.04 - 1) * 100);
  assert.equal(day.outlook === null || day.outlook.kind === 'day', true);
});

check('相对上次成交价：卖光后继续上涨，基准跟着抬高，从高点回落够了就买回', () => {
  const r = simulate(
    fund([1, 1, 1.06, 1.2, 1.4, 1.32]),
    { trigger: 'last', n: 2, sell: 5, buy: 5, core: 0, batch: 1, interval: 0 },
    { capital: 1000 }
  );
  // 1.06 整仓卖出；之后涨到 1.4 基准随之抬高；1.32 较 1.4 回落 5.7% 买回
  assert.deepEqual(
    r.log.map((t) => [t.type, t.nav]),
    [
      ['sell', 1.06],
      ['buy', 1.32]
    ]
  );
});

console.log(`回测引擎检查：${passed} 项通过`);
