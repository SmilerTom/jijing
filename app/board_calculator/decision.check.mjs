import assert from 'node:assert/strict';
import {
  addTradingDays,
  buildLots,
  estimateFee,
  findFeeSaving,
  getSettlement,
  parseRedemptionTiers,
  simulateSale
} from './decision.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed++;
  console.log(`PASS ${name}`);
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const tiers = parseRedemptionTiers([
  { time: '持有期限 < 7天', rate: '1.50%' },
  { time: '7天 ≤ 持有期限 < 30天', rate: '0.50%' },
  { time: '持有期限 ≥ 30天', rate: '0.00%' }
]);

check('解析赎回费档位，无法识别时不猜', () => {
  assert.deepEqual(tiers, [
    { minDays: 0, maxDays: 7, rate: 0.015 },
    { minDays: 7, maxDays: 30, rate: 0.005 },
    { minDays: 30, maxDays: Infinity, rate: 0 }
  ]);
  assert.equal(parseRedemptionTiers([{ time: '持有期限 ≥ 1年', rate: '0.00%' }])[0].minDays, 365);
  assert.equal(parseRedemptionTiers([{ time: '满足特定条件', rate: '1.00%' }]), null);
  assert.equal(parseRedemptionTiers([]), null);
});

check('15:00 前按当日成交，之后和周末顺延；一律按北京时间', () => {
  const before = getSettlement({ now: new Date('2026-11-02T06:18:00Z'), arrivalDays: 3 });
  assert.equal(before.tradeDate, '2026-11-02');
  assert.equal(before.minutesLeft, 42);
  assert.equal(before.confirmDate, '2026-11-03');
  assert.equal(before.arrivalDate, '2026-11-05');
  const after = getSettlement({ now: new Date('2026-11-02T07:00:00Z') });
  assert.equal(after.tradeDate, '2026-11-03');
  assert.equal(after.minutesLeft, null);
  assert.equal(getSettlement({ now: new Date('2026-11-07T04:00:00Z') }).tradeDate, '2026-11-09');
  const holiday = (date) => date !== '2026-11-03';
  assert.equal(addTradingDays('2026-11-02', 1, holiday), '2026-11-04');
});

check('买卖记录按先进先出还原批次，并排除分组和仅历史记录', () => {
  const { lots, unknownShare } = buildLots({
    share: 150,
    transactions: [
      { type: 'buy', share: 100, date: '2026-10-05' },
      { type: 'buy', share: 100, date: '2026-10-12', isAfter3pm: true },
      { type: 'sell', share: 50, date: '2026-10-20' },
      { type: 'buy', share: 999, date: '2026-10-21', groupId: 'g1' },
      { type: 'buy', share: 999, date: '2026-10-22', isHistoryOnly: true }
    ]
  });
  assert.equal(unknownShare, 0);
  assert.deepEqual(lots, [
    { share: 50, confirmDate: '2026-10-06' },
    { share: 100, confirmDate: '2026-10-14' }
  ]);
});

check('持仓多于记录时不假设持有天数，赎回费只给下限', () => {
  const built = buildLots({ share: 300, transactions: [{ type: 'buy', share: 100, date: '2026-10-29' }] });
  assert.equal(built.unknownShare, 200);
  const small = estimateFee({ ...built, tiers, sellShare: 250, nav: 2, sellConfirmDate: '2026-11-03' });
  assert.equal(small.feeIsMinimum, true);
  near(small.fee, 50 * 2 * 0.015);
  const free = estimateFee({
    ...built,
    tiers: [{ minDays: 0, maxDays: Infinity, rate: 0 }],
    sellShare: 150,
    nav: 2,
    sellConfirmDate: '2026-11-03'
  });
  assert.equal(free.feeIsMinimum, false);
  assert.deepEqual(estimateFee({ ...built, tiers: null, sellShare: 1, nav: 2, sellConfirmDate: '2026-11-03' }), {
    fee: null,
    feeIsMinimum: false
  });
});

check('卖出模拟：先卖老批次，再算费用、盈亏和后续涨跌影响', () => {
  const lots = [
    { share: 80, confirmDate: '2026-09-01' },
    { share: 20, confirmDate: '2026-10-29' }
  ];
  const base = { share: 100, cost: 110, nav: 100, lots, unknownShare: 0, tiers, sellConfirmDate: '2026-11-03' };
  const half = simulateSale({ ...base, ratio: 0.5 });
  near(half.fee, 0);
  near(half.realizedProfit, -500);
  near(half.downside, -250);
  const all = simulateSale({ ...base, ratio: 1 });
  near(all.fee, 20 * 100 * 0.015);
  near(all.netReceived, 10000 - 30);
  near(all.realizedProfit, -1030);
  near(all.downside, 0);
  near(simulateSale({ ...base, ratio: 0 }).upside, 500);
});

check('跨过下一费率档的日期和可省金额', () => {
  const lots = [{ share: 20, confirmDate: '2026-10-29' }];
  const settlement = getSettlement({ now: new Date('2026-11-02T06:00:00Z') });
  const saving = findFeeSaving({ lots, unknownShare: 0, tiers, share: 20, nav: 100, settlement });
  assert.equal(saving.tradeDate, '2026-11-04');
  near(saving.saving, 20 * 100 * (0.015 - 0.005));
  assert.equal(findFeeSaving({ lots: [], unknownShare: 0, tiers, share: 0, nav: 100, settlement }), null);
});

console.log(`决策检查：${passed} 项通过`);
