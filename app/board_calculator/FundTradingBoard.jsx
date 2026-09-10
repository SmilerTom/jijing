'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNumber, isObject, isString } from 'lodash';
import { fetchFundData, fetchFundHistory } from '@/app/api/fund';
import { TrashIcon } from '@/app/components/Icons';
import { useHoldingProfit } from '@/app/hooks/useHoldingProfit';
import * as qk from '@/app/lib/query-keys';
import { storageStore, useStorageStore } from '@/app/stores/storageStore';
import {
  DEFAULT_STRATEGY,
  buildStrategyPrompt,
  calculateTrackedHolding,
  getStrategyQuote,
  normalizeStrategy
} from './strategy.mjs';
import useStrategyReminder, { notifyStrategyChange } from './useStrategyReminder';
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
  const [strategyError, setStrategyError] = useState('');
  const [confirmationNav, setConfirmationNav] = useState('');
  const [flowType, setFlowType] = useState('buy');
  const [flowAmount, setFlowAmount] = useState('');
  const [flowDate, setFlowDate] = useState(localDateTime);
  const [rows, setRows] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = `board-calculator:${fundId}`;
  const fund = useMemo(() => funds.find((item) => item.code === fundId), [funds, fundId]);
  const { data: liveFund, isError: liveError } = useQuery({
    queryKey: qk.fundData(fundId, fund?.dataSource || 1),
    queryFn: () => fetchFundData(fundId, fund?.dataSource || 1),
    enabled: !embedded && Boolean(fundId),
    staleTime: 45000,
    refetchInterval: 60000,
    refetchOnWindowFocus: true
  });
  const marketFund = useMemo(() => {
    if (embedded) return fund;
    const merged = liveFund ? { ...fund, gsz: null, gztime: null, noValuation: false, ...liveFund } : fund;
    return liveError ? { ...merged, gsz: null, gztime: null } : merged;
  }, [embedded, fund, liveFund, liveError]);
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
  const currentNav = getStrategyQuote(marketFund, history)?.nav;
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
  const rowSummaries = useMemo(() => summarizeRows(rows, dailyChangeByDate), [dailyChangeByDate, rows]);
  const reminder = useStrategyReminder({ fundId, fund: marketFund, history, strategy, enabled: hydrated });
  const { strategyState } = reminder;
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
              Object.keys(DEFAULT_STRATEGY_FORM).map((key) => [key, inputValue(normalizeStrategy(saved.strategy)[key])])
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
    try {
      storageStore.setItem(storageKey, JSON.stringify({ amount, profit, rate, basisNav, rows, strategy }));
      notifyStrategyChange();
      setStrategyError('');
    } catch {
      setStrategyError('设置保存失败，请检查浏览器存储；顶部提示仍使用之前保存的设置。');
    }
  }, [hydrated, amount, profit, rate, basisNav, rows, strategy, storageKey]);

  const updateStrategy = (key, value) => setStrategy((current) => ({ ...current, [key]: value }));
  const updateManualValue = (setter, value) => {
    setter(value);
    if (Number.isFinite(currentNav)) setBasisNav(String(currentNav));
  };
  const applyDefaultStrategy = () => {
    setStrategy(DEFAULT_STRATEGY_FORM);
  };
  const addFlow = () => {
    if (!(flowValue > 0) || !flowDate) return;
    setRows((current) => [
      ...current,
      { date: displayDate(flowDate), dateKey: flowDate.slice(0, 10), type: flowType, amount: flowValue }
    ]);
    setFlowAmount('');
  };
  const strategyPrompt = buildStrategyPrompt({ strategyState });
  const status = {
    ...strategyPrompt,
    tone: strategyPrompt.tone === 'up' ? styles.up : strategyPrompt.tone === 'down' ? styles.down : '',
    detail: strategyPrompt.detail
  };
  const confirmationType = strategyState.status === 'stopped' ? 'resume' : strategyState.status;
  const canConfirm = ['sell', 'buy', 'stop', 'resume'].includes(confirmationType);
  const confirmTrade = (event) => {
    event.preventDefault();
    if (strategyError) return;
    if (reminder.confirmTrade(confirmationType, confirmationNav)) setConfirmationNav('');
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
            {reminder.signalQuote?.estimated ? '估值已更新' : Number.isFinite(currentNav) ? '已更新' : '待更新'}
          </span>
          <span className={styles.riskMessage}>
            {reminder.signalQuote?.estimated
              ? `盘中估值 ${reminder.signalQuote.nav.toFixed(4)}（${reminder.signalQuote.time}），仅用于预警`
              : !Number.isFinite(currentNav)
                ? '等待真实基金净值更新'
                : historyLoading
                  ? '正在更新历史净值'
                  : historyError
                    ? '历史净值更新失败，最高值记录可能不完整'
                    : `最新净值 ${currentNav.toFixed(4)}${Number.isFinite(reminder.cycle?.peakNav) ? `，跟踪最高 ${reminder.cycle.peakNav.toFixed(4)}` : ''}`}
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
          <i>正式净值</i>
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
            id={`${fundId}-rise-rate`}
            label="涨多少卖"
            value={strategy.riseRate}
            onChange={(value) => updateStrategy('riseRate', value)}
            min="0.01"
            max="1000"
            step="0.1"
            suffix="%"
            hint="首次跟踪 / 上次实际买入为起点"
          />
          <StrategyField
            id={`${fundId}-buy-drop-rate`}
            label="跌多少买回"
            value={strategy.buyDropRate}
            onChange={(value) => updateStrategy('buyDropRate', value)}
            min="0.01"
            max="99"
            step="0.1"
            suffix="%"
            hint="确认卖出后，较实际卖出价回落"
          />
          <StrategyField
            id={`${fundId}-stop-drawdown`}
            label="最高值回落多少卖"
            value={strategy.stopDrawdown}
            onChange={(value) => updateStrategy('stopDrawdown', value)}
            min="0.01"
            max="99"
            step="0.1"
            suffix="%"
            hint="跟踪期间最高净值回落，优先止损"
          />
          <StrategyField
            id={`${fundId}-cooldown-days`}
            label="冷静期"
            value={strategy.cooldownDays}
            onChange={(value) => updateStrategy('cooldownDays', value)}
            min="0"
            max="3650"
            step="1"
            suffix="天"
            hint="实际成交确认后按日历天计算"
          />
        </div>
        <div className={styles.strategyStatus} role="status">
          <strong className={status.tone}>{status.label}</strong>
          <span>{status.detail}</span>
        </div>
        {strategyError || reminder.error ? (
          <p className={styles.strategyNote} role="alert">
            {strategyError || reminder.error}
          </p>
        ) : null}
        {canConfirm ? (
          <form className={styles.strategyConfirmation} onSubmit={confirmTrade}>
            <label htmlFor={`${fundId}-confirmed-nav`}>
              实际成交净值
              <input
                id={`${fundId}-confirmed-nav`}
                className={styles.strategyInput}
                type="number"
                min="0.000001"
                max="1000000"
                step="any"
                required
                value={confirmationNav}
                onChange={(event) => setConfirmationNav(event.target.value)}
                placeholder="按成交记录填写"
              />
            </label>
            <button className={styles.strategyDefault} type="submit" disabled={Boolean(strategyError)}>
              {confirmationType === 'resume'
                ? '已重新买入，恢复跟踪'
                : confirmationType === 'buy'
                  ? '已买入'
                  : '已卖出'}
            </button>
          </form>
        ) : null}
        <p className={styles.strategyNote}>
          仅提示，不自动交易；成交确认只更新滚仓阶段，不修改持仓和出入金。普通买卖保留最高值，止损确认后暂停补仓。
        </p>
        {!embedded && liveError ? (
          <p className={styles.strategyNote} role="status">
            估值刷新失败，已暂停使用估值，按已有正式净值复核。
          </p>
        ) : null}
        {reminder.signalQuote ? (
          <small className={styles.strategyNote}>
            {reminder.signalQuote.estimated
              ? `估值时间：${reminder.signalQuote.time}；正式净值：${reminder.quote?.date || '待更新'}`
              : `正式净值日期：${reminder.signalQuote.date}；暂无更新的有效当日估值`}
            。估值只作预警，不更新最高值或成交基准。
          </small>
        ) : null}
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
