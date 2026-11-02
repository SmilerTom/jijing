'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Clock, Lightbulb } from 'lucide-react';
import { fetchFundTradeRules } from '@/app/api/fund';
import * as qk from '@/app/lib/query-keys';
import { isTradingDay, loadHolidaysForYears } from '@/app/lib/tradingCalendar';
import { useStorageStore } from '@/app/stores/storageStore';
import { buildLots, findFeeSaving, getSettlement, parseRedemptionTiers, simulateSale } from './decision.mjs';
import styles from './page.module.css';

const OPTIONS = [
  { label: '全部卖出', ratio: 1 },
  { label: '卖出一半', ratio: 0.5 },
  { label: '继续持有', ratio: 0 }
];
const isTrading = (date) => isTradingDay(dayjs(date));
const money = (value) =>
  `¥${Math.abs(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (date) => (date ? date.slice(5) : '--');
const feeText = (option, rulesFailed) => {
  if (option.ratio === 0) return '—';
  if (option.fee === null) return rulesFailed ? '无法计算' : '计算中…';
  return `${option.feeIsMinimum ? '至少 ' : ''}${money(option.fee)}`;
};
const profitText = (value) => (value === null ? '缺少成本' : `${value >= 0 ? '+' : '−'}${money(value)}`);
const toneOf = (value) => (value > 0 ? styles.up : value < 0 ? styles.down : '');

export default function DecisionCard({ fundId, nav, estimated, open, onDecide }) {
  const { holdings, transactions } = useStorageStore();
  const [ratioPercent, setRatioPercent] = useState(50);
  const [now, setNow] = useState(() => new Date());
  const [decisionNote, setDecisionNote] = useState('');
  const sliderId = useId();
  const holding = holdings?.[fundId];
  const share = Number(holding?.share);
  const cost = Number(holding?.cost);
  const hasPosition = share > 0 && nav > 0;

  const rulesQuery = useQuery({
    queryKey: qk.fundTradeRules(fundId),
    queryFn: () => fetchFundTradeRules(fundId),
    enabled: hasPosition,
    staleTime: 24 * 60 * 60 * 1000
  });
  const year = now.getFullYear();
  const { isSuccess: calendarReady } = useQuery({
    queryKey: ['tradingCalendarYears', year],
    queryFn: async () => {
      await loadHolidaysForYears([year, year + 1]);
      return true;
    },
    enabled: hasPosition,
    staleTime: 24 * 60 * 60 * 1000
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const rules = rulesQuery.data;
  const tiers = useMemo(() => parseRedemptionTiers(rules?.redeemRows), [rules]);
  const fundTransactions = transactions?.[fundId];
  const { lots, unknownShare } = useMemo(
    () =>
      buildLots({
        transactions: fundTransactions,
        share: hasPosition ? share : 0,
        confirmDays: rules?.buyConfirmDays ?? 1,
        isTrading
      }),
    // 日历加载后需要按真实节假日重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fundTransactions, hasPosition, share, rules, calendarReady]
  );

  if (!hasPosition) {
    return <p className={styles.riskMuted}>录入持仓后，可测算卖出费用、盈亏和到账时间。</p>;
  }

  const settlement = getSettlement({
    now,
    confirmDays: rules?.confirmDays ?? 1,
    arrivalDays: rules?.arrivalDays,
    isTrading
  });
  const params = {
    share,
    cost,
    nav,
    lots,
    unknownShare,
    tiers,
    sellConfirmDate: settlement.confirmDate
  };
  const options = OPTIONS.map((option) => ({ ...option, ...simulateSale({ ...params, ratio: option.ratio }) }));
  const custom = simulateSale({ ...params, ratio: ratioPercent / 100 });
  const saving = findFeeSaving({
    lots,
    unknownShare,
    tiers,
    share,
    nav,
    settlement,
    confirmDays: rules?.confirmDays ?? 1,
    isTrading
  });
  const rulesFailed = rulesQuery.isError || (rulesQuery.isSuccess && !tiers);
  const redeemBlocked = rules?.redeemStatus && !rules.redeemStatus.includes('开放');

  return (
    <details className={styles.decisionFold} open={open}>
      <summary>
        <b>如果现在操作</b>
        <span className={styles.riskMuted}>费用、盈亏和到账估算</span>
      </summary>
      {redeemBlocked ? (
        <p className={styles.decisionAlert} role="alert">
          当前赎回状态：{rules.redeemStatus}，可能无法按下面的时间卖出。
        </p>
      ) : null}
      <div className={styles.decisionScroll} role="region" aria-label="三种操作的代价对比" tabIndex={0}>
        <table className={styles.decisionTable}>
          <thead>
            <tr>
              <th scope="col">如果你…</th>
              {options.map((option) => (
                <th scope="col" key={option.label}>
                  {option.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">赎回费</th>
              {options.map((option) => (
                <td key={option.label}>{feeText(option, rulesFailed)}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">本次盈亏</th>
              {options.map((option) => (
                <td
                  key={option.label}
                  className={option.ratio > 0 && option.realizedProfit !== null ? toneOf(option.realizedProfit) : ''}
                >
                  {option.ratio === 0 ? '—' : profitText(option.realizedProfit)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">再跌 5%</th>
              {options.map((option) => (
                <td key={option.label} className={option.downside < 0 ? styles.down : ''}>
                  {option.downside < 0 ? `再亏 ${money(option.downside)}` : '不受影响'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">再涨 5%</th>
              {options.map((option) => (
                <td key={option.label} className={option.upside > 0 ? styles.up : ''}>
                  {option.upside > 0 ? `多赚 ${money(option.upside)}` : `少赚 ${money(share * nav * 0.05)}`}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">预计到账</th>
              {options.map((option) => (
                <td key={option.label}>{option.ratio === 0 ? '—' : shortDate(settlement.arrivalDate)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.decisionSlider}>
        <div className={styles.riskMeterHead}>
          <label htmlFor={sliderId}>自定义卖出比例 {ratioPercent}%</label>
          <span aria-live="polite">
            约 {money(custom.gross)} · 赎回费 {feeText(custom, rulesFailed)}
            {ratioPercent > 0 && custom.realizedProfit !== null ? ` · 盈亏 ${profitText(custom.realizedProfit)}` : ''}
          </span>
        </div>
        <input
          id={sliderId}
          type="range"
          min="0"
          max="100"
          step="5"
          value={ratioPercent}
          onChange={(event) => setRatioPercent(Number(event.target.value))}
        />
      </div>

      <div className={styles.decisionRecord}>
        <button
          type="button"
          className={styles.strategyDefault}
          onClick={() => {
            if (onDecide?.(ratioPercent / 100)) {
              setDecisionNote(
                ratioPercent === 0 ? '已记录：继续持有。' : `已记录：卖出 ${ratioPercent}%。这里只做记录，不会下单。`
              );
            }
          }}
        >
          记录我的决定：{ratioPercent === 0 ? '继续持有' : `卖出 ${ratioPercent}%`}
        </button>
        <span className={styles.riskMuted} role="status">
          {decisionNote}
        </span>
      </div>

      {saving ? (
        <p className={styles.decisionTip}>
          <Lightbulb size={15} aria-hidden="true" />
          <span>
            {shortDate(saving.tradeDate)} 起提交全部卖出，赎回费预计少 {money(saving.saving)}；但这期间净值可能变化。
          </span>
        </p>
      ) : null}

      <p className={styles.decisionCutoff}>
        <Clock size={15} aria-hidden="true" />
        {settlement.beforeCutoff ? (
          <span>
            15:00 前提交按今日净值成交，还剩{' '}
            <b>
              {settlement.minutesLeft >= 60 ? `${Math.floor(settlement.minutesLeft / 60)} 小时 ` : ''}
              {settlement.minutesLeft % 60} 分钟
            </b>
          </span>
        ) : (
          <span>
            现在提交按 <b>{shortDate(settlement.tradeDate)}</b> 净值成交
          </span>
        )}
      </p>

      <p className={styles.riskMuted}>
        {estimated ? '按盘中估值估算，实际金额以成交净值为准。' : '按最新正式净值估算，实际金额以成交净值为准。'}
        {unknownShare > 0.000001
          ? `有 ${unknownShare.toFixed(2)} 份没有买入记录，无法判断持有天数，赎回费只算有记录的部分。`
          : ''}
        {rulesQuery.isSuccess && !tiers ? '费率规则暂时无法识别，请以销售平台为准。' : ''}
        持有天数按交易记录推算，赎回费和到账日请以销售平台显示为准。
        {rulesQuery.isError ? (
          <button type="button" className={styles.riskLink} onClick={() => rulesQuery.refetch()}>
            重新获取费率
          </button>
        ) : null}
      </p>
    </details>
  );
}
