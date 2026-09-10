'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNumber, isObject, isString } from 'lodash';
import { fetchFundHistory } from '@/app/api/fund';
import { TrashIcon } from '@/app/components/Icons';
import { useHoldingProfit } from '@/app/hooks/useHoldingProfit';
import * as qk from '@/app/lib/query-keys';
import { storageStore, useStorageStore } from '@/app/stores/storageStore';
import { DEFAULT_STRATEGY, buildStrategyPrompt, calculateStrategyState, calculateTrackedHolding } from './strategy.mjs';
import styles from './page.module.css';

const DEFAULT_STRATEGY_FORM = Object.fromEntries(
  Object.entries(DEFAULT_STRATEGY).map(([key, value]) => [key, String(value)])
);

const pad = (value) => String(value).padStart(2, '0');
const localDateTime = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const displayDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '--'
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const dateKeyFromRow = (row) => {
  if (isString(row?.dateKey) && /^\d{4}-\d{2}-\d{2}$/.test(row.dateKey)) return row.dateKey;
  if (!isString(row?.date) || !/^\d{2}-\d{2}/.test(row.date)) return null;
  return `${new Date().getFullYear()}-${row.date.slice(0, 5)}`;
};
const summarizeRows = (rows, dailyChangeByDate) => {
  let cumulative = 0;
  return rows.map((row) => {
    cumulative += (row.type === 'buy' ? 1 : -1) * Number(row.amount);
    return { ...row, cumulative, dailyChange: dailyChangeByDate.get(dateKeyFromRow(row)) };
  });
};
const formatMoney = (value) => (Number.isFinite(value) ? `¥${value.toFixed(2)}` : '--');
const formatRate = (value) => (Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '--');
const hasNumber = (value) => value !== '' && Number.isFinite(Number(value));
const inputValue = (value) => (value === '' || isString(value) || isNumber(value) ? String(value) : '');
const persistManualHolding = (setHoldings, fundId, share, cost) => {
  if (!(share > 0) || !(cost > 0)) return;
  setHoldings((current) => {
    if (current?.[fundId]) return current;
    return { ...current, [fundId]: { share: Number(share.toFixed(6)), cost } };
  });
};

function StrategyField({ id, label, value, onChange, min, max, step, prefix, suffix, hint }) {
  return (
    <label className={styles.strategyField} htmlFor={id}>
      <span>{label}</span>
      <span className={styles.strategyInputWrap}>
        {prefix ? <span className={styles.strategyPrefix}>{prefix}</span> : null}
        <input
          id={id}
          className={styles.strategyInput}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
        />
        <em>{suffix}</em>
      </span>
      <small id={`${id}-hint`}>{hint}</small>
    </label>
  );
}

export default function FundTradingBoard({ fundId, fundName, embedded = false }) {
  const { funds, holdings, setHoldings, initFunds, initHoldings, initTransactions, initFundDividends } =
    useStorageStore();
  const { getHoldingProfit } = useHoldingProfit({ activeGroupId: null });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [profit, setProfit] = useState('');
  const [rate, setRate] = useState('');
  const [basisNav, setBasisNav] = useState('');
  const [strategy, setStrategy] = useState(DEFAULT_STRATEGY_FORM);
  const [flowType, setFlowType] = useState('buy');
  const [flowAmount, setFlowAmount] = useState('');
  const [flowDate, setFlowDate] = useState(localDateTime);
  const [rows, setRows] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = `board-calculator:${fundId}`;
  const fund = useMemo(() => funds.find((item) => item.code === fundId), [funds, fundId]);
  const holding = holdings?.[fundId];
  const holdingProfit = fund && holding ? getHoldingProfit(fund, holding, null) : null;
  const {
    data: history = [],
    isPending: historyLoading,
    isError: historyError
  } = useQuery({
    queryKey: qk.fundHistory(fundId, '3m'),
    queryFn: () => fetchFundHistory(fundId, '3m'),
    enabled: Boolean(fundId),
    staleTime: 10 * 60 * 1000
  });
  const navHistory = useMemo(
    () =>
      history
        .map((item) => Number(item?.unitNetValue ?? item?.value))
        .filter((value) => Number.isFinite(value) && value > 0),
    [history]
  );
  const dailyChangeByDate = useMemo(() => {
    const changes = new Map();
    let previousNav = null;
    history
      .map((item) => ({
        date: item?.date,
        nav: Number(item?.unitNetValue ?? item?.value),
        reportedChange:
          item?.equityReturn === null || item?.equityReturn === '' || item?.equityReturn === undefined
            ? NaN
            : Number(item.equityReturn)
      }))
      .filter((item) => isString(item.date) && Number.isFinite(item.nav) && item.nav > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((item) => {
        const change = Number.isFinite(item.reportedChange)
          ? item.reportedChange
          : Number.isFinite(previousNav) && previousNav > 0
            ? ((item.nav - previousNav) / previousNav) * 100
            : null;
        if (Number.isFinite(change)) changes.set(item.date, change);
        previousNav = item.nav;
      });
    return changes;
  }, [history]);
  const storedNav = Number(fund?.dwjz);
  const historyNav = navHistory[navHistory.length - 1];
  const currentNav = Number.isFinite(storedNav) && storedNav > 0 ? storedNav : historyNav;
  const manualAmountValue = hasNumber(amount) ? Number(amount) : NaN;
  const manualRateValue = hasNumber(rate) ? Number(rate) : NaN;
  const flowValue = Number(flowAmount);
  const rateFactor = Number.isFinite(manualRateValue) ? 1 + manualRateValue / 100 : NaN;
  const manualTotalValue =
    Number.isFinite(manualAmountValue) && rateFactor !== 0 ? manualAmountValue / rateFactor : NaN;
  const calculatedProfit = Number.isFinite(manualTotalValue) ? manualAmountValue - manualTotalValue : NaN;
  const manualProfitValue = hasNumber(profit) ? Number(profit) : calculatedProfit;
  const trackedHolding = calculateTrackedHolding({ amount, profit, rate, basisNav, currentNav });
  const principal = isNumber(holding?.cost) && isNumber(holding?.share) ? holding.cost * holding.share : NaN;
  const amountValue = Number.isFinite(holdingProfit?.amount)
    ? holdingProfit.amount
    : (trackedHolding?.amount ?? manualAmountValue);
  const profitValue = Number.isFinite(holdingProfit?.profitTotal)
    ? holdingProfit.profitTotal
    : (trackedHolding?.profit ?? manualProfitValue);
  const rateValue =
    Number.isFinite(holdingProfit?.profitTotal) && principal > 0
      ? (holdingProfit.profitTotal / principal) * 100
      : (trackedHolding?.rate ?? manualRateValue);
  const totalValue =
    Number.isFinite(holdingProfit?.amount) && Number.isFinite(principal)
      ? principal
      : (trackedHolding?.principal ?? manualTotalValue);
  const hasLiveHolding = Number.isFinite(holdingProfit?.amount);
  const profitTone = Number.isFinite(profitValue) ? (profitValue >= 0 ? styles.up : styles.down) : '';
  const rateTone = Number.isFinite(rateValue) ? (rateValue >= 0 ? styles.up : styles.down) : '';
  const soldAmount = rows.reduce((total, row) => (row.type === 'sell' ? total + Number(row.amount) : total), 0);
  const rowSummaries = useMemo(() => summarizeRows(rows, dailyChangeByDate), [dailyChangeByDate, rows]);
  const strategyState = calculateStrategyState({
    holdingRate: Number.isFinite(rateValue) ? rateValue : null,
    currentHoldingAmount: Number.isFinite(amountValue) ? amountValue : null,
    currentNav: Number.isFinite(currentNav) ? currentNav : null,
    navHistory,
    lastSellNav: null,
    soldAmount,
    strategy
  });
  const manualShare = trackedHolding?.share;
  const manualCost = trackedHolding?.cost;

  useEffect(() => {
    if (embedded) return;
    const refreshStoredData = () => {
      initFunds();
      initHoldings();
      initTransactions();
      initFundDividends();
    };
    refreshStoredData();
    window.addEventListener('storage', refreshStoredData);
    window.addEventListener('focus', refreshStoredData);
    return () => {
      window.removeEventListener('storage', refreshStoredData);
      window.removeEventListener('focus', refreshStoredData);
    };
  }, [embedded, initFunds, initHoldings, initTransactions, initFundDividends]);

  useEffect(() => {
    try {
      const saved = storageStore.getItem(storageKey, null);
      if (isObject(saved) && !isArray(saved)) {
        setAmount(inputValue(saved.amount));
        setProfit(inputValue(saved.profit));
        setRate(inputValue(saved.rate));
        setBasisNav(inputValue(saved.basisNav));
        if (isArray(saved.rows)) {
          setRows(
            saved.rows
              .filter(
                (row) =>
                  row &&
                  isObject(row) &&
                  isString(row.date) &&
                  (row.type === 'buy' || row.type === 'sell') &&
                  Number.isFinite(Number(row.amount))
              )
              .map((row) => ({ ...row, amount: Number(row.amount), dateKey: dateKeyFromRow(row) }))
          );
        }
        if (isObject(saved.strategy) && !isArray(saved.strategy)) {
          setStrategy(
            Object.fromEntries(
              Object.keys(DEFAULT_STRATEGY_FORM).map((key) => [
                key,
                inputValue(saved.strategy[key] ?? DEFAULT_STRATEGY_FORM[key])
              ])
            )
          );
        }
      }
    } catch {}
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || hasNumber(basisNav) || !Number.isFinite(currentNav)) return;
    if (hasNumber(amount)) setBasisNav(String(currentNav));
  }, [hydrated, basisNav, amount, profit, rate, currentNav]);

  useEffect(() => {
    if (!hydrated || editing || !fund || holding) return;
    persistManualHolding(setHoldings, fundId, manualShare, manualCost);
  }, [hydrated, editing, fund, holding, setHoldings, fundId, manualShare, manualCost]);

  useEffect(() => {
    if (!hydrated) return;
    storageStore.setItem(storageKey, JSON.stringify({ amount, profit, rate, basisNav, rows, strategy }));
  }, [hydrated, amount, profit, rate, basisNav, rows, strategy, storageKey]);

  const updateStrategy = (key, value) => setStrategy((current) => ({ ...current, [key]: value }));
  const updateManualValue = (setter, value) => {
    setter(value);
    if (Number.isFinite(currentNav)) setBasisNav(String(currentNav));
  };
  const applyDefaultStrategy = () => {
    setStrategy(DEFAULT_STRATEGY_FORM);
    storageStore.setItem(
      storageKey,
      JSON.stringify({ amount, profit, rate, basisNav, rows, strategy: DEFAULT_STRATEGY_FORM })
    );
  };
  const addFlow = () => {
    if (!(flowValue > 0) || !flowDate) return;
    setRows((current) => [
      ...current,
      { date: displayDate(flowDate), dateKey: flowDate.slice(0, 10), type: flowType, amount: flowValue }
    ]);
    setFlowAmount('');
  };
  const strategyPrompt = buildStrategyPrompt({
    strategyState,
    holdingRate: rateValue,
    currentHoldingAmount: amountValue,
    strategy
  });
  const status = {
    ...strategyPrompt,
    tone: strategyPrompt.tone === 'up' ? styles.up : strategyPrompt.tone === 'down' ? styles.down : '',
    detail: `${strategyPrompt.detail}${strategyState.sellTriggered ? ' 请在下方出入金选择“卖出”并录入金额。' : strategyState.status === 'buy' ? ' 请通过出入金手动录入。' : ''}`
  };

  return (
    <div className={styles.boardPreview}>
      <div className={styles.previewHead} hidden={embedded}>
        <strong>{fund?.name || fundName}</strong>
        <div className={styles.previewTools}>
          <span>● {Number.isFinite(currentNav) ? `净值 ${fund?.jzrq || '已更新'}` : '行情待更新'}</span>
          {!hasLiveHolding ? (
            <button
              type="button"
              className={styles.previewEdit}
              onClick={() => {
                if (editing && fund && !holding) {
                  persistManualHolding(setHoldings, fundId, manualShare, manualCost);
                }
                setEditing((value) => !value);
              }}
            >
              {editing ? '完成' : '编辑'}
            </button>
          ) : null}
        </div>
      </div>
      <div className={styles.riskPanel} hidden={embedded}>
        <div className={styles.riskBanner}>
          <span className={styles.riskState}>
            {Number.isFinite(currentNav) && navHistory.length >= Number(strategy.maPeriod) ? '已更新' : '待更新'}
          </span>
          <span className={styles.riskMessage}>
            {!Number.isFinite(currentNav)
              ? '等待真实基金净值更新'
              : historyLoading
                ? '正在更新历史净值'
                : historyError
                  ? '历史净值更新失败'
                  : navHistory.length < Number(strategy.maPeriod)
                    ? `历史净值不足 ${strategy.maPeriod || '--'} 个交易日`
                    : `最新净值 ${currentNav.toFixed(4)}，${strategy.maPeriod || '--'} 日均线 ${strategyState.movingAverage.toFixed(4)}`}
          </span>
        </div>
      </div>
      <div className={styles.stats} hidden={embedded}>
        <div className={styles.stat}>
          <i>金额</i>
          {editing && !hasLiveHolding ? (
            <input
              className={styles.statEdit}
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => updateManualValue(setAmount, event.target.value)}
              aria-label="编辑金额"
              placeholder="输入金额"
            />
          ) : (
            <b className={styles.statValue}>{Number.isFinite(amountValue) ? formatMoney(amountValue) : '--'}</b>
          )}
          {Number.isFinite(totalValue) && Number.isFinite(rateValue) ? (
            <small className={styles.statSubvalue}>总额 {formatMoney(totalValue)}</small>
          ) : null}
        </div>
        <div className={styles.stat}>
          <i>持有收益</i>
          {editing && !hasLiveHolding ? (
            <input
              className={styles.statEdit}
              type="number"
              step="0.01"
              value={profit}
              onChange={(event) => updateManualValue(setProfit, event.target.value)}
              aria-label="编辑持有收益"
              placeholder="自动计算，可修改"
            />
          ) : (
            <b className={`${styles.statValue} ${profitTone}`}>
              {Number.isFinite(profitValue) ? formatMoney(profitValue) : '--'}
            </b>
          )}
        </div>
        <div className={styles.stat}>
          <i>持有收益率</i>
          {editing && !hasLiveHolding ? (
            <input
              className={`${styles.statEdit} ${rateTone}`}
              type="number"
              step="0.01"
              value={rate}
              onChange={(event) => updateManualValue(setRate, event.target.value)}
              aria-label="编辑持有收益率"
              placeholder="输入收益率"
            />
          ) : (
            <b className={`${styles.statValue} ${rateTone}`}>
              {Number.isFinite(rateValue) ? formatRate(rateValue) : '--'}
            </b>
          )}
        </div>
        <div className={styles.stat}>
          <i>最新净值</i>
          <b className={styles.statValue}>{Number.isFinite(currentNav) ? currentNav.toFixed(4) : '待更新'}</b>
        </div>
        <div className={styles.stat}>
          <i>跟踪指数</i>
          <b className={styles.statValue}>{fund?.relatedSectorQuoteName || fund?.relatedSector || '--'}</b>
        </div>
      </div>
      <section className={styles.strategyBox} aria-labelledby={`${fundId}-strategy-title`}>
        <div className={styles.strategyHead}>
          <b id={`${fundId}-strategy-title`}>策略设置</b>
          <button
            type="button"
            className={styles.strategyDefault}
            onClick={applyDefaultStrategy}
            aria-label="恢复默认策略"
          >
            默认
          </button>
        </div>
        <div className={styles.strategyFields}>
          <StrategyField
            id={`${fundId}-target-rate`}
            label="目标收益率"
            value={strategy.targetRate}
            onChange={(value) => updateStrategy('targetRate', value)}
            min="0"
            max="100"
            step="0.1"
            suffix="%"
            hint="0—100"
          />
          <StrategyField
            id={`${fundId}-sell-ratio`}
            label="每次卖出"
            value={strategy.sellRatio}
            onChange={(value) => updateStrategy('sellRatio', value)}
            min="0"
            max="100"
            step="0.1"
            suffix="%"
            hint="按当前持仓份额"
          />
          <StrategyField
            id={`${fundId}-cash-tranches`}
            label="卖出资金分"
            value={strategy.cashTranches}
            onChange={(value) => updateStrategy('cashTranches', value)}
            min="1"
            step="1"
            suffix="份"
            hint="正整数"
          />
          <StrategyField
            id={`${fundId}-ma-period`}
            label="补仓条件"
            value={strategy.maPeriod}
            onChange={(value) => updateStrategy('maPeriod', value)}
            min="1"
            step="1"
            prefix="跌破"
            suffix="日均线"
            hint="跌破后提示"
          />
          <StrategyField
            id={`${fundId}-lock-rise-rate`}
            label="踏空锁定线"
            value={strategy.lockRiseRate}
            onChange={(value) => updateStrategy('lockRiseRate', value)}
            min="0"
            step="0.1"
            suffix="%"
            hint="从最近卖出净值算"
          />
        </div>
        <div className={styles.strategyStatus} role="status">
          <strong className={status.tone}>{status.label}</strong>
          <span>{status.detail}</span>
        </div>
      </section>
      <div className={styles.tableScroll} role="region" aria-label="出入金流水，可横向滚动" tabIndex={0}>
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th>时间</th>
              <th>日涨跌幅</th>
              <th>金额</th>
              <th>累计</th>
              <th>收益率</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rowSummaries.length ? (
              rowSummaries.map((row, index) => (
                <tr key={`${row.date}-${index}`}>
                  <td>{row.date}</td>
                  <td
                    className={Number.isFinite(row.dailyChange) ? (row.dailyChange >= 0 ? styles.up : styles.down) : ''}
                  >
                    {Number.isFinite(row.dailyChange) ? formatRate(row.dailyChange) : '待更新'}
                  </td>
                  <td className={row.type === 'buy' ? styles.buy : styles.sell}>
                    {row.type === 'buy' ? '+' : '−'}
                    {row.amount.toFixed(2)}
                  </td>
                  <td>{formatMoney(row.cumulative)}</td>
                  <td className={rateTone}>{Number.isFinite(rateValue) ? formatRate(rateValue) : '待更新'}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.flowDelete}
                      aria-label={`删除${row.type === 'buy' ? '买入' : '卖出'}记录 ${row.date}`}
                      title="删除记录"
                      onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      <TrashIcon width="14" height="14" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className={styles.emptyCell}>
                  暂无流水
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={styles.flowBox}>
        <div className={styles.flowBoxHead}>
          <b>出入金</b>
          <span>买卖记录由你手动录入</span>
        </div>
        <div className={styles.flowForm}>
          <label>
            操作
            <select
              className={flowType === 'buy' ? styles.buy : styles.sell}
              value={flowType}
              onChange={(event) => setFlowType(event.target.value)}
            >
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </label>
          <label>
            金额
            <input
              className={`${styles.flowAmount} ${flowType === 'buy' ? styles.buy : styles.sell}`}
              type="number"
              min="0"
              step="0.01"
              value={flowAmount}
              onChange={(event) => setFlowAmount(event.target.value)}
              placeholder="输入金额"
            />
          </label>
          <label>
            日期
            <input
              className={styles.flowDate}
              type="datetime-local"
              value={flowDate}
              onChange={(event) => setFlowDate(event.target.value)}
            />
          </label>
          <button type="button" className={styles.flowSubmit} onClick={addFlow}>
            添加
          </button>
        </div>
        <small>发生时间显示为 MM-DD HH:MM，默认当天，可手动选择日期。</small>
      </div>
    </div>
  );
}
