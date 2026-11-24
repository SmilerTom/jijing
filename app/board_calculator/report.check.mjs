import assert from 'node:assert/strict';
import { buildReportCsv } from './report.mjs';

const csv = buildReportCsv({
  fundId: '017811',
  fundName: '测试,基金',
  generatedAt: new Date('2026-11-24T00:00:00Z'),
  byPeriod: {
    '1y': {
      start: '2025-11-24',
      end: '2026-11-24',
      totalReturn: 12.345,
      annualReturn: 12.3,
      maxDrawdown: 20,
      volatility: 25,
      sharpe: 0.4,
      sortino: 0.6,
      calmar: 0.6,
      benchmark: { totalReturn: 5, excessReturn: 7.345, beta: 1.1, trackingError: 10, infoRatio: 0.5, winRate: 52 }
    }
  },
  rows: [{ dateKey: '2026-11-01', type: 'buy', amount: 100, cumulative: 100 }],
  transactions: [{ date: '2026-11-01', type: 'sell', share: 10, price: 1.2, amount: 12 }],
  signalLog: { decisions: [{ date: '2026-11-02', ratio: 0.3, nav: 1.2 }] }
});
assert.ok(csv.startsWith('﻿'), '带 BOM，Excel 能正确识别中文');
assert.match(csv, /"测试,基金"/);
assert.match(csv, /近1年,2025-11-24,2026-11-24,12\.35/);
assert.match(csv, /2026-11-02,30,1\.2/);
assert.ok(!/NaN|undefined/.test(csv));
const injected = buildReportCsv({ fundId: '1', fundName: '=HYPERLINK("x")' });
assert.match(injected, /"'=HYPERLINK\(""x""\)"/);
console.log('报告检查：3 项通过');
