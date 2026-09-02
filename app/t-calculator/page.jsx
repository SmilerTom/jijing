'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  calculateEntryRows,
  calculateExitRows,
  DEFAULT_ENTRIES,
  DEFAULT_EXITS,
  summarizeEntryPosition
} from './calculator.mjs';
import styles from './calculator.module.css';

const DEFAULT_FORM = {
  baseNav: '3.2743',
  holdingValue: '',
  profitRate: '',
  holdingDays: '30'
};
const PERCENT_OPTIONS = Array.from({ length: 46 }, (_, index) => index + 5);

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
const formatAmount = (value) =>
  Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
const formatInputAmount = (value) => (Number.isFinite(value) ? value.toFixed(2) : '');
const formatInputPercent = (value) => (Number.isFinite(value) ? (value * 100).toFixed(2) : '');
const formatNav = (value) => (Number.isFinite(value) && value > 0 ? value.toFixed(4) : '--');
const formatNumber = (value) =>
  Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '--';
const formatPercent = (value, digits = 2) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%` : '--';
const absolutePercent = (value) => (Number.isFinite(numericValue(value)) ? Math.abs(numericValue(value)) : '');
const entryLabel = (entry) =>
  entry.confirmation || entry.id === 'initial' ? entry.label : `下跌 ${absolutePercent(entry.change)}% 补仓`;
const exitLabel = (exit, index) => `${index === 0 ? '上涨' : '再涨'} ${absolutePercent(exit.rebound)}%`;
const cloneDefaults = () => ({
  form: { ...DEFAULT_FORM },
  entries: DEFAULT_ENTRIES.map((entry) => ({ ...entry })),
  exits: DEFAULT_EXITS.map((exit) => ({ ...exit }))
});

function Field({ id, label, value, onChange, min = '0', max, step = '0.01', suffix, hint, error }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
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

export default function TradingCalculatorPage() {
  const defaults = useMemo(() => cloneDefaults(), []);
  const [form, setForm] = useState(defaults.form);
  const [entries, setEntries] = useState(defaults.entries);
  const [exits, setExits] = useState(defaults.exits);
  const [isEditingSnapshot, setIsEditingSnapshot] = useState(false);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateEntry = (id, key, value) =>
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));
  const updateExit = (id, key, value) =>
    setExits((current) => current.map((exit) => (exit.id === id ? { ...exit, [key]: value } : exit)));
  const reset = () => {
    setForm(defaults.form);
    setEntries(defaults.entries.map((entry) => ({ ...entry })));
    setExits(defaults.exits.map((exit) => ({ ...exit })));
    setIsEditingSnapshot(false);
  };

  const plannedCapital = useMemo(
    () =>
      entries.reduce((sum, entry) => {
        const amount = numericValue(entry.amount);
        return sum + (Number.isFinite(amount) ? Math.max(0, amount) : 0);
      }, 0),
    [entries]
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
    () => calculateEntryRows({ capital: plannedCapital, baseNav: numericValue(form.baseNav), entries }),
    [plannedCapital, form.baseNav, entries]
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
  const hasManualHoldingValue = isValidNonNegative(form.holdingValue);
  const currentHoldingValue = hasManualHoldingValue ? numericValue(form.holdingValue) : position.holdingValue;
  const calculatedProfitRate = plannedCapital > 0 ? currentHoldingValue / plannedCapital - 1 : 0;
  const hasManualProfitRate =
    form.profitRate !== '' &&
    Number.isFinite(numericValue(form.profitRate)) &&
    numericValue(form.profitRate) >= -100 &&
    numericValue(form.profitRate) <= 100;
  const profitRate = hasManualProfitRate ? numericValue(form.profitRate) / 100 : calculatedProfitRate;
  const profitRateInput = form.profitRate === '' ? formatInputPercent(calculatedProfitRate) : asText(form.profitRate);
  const exitRows = useMemo(
    () =>
      calculateExitRows({
        targetCapital: plannedCapital,
        baseNav: numericValue(form.baseNav),
        exits
      }),
    [plannedCapital, form.baseNav, exits]
  );
  const lastExit = exitRows.at(-1);
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
  const updateExitRatio = (id, value) =>
    setExits((current) =>
      current.map((exit) => (exit.id === id ? { ...exit, sellRatio: value, sellShares: '' } : exit))
    );
  const updateExitShares = (id, index, value) => {
    const beforeShares = exitRows[index]?.beforeShares || 0;
    const shareValue = value === '' ? NaN : numericValue(value);
    const boundedShareValue = Number.isFinite(shareValue) ? Math.min(beforeShares, Math.max(0, shareValue)) : NaN;
    const ratio =
      beforeShares > 0 && Number.isFinite(boundedShareValue)
        ? ((boundedShareValue / beforeShares) * 100).toFixed(2)
        : '';
    const nextShares =
      Number.isFinite(shareValue) && boundedShareValue !== shareValue ? boundedShareValue.toFixed(4) : value;
    setExits((current) =>
      current.map((exit) => (exit.id === id ? { ...exit, sellShares: nextShares, sellRatio: ratio } : exit))
    );
  };
  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}>
            <span className={styles.liveDot} />
            POSITION BOARD <span>/</span> 017811
          </div>
          <h1>东方人工智能主题混合 C</h1>
          <p>分批入仓 · 回撤补仓 · 确认加仓 · 反弹出仓</p>
        </div>
        <div className={styles.heroActions}>
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
                  onClick={() => setIsEditingSnapshot((current) => !current)}
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
                    value={hasManualHoldingValue ? form.holdingValue : formatInputAmount(position.holdingValue)}
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
                <div
                  className={`${styles.metric} ${styles.metricField} ${profitRate >= 0 ? styles.positive : styles.negative}`}
                >
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
                  />
                </div>
              ) : (
                <Metric
                  label="盈利率"
                  value={formatPercent(profitRate)}
                  tone={profitRate >= 0 ? 'positive' : 'negative'}
                  note="当前账户盈利率"
                />
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
          </div>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.flowPanel}`} aria-labelledby="entry-title">
        <SectionTitle
          id="entry-title"
          title="入仓流水"
          detail="下跌补仓与止跌确认加仓分开显示；最后一档净值可手工输入。"
        />
        <div id="entry-table-hint" className={styles.srOnly}>
          可编辑触发幅度、执行净值和买入金额，数值变化会实时更新流水。
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
                <th>节点</th>
                <th>幅度</th>
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
              {entries.map((entry, index) => {
                const row = entryRows[index] || {};
                const label = entryLabel(entry);
                return (
                  <tr key={entry.id}>
                    <th scope="row">
                      <span className={styles.nodeIndex}>0{index + 1}</span>
                      {label}
                    </th>
                    <td>
                      {entry.confirmation || entry.id === 'initial' ? (
                        <span className={styles.confirmBadge}>{entry.confirmation ? '确认' : '基准'}</span>
                      ) : (
                        <label className={styles.tableInput}>
                          <select
                            aria-label={`${label}触发幅度`}
                            aria-describedby="entry-table-hint"
                            value={asText(absolutePercent(entry.change))}
                            onChange={(event) => updateEntry(entry.id, 'change', `-${event.target.value}`)}
                          >
                            <option value="">选择</option>
                            {PERCENT_OPTIONS.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
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
                          onChange={(event) => updateEntry(entry.id, 'amount', event.target.value)}
                        />
                      </label>
                    </td>
                    <td>{formatMoney(row.cumulativeInvested)}</td>
                    <td>{formatNumber(row.buyShares)}</td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td className={row.totalAssets < plannedCapital ? styles.down : styles.up}>
                      {formatMoney(row.totalAssets)}
                    </td>
                    <td>
                      {entry.confirmation ? (
                        <label className={styles.tableInput}>
                          <input
                            aria-label={`${label}执行净值`}
                            aria-describedby="entry-table-hint"
                            type="number"
                            value={asText(entry.nav)}
                            min="0"
                            step="0.0001"
                            onChange={(event) => updateEntry(entry.id, 'nav', event.target.value)}
                          />
                        </label>
                      ) : (
                        <span>{formatNav(row.nav)}</span>
                      )}
                    </td>
                    <td className={row.returnRate >= 0 ? styles.up : styles.down}>{formatPercent(row.returnRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.flowPanel}`} aria-labelledby="exit-title">
        <SectionTitle
          id="exit-title"
          title="出仓流水"
          detail="每轮涨幅作用于上一轮净值，每轮按当前持仓份额比例执行。"
        />
        <div id="exit-table-hint" className={styles.srOnly}>
          可编辑上涨幅度、卖出比例或卖出份额，数值变化会实时更新出仓资金。
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.exitTable}>
            <caption className={styles.srOnly}>出仓后资金流水</caption>
            <colgroup>
              <col className={styles.exitNodeColumn} />
              <col className={styles.exitPercentColumn} />
              <col className={styles.exitRatioColumn} />
              <col className={styles.exitSharesColumn} />
              <col className={styles.exitAmountColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitValueColumn} />
              <col className={styles.exitNavColumn} />
              <col className={styles.exitReturnColumn} />
            </colgroup>
            <thead>
              <tr>
                <th>节点</th>
                <th>幅度</th>
                <th>卖比例</th>
                <th>卖出份额</th>
                <th>出仓金额</th>
                <th>累计</th>
                <th>持仓市值</th>
                <th>总资产</th>
                <th>净值</th>
                <th>收益率</th>
              </tr>
            </thead>
            <tbody>
              {exits.map((exit, index) => {
                const row = exitRows[index] || {};
                const label = exitLabel(exit, index);
                return (
                  <tr key={exit.id}>
                    <th scope="row">
                      <span className={styles.nodeIndex}>0{index + 1}</span>
                      {label}
                    </th>
                    <td>
                      <label className={styles.tableInput}>
                        <select
                          aria-label={`${label}上涨幅度`}
                          aria-describedby="exit-table-hint"
                          value={asText(absolutePercent(exit.rebound))}
                          onChange={(event) => updateExit(exit.id, 'rebound', event.target.value)}
                        >
                          <option value="">涨</option>
                          {PERCENT_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <span>%</span>
                      </label>
                    </td>
                    <td>
                      <label className={styles.tableInput}>
                        <input
                          aria-label={`${label}卖出比例`}
                          aria-describedby="exit-table-hint"
                          type="number"
                          value={asText(exit.sellRatio)}
                          min="0"
                          max="100"
                          step="1"
                          onChange={(event) => updateExitRatio(exit.id, event.target.value)}
                        />
                        <span>%</span>
                      </label>
                    </td>
                    <td>
                      <label className={styles.tableInput}>
                        <input
                          aria-label={`${label}卖出份额`}
                          aria-describedby="exit-table-hint"
                          type="number"
                          value={asText(
                            exit.sellShares === '' || exit.sellShares === undefined
                              ? row.soldShares.toFixed(4)
                              : exit.sellShares
                          )}
                          min="0"
                          max={row.beforeShares || undefined}
                          step="0.0001"
                          onChange={(event) => updateExitShares(exit.id, index, event.target.value)}
                        />
                      </label>
                    </td>
                    <td>
                      <output
                        className={`${styles.tableInput} ${styles.outAmount}`}
                        aria-label={`${label}参考出仓金额`}
                      >
                        <span className={styles.outSign}>−</span>
                        {formatAmount(row.netCash)}
                      </output>
                    </td>
                    <td>{formatMoney(row.cash)}</td>
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
      </section>

      <footer className={styles.footer}>
        <span>CALCULATION ONLY · 不构成投资建议</span>
        <span>C 类份额：按持有时间记录</span>
      </footer>
    </main>
  );
}
