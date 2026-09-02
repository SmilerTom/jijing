'use client';

import { useMemo, useState } from 'react';
import {
  calculateEntryRows,
  calculateExitRows,
  calculateRecovery,
  DEFAULT_ENTRIES,
  DEFAULT_EXITS,
  summarizeEntryPosition
} from './calculator.mjs';
import styles from './calculator.module.css';

const DEFAULT_FORM = {
  capital: '10000',
  baseNav: '3.2743',
  scenarioNav: '3.2743',
  redemptionFee: '0',
  holdingDays: '30'
};

const asText = (value) => (value === null || value === undefined ? '' : String(value));
const numericValue = (value) => Number(value);
const isValidPositive = (value) => Number.isFinite(numericValue(value)) && numericValue(value) > 0;
const formatMoney = (value) =>
  Number.isFinite(value)
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';
const formatNav = (value) => (Number.isFinite(value) && value > 0 ? value.toFixed(4) : '--');
const formatNumber = (value) =>
  Number.isFinite(value) ? value.toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '--';
const formatPercent = (value, digits = 2) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%` : '--';
const cloneDefaults = () => ({
  form: { ...DEFAULT_FORM },
  entries: DEFAULT_ENTRIES.map((entry) => ({ ...entry })),
  exits: DEFAULT_EXITS.map((exit) => ({ ...exit }))
});

function Field({ id, label, value, onChange, min = '0', step = '0.01', suffix, hint, error }) {
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

function SectionTitle({ id, eyebrow, title, detail }) {
  return (
    <div className={styles.sectionTitle}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export default function TradingCalculatorPage() {
  const defaults = useMemo(() => cloneDefaults(), []);
  const [form, setForm] = useState(defaults.form);
  const [entries, setEntries] = useState(defaults.entries);
  const [exits, setExits] = useState(defaults.exits);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateEntry = (id, key, value) =>
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)));
  const updateExit = (id, key, value) =>
    setExits((current) => current.map((exit) => (exit.id === id ? { ...exit, [key]: value } : exit)));
  const reset = () => {
    setForm(defaults.form);
    setEntries(defaults.entries.map((entry) => ({ ...entry })));
    setExits(defaults.exits.map((exit) => ({ ...exit })));
  };

  const errors = useMemo(
    () => ({
      capital: !isValidPositive(form.capital) ? '本金必须大于 0' : '',
      baseNav: !isValidPositive(form.baseNav) ? '基准净值必须大于 0' : '',
      scenarioNav: !isValidPositive(form.scenarioNav) ? '模拟净值必须大于 0' : '',
      redemptionFee:
        Number.isFinite(numericValue(form.redemptionFee)) &&
        numericValue(form.redemptionFee) >= 0 &&
        numericValue(form.redemptionFee) < 100
          ? ''
          : '费率需在 0～100 之间',
      holdingDays:
        Number.isFinite(numericValue(form.holdingDays)) && numericValue(form.holdingDays) >= 0
          ? ''
          : '持有天数不能为负数'
    }),
    [form]
  );

  const entryRows = useMemo(
    () => calculateEntryRows({ capital: numericValue(form.capital), baseNav: numericValue(form.baseNav), entries }),
    [form.capital, form.baseNav, entries]
  );
  const latestEntry = entryRows.at(-1);
  const position = useMemo(
    () =>
      summarizeEntryPosition({
        rows: entryRows,
        scenarioNav: numericValue(form.scenarioNav),
        redemptionFeePct: numericValue(form.redemptionFee)
      }),
    [entryRows, form.scenarioNav, form.redemptionFee]
  );
  const exitRows = useMemo(
    () =>
      calculateExitRows({
        targetCapital: numericValue(form.capital),
        baseNav: numericValue(form.baseNav),
        exits,
        redemptionFeePct: numericValue(form.redemptionFee)
      }),
    [form.capital, form.baseNav, form.redemptionFee, exits]
  );
  const drawdownPct =
    isValidPositive(form.baseNav) && isValidPositive(form.scenarioNav)
      ? Math.max(0, (1 - numericValue(form.scenarioNav) / numericValue(form.baseNav)) * 100)
      : 0;
  const recovery = useMemo(
    () => calculateRecovery({ currentNav: numericValue(form.scenarioNav), lossPct: drawdownPct }),
    [form.scenarioNav, drawdownPct]
  );
  const setDrawdown40 = () =>
    updateForm('scenarioNav', isValidPositive(form.baseNav) ? (numericValue(form.baseNav) * 0.6).toFixed(4) : '');

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}>
            <span className={styles.liveDot} />
            LOCAL SCENARIO LAB <span>/</span> 017811
          </div>
          <h1>东方人工智能主题混合 C</h1>
          <p>分批入仓 · 回撤补仓 · 确认加仓 · 反弹出仓</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.secondaryButton} onClick={setDrawdown40}>
            载入 −40% 情景
          </button>
          <button type="button" className={styles.textButton} onClick={reset}>
            恢复默认
          </button>
        </div>
      </header>

      <section className={styles.notice} aria-label="使用说明">
        <span className={styles.noticeMark}>i</span>
        <p>这是本地计算器，不连接行情或交易接口。基金净值按每日确认值计算；C 类份额建议先确认持有天数和赎回费。</p>
        <span className={styles.noticeTag}>实时计算</span>
      </section>

      <div className={styles.workspace}>
        <section className={styles.panel} aria-labelledby="parameters-title">
          <SectionTitle
            id="parameters-title"
            eyebrow="01 / INPUTS"
            title="参数与情景"
            detail="任何字段变化都会立即重算下方资金流水。"
          />
          <div className={styles.fieldsGrid}>
            <Field
              id="capital"
              label="测试本金"
              value={form.capital}
              onChange={(value) => updateForm('capital', value)}
              step="100"
              suffix="元"
              hint="最高投入额度，不代表必须投满。"
              error={errors.capital}
            />
            <Field
              id="baseNav"
              label="基准净值 P0"
              value={form.baseNav}
              onChange={(value) => updateForm('baseNav', value)}
              step="0.0001"
              hint="首次确认买入时的净值。"
              error={errors.baseNav}
            />
            <Field
              id="scenarioNav"
              label="模拟净值"
              value={form.scenarioNav}
              onChange={(value) => updateForm('scenarioNav', value)}
              step="0.0001"
              hint="用于查看当前资金和回本要求。"
              error={errors.scenarioNav}
            />
            <Field
              id="redemptionFee"
              label="赎回费率"
              value={form.redemptionFee}
              onChange={(value) => updateForm('redemptionFee', value)}
              step="0.01"
              suffix="%"
              hint="满 30 天可填 0。"
              error={errors.redemptionFee}
            />
            <Field
              id="holdingDays"
              label="当前持有天数"
              value={form.holdingDays}
              onChange={(value) => updateForm('holdingDays', value)}
              step="1"
              suffix="天"
              hint="仅用于提醒，不改变份额计算。"
              error={errors.holdingDays}
            />
          </div>
          <div className={styles.assumption}>
            <span>当前场景</span>
            <strong>{formatPercent(-drawdownPct / 100)} </strong>
            <em>相对 P0</em>
            <span className={styles.assumptionDivider}>|</span>
            <span>计划投入</span>
            <strong>{formatMoney(latestEntry?.cumulativeInvested || 0)}</strong>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.resultsPanel}`} aria-labelledby="results-title">
          <SectionTitle
            id="results-title"
            eyebrow="02 / LIVE RESULT"
            title="账户快照"
            detail="按已配置的全部入仓计划估算。"
          />
          <div className={styles.metricsGrid}>
            <Metric label="剩余现金" value={formatMoney(position.cash)} note="入仓后未使用资金" />
            <Metric
              label="持仓市值"
              value={formatMoney(position.holdingValue)}
              note={`${formatNumber(position.shares)} 份`}
            />
            <Metric
              label="账户总资产"
              value={formatMoney(position.totalAssets)}
              tone={position.totalAssets >= numericValue(form.capital) ? 'positive' : 'negative'}
              note={`相对本金 ${formatPercent(position.totalAssets / numericValue(form.capital) - 1)}`}
            />
            <Metric label="平均成本" value={formatNav(position.averageCost)} note="累计投入 ÷ 累计份额" />
            <Metric
              label="回本净值"
              value={formatNav(position.breakEvenNav)}
              tone="accent"
              note={`当前还需 ${formatPercent(position.requiredRise)}`}
            />
            <Metric
              label="回撤回本"
              value={formatNav(recovery.recoveryNav)}
              tone="accent"
              note={`回撤 ${drawdownPct.toFixed(2)}% · 需涨 ${formatPercent(recovery.requiredRise)}`}
            />
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="entry-title">
        <SectionTitle
          id="entry-title"
          eyebrow="03 / ENTRY LADDER"
          title="入仓流水"
          detail="下跌补仓与止跌确认加仓分开显示；最后一档净值可手工输入。"
        />
        <div id="entry-table-hint" className={styles.srOnly}>
          可编辑触发幅度、执行净值和买入金额，数值变化会实时更新流水。
        </div>
        <div className={styles.tableScroll}>
          <table>
            <caption className={styles.srOnly}>入仓后资金流水</caption>
            <thead>
              <tr>
                <th>节点</th>
                <th>触发幅度</th>
                <th>执行净值</th>
                <th>本次买入</th>
                <th>累计投入</th>
                <th>剩余现金</th>
                <th>持仓市值</th>
                <th>账户总资产</th>
                <th>平均成本</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const row = entryRows[index] || {};
                return (
                  <tr key={entry.id}>
                    <th scope="row">
                      <span className={styles.nodeIndex}>0{index + 1}</span>
                      {entry.label}
                    </th>
                    <td>
                      {entry.confirmation ? (
                        <span className={styles.confirmBadge}>确认</span>
                      ) : (
                        <label className={styles.tableInput}>
                          <input
                            aria-label={`${entry.label}触发幅度`}
                            aria-describedby="entry-table-hint"
                            type="number"
                            value={asText(entry.change)}
                            step="0.1"
                            onChange={(event) => updateEntry(entry.id, 'change', event.target.value)}
                          />
                          <span>%</span>
                        </label>
                      )}
                    </td>
                    <td>
                      {entry.confirmation ? (
                        <label className={styles.tableInput}>
                          <input
                            aria-label={`${entry.label}执行净值`}
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
                    <td>
                      <label className={styles.tableInput}>
                        <input
                          aria-label={`${entry.label}买入金额`}
                          aria-describedby="entry-table-hint"
                          type="number"
                          value={asText(entry.amount)}
                          min="0"
                          step="100"
                          onChange={(event) => updateEntry(entry.id, 'amount', event.target.value)}
                        />
                        <span>元</span>
                      </label>
                    </td>
                    <td>{formatMoney(row.cumulativeInvested)}</td>
                    <td>{formatMoney(row.cash)}</td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td className={row.totalAssets < numericValue(form.capital) ? styles.down : styles.up}>
                      {formatMoney(row.totalAssets)}
                    </td>
                    <td>{formatNav(row.averageCost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="exit-title">
        <SectionTitle
          id="exit-title"
          eyebrow="04 / EXIT LADDER"
          title="出仓流水"
          detail="每轮涨幅作用于上一轮净值，每轮卖出当前剩余份额比例。"
        />
        <div id="exit-table-hint" className={styles.srOnly}>
          可编辑上涨幅度和卖出比例，数值变化会实时更新出仓资金。
        </div>
        <div className={styles.tableScroll}>
          <table>
            <caption className={styles.srOnly}>出仓后资金流水</caption>
            <thead>
              <tr>
                <th>节点</th>
                <th>上涨幅度</th>
                <th>触发净值</th>
                <th>卖出比例</th>
                <th>本次卖出现金</th>
                <th>累计现金</th>
                <th>剩余持仓市值</th>
                <th>账户总资产</th>
                <th>总收益</th>
              </tr>
            </thead>
            <tbody>
              {exits.map((exit, index) => {
                const row = exitRows[index] || {};
                return (
                  <tr key={exit.id}>
                    <th scope="row">
                      <span className={styles.nodeIndex}>0{index + 1}</span>
                      {exit.label}
                    </th>
                    <td>
                      <label className={styles.tableInput}>
                        <input
                          aria-label={`${exit.label}上涨幅度`}
                          aria-describedby="exit-table-hint"
                          type="number"
                          value={asText(exit.rebound)}
                          min="0"
                          step="1"
                          onChange={(event) => updateExit(exit.id, 'rebound', event.target.value)}
                        />
                        <span>%</span>
                      </label>
                    </td>
                    <td>{formatNav(row.triggerNav)}</td>
                    <td>
                      <label className={styles.tableInput}>
                        <input
                          aria-label={`${exit.label}卖出比例`}
                          aria-describedby="exit-table-hint"
                          type="number"
                          value={asText(exit.sellRatio)}
                          min="0"
                          max="100"
                          step="1"
                          onChange={(event) => updateExit(exit.id, 'sellRatio', event.target.value)}
                        />
                        <span>%</span>
                      </label>
                    </td>
                    <td>{formatMoney(row.netCash)}</td>
                    <td>{formatMoney(row.cash)}</td>
                    <td>{formatMoney(row.holdingValue)}</td>
                    <td>{formatMoney(row.totalAssets)}</td>
                    <td className={row.totalReturn >= 0 ? styles.up : styles.down}>{formatPercent(row.totalReturn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.recoveryPanel} aria-labelledby="recovery-title">
        <div>
          <span className={styles.eyebrow}>05 / RECOVERY MATH</span>
          <h2 id="recovery-title">回撤之后，净值要走多远？</h2>
          <p>
            当前模拟净值 <strong>{formatNav(recovery.currentNav)}</strong>，相对基准回撤{' '}
            <strong>{drawdownPct.toFixed(2)}%</strong>。
          </p>
        </div>
        <div className={styles.recoveryNumber}>
          <span>回本净值</span>
          <strong>{formatNav(recovery.recoveryNav)}</strong>
          <em>还需上涨 {formatPercent(recovery.requiredRise)}</em>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>CALCULATION ONLY · 不构成投资建议</span>
        <span>C 类份额：交易前核对持有天数与赎回费</span>
      </footer>
    </main>
  );
}
