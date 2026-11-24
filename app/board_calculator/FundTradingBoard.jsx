'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNumber, isObject, isString } from 'lodash';
import {
  fetchFundData,
  fetchFundHistory,
  fetchFundPingzhongdata,
  fetchFundTradeRules,
  fetchIndexKlines
} from '@/app/api/fund';
import { TrashIcon } from '@/app/components/Icons';
import { useHoldingProfit } from '@/app/hooks/useHoldingProfit';
import * as qk from '@/app/lib/query-keys';
import { storageStore, useStorageStore } from '@/app/stores/storageStore';
import { cn } from '@/lib/utils';
import {
  BAND_PERIODS,
  DEFAULT_BAND,
  DEFAULT_STRATEGY,
  buildStrategyPrompt,
  calculateTrackedHolding,
  getStrategyQuote,
  isStrategyCycle,
  normalizeBand,
  normalizeStrategy,
  splitBandPosition
} from './strategy.mjs';
import { navChange, triggerDistance } from './preview.mjs';
import { applyTradeToBook, parseRedemptionTiers, pickTradeBook, rateForDays, resolvePosition } from './decision.mjs';
import {
  PERIODS,
  backtestAgainstHold,
  calendarYearReturns,
  computeMetrics,
  flowsFromTransactions,
  klinesToSeries,
  replayRollingSignals,
  slicePeriod,
  toAdjustedSeries,
  worstWindows,
  xirr
} from './analytics.mjs';
import PerformancePanel from './PerformancePanel';
import BacktestPanel from './BacktestPanel';
import PortfolioPanel from './PortfolioPanel';
import ProfilePanel from './ProfilePanel';
import { downloadReport } from './report.mjs';
import useStrategyReminder, { notifyStrategyChange } from './useStrategyReminder';
import MarketAnalysis, { SignalReview } from './RiskPanel';
import { BandAllocation, BandChartCard, BandHistory, BandSettings, useBandModel } from './ValuationBandPanel';
import DecisionCard from './DecisionCard';
import Tabs from './Tabs';
import { classifyRisk } from './risk.mjs';
import styles from './page.module.css';

const BENCHMARK_SECID = '1.000300';
const DEFAULT_STRATEGY_FORM = Object.fromEntries(
  Object.entries({ ...DEFAULT_STRATEGY, ...DEFAULT_BAND }).map(([key, value]) => [key, String(value)])
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
  const {
    funds,
    holdings,
    groupHoldings,
    transactions,
    setHoldings,
    setGroupHoldings,
    setTransactions,
    initFunds,
    initHoldings,
    initGroupHoldings,
    initTransactions,
    initFundDividends
  } = useStorageStore();
  const { getHoldingProfit } = useHoldingProfit({ activeGroupId: null });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [profit, setProfit] = useState('');
  const [rate, setRate] = useState('');
  const [basisNav, setBasisNav] = useState('');
  const [strategy, setStrategy] = useState(DEFAULT_STRATEGY_FORM);
  const [strategyError, setStrategyError] = useState('');
  const [confirmationNav, setConfirmationNav] = useState('');
  const [confirmShare, setConfirmShare] = useState('');
  const [confirmAmount, setConfirmAmount] = useState('');
  const [syncBooks, setSyncBooks] = useState(true);
  const [tradeNote, setTradeNote] = useState('');
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
  const position = useMemo(() => resolvePosition(fundId, holdings, groupHoldings), [fundId, holdings, groupHoldings]);
  // 与卖出测算同一口径：合并全局和各分组账本；基金不在自选列表时用实时行情计算
  const holding = position;
  const profitFund = marketFund ? { code: fundId, ...marketFund } : null;
  const holdingProfit = profitFund && holding ? getHoldingProfit(profitFund, holding, null) : null;
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
      initGroupHoldings();
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
  }, [embedded, initFunds, initHoldings, initGroupHoldings, initTransactions, initFundDividends]);

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
              Object.entries({ ...normalizeStrategy(saved.strategy), ...normalizeBand(saved.strategy) }).map(
                ([key, value]) => [key, inputValue(value)]
              )
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
    setStrategy((current) => ({ ...DEFAULT_STRATEGY_FORM, mode: current.mode, modePicked: current.modePicked }));
  };
  const pickBandPeriod = (period) =>
    setStrategy((current) => ({
      ...current,
      bandPeriod: String(period),
      bandSell: String(BAND_PERIODS[period].sell),
      bandBuy: String(BAND_PERIODS[period].buy)
    }));
  const addFlow = () => {
    if (!(flowValue > 0) || !flowDate) return;
    setRows((current) => [
      ...current,
      { date: displayDate(flowDate), dateKey: flowDate.slice(0, 10), type: flowType, amount: flowValue }
    ]);
    setFlowAmount('');
  };
  const strategyPrompt = buildStrategyPrompt({ strategyState });
  const verdictTone =
    strategyPrompt.tone === 'up' || strategyPrompt.tone === 'warn'
      ? 'alert'
      : strategyPrompt.tone === 'down'
        ? 'chance'
        : 'calm';
  const confirmationType = strategyState.status === 'stopped' ? 'resume' : strategyState.status;
  const canConfirm = ['sell', 'buy', 'stop', 'resume'].includes(confirmationType);
  const bandMode = strategy.mode === 'band';
  const signalQuote = reminder.signalQuote;
  const cycle = reminder.cycle;
  const validCycle = isStrategyCycle(cycle);
  const waitingBuy = validCycle && cycle.phase === 'waitingBuy';
  const previewNav = validCycle && signalQuote?.date >= cycle.anchorDate ? signalQuote.nav : null;
  const cycleChange = navChange(previewNav, validCycle ? cycle.anchorNav : null);
  const triggerRate = Number(waitingBuy ? strategy.buyDropRate : strategy.riseRate);
  const targetNav =
    validCycle && cycle.phase !== 'stopped' && triggerRate > 0 && (!waitingBuy || triggerRate < 100)
      ? cycle.anchorNav * (1 + (waitingBuy ? -triggerRate : triggerRate) / 100)
      : null;
  const rollingDistance = triggerDistance(previewNav, targetNav, waitingBuy);
  const dailyEstimate =
    signalQuote?.estimated && hasNumber(inputValue(marketFund?.gszzl)) ? Number(marketFund.gszzl) : null;
  const bandSplit = splitBandPosition({
    amount: amountValue,
    corePercent: strategy.corePercent,
    phase: strategyState.phase
  });
  const band = useBandModel({ strategy, state: strategyState, history: reminder.bandHistory, split: bandSplit });
  const risk = classifyRisk(strategyState);
  const sleevePercent = 100 - Number(strategy.corePercent);
  const advice = !bandMode
    ? ''
    : confirmationType === 'sell'
      ? bandSplit
        ? `建议卖出机动仓约 ${formatMoney(bandSplit.sleeve)}（持仓的 ${sleevePercent}%），底仓不动。`
        : `建议卖出机动仓（持仓的 ${sleevePercent}%），底仓不动。`
      : confirmationType === 'buy'
        ? bandSplit
          ? `建议买回机动仓约 ${formatMoney(bandSplit.sleeve)}。`
          : '建议买回机动仓。'
        : '';
  const distanceValue = bandMode ? band.distance : rollingDistance;
  const buyingSide = bandMode ? band.buying : waitingBuy;
  const kpis = [
    {
      key: 'amount',
      label: '持仓市值',
      value: formatMoney(amountValue),
      sub: Number.isFinite(totalValue)
        ? `本金 ${formatMoney(totalValue)}`
        : Number.isFinite(amountValue)
          ? '缺成本价，在首页补充后可算收益'
          : '点「录入持仓」填写'
    },
    {
      key: 'profit',
      label: '持有收益',
      value: formatMoney(profitValue),
      tone: profitTone,
      sub: Number.isFinite(rateValue) ? `收益率 ${formatRate(rateValue)}` : '--',
      subTone: rateTone
    },
    bandMode
      ? {
          key: 'deviation',
          label: '偏离均线',
          value: formatRate(band.deviation),
          sub: `${band.maLabel}${strategyState.estimated ? ' · 含今日估值' : ''}`
        }
      : {
          key: 'cycle',
          label: '本轮涨跌',
          value: formatRate(cycleChange),
          sub: waitingBuy ? '相对上次卖出' : '相对跟踪起点 / 上次买入'
        },
    {
      key: 'distance',
      label: buyingSide ? '距买回线' : '距卖出线',
      value: distanceValue === null ? '--' : distanceValue === 0 ? '已到线' : `${distanceValue.toFixed(2)}%`,
      sub: bandMode
        ? buyingSide
          ? `均线 −${strategy.bandBuy}%`
          : `均线 +${strategy.bandSell}%`
        : `触发线 ${formatRate(waitingBuy ? -triggerRate : triggerRate)}`
    }
  ];
  const [tab, setTab] = useState('action');
  const allHistoryQuery = useQuery({
    queryKey: qk.fundHistory(fundId, 'all'),
    queryFn: () => fetchFundHistory(fundId, 'all'),
    enabled: !embedded && Boolean(fundId),
    staleTime: 10 * 60 * 1000
  });
  const benchmarkQuery = useQuery({
    queryKey: ['benchmarkKlines', BENCHMARK_SECID, 2500],
    queryFn: () => fetchIndexKlines(BENCHMARK_SECID, 2500),
    enabled: !embedded,
    staleTime: 60 * 60 * 1000
  });
  const tradeRulesQuery = useQuery({
    queryKey: qk.fundTradeRules(fundId),
    queryFn: () => fetchFundTradeRules(fundId),
    enabled: !embedded && Boolean(fundId),
    staleTime: 24 * 60 * 60 * 1000
  });
  const profileQuery = useQuery({
    queryKey: ['boardFundProfile', fundId],
    queryFn: () => fetchFundPingzhongdata(fundId),
    enabled: !embedded && Boolean(fundId),
    staleTime: 60 * 60 * 1000
  });
  const fundSeries = useMemo(() => toAdjustedSeries(allHistoryQuery.data), [allHistoryQuery.data]);
  const benchSeries = useMemo(() => klinesToSeries(benchmarkQuery.data), [benchmarkQuery.data]);
  const byPeriod = useMemo(
    () =>
      Object.fromEntries(
        PERIODS.map(([key]) => {
          const slice = slicePeriod(fundSeries, key);
          return [key, slice ? computeMetrics(slice, benchSeries) : null];
        })
      ),
    [fundSeries, benchSeries]
  );
  const years = useMemo(() => calendarYearReturns(fundSeries, benchSeries), [fundSeries, benchSeries]);
  const worst = useMemo(() => worstWindows(fundSeries), [fundSeries]);
  const fundTransactions = transactions?.[fundId];
  const todayKey = localDateTime().slice(0, 10);
  const xirrValue = xirr(flowsFromTransactions(fundTransactions, amountValue, todayKey));
  const tiers = useMemo(() => parseRedemptionTiers(tradeRulesQuery.data?.redeemRows), [tradeRulesQuery.data]);
  const buyFee = Number(profileQuery.data?.fund_Rate) / 100 || 0;
  const rollingSignals = useMemo(
    () => (bandMode ? [] : replayRollingSignals(fundSeries, strategy)),
    [bandMode, fundSeries, strategy]
  );
  const backtest = useMemo(() => {
    const series = bandMode ? band.series.map((row) => ({ date: row.date, nav: row.nav })) : fundSeries;
    if (series.length < 2) return null;
    return backtestAgainstHold(series, bandMode ? band.signals : rollingSignals, {
      corePercent: bandMode ? Number(strategy.corePercent) : 0,
      buyFee,
      feeForDays: (days) => rateForDays(tiers, days) ?? 0
    });
  }, [bandMode, band.series, band.signals, fundSeries, rollingSignals, strategy.corePercent, buyFee, tiers]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const goAction = () => {
    setTab('action');
    requestAnimationFrame(() => {
      document.getElementById(`${fundId}-workbench`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById(`${fundId}-confirmed-nav`)?.focus({ preventScroll: true });
    });
  };
  const tradeSide = confirmationType === 'buy' || confirmationType === 'resume' ? 'buy' : 'sell';
  const tradeBook = pickTradeBook(position);
  const confirmShareValue = Number(confirmShare);
  const confirmNavValue = Number(confirmationNav);
  const confirmAmountValue = hasNumber(confirmAmount)
    ? Number(confirmAmount)
    : confirmShareValue > 0 && confirmNavValue > 0
      ? confirmShareValue * confirmNavValue
      : NaN;
  const bookTrade = () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const trade = { type: tradeSide, share: confirmShareValue, amount: confirmAmountValue, date };
    const groupId = tradeBook.groupId;
    if (groupId) {
      setGroupHoldings((current) => ({
        ...current,
        [groupId]: { ...(current?.[groupId] || {}), [fundId]: applyTradeToBook(current?.[groupId]?.[fundId], trade) }
      }));
    } else {
      setHoldings((current) => ({ ...current, [fundId]: applyTradeToBook(current?.[fundId], trade) }));
    }
    setTransactions((current) => ({
      ...current,
      [fundId]: [
        {
          id: globalThis.crypto?.randomUUID?.() || `board-${now.getTime()}`,
          type: tradeSide,
          share: confirmShareValue,
          amount: confirmAmountValue,
          price: confirmNavValue,
          date,
          isAfter3pm: now.getHours() >= 15,
          isDca: false,
          timestamp: now.getTime(),
          ...(groupId ? { groupId } : {})
        },
        ...(current?.[fundId] || [])
      ]
    }));
    setRows((current) => [
      ...current,
      { date: displayDate(localDateTime()), dateKey: date, type: tradeSide, amount: confirmAmountValue }
    ]);
    if (tradeSide === 'sell' && Number(position?.share) > 0)
      reminder.saveDecision(Math.min(1, confirmShareValue / Number(position.share)));
  };
  const confirmTrade = (event) => {
    event.preventDefault();
    if (strategyError) return;
    const willBook = syncBooks && tradeBook && confirmShareValue > 0 && confirmAmountValue > 0;
    if (syncBooks && tradeBook && !willBook) {
      setTradeNote('同步记账需要填写成交份额；只确认策略阶段请取消勾选。');
      return;
    }
    if (!reminder.confirmTrade(confirmationType, confirmationNav)) return;
    if (willBook) bookTrade();
    setTradeNote(
      willBook
        ? `已确认，并记入${tradeBook.groupId ? '分组' : '全局'}持仓、交易记录和流水。`
        : '已确认策略阶段；持仓和流水未改动。'
    );
    setConfirmationNav('');
    setConfirmShare('');
    setConfirmAmount('');
  };
  const sourceText = signalQuote
    ? signalQuote.estimated
      ? `盘中估值 ${signalQuote.time}，正式净值 ${reminder.quote?.date || '待更新'}`
      : `正式净值 ${signalQuote.date}，暂无当日估值`
    : '等待净值';

  const tabs = [
    ['action', '操作', canConfirm],
    ['backtest', '策略回测'],
    ['portfolio', '组合'],
    ['profile', '档案'],
    ['market', '市场'],
    ['ledger', '流水'],
    ['settings', '设置']
  ];
  const exportReport = () =>
    downloadReport({
      fundId,
      fundName: fund?.name || fundName,
      byPeriod,
      years,
      worst,
      xirrValue,
      backtest,
      bandMode,
      rows: rowSummaries,
      transactions: fundTransactions,
      signalLog: reminder.signalLog
    });

  return (
    <div className={styles.advisor}>
      {embedded ? null : (
        <header className={styles.advisorHeader}>
          <div className={styles.advisorTitle}>
            <p className={styles.eyebrow}>
              {fundId} · {fund?.relatedSectorQuoteName || fund?.relatedSector || '跟踪指数待更新'}
            </p>
            <h2>{fund?.name || fundName}</h2>
          </div>
          <dl className={styles.advisorQuote}>
            <div>
              <dt>单位净值 {fund?.jzrq ? fund.jzrq.slice(5) : ''}</dt>
              <dd>{Number.isFinite(currentNav) ? currentNav.toFixed(4) : '待更新'}</dd>
            </div>
            <div>
              <dt>今日估算</dt>
              <dd className={Number.isFinite(dailyEstimate) ? (dailyEstimate >= 0 ? styles.up : styles.down) : ''}>
                {formatRate(dailyEstimate)}
              </dd>
            </div>
          </dl>
          <div className={styles.headerActions}>
            <button type="button" className={styles.segButton} onClick={exportReport}>
              导出 CSV
            </button>
            <button type="button" className={styles.segButton} onClick={() => window.print()}>
              打印报告
            </button>
          </div>
        </header>
      )}

      {historyLoading || historyError ? (
        <p className={styles.strategyNote} role="status">
          {historyLoading ? '正在更新历史净值…' : '历史净值更新失败，最高值记录和预测可能不完整。'}
        </p>
      ) : null}

      <section className={cn(styles.verdict, styles[`verdict_${verdictTone}`])} aria-labelledby={`${fundId}-verdict`}>
        <div className={styles.verdictMain}>
          <p className={styles.eyebrow}>今日建议 · {bandMode ? '均线带滚仓' : '涨跌滚仓'}</p>
          <h3 id={`${fundId}-verdict`} role="status">
            {strategyPrompt.label}
          </h3>
          {advice ? <p className={styles.verdictAdvice}>{advice}</p> : null}
          <p className={styles.verdictDetail}>{strategyPrompt.detail}</p>
          {!bandMode && Number.isFinite(risk.ratio) ? (
            <div className={styles.verdictMeter}>
              <div className={styles.riskMeterHead}>
                <span>
                  距止损线 {risk.stopLine}%
                  {Number.isFinite(risk.remaining) ? ` · 还差 ${risk.remaining.toFixed(2)}%` : ''}
                </span>
                <span>{Math.round(risk.ratio * 100)}%</span>
              </div>
              <div
                className={styles.riskBar}
                role="meter"
                aria-label="最高值回落占止损线的比例"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(risk.ratio * 100)}
              >
                <i style={{ width: `${Math.max(2, risk.ratio * 100)}%` }} />
              </div>
            </div>
          ) : null}
        </div>
        {canConfirm ? (
          <button type="button" className={styles.primaryAction} onClick={goAction}>
            记录实际成交
          </button>
        ) : null}
      </section>

      {strategyError || reminder.error || (!embedded && liveError) ? (
        <p className={styles.strategyNote} role="alert">
          {strategyError || reminder.error || '估值刷新失败，已暂停使用估值，按已有正式净值复核。'}
        </p>
      ) : null}

      {embedded ? null : (
        <div className={styles.kpiGrid}>
          {kpis.map((item) => (
            <div key={item.key} className={styles.kpi}>
              <span>{item.label}</span>
              <b className={item.tone}>{item.value}</b>
              <small className={item.subTone}>{item.sub}</small>
            </div>
          ))}
        </div>
      )}
      {!hasLiveHolding && !embedded ? (
        <div className={styles.holdingEdit}>
          {editing ? (
            <div className={styles.holdingForm}>
              {[
                ['金额', amount, setAmount, '持仓金额'],
                ['持有收益', profit, setProfit, '可留空自动计算'],
                ['收益率 %', rate, setRate, '例如 12.5']
              ].map(([label, value, setter, placeholder]) => (
                <label key={label}>
                  {label}
                  <input
                    className={styles.strategyInput}
                    type="number"
                    step="0.01"
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => updateManualValue(setter, event.target.value)}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              if (editing && fund && !holding) persistManualHolding(setHoldings, fundId, manualShare, manualCost);
              setEditing((value) => !value);
            }}
          >
            {editing ? '完成录入' : Number.isFinite(amountValue) ? '修改持仓' : '录入持仓'}
          </button>
        </div>
      ) : null}

      {embedded ? null : (
        <PerformancePanel
          byPeriod={byPeriod}
          years={years}
          worst={worst}
          xirrValue={xirrValue}
          loading={allHistoryQuery.isPending}
          failed={allHistoryQuery.isError}
          benchmarkFailed={benchmarkQuery.isError}
        />
      )}

      {bandMode ? (
        <>
          <BandChartCard model={band} loading={reminder.bandLoading} failed={reminder.bandFailed} />
          <div className={styles.advisorCard}>
            <h3 className={styles.advisorCardTitle}>
              仓位结构{bandSplit ? (strategyState.phase === 'waitingBuy' ? '（机动仓已卖出）' : '') : ''}
            </h3>
            <BandAllocation model={band} split={bandSplit} phase={strategyState.phase} />
          </div>
        </>
      ) : null}

      <section id={`${fundId}-workbench`} className={styles.advisorCard} aria-label="工作台">
        <Tabs id={`${fundId}-workbench`} label="工作台" tabs={tabs} value={tab} onChange={setTab}>
          {tab === 'action' ? (
            <div className={styles.actionPane}>
              {canConfirm ? (
                <form className={styles.tradeForm} onSubmit={confirmTrade}>
                  <div className={styles.tradeFields}>
                    <label htmlFor={`${fundId}-confirmed-nav`}>
                      成交净值
                      <input
                        id={`${fundId}-confirmed-nav`}
                        className={styles.fieldInput}
                        type="number"
                        min="0.000001"
                        max="1000000"
                        step="any"
                        required
                        value={confirmationNav}
                        onChange={(event) => setConfirmationNav(event.target.value)}
                        placeholder="按确认单填写"
                      />
                    </label>
                    <label htmlFor={`${fundId}-confirmed-share`}>
                      成交份额
                      <input
                        id={`${fundId}-confirmed-share`}
                        className={styles.fieldInput}
                        type="number"
                        min="0"
                        step="any"
                        value={confirmShare}
                        onChange={(event) => setConfirmShare(event.target.value)}
                        placeholder={
                          tradeSide === 'sell' && position ? `持有 ${Number(position.share).toFixed(2)}` : '份'
                        }
                      />
                    </label>
                    <label htmlFor={`${fundId}-confirmed-amount`}>
                      {tradeSide === 'buy' ? '买入金额（含费）' : '卖出金额'}
                      <input
                        id={`${fundId}-confirmed-amount`}
                        className={styles.fieldInput}
                        type="number"
                        min="0"
                        step="0.01"
                        value={confirmAmount}
                        onChange={(event) => setConfirmAmount(event.target.value)}
                        placeholder={
                          Number.isFinite(confirmAmountValue) ? confirmAmountValue.toFixed(2) : '份额 × 净值'
                        }
                      />
                    </label>
                  </div>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={syncBooks && Boolean(tradeBook)}
                      disabled={!tradeBook}
                      onChange={(event) => setSyncBooks(event.target.checked)}
                    />
                    {tradeBook
                      ? `同时记入${tradeBook.groupId ? '分组' : '全局'}持仓、交易记录和流水`
                      : '这只基金在多个账本中持有，请到首页对应分组记账'}
                  </label>
                  <div className={styles.tradeActions}>
                    <button className={styles.primaryAction} type="submit" disabled={Boolean(strategyError)}>
                      {confirmationType === 'resume'
                        ? '已重新买入，恢复跟踪'
                        : confirmationType === 'buy'
                          ? '确认已买入'
                          : '确认已卖出'}
                    </button>
                    <span className={styles.riskMuted} role="status">
                      {tradeNote}
                    </span>
                  </div>
                </form>
              ) : (
                <p className={styles.riskMuted}>当前没有需要执行的信号。下面可以随时测算卖出的费用和到账时间。</p>
              )}
              <DecisionCard
                key={bandMode ? sleevePercent : 'manual'}
                fundId={fundId}
                nav={signalQuote?.nav}
                estimated={Boolean(signalQuote?.estimated)}
                presetRatio={bandMode ? sleevePercent / 100 : null}
                onDecide={reminder.saveDecision}
              />
            </div>
          ) : null}

          {tab === 'market' ? (
            <MarketAnalysis
              fundId={fundId}
              fund={marketFund}
              history={history}
              reminder={reminder}
              strategy={strategy}
              active
            />
          ) : null}

          {tab === 'backtest' ? (
            <div className={styles.actionPane}>
              <h4 className={styles.paneTitle}>当前策略 vs 一直持有</h4>
              <BacktestPanel
                result={backtest}
                bandMode={bandMode}
                feeKnown={Boolean(tiers)}
                loading={allHistoryQuery.isPending}
              />
              {bandMode ? (
                <>
                  <h4 className={styles.paneTitle}>当前参数下的历史信号</h4>
                  <BandHistory model={band} />
                </>
              ) : null}
              <h4 className={styles.paneTitle}>提示复盘 · 只保存在这台设备上</h4>
              <SignalReview log={reminder.signalLog} latestNav={signalQuote?.nav} />
            </div>
          ) : null}

          {tab === 'portfolio' ? (
            <PortfolioPanel
              fundId={fundId}
              funds={funds}
              holdings={holdings}
              groupHoldings={groupHoldings}
              currentSeries={fundSeries}
            />
          ) : null}

          {tab === 'profile' ? (
            <ProfilePanel
              profile={profileQuery.data}
              tiers={tiers}
              loading={profileQuery.isPending}
              failed={profileQuery.isError}
              onRetry={() => profileQuery.refetch()}
            />
          ) : null}

          {tab === 'settings' ? (
            <div className={styles.actionPane}>
              <div className={styles.modeRow}>
                <span className={styles.bandLabel}>滚仓方式</span>
                <div className={styles.modeSwitch} role="group" aria-label="滚仓模式">
                  {[
                    ['band', '均线带滚仓'],
                    ['rolling', '涨跌滚仓']
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={cn(styles.segButton, strategy.mode === mode && styles.segActive)}
                      aria-pressed={strategy.mode === mode}
                      onClick={() => setStrategy((current) => ({ ...current, mode, modePicked: '1' }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className={styles.bandHint}>
                {bandMode
                  ? '底仓长期持有；机动仓在净值高于均线一定比例时卖出，回落到下轨时买回。'
                  : '从跟踪起点上涨到卖出线时卖出，回落到买回线时买回；从最高值回落到止损线时优先止损。'}
              </p>
              {bandMode ? (
                <BandSettings
                  fundId={fundId}
                  model={band}
                  strategy={strategy}
                  onPeriod={pickBandPeriod}
                  onField={updateStrategy}
                  onReset={applyDefaultStrategy}
                />
              ) : (
                <>
                  <div className={styles.bandCardHead}>
                    <span className={styles.bandLabel}>触发条件</span>
                    <button type="button" className={styles.segButton} onClick={applyDefaultStrategy}>
                      恢复默认
                    </button>
                  </div>
                  <div className={styles.strategyFields}>
                    {[
                      ['rise-rate', 'riseRate', '涨多少卖', '0.01', '1000', '0.1', '%', '从跟踪起点 / 上次买入算'],
                      ['buy-drop-rate', 'buyDropRate', '跌多少买回', '0.01', '99', '0.1', '%', '从实际卖出价算'],
                      [
                        'stop-drawdown',
                        'stopDrawdown',
                        '最高值回落多少止损',
                        '0.01',
                        '99',
                        '0.1',
                        '%',
                        '优先于其他信号'
                      ],
                      ['cooldown-days', 'cooldownDays', '冷静期', '0', '3650', '1', '天', '成交后按日历天']
                    ].map(([id, key, label, min, max, step, suffix, hint]) => (
                      <StrategyField
                        key={key}
                        id={`${fundId}-${id}`}
                        label={label}
                        value={strategy[key]}
                        onChange={(value) => updateStrategy(key, value)}
                        min={min}
                        max={max}
                        step={step}
                        suffix={suffix}
                        hint={hint}
                      />
                    ))}
                  </div>
                </>
              )}
              {cycle && signalQuote ? (
                <p className={styles.riskMuted}>
                  {cycle.startDate ? `从 ${cycle.startDate} 开始跟踪。` : ''}
                  {confirmingReset ? (
                    <span className={styles.resetConfirm}>
                      将以当前净值重新开始跟踪，最高值和基准都会重置。
                      <button
                        type="button"
                        className={styles.riskLink}
                        onClick={() => {
                          reminder.resetCycle();
                          setConfirmingReset(false);
                        }}
                      >
                        确定重置
                      </button>
                      <button type="button" className={styles.riskLink} onClick={() => setConfirmingReset(false)}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" className={styles.riskLink} onClick={() => setConfirmingReset(true)}>
                        重新跟踪
                      </button>
                      {reminder.canUndoReset ? (
                        <button type="button" className={styles.riskLink} onClick={() => reminder.undoReset()}>
                          恢复上次跟踪
                        </button>
                      ) : null}
                    </>
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'ledger' ? (
            <div className={styles.actionPane}>
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
              <div className={styles.tableScroll} role="region" aria-label="出入金流水，可横向滚动" tabIndex={0}>
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>日涨跌幅</th>
                      <th>金额</th>
                      <th>累计</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowSummaries.length ? (
                      rowSummaries.map((row, index) => (
                        <tr key={`${row.date}-${index}`}>
                          <td>{row.date}</td>
                          <td
                            className={
                              Number.isFinite(row.dailyChange) ? (row.dailyChange >= 0 ? styles.up : styles.down) : ''
                            }
                          >
                            {Number.isFinite(row.dailyChange) ? formatRate(row.dailyChange) : '待更新'}
                          </td>
                          <td className={row.type === 'buy' ? styles.buy : styles.sell}>
                            {row.type === 'buy' ? '+' : '−'}
                            {row.amount.toFixed(2)}
                          </td>
                          <td>{formatMoney(row.cumulative)}</td>
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
                        <td colSpan="5" className={styles.emptyCell}>
                          暂无流水
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className={styles.riskMuted}>上表是本页出入金流水；确认成交时勾选同步会自动记入。</p>
              <h4 className={styles.paneTitle}>交易记录（与首页同步）</h4>
              <div className={styles.tableScroll} role="region" aria-label="交易记录，可横向滚动" tabIndex={0}>
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>类型</th>
                      <th>份额</th>
                      <th>净值</th>
                      <th>金额</th>
                      <th>账本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isArray(fundTransactions) && fundTransactions.length ? (
                      fundTransactions.map((tx) => (
                        <tr key={tx.id || tx.timestamp}>
                          <td>{String(tx.date || '').slice(0, 10)}</td>
                          <td className={tx.type === 'buy' ? styles.buy : styles.sell}>
                            {tx.type === 'buy' ? '买入' : '卖出'}
                            {tx.isHistoryOnly ? '（补录）' : ''}
                          </td>
                          <td>{Number.isFinite(Number(tx.share)) ? Number(tx.share).toFixed(2) : '--'}</td>
                          <td>{Number(tx.price) > 0 ? Number(tx.price).toFixed(4) : '--'}</td>
                          <td>{formatMoney(Number(tx.amount))}</td>
                          <td>{tx.groupId ? '分组' : '全局'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className={styles.emptyCell}>
                          首页暂无这只基金的交易记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Tabs>
      </section>

      <p className={styles.advisorFootnote}>
        数据：{sourceText}。估值只作预警，{bandMode ? '不算入均线' : '不更新最高值或成交基准'}
        。本页只提供参考，不自动交易，不构成投资建议。
      </p>
    </div>
  );
}
