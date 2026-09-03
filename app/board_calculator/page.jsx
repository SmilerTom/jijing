'use client';

import { useState } from 'react';
import styles from './page.module.css';

const DOWN_RISK = [-5, -8, -10, -15, -20];
const UP_RISK = [5, 8, 10, 15, 20];

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
const formatMoney = (value) => (Number.isFinite(value) ? `¥${value.toFixed(2)}` : '--');
const formatRate = (value) => (Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '--');
const hasNumber = (value) => value !== '' && Number.isFinite(Number(value));

function RiskSettings() {
  const [selected, setSelected] = useState(new Set([-8, 5]));
  const toggle = (value) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  return (
    <div className={styles.riskSettings}>
      <span className={styles.riskSettingsTitle}>风控线（可多选）</span>
      <div className={styles.riskControls}>
        <fieldset className={styles.riskGroup}>
          <legend>下跌</legend>
          {DOWN_RISK.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.riskChip} ${selected.has(value) ? styles.selected : ''}`}
              aria-pressed={selected.has(value)}
              onClick={() => toggle(value)}
            >
              {value}%
            </button>
          ))}
        </fieldset>
        <fieldset className={styles.riskGroup}>
          <legend>上涨</legend>
          {UP_RISK.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.riskChip} ${selected.has(value) ? styles.selected : ''}`}
              aria-pressed={selected.has(value)}
              onClick={() => toggle(value)}
            >
              +{value}%
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

function PreviewA() {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [flowType, setFlowType] = useState('buy');
  const [flowAmount, setFlowAmount] = useState('');
  const [flowDate, setFlowDate] = useState(localDateTime);
  const [rows, setRows] = useState([]);
  const amountValue = Number(amount);
  const rateValue = Number(rate);
  const flowValue = Number(flowAmount);
  const saveSnapshot = () => setEditing(false);
  const addFlow = () => {
    if (!(flowValue > 0) || !flowDate) return;
    setRows((current) => [...current, { date: displayDate(flowDate), type: flowType, amount: flowValue }]);
    setFlowAmount('');
  };
  return (
    <div className={styles.boardPreview}>
      <div className={styles.previewHead}>
        <strong>东方人工智能主题混合 C</strong>
        <div className={styles.previewTools}>
          <span>● 行情待更新</span>
          <button
            type="button"
            className={styles.previewEdit}
            onClick={() => (editing ? saveSnapshot() : setEditing(true))}
          >
            {editing ? '完成' : '编辑'}
          </button>
        </div>
      </div>
      <div className={styles.riskPanel}>
        <div className={styles.riskBanner}>
          <span className={styles.riskState}>待更新</span>
          <span className={styles.riskMessage}>等待跟踪指数更新</span>
        </div>
        <RiskSettings />
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <i>金额</i>
          {editing ? (
            <input
              className={styles.statEdit}
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label="编辑金额"
              placeholder="输入金额"
            />
          ) : (
            <b className={styles.statValue}>{amountValue > 0 ? formatMoney(amountValue) : '--'}</b>
          )}
        </div>
        <div className={styles.stat}>
          <i>持有收益</i>
          <b className={styles.statValue}>
            {amountValue > 0 && hasNumber(rate) ? formatMoney((amountValue * rateValue) / 100) : '--'}
          </b>
        </div>
        <div className={styles.stat}>
          <i>持有收益率</i>
          {editing ? (
            <input
              className={styles.statEdit}
              type="number"
              step="0.01"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              aria-label="编辑持有收益率"
              placeholder="输入收益率"
            />
          ) : (
            <b className={styles.statValue}>{hasNumber(rate) ? formatRate(rateValue) : '--'}</b>
          )}
        </div>
        <div className={styles.stat}>
          <i>昨日收益</i>
          <b className={styles.statValue}>--</b>
        </div>
        <div className={styles.stat}>
          <i>最新净值</i>
          <b className={styles.statValue}>待更新</b>
        </div>
        <div className={styles.stat}>
          <i>跟踪指数</i>
          <b className={styles.statValue}>--</b>
        </div>
      </div>
      <table className={styles.miniTable}>
        <thead>
          <tr>
            <th>时间</th>
            <th>日涨跌幅</th>
            <th>金额</th>
            <th>累计</th>
            <th>收益率</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={`${row.date}-${index}`}>
                <td>{row.date}</td>
                <td>待更新</td>
                <td className={row.type === 'buy' ? styles.up : styles.down}>
                  {row.type === 'buy' ? '+' : '−'}
                  {row.amount.toFixed(2)}
                </td>
                <td>待更新</td>
                <td>待更新</td>
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
      <div className={styles.flowBox}>
        <div className={styles.flowBoxHead}>
          <b>出入金</b>
          <span>净值更新后自动计算</span>
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

function PreviewB() {
  return (
    <div className={styles.boardPreview}>
      <div className={styles.previewHead}>
        <strong>交易账本</strong>
        <span>本基金</span>
      </div>
      <table className={styles.miniTable}>
        <thead>
          <tr>
            <th>时间</th>
            <th>日涨跌幅</th>
            <th>金额</th>
            <th>累计</th>
            <th>收益率</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>09-03 10:20</td>
            <td className={styles.down}>-6.00%</td>
            <td className={styles.up}>+200.00</td>
            <td>2,200.00</td>
            <td className={styles.down}>-1.80%</td>
          </tr>
          <tr>
            <td>09-05 14:10</td>
            <td className={styles.up}>+10.00%</td>
            <td className={styles.down}>-200.00</td>
            <td>2,000.00</td>
            <td className={styles.up}>+3.20%</td>
          </tr>
          <tr>
            <td>09-08 09:35</td>
            <td className={styles.down}>-3.00%</td>
            <td className={styles.up}>+300.00</td>
            <td>2,300.00</td>
            <td className={styles.down}>-0.60%</td>
          </tr>
        </tbody>
      </table>
      <div className={styles.signalGrid}>
        <div className={styles.signal}>
          <small>当前份额</small>
          <strong>682.41</strong>
        </div>
        <div className={styles.signal}>
          <small>已实现收益</small>
          <strong className={styles.up}>+64.00</strong>
        </div>
      </div>
    </div>
  );
}

function PreviewC() {
  return (
    <div className={styles.boardPreview}>
      <div className={styles.previewHead}>
        <strong>风控雷达</strong>
        <span>3 条规则</span>
      </div>
      <div className={`${styles.risk} ${styles.ok}`}>
        <b>当前状态 · 正常</b>
        <span>回撤 -4.2%</span>
      </div>
      <div className={styles.risk}>
        <b>涨幅 ≥ +8%</b>
        <span>提示分批出仓</span>
      </div>
      <div className={styles.risk}>
        <b>跌幅 ≤ -10%</b>
        <span>提示分批补仓</span>
      </div>
      <div className={styles.signalGrid}>
        <div className={styles.signal}>
          <small>今日涨跌幅</small>
          <strong className={styles.down}>-6.00%</strong>
        </div>
        <div className={styles.signal}>
          <small>账户收益率</small>
          <strong className={styles.up}>+2.40%</strong>
        </div>
        <div className={styles.signal}>
          <small>计划出仓</small>
          <strong>¥200.00</strong>
        </div>
        <div className={styles.signal}>
          <small>计划补仓</small>
          <strong>¥300.00</strong>
        </div>
      </div>
    </div>
  );
}

function BoardOption({ name, title, description, children, selected, onSelect }) {
  return (
    <article
      className={`${styles.boardOption} ${selected ? styles.boardSelected : ''}`}
      onClick={onSelect}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect()}
      role="button"
      tabIndex="0"
      aria-pressed={selected}
    >
      <div className={styles.cardImage}>
        <div className={styles.mockup}>
          <div className={styles.mockupHeader}>{name}</div>
          <div className={styles.mockupBody}>{children}</div>
        </div>
      </div>
      <div className={styles.cardBody}>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </article>
  );
}

export default function BoardCalculatorPage() {
  const [selected, setSelected] = useState('cockpit');
  return (
    <main className={styles.page}>
      <h1>选择基金看板的信息层级</h1>
      <p className={styles.subtitle}>三种方案都保留：时间、日涨跌幅、出入金金额、累计金额、收益率与风控提示。</p>
      <div className={styles.boardOptions}>
        <BoardOption
          name="A · 交易驾驶舱"
          title="交易驾驶舱"
          description="先看仓位、收益和风控状态，再看流水。适合每天快速决定是否补仓或做 T。"
          selected={selected === 'cockpit'}
          onSelect={() => setSelected('cockpit')}
        >
          <PreviewA />
        </BoardOption>
        <BoardOption
          name="B · 流水账本"
          title="流水账本"
          description="把每次出入金和日涨跌幅放在同一张表，适合复盘和核对金额。"
          selected={selected === 'ledger'}
          onSelect={() => setSelected('ledger')}
        >
          <PreviewB />
        </BoardOption>
        <BoardOption
          name="C · 信号提醒"
          title="信号提醒"
          description="把风控线放到第一视线，触发时直接告诉你“补仓 / 出仓 / 观望”。"
          selected={selected === 'signals'}
          onSelect={() => setSelected('signals')}
        >
          <PreviewC />
        </BoardOption>
      </div>
      <p className={styles.subtitleBottom}>请选择一种作为主布局；风控规则仍可在下一步细化。</p>
    </main>
  );
}
