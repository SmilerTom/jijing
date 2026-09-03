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

export default function BoardCalculatorPage() {
  return (
    <main className={styles.page}>
      <h1>交易驾驶舱</h1>
      <p className={styles.subtitle}>查看持仓收益、行情和风控状态，记录本基金的出入金流水。</p>
      <div className={styles.boardOptions}>
        <article className={`${styles.boardOption} ${styles.boardSelected}`}>
          <div className={styles.cardImage}>
            <div className={styles.mockup}>
              <div className={styles.mockupHeader}>A · 交易驾驶舱</div>
              <div className={styles.mockupBody}>
                <PreviewA />
              </div>
            </div>
          </div>
          <div className={styles.cardBody}>
            <h3>交易驾驶舱</h3>
            <p>先看仓位、收益和风控状态，再看流水。适合每天快速决定是否补仓或做 T。</p>
          </div>
        </article>
      </div>
    </main>
  );
}
