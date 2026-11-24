import lodash from 'lodash';
import { PERIODS } from './analytics.mjs';

const { isArray, isNil, isNumber } = lodash;

const cell = (value) => {
  const text = isNil(value) || (isNumber(value) && !Number.isFinite(value)) ? '' : String(value);
  // 防止表格软件把 =、+、-、@ 开头的文本当公式执行
  const safe = /^[=+\-@]/.test(text) && !/^[+-]?\d/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const num = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : '');

/** 生成复盘报告 CSV：基本信息、各区间指标、年度收益、最差区间、回测、流水、交易记录、决定记录 */
export function buildReportCsv({
  fundId,
  fundName,
  generatedAt = new Date(),
  byPeriod = {},
  years = [],
  worst = [],
  xirrValue = null,
  backtest = null,
  bandMode = true,
  rows = [],
  transactions = [],
  signalLog = null
}) {
  const lines = [];
  const add = (...values) => lines.push(values.map(cell).join(','));
  add('基金复盘报告');
  add('基金', fundName, fundId);
  add('生成时间', generatedAt.toISOString());
  add('资金加权年化(XIRR,%)', num(xirrValue));
  add();
  add(
    '区间指标',
    '起始',
    '结束',
    '区间收益%',
    '年化%',
    '最大回撤%',
    '年化波动%',
    '夏普',
    '索提诺',
    '卡玛',
    '沪深300%',
    '超额%',
    'Beta',
    '跟踪误差%',
    '信息比率',
    '跑赢天数%'
  );
  PERIODS.forEach(([key, label]) => {
    const m = byPeriod[key];
    if (!m) return;
    const b = m.benchmark || {};
    add(
      label,
      m.start,
      m.end,
      num(m.totalReturn),
      num(m.annualReturn),
      num(m.maxDrawdown),
      num(m.volatility),
      num(m.sharpe),
      num(m.sortino),
      num(m.calmar),
      num(b.totalReturn),
      num(b.excessReturn),
      num(b.beta),
      num(b.trackingError),
      num(b.infoRatio),
      num(b.winRate)
    );
  });
  add();
  add('年份', '本基金%', '沪深300%', '不满整年');
  years.forEach((item) => add(item.year, num(item.fund), num(item.benchmark), item.partial ? '是' : ''));
  add();
  add('最差区间(交易日)', '涨跌%', '开始', '结束');
  worst.forEach((item) => add(item.size, num(item.change), item.start, item.end));
  if (backtest) {
    add();
    add(`策略回测(${bandMode ? '均线带' : '涨跌滚仓'})`, '当前策略', '一直持有');
    add('区间', `${backtest.strategy.start}~${backtest.strategy.end}`, '');
    add('区间收益%', num(backtest.strategy.totalReturn), num(backtest.holding.totalReturn));
    add('年化%', num(backtest.strategy.annualReturn), num(backtest.holding.annualReturn));
    add('最大回撤%', num(backtest.strategy.maxDrawdown), num(backtest.holding.maxDrawdown));
    add('夏普', num(backtest.strategy.sharpe), num(backtest.holding.sharpe));
    add('交易次数', backtest.trades, 0);
    add('申赎费用%', num(backtest.fees), 0);
  }
  add();
  add('出入金流水', '类型', '金额', '累计');
  rows.forEach((row) =>
    add(row.dateKey || row.date, row.type === 'buy' ? '买入' : '卖出', num(row.amount), num(row.cumulative))
  );
  add();
  add('交易记录日期', '类型', '份额', '净值', '金额', '账本', '补录');
  (isArray(transactions) ? transactions : []).forEach((tx) =>
    add(
      String(tx.date || '').slice(0, 10),
      tx.type === 'buy' ? '买入' : '卖出',
      num(Number(tx.share), 4),
      num(Number(tx.price), 4),
      num(Number(tx.amount)),
      tx.groupId ? '分组' : '全局',
      tx.isHistoryOnly ? '是' : ''
    )
  );
  const decisions = isArray(signalLog?.decisions) ? signalLog.decisions : [];
  if (decisions.length) {
    add();
    add('决定日期', '卖出比例%', '当时净值');
    decisions.forEach((item) => add(item.date, num(Number(item.ratio) * 100, 0), num(Number(item.nav), 4)));
  }
  return `﻿${lines.join('\n')}\n`;
}

export function downloadReport(input) {
  const csv = buildReportCsv(input);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${input.fundId}-复盘-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
