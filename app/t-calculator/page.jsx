'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isArray, isObject } from 'lodash';
import {
  calculateEntryRows,
  calculateExitRows,
  calculateRiskSignals,
  DEFAULT_ENTRIES,
  DEFAULT_EXITS,
  DEFAULT_RISK_RULES,
  summarizeAccountPosition,
  summarizeEntryPosition
} from './calculator.mjs';
import {
  fetchEastmoneySectorQuotesBatch,
  fetchFundNetValueRange,
  fetchNavMetricsFromTrendFallback,
  fetchSmartFundNetValueBackward
} from '../api/fund';
import { storageStore } from '../stores/storageStore';
import styles from './calculator.module.css';

const DEFAULT_FORM = {
  baseNav: '3.2743',
  holdingValue: '',
  profitRate: '',
  holdingDays: '30'
};
const PAGE_SIZE_OPTIONS = [5, 10];
const PENDING_FLOW_KEY = 'fundTradingCalculatorPendingFlows';
const RISK_SETTINGS_KEY = 'fundTradingCalculatorRiskSettings';
const BENCHMARK_INDEX = { secid: '2.930713', name: '中证人工智能主题指数', weight: 80 };
const RISK_FIELDS = [
  ['fundDownWatch', '基金跌幅观察'],
  ['fundDownEntry', '基金跌幅补仓'],
  ['fundDownStop', '基金跌幅暂停补仓'],
  ['fundUpWatch', '基金涨幅观察'],
  ['fundUpExit', '基金涨幅出仓'],
  ['fundUpStrong', '基金涨幅强提醒'],
  ['drawdownWarn', '最大回撤提醒'],
  ['drawdownStop', '最大回撤暂停补仓']
];

const asText = (value) => (value === null || value === undefined ? '' : String(value));
const numericValue = (value) => Number(value);
const isValidNonNegative = (value) =>
  value !== '' &&
  value !== null &&
  value !== undefined &&
  Number.isFinite(numericValue(value)) &&
  numericValue(value) >= 0;
const formatMoney = (value) =>
  Number.isFinite(value)
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';
const formatInputAmount = (value) => (Number.isFinite(value) ? value.toFixed(2) : '');
const formatNav = (value) => (Number.isFinite(value) && value > 0 ? value.toFixed(4) : '--');
const formatNumber = (value) =>
  Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '--';
const formatPercent = (value, digits = 2) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%` : '--';
const formatPointPercent = (value, digits = 2) =>
  hasNumericValue(value) ? `${numericValue(value) >= 0 ? '+' : ''}${numericValue(value).toFixed(digits)}%` : '--';
const absolutePercent = (value) => (Number.isFinite(numericValue(value)) ? Math.abs(numericValue(value)) : '');
const hasNumericValue = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isFinite(numericValue(value));
const entryMoveLabel = (change) =>
  `${change >= 0 ? '上涨' : '下跌'} ${absolutePercent(change).toFixed(2)}% ${change >= 0 ? '加仓' : '补仓'}`;
const exitMoveLabel = (change, index) =>
  `${change >= 0 ? (index === 0 ? '上涨' : '再涨') : index === 0 ? '下跌' : '再跌'} ${absolutePercent(change).toFixed(2)}%`;
const entryLabel = (entry, row) => {
  if (entry.manual && hasNumericValue(row?.change) && !row?.pendingNav) return entryMoveLabel(row.change);
  if (entry.manual || entry.confirmation) return entry.label;
  return entryMoveLabel(hasNumericValue(row?.change) && !row?.pendingNav ? row.change : numericValue(entry.change));
};
const exitLabel = (exit, index, row) => {
  if (exit.manual && hasNumericValue(row?.rebound) && !row?.pendingNav) return exitMoveLabel(row.rebound, index);
  if (exit.manual) return exit.label;
  return exitMoveLabel(
    hasNumericValue(row?.rebound) && !row?.pendingNav ? row.rebound : numericValue(exit.rebound),
    index
  );
};
const dailyChangeLabel = (row) => {
  if (row?.pendingDailyChange) return '待更新';
  return hasNumericValue(row?.dailyChange) ? formatPointPercent(row.dailyChange) : '--';
};
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateBefore = (value, days = 7) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const localDateTimeValue = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const flowDate = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : '');
const hasDateNav = (navByDate, date) => Boolean(date && Object.prototype.hasOwnProperty.call(navByDate, date));
const tomorrowKey = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const cloneDefaults = () => ({
  form: { ...DEFAULT_FORM },
  entries: DEFAULT_ENTRIES.map((entry) => ({ ...entry })),
  exits: DEFAULT_EXITS.map((exit) => ({ ...exit }))
});

function Field({ id, label, value, onChange, min = '0', max, step = '0.01', suffix, hint, error, placeholder }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint ${id}-error`}
          aria-invalid={Boolean(error)}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      <small id={`${id}-hint`}>{hint}</small>
      {error && (
        <small id={`${id}-error`} className={styles.error}>
          {error}
        </small>
      )}
    </div>
  );
}

function Metric({ label, value, note, tone = '' }) {
  return (
    <div className={`${styles.metric} ${tone ? styles[tone] : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function FlowDateField({ label, value, onChange }) {
  return (
    <label className={styles.flowDateField}>
      <span className={styles.srOnly}>{label}发生时间</span>
      <input
        aria-label={`${label}发生时间`}
        type="datetime-local"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SectionTitle({ id, eyebrow, title, detail, action }) {
  return (
    <div className={styles.sectionTitle}>
      <div className={styles.sectionTitleContent}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <h2 id={id}>{title}</h2>
        {detail && <p>· {detail}</p>}
      </div>
      {action && <div className={styles.sectionTitleAction}>{action}</div>}
    </div>
  );
}

function Pagination({ label, page, pageCount, pageSize, total, onPageChange, onPageSizeChange }) {
  if (total === 0) return null;
  return (
    <div className={styles.pagination} aria-label={`${label}分页`}>
      <label>
        每页
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}条
            </option>
          ))}
        </select>
      </label>
      <span>
        第 {page} / {pageCount} 页，共 {total} 条
      </span>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}

export default function TradingCalculatorPage() {
  const defaults = useMemo(() => cloneDefaults(), []);
  const [form, setForm] = useState(defaults.form);
  const [entries, setEntries] = useState(defaults.entries);
  const [exits, setExits] = useState(defaults.exits);
  const [isEditingSnapshot, setIsEditingSnapshot] = useState(false);
  const [pendingFlows, setPendingFlows] = useState({ entries: [], exits: [] });
  const [flowType, setFlowType] = useState(null);
  const [flowDraft, setFlowDraft] = useState({ amount: '', recordedAt: '' });
  const [flowError, setFlowError] = useState('');
  const [entryPage, setEntryPage] = useState(1);
  const [exitPage, setExitPage] = useState(1);
  const [entryPageSize, setEntryPageSize] = useState(5);
  const [exitPageSize, setExitPageSize] = useState(5);
  const [navByDate, setNavByDate] = useState({});
  const [dailyChangeByDate, setDailyChangeByDate] = useState({});
  const [fundQuote, setFundQuote] = useState({ nav: null, dailyChangePct: null, date: '', status: 'loading' });
  const [benchmarkQuote, setBenchmarkQuote] = useState({ pct: null, status: 'loading' });
  const [riskRules, setRiskRules] = useState(DEFAULT_RISK_RULES);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const flowsHydrated = useRef(false);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateEntry = (id, key, value) =>
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));
  const updateExit = (id, key, value) =>
    setExits((current) => current.map((exit) => (exit.id === id ? { ...exit, [key]: value } : exit)));
  const updateEntryAmount = (id, value) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              amount: value,
              recordedAt: value === '' && !entry.manual ? '' : entry.recordedAt || localDateTimeValue()
            }
          : entry
      )
    );
  const updateExitAmount = (id, value) =>
    setExits((current) =>
      current.map((exit) =>
        exit.id === id
          ? {
              ...exit,
              amount: value,
              sellShares: '',
              sellRatio: '',
              recordedAt: value === '' && !exit.manual ? '' : exit.recordedAt || localDateTimeValue()
            }
          : exit
      )
    );
  const reset = () => {
    setForm(defaults.form);
    setEntries(defaults.entries.map((entry) => ({ ...entry })));
    setExits(defaults.exits.map((exit) => ({ ...exit })));
    setIsEditingSnapshot(false);
    setPendingFlows({ entries: [], exits: [] });
    setRiskRules(DEFAULT_RISK_RULES);
    setFlowMenuOpen(false);
  };

  useEffect(() => {
    if (flowsHydrated.current) return;
    flowsHydrated.current = true;
    const saved = storageStore.getItem(PENDING_FLOW_KEY, { entries: [], exits: [] });
    const savedEntries = isArray(saved?.entries) ? saved.entries : [];
    const savedExits = isArray(saved?.exits) ? saved.exits : [];
    const today = todayKey();
    const dueEntries = savedEntries.filter((flow) => flow?.availableOn && flow.availableOn <= today);
    const dueExits = savedExits.filter((flow) => flow?.availableOn && flow.availableOn <= today);
    setEntries((current) => [...current, ...dueEntries]);
    setExits((current) => [...current, ...dueExits]);
    setPendingFlows({
      entries: savedEntries.filter((flow) => !dueEntries.includes(flow)),
      exits: savedExits.filter((flow) => !dueExits.includes(flow))
    });
  }, [defaults]);

  useEffect(() => {
    if (flowsHydrated.current) storageStore.setItem(PENDING_FLOW_KEY, JSON.stringify(pendingFlows));
  }, [pendingFlows]);

  useEffect(() => {
    const saved = storageStore.getItem(RISK_SETTINGS_KEY, DEFAULT_RISK_RULES);
    if (isObject(saved)) setRiskRules((current) => ({ ...current, ...saved }));
  }, []);
  useEffect(() => {
    storageStore.setItem(RISK_SETTINGS_KEY, JSON.stringify(riskRules));
  }, [riskRules]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchNavMetricsFromTrendFallback('017811'),
      fetchEastmoneySectorQuotesBatch([BENCHMARK_INDEX.secid])
    ]).then(([fundResult, benchmarkResult]) => {
      if (cancelled) return;
      const metrics = fundResult.status === 'fulfilled' ? fundResult.value : null;
      const today = todayKey();
      const nav = hasNumericValue(metrics?.dwjz) ? numericValue(metrics.dwjz) : null;
      const isToday = metrics?.jzrq === today;
      setFundQuote({
        nav: nav > 0 ? nav : null,
        dailyChangePct: isToday && hasNumericValue(metrics?.zzl) ? numericValue(metrics.zzl) : null,
        date: metrics?.jzrq || '',
        status: fundResult.status === 'fulfilled' && nav > 0 ? (isToday ? 'updated' : 'pending') : 'error'
      });
      const quote = benchmarkResult.status === 'fulfilled' ? benchmarkResult.value?.[BENCHMARK_INDEX.secid] : null;
      setBenchmarkQuote({
        pct: hasNumericValue(quote?.pct) ? numericValue(quote.pct) : null,
        status: quote ? 'updated' : 'error'
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flowDateKey = useMemo(
    () =>
      [...entries, ...exits, ...pendingFlows.entries, ...pendingFlows.exits]
        .map((flow) => flowDate(flow.recordedAt))
        .filter(Boolean)
        .filter((date, index, dates) => dates.indexOf(date) === index)
        .join(','),
    [entries, exits, pendingFlows.entries, pendingFlows.exits]
  );
  useEffect(() => {
    const dates = flowDateKey ? flowDateKey.split(',') : [];
    const missing = dates.filter((date) => !hasDateNav(navByDate, date));
    const dailyMissing = dates.filter((date) => !hasDateNav(dailyChangeByDate, date));
    if (!missing.length && !dailyMissing.length) return undefined;
    let cancelled = false;
    const navPromise = Promise.all(
      missing.map(async (date) => {
        try {
          const result = await fetchSmartFundNetValueBackward('017811', date);
          return [date, result?.value > 0 && (date !== todayKey() || result.date === date) ? result.value : null];
        } catch {
          return [date, null];
        }
      })
    );
    const dailyPromise = dailyMissing.length
      ? fetchFundNetValueRange('017811', dateBefore(dailyMissing.slice().sort()[0]), todayKey())
      : Promise.resolve([]);
    Promise.all([navPromise, dailyPromise]).then(([results, dailyRows]) => {
      if (cancelled) return;
      if (results.length) setNavByDate((current) => ({ ...current, ...Object.fromEntries(results) }));
      if (dailyMissing.length) {
        const dailyResults = Object.fromEntries(
          dailyMissing.map((date) => {
            const resolved = dailyRows.filter((row) => row?.date <= date).at(-1);
            return [date, date === todayKey() && resolved?.date !== date ? null : (resolved?.growth ?? null)];
          })
        );
        setDailyChangeByDate((current) => ({ ...current, ...dailyResults }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flowDateKey, navByDate, dailyChangeByDate]);

  const plannedCapital = useMemo(
    () =>
      entries.reduce((sum, entry) => {
        const amount = numericValue(entry.amount);
        const date = flowDate(entry.recordedAt);
        const ready =
          !entry.manual || numericValue(entry.nav) > 0 || (date && hasDateNav(navByDate, date) && navByDate[date] > 0);
        return sum + (ready && Number.isFinite(amount) ? Math.max(0, amount) : 0);
      }, 0),
    [entries, navByDate]
  );
  const errors = {
    holdingValue: form.holdingValue === '' || isValidNonNegative(form.holdingValue) ? '' : '持仓市值不能为负数',
    profitRate:
      form.profitRate === '' ||
      (Number.isFinite(numericValue(form.profitRate)) &&
        numericValue(form.profitRate) >= -100 &&
        numericValue(form.profitRate) <= 100)
        ? ''
        : '盈利率需在 -100% 至 100% 之间',
    holdingDays:
      Number.isFinite(numericValue(form.holdingDays)) && numericValue(form.holdingDays) >= 0 ? '' : '持有时间不能为负数'
  };
  const entryRows = useMemo(
    () =>
      calculateEntryRows({
        capital: plannedCapital,
        baseNav: numericValue(form.baseNav),
        entries,
        navByDate,
        dailyChangeByDate
      }),
    [plannedCapital, form.baseNav, entries, navByDate, dailyChangeByDate]
  );
  const latestEntry = entryRows.at(-1);
  const position = useMemo(
    () =>
      summarizeEntryPosition({
        rows: entryRows,
        scenarioNav: numericValue(form.baseNav)
      }),
    [entryRows, form.baseNav]
  );
  const toggleSnapshotEdit = () => {
    if (!isEditingSnapshot && form.holdingValue === '')
      updateForm('holdingValue', formatInputAmount(position.holdingValue));
    setIsEditingSnapshot((current) => !current);
  };
  const exitRows = useMemo(
    () =>
      calculateExitRows({
        targetCapital: plannedCapital,
        baseNav: numericValue(form.baseNav),
        initialShares: position.shares,
        initialCash: position.cash,
        exits,
        navByDate,
        dailyChangeByDate
      }),
    [plannedCapital, form.baseNav, position.shares, position.cash, exits, navByDate, dailyChangeByDate]
  );
  const lastExit = exitRows.at(-1);
  const currentNav = fundQuote.nav > 0 ? fundQuote.nav : numericValue(form.baseNav);
  const accountSummary = useMemo(
    () => summarizeAccountPosition({ entryRows, exitRows, currentNav }),
    [entryRows, exitRows, currentNav]
  );
  const hasManualHoldingValue = isValidNonNegative(form.holdingValue);
  const currentHoldingValue = hasManualHoldingValue ? numericValue(form.holdingValue) : accountSummary.holdingValue;
  const calculatedProfitRate = accountSummary.profitRate;
  const hasManualProfitRate =
    form.profitRate !== '' &&
    Number.isFinite(numericValue(form.profitRate)) &&
    numericValue(form.profitRate) >= -100 &&
    numericValue(form.profitRate) <= 100;
  const profitRate = hasManualProfitRate ? numericValue(form.profitRate) / 100 : calculatedProfitRate;
  const profitRateInput = form.profitRate === '' ? '' : asText(form.profitRate);
  const profitTone = Number.isFinite(profitRate) ? (profitRate >= 0 ? 'positive' : 'negative') : '';
  const riskSignals = useMemo(
    () =>
      calculateRiskSignals({
        fundDailyChange: fundQuote.dailyChangePct,
        benchmarkChange: hasNumericValue(benchmarkQuote.pct) ? numericValue(benchmarkQuote.pct) * 100 : null,
        maxDrawdown: accountSummary.maxDrawdown,
        rules: riskRules
      }),
    [fundQuote.dailyChangePct, benchmarkQuote.pct, accountSummary.maxDrawdown, riskRules]
  );
  const entryItems = useMemo(
    () => [
      ...entries.map((entry, index) => ({ entry, row: entryRows[index], pending: false })),
      ...pendingFlows.entries.map((entry) => ({ entry, row: null, pending: true }))
    ],
    [entries, entryRows, pendingFlows.entries]
  );
  const exitItems = useMemo(
    () => [
      ...exits.map((exit, index) => ({ exit, row: exitRows[index], pending: false })),
      ...pendingFlows.exits.map((exit) => ({ exit, row: null, pending: true }))
    ],
    [exits, exitRows, pendingFlows.exits]
  );
  const entryPageCount = Math.max(1, Math.ceil(entryItems.length / entryPageSize));
  const exitPageCount = Math.max(1, Math.ceil(exitItems.length / exitPageSize));
  const safeEntryPage = Math.min(entryPage, entryPageCount);
  const safeExitPage = Math.min(exitPage, exitPageCount);
  const visibleEntryItems = entryItems.slice((safeEntryPage - 1) * entryPageSize, safeEntryPage * entryPageSize);
  const visibleExitItems = exitItems.slice((safeExitPage - 1) * exitPageSize, safeExitPage * exitPageSize);
  const holdingActive = currentHoldingValue > 0 && (lastExit?.remainingShares ?? latestEntry?.shares ?? 0) > 0;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!holdingActive) return;
      setForm((current) => {
        const days = numericValue(current.holdingDays);
        return Number.isFinite(days) && days >= 0 ? { ...current, holdingDays: String(Math.floor(days) + 1) } : current;
      });
    }, 86400000);
    return () => window.clearInterval(timer);
  }, [holdingActive]);
  const updatePendingFlow = (type, id, key, value) =>
    setPendingFlows((current) => ({
      ...current,
      [type]: current[type].map((flow) => (flow.id === id ? { ...flow, [key]: value } : flow))
    }));
  const updateFlowDate = (type, id, value, pending = false) => {
    if (pending) return updatePendingFlow(type, id, 'recordedAt', value);
    return type === 'entry' ? updateEntry(id, 'recordedAt', value) : updateExit(id, 'recordedAt', value);
  };
  const openFlowDialog = (type) => {
    setFlowType(type);
    setFlowDraft({ amount: '', recordedAt: localDateTimeValue() });
    setFlowError('');
  };
  const openFlowFromMenu = (type) => {
    setFlowMenuOpen(false);
    openFlowDialog(type);
  };
  const closeFlowDialog = () => {
    setFlowType(null);
    setFlowError('');
  };
  const submitFlow = (event) => {
    event.preventDefault();
    const value = numericValue(flowDraft.amount);
    if (!(value > 0)) {
      setFlowError(flowType === 'entry' ? '买入金额必须大于 0' : '出仓金额必须大于 0');
      return;
    }
    const record = {
      id: `manual-${flowType}-${Date.now()}`,
      label: flowType === 'entry' ? '新增入仓' : '新增出仓',
      manual: true,
      availableOn: tomorrowKey(),
      recordedAt: flowDraft.recordedAt || localDateTimeValue(),
      ...(flowType === 'entry'
        ? { amount: String(value), change: null, confirmation: true }
        : { amount: String(value) })
    };
    setPendingFlows((current) => ({
      ...current,
      [flowType === 'entry' ? 'entries' : 'exits']: [...current[flowType === 'entry' ? 'entries' : 'exits'], record]
    }));
    closeFlowDialog();
  };
  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}>
            <span className={styles.liveDot} />
            LIVE <span>/</span> 017811
          </div>
          <h1>东方人工智能主题混合 C</h1>
          <p>分批入仓 · 回撤补仓 · 确认加仓 · 反弹出仓</p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.flowMenu}>
            <button
              type="button"
              className={styles.addButton}
              aria-expanded={flowMenuOpen}
              aria-controls="flow-actions"
              aria-label="新增入金或出金"
              onClick={() => setFlowMenuOpen((open) => !open)}
            >
              +
            </button>
            {flowMenuOpen && (
              <div id="flow-actions" className={styles.flowActions} role="menu">
                <button type="button" role="menuitem" onClick={() => openFlowFromMenu('entry')}>
                  入金
                </button>
                <button type="button" role="menuitem" onClick={() => openFlowFromMenu('exit')}>
                  出金
                </button>
              </div>
            )}
          </div>
          <button type="button" className={styles.textButton} onClick={reset}>
            恢复默认
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={`${styles.panel} ${styles.snapshotPanel}`} aria-labelledby="results-title">
          <div>
            <SectionTitle
              id="results-title"
              title="账户快照"
              detail="单只基金持仓结果。"
              action={
                <button
                  type="button"
                  className={styles.editButton}
                  aria-pressed={isEditingSnapshot}
                  onClick={toggleSnapshotEdit}
                >
                  {isEditingSnapshot ? '完成' : '编辑'}
                </button>
              }
            />
            <div className={styles.metricsGrid}>
              {isEditingSnapshot ? (
                <div className={`${styles.metric} ${styles.metricField}`}>
                  <Field
                    id="holdingValue"
                    label="持仓市值"
                    value={form.holdingValue}
                    onChange={(value) => updateForm('holdingValue', value)}
                    step="0.01"
                    suffix="元"
                    hint="只修改看板显示，不参与流水计算。"
                    error={errors.holdingValue}
                  />
                </div>
              ) : (
                <Metric label="持仓市值" value={formatMoney(currentHoldingValue)} note="当前持仓市值" />
              )}
              {isEditingSnapshot ? (
                <div className={`${styles.metric} ${styles.metricField} ${profitTone ? styles[profitTone] : ''}`}>
                  <Field
                    id="profitRate"
                    label="盈利率"
                    value={profitRateInput}
                    onChange={(value) => updateForm('profitRate', value)}
                    min="-100"
                    max="100"
                    step="0.01"
                    suffix="%"
                    hint="只修改看板显示，不参与流水计算。"
                    error={errors.profitRate}
                    placeholder="自动计算"
                  />
                </div>
              ) : (
                <Metric label="盈利率" value={formatPercent(profitRate)} tone={profitTone} note="当前账户盈利率" />
              )}
              <Metric label="持仓份额" value={formatNumber(latestEntry?.shares || 0)} note="当前持仓份额" />
              <Metric label="平均成本" value={formatNav(position.averageCost)} note="累计投入 ÷ 累计份额" />
              <Metric
                label="回本净值"
                value={formatNav(position.breakEvenNav)}
                tone="accent"
                note={`当前还需 ${formatPercent(position.requiredRise)}`}
              />
              {isEditingSnapshot ? (
                <div className={`${styles.metric} ${styles.metricField}`}>
                  <Field
                    id="holdingDays"
                    label="持有时间"
                    value={form.holdingDays}
                    onChange={(value) => updateForm('holdingDays', value)}
                    step="1"
                    suffix="天"
                    hint="只修改看板显示。"
                    error={errors.holdingDays}
                  />
                </div>
              ) : (
                <Metric label="持有时间" value={`${form.holdingDays} 天`} note="未清仓时每天自动增加 1 天" />
              )}
            </div>
            <div className={styles.riskStrip} role="status" aria-live="polite">
              {riskSignals.length ? (
                riskSignals.map((signal) => (
                  <div key={signal.id} className={`${styles.riskItem} ${styles[`risk${signal.level}`]}`}>
                    <strong>{signal.action}</strong>
                    <span>
                      {signal.source}：{signal.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className={`${styles.riskItem} ${styles.riskSafe}`}>
                  <strong>暂无风控触发</strong>
                  <span>基金和账户数据未达到已设置的提醒线</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.marketPanel}`} aria-labelledby="market-title">
        <SectionTitle id="market-title" title="今日行情" detail="基金净值更新后，流水中的待更新节点会自动补全。" />
        <div className={styles.marketGrid}>
          <Metric
            label="基金净值"
            value={formatNav(fundQuote.nav)}
            note={
              fundQuote.date ? `净值日期 ${fundQuote.date}` : fundQuote.status === 'loading' ? '正在获取' : '暂无数据'
            }
          />
          <Metric
            label="基金日涨跌幅"
            value={formatPointPercent(fundQuote.dailyChangePct)}
            tone={
              hasNumericValue(fundQuote.dailyChangePct) ? (fundQuote.dailyChangePct >= 0 ? 'positive' : 'negative') : ''
            }
            note={fundQuote.status === 'pending' ? '今日净值尚未更新' : '以基金净值为准'}
          />
          <Metric
            label="业绩基准指数参考"
            value={formatPointPercent(
              hasNumericValue(benchmarkQuote.pct) ? numericValue(benchmarkQuote.pct) * 100 : null
            )}
            tone={hasNumericValue(benchmarkQuote.pct) ? (benchmarkQuote.pct >= 0 ? 'positive' : 'negative') : ''}
            note={`${BENCHMARK_INDEX.name} · 参考权重 ${BENCHMARK_INDEX.weight}%`}
          />
          <Metric
            label="行情状态"
            value={
              fundQuote.status === 'updated'
                ? '已更新'
                : fundQuote.status === 'pending'
                  ? '待更新'
                  : fundQuote.status === 'loading'
                    ? '获取中'
                    : '暂不可用'
            }
            tone={fundQuote.status === 'updated' ? 'positive' : 'accent'}
            note="指数仅作预警参考"
          />
        </div>
        <details className={styles.riskSettings}>
          <summary>风控设置</summary>
          <div className={styles.riskSettingsGrid}>
            {RISK_FIELDS.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <span className={styles.riskInputWrap}>
                  <input
                    type="number"
                    step="0.1"
                    value={riskRules[key]}
                    onChange={(event) =>
                      setRiskRules((current) => ({
                        ...current,
                        [key]: event.target.value === '' ? '' : numericValue(event.target.value)
                      }))
                    }
                  />
                  <em>%</em>
                </span>
              </label>
            ))}
          </div>
        </details>
      </section>

      <section className={`${styles.panel} ${styles.flowPanel}`} aria-labelledby="entry-title">
        <SectionTitle
          id="entry-title"
          title="入仓流水"
          detail="按添加时间取得净值；输入入仓金额后自动计算幅度、份额与后续资产。"
        />
        <div id="entry-table-hint" className={styles.srOnly}>
          可编辑添加时间和买入金额，日期净值更新后自动计算幅度、份额与后续流水。
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.entryTable}>
            <caption className={styles.srOnly}>入仓后资金流水</caption>
            <colgroup>
              <col className={styles.entryNodeColumn} />
              <col className={styles.entryPercentColumn} />
              <col className={styles.entryAmountColumn} />
              <col className={styles.entryValueColumn} />
              <col className={styles.entryValueColumn} />
              <col className={styles.entryValueColumn} />
              <col className={styles.entryValueColumn} />
              <col className={styles.entryNavColumn} />
              <col className={styles.entryReturnColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>时间 / 节点</th>
                <th>日涨跌幅</th>
                <th>金额</th>
                <th>累计</th>
                <th>份额</th>
                <th>持仓市值</th>
                <th>总资产</th>
                <th>净值</th>
                <th>收益率</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntryItems.map(({ entry, row, pending }, visibleIndex) => {
                const index = (safeEntryPage - 1) * entryPageSize + visibleIndex;
                const label = entryLabel(entry, row);
                if (pending || row?.pendingNav) {
                  const pendingStatus = pending ? '待次日计算' : '等待净值';
                  return (
                    <tr key={entry.id} className={styles.pendingRow}>
                      <th scope="row">
                        <FlowDateField
                          label={label}
                          value={entry.recordedAt}
                          onChange={(value) => updateFlowDate('entry', entry.id, value, pending)}
                        />
                        <span className={styles.nodeIndex}>{String(index + 1).padStart(2, '0')}</span>
                        {label}
                        <span className={styles.pendingBadge}>{pendingStatus}</span>
                      </th>
                      <td>
                        <span className={styles.pendingBadge}>自动更新</span>
                      </td>
                      <td>
                        <label className={`${styles.tableInput} ${styles.inInput}`}>
                          <span className={styles.sign}>+</span>
                          <input
                            aria-label={`${label}买入金额`}
                            type="number"
                            value={asText(entry.amount)}
                            min="0"
                            step="0.01"
                            onChange={(event) =>
                              pending
                                ? updatePendingFlow('entries', entry.id, 'amount', event.target.value)
                                : updateEntryAmount(entry.id, event.target.value)
                            }
                          />
                        </label>
                      </td>
                      <td colSpan="4">—</td>
                      <td>
                        <span className={styles.pendingBadge}>等待日期净值</span>
                      </td>
                      <td>待计算</td>
                    </tr>
                  );
                }
                return (
                  <tr key={entry.id}>
                    <th scope="row">
                      <FlowDateField
                        label={label}
                        value={entry.recordedAt}
                        onChange={(value) => updateFlowDate('entry', entry.id, value)}
                      />
                      <span className={styles.nodeIndex}>{String(index + 1).padStart(2, '0')}</span>
                      {label}
                    </th>
                    <td>
                      {entry.recordedAt ? (
                        <span
                          className={
                            row.pendingNav || row.pendingDailyChange
                              ? styles.pendingBadge
                              : row.dailyChange >= 0
                                ? styles.up
                                : styles.down
                          }
                        >
                          {row.pendingNav ? '等待日期净值' : dailyChangeLabel(row)}
                        </span>
                      ) : entry.manual ? (
                        <span className={styles.confirmBadge}>{formatPercent(numericValue(row.change) / 100)}</span>
                      ) : entry.confirmation ? (
                        <span className={styles.confirmBadge}>确认</span>
                      ) : (
                        <label className={styles.tableInput}>
                          <input
                            aria-label={`${label}触发幅度`}
                            aria-describedby="entry-table-hint"
                            type="number"
                            value={asText(absolutePercent(entry.change))}
                            min="0"
                            max="100"
                            step="0.01"
                            onChange={(event) =>
                              updateEntry(entry.id, 'change', event.target.value === '' ? '' : `-${event.target.value}`)
                            }
                          />
                          <span>%</span>
                        </label>
                      )}
                    </td>
                    <td>
                      <label className={`${styles.tableInput} ${styles.inInput}`}>
                        <span className={styles.sign}>+</span>
                        <input
                          aria-label={`${label}买入金额`}
                          aria-describedby="entry-table-hint"
                          type="number"
                          value={asText(entry.amount)}
                          min="0"
                          step="0.01"
                          onChange={(event) => updateEntryAmount(entry.id, event.target.value)}
                        />
                      </label>
                    </td>
                    <td>{formatMoney(row.cumulativeInvested)}</td>
                    <td>{formatNumber(row.buyShares)}</td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td className={row.totalAssets < plannedCapital ? styles.down : styles.up}>
                      {formatMoney(row.totalAssets)}
                    </td>
                    <td>{formatNav(row.nav)}</td>
                    <td className={row.returnRate >= 0 ? styles.up : styles.down}>{formatPercent(row.returnRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          label="入仓流水"
          page={safeEntryPage}
          pageCount={entryPageCount}
          pageSize={entryPageSize}
          total={entryItems.length}
          onPageChange={setEntryPage}
          onPageSizeChange={(size) => {
            setEntryPageSize(size);
            setEntryPage(1);
          }}
        />
      </section>

      <section className={`${styles.panel} ${styles.flowPanel}`} aria-labelledby="exit-title">
        <SectionTitle
          id="exit-title"
          title="出仓流水"
          detail="按添加时间取得净值；输入出仓金额后自动计算幅度、份额与后续资产。"
        />
        <div id="exit-table-hint" className={styles.srOnly}>
          可编辑添加时间和出仓金额，日期净值更新后自动计算幅度、份额与后续资金。
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.exitTable}>
            <caption className={styles.srOnly}>出仓后资金流水</caption>
            <colgroup>
              <col className={styles.exitNodeColumn} />
              <col className={styles.exitPercentColumn} />
              <col className={styles.exitAmountColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitNavColumn} />
              <col className={styles.exitReturnColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>时间 / 节点</th>
                <th>日涨跌幅</th>
                <th>出仓金额</th>
                <th>累计</th>
                <th>份额</th>
                <th>持仓市值</th>
                <th>总资产</th>
                <th>净值</th>
                <th>收益率</th>
              </tr>
            </thead>
            <tbody>
              {visibleExitItems.map(({ exit, row, pending }, visibleIndex) => {
                const index = (safeExitPage - 1) * exitPageSize + visibleIndex;
                const label = exitLabel(exit, index, row);
                if (pending || row?.pendingNav) {
                  const pendingStatus = pending ? '待次日计算' : '等待净值';
                  return (
                    <tr key={exit.id} className={styles.pendingRow}>
                      <th scope="row">
                        <FlowDateField
                          label={label}
                          value={exit.recordedAt}
                          onChange={(value) => updateFlowDate('exit', exit.id, value, pending)}
                        />
                        <span className={styles.nodeIndex}>{String(index + 1).padStart(2, '0')}</span>
                        {label}
                        <span className={styles.pendingBadge}>{pendingStatus}</span>
                      </th>
                      <td>
                        <span className={styles.pendingBadge}>自动更新</span>
                      </td>
                      <td>
                        <label className={`${styles.tableInput} ${styles.outAmount}`}>
                          <span className={styles.outSign}>−</span>
                          <input
                            aria-label={`${label}出仓金额`}
                            type="number"
                            value={asText(exit.amount)}
                            min="0"
                            step="0.01"
                            onChange={(event) =>
                              pending
                                ? updatePendingFlow('exits', exit.id, 'amount', event.target.value)
                                : updateExitAmount(exit.id, event.target.value)
                            }
                          />
                        </label>
                      </td>
                      <td colSpan="4">—</td>
                      <td>
                        <span className={styles.pendingBadge}>等待日期净值</span>
                      </td>
                      <td>待计算</td>
                    </tr>
                  );
                }
                return (
                  <tr key={exit.id}>
                    <th scope="row">
                      <FlowDateField
                        label={label}
                        value={exit.recordedAt}
                        onChange={(value) => updateFlowDate('exit', exit.id, value)}
                      />
                      <span className={styles.nodeIndex}>{String(index + 1).padStart(2, '0')}</span>
                      {label}
                    </th>
                    <td>
                      {exit.recordedAt || exit.manual ? (
                        <span
                          className={
                            row.pendingDailyChange
                              ? styles.pendingBadge
                              : row.dailyChange >= 0
                                ? styles.up
                                : styles.down
                          }
                        >
                          {exit.recordedAt ? dailyChangeLabel(row) : formatPercent(numericValue(row.rebound) / 100)}
                        </span>
                      ) : (
                        <label className={styles.tableInput}>
                          <input
                            aria-label={`${label}上涨幅度`}
                            aria-describedby="exit-table-hint"
                            type="number"
                            value={asText(absolutePercent(exit.rebound))}
                            min="0"
                            max="100"
                            step="0.01"
                            onChange={(event) => updateExit(exit.id, 'rebound', event.target.value)}
                          />
                          <span>%</span>
                        </label>
                      )}
                    </td>
                    <td>
                      <label className={`${styles.tableInput} ${styles.outAmount}`}>
                        <span className={styles.outSign}>−</span>
                        <input
                          aria-label={`${label}出仓金额`}
                          type="number"
                          value={asText(exit.amount)}
                          min="0"
                          step="0.01"
                          onChange={(event) => updateExitAmount(exit.id, event.target.value)}
                        />
                      </label>
                    </td>
                    <td>{formatMoney(row.cumulativeAmount)}</td>
                    <td>{formatNumber(row.soldShares)}</td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td>{formatMoney(row.totalAssets)}</td>
                    <td>{formatNav(row.triggerNav)}</td>
                    <td className={row.totalReturn >= 0 ? styles.up : styles.down}>{formatPercent(row.totalReturn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          label="出仓流水"
          page={safeExitPage}
          pageCount={exitPageCount}
          pageSize={exitPageSize}
          total={exitItems.length}
          onPageChange={setExitPage}
          onPageSizeChange={(size) => {
            setExitPageSize(size);
            setExitPage(1);
          }}
        />
      </section>

      {flowType && (
        <dialog
          open
          className={styles.flowDialog}
          aria-modal="true"
          aria-labelledby="flow-dialog-title"
          onCancel={closeFlowDialog}
          onClick={(event) => event.target === event.currentTarget && closeFlowDialog()}
        >
          <form className={styles.flowDialogCard} onSubmit={submitFlow}>
            <div className={styles.flowDialogHeader}>
              <div>
                <span className={styles.eyebrow}>PENDING RECORD</span>
                <h2 id="flow-dialog-title">新增{flowType === 'entry' ? '入仓' : '出仓'}记录</h2>
              </div>
              <button type="button" className={styles.textButton} onClick={closeFlowDialog}>
                关闭
              </button>
            </div>
            <p className={styles.flowDialogHint}>
              入仓和出仓都填写金额；发生时间默认当天，可修改，日期净值会自动更新。
            </p>
            <div className={styles.flowDialogFields}>
              <label className={styles.dialogField}>
                <span>{flowType === 'entry' ? '买入金额' : '出仓金额'}</span>
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.01"
                  value={flowDraft.amount}
                  onChange={(event) =>
                    setFlowDraft((current) => ({
                      ...current,
                      amount: event.target.value
                    }))
                  }
                />
              </label>
              <label className={styles.dialogField}>
                <span>发生时间</span>
                <input
                  type="datetime-local"
                  value={flowDraft.recordedAt}
                  onChange={(event) => setFlowDraft((current) => ({ ...current, recordedAt: event.target.value }))}
                />
              </label>
            </div>
            {flowError && <p className={styles.dialogError}>{flowError}</p>}
            <div className={styles.flowDialogActions}>
              <button type="button" className={styles.textButton} onClick={closeFlowDialog}>
                取消
              </button>
              <button type="submit" className={styles.secondaryButton}>
                暂存，次日计算
              </button>
            </div>
          </form>
        </dialog>
      )}

      <footer className={styles.footer}>
        <span>CALCULATION ONLY · 不构成投资建议</span>
        <span>C 类份额：按持有时间记录</span>
      </footer>
    </main>
  );
}
