# Fund Trading Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/t-calculator` into a single-fund trading cockpit with dated cash-flow ledgers, official benchmark-index early warnings, editable risk rules, and correct account-level profitability.

**Architecture:** Keep the existing page as the focused client component and keep all arithmetic in `calculator.mjs`. Reuse the existing fund APIs `fetchFundNetValueRange`, `fetchNavMetricsFromTrendFallback`, and `fetchEastmoneySectorQuotesBatch`; do not add a dependency or a second data service. Use `storageStore` for risk settings and one-per-day equity snapshots, while keeping the existing pending-flow persistence.

**Tech Stack:** Next.js App Router, React JSX, existing CSS module and CSS variables, existing Eastmoney/Tencent data helpers, Node built-in `assert`.

---

### Task 1: Add account summary, daily-flow metrics, and risk-signal math

**Files:**

- Modify: `app/t-calculator/calculator.mjs`
- Modify: `app/t-calculator/calculator.check.mjs`

- [ ] **Step 1: Write failing checks for the approved accounting rules**

Append checks covering a position with 100 shares, 1000 cumulative entry, 200 cumulative net exit, 1000 current NAV, and a 900 current holding value. The expected account total assets are 1100, account profit is 100, and account profit rate is 10%. Add a history of 1000 then 1200 then 1100 and assert maximum drawdown is -8.3333%. Add risk checks for -8% fund daily change (补仓), +8% fund daily change (出仓), -9% benchmark change (指数预警), and -20% drawdown (暂停补仓). Add a missing daily-change input check that returns a pending data state rather than 0%.

Run `node app/t-calculator/calculator.check.mjs`; expected result: FAIL because the new exports and daily fields do not exist.

- [ ] **Step 2: Implement the minimum pure calculations**

Add these exports to `calculator.mjs`:

```js
export const DEFAULT_RISK_RULES = {
  fundDownWatch: -5,
  fundDownEntry: -8,
  fundDownStop: -12,
  fundUpWatch: 5,
  fundUpExit: 8,
  fundUpStrong: 12,
  drawdownWarn: -10,
  drawdownStop: -20
};

export function summarizeAccountPosition({ entryRows = [], exitRows = [], currentNav = 0, equityHistory = [] } = {}) {
  const entry = [...entryRows].reverse().find((row) => !row?.pendingNav);
  const exit = [...exitRows].reverse().find((row) => !row?.pendingNav);
  const invested = entry?.cumulativeInvested || 0;
  const shares = exit ? exit.remainingShares : entry?.shares || 0;
  const cash = exit ? exit.cash : entry?.cash || 0;
  const nav = Number(currentNav);
  const holdingValue = nav > 0 ? shares * nav : 0;
  const totalAssets = cash + holdingValue;
  const realizedAmount = exit?.cumulativeAmount || 0;
  const profit = totalAssets - invested;
  const profitRate = invested > 0 ? profit / invested : 0;
  const points = [...equityHistory, ...entryRows, ...exitRows]
    .map((row) => ({ date: row?.recordedAt || row?.date || '', totalAssets: Number(row?.totalAssets) }))
    .filter((row) => Number.isFinite(row.totalAssets) && row.totalAssets >= 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (totalAssets >= 0) points.push({ date: 'current', totalAssets });
  let highWater = 0;
  let maxDrawdown = 0;
  for (const point of points) {
    highWater = Math.max(highWater, point.totalAssets);
    if (highWater > 0) maxDrawdown = Math.min(maxDrawdown, point.totalAssets / highWater - 1);
  }
  return { invested, realizedAmount, shares, cash, holdingValue, totalAssets, profit, profitRate, maxDrawdown };
}

export function calculateRiskSignals({ fundDailyChange = null, benchmarkChange = null, maxDrawdown = 0, rules = DEFAULT_RISK_RULES } = {}) {
  const signals = [];
  if (Number.isFinite(fundDailyChange)) {
    if (fundDailyChange <= rules.fundDownStop) signals.push({ id: 'fund-down-stop', level: 'danger', source: '基金', action: '暂停补仓', message: '基金日跌幅达到强风控线' });
    else if (fundDailyChange <= rules.fundDownEntry) signals.push({ id: 'fund-down-entry', level: 'warning', source: '基金', action: '建议补仓', message: '基金日跌幅达到补仓线' });
    else if (fundDailyChange <= rules.fundDownWatch) signals.push({ id: 'fund-down-watch', level: 'watch', source: '基金', action: '观察', message: '基金日跌幅进入观察区' });
    else if (fundDailyChange >= rules.fundUpStrong) signals.push({ id: 'fund-up-strong', level: 'danger', source: '基金', action: '分批出仓', message: '基金日涨幅达到强提醒线' });
    else if (fundDailyChange >= rules.fundUpExit) signals.push({ id: 'fund-up-exit', level: 'warning', source: '基金', action: '建议出仓', message: '基金日涨幅达到出仓线' });
    else if (fundDailyChange >= rules.fundUpWatch) signals.push({ id: 'fund-up-watch', level: 'watch', source: '基金', action: '观察', message: '基金日涨幅进入观察区' });
  }
  if (Number.isFinite(benchmarkChange) && (benchmarkChange <= rules.fundDownEntry || benchmarkChange >= rules.fundUpExit))
    signals.push({ id: 'benchmark', level: 'index', source: '业绩基准指数', action: '指数预警', message: '指数达到预警线，基金净值待更新' });
  if (Number.isFinite(maxDrawdown) && maxDrawdown <= rules.drawdownStop)
    signals.push({ id: 'drawdown-stop', level: 'danger', source: '账户回撤', action: '暂停补仓', message: '最大回撤达到暂停线' });
  else if (Number.isFinite(maxDrawdown) && maxDrawdown <= rules.drawdownWarn)
    signals.push({ id: 'drawdown-warn', level: 'warning', source: '账户回撤', action: '风险提醒', message: '最大回撤达到提醒线' });
  return signals;
}
```

All risk thresholds and signal inputs use percentage points (for example, `-8` means -8%); convert the benchmark API’s decimal `pct` value to percentage points before calling this function.

Update `calculateEntryRows` and `calculateExitRows` to accept `dailyChangeByDate` and return `dailyChange` for a dated row. If a dated row has no daily change yet, return `pendingNav: true`/a pending daily field; never convert the missing value to 0. Preserve the existing compatibility fallback for legacy ratio/share exit data.

- [ ] **Step 3: Run the pure check**

Run `node app/t-calculator/calculator.check.mjs`. Expected result: PASS with exit code 0 and no output.

- [ ] **Step 4: Commit the calculation slice**

```bash
git add app/t-calculator/calculator.mjs app/t-calculator/calculator.check.mjs
git commit -m "feat: add fund dashboard risk calculations"
```

### Task 2: Load the fund NAV and official benchmark index without mixing their meanings

**Files:**

- Modify: `app/t-calculator/page.jsx`

- [ ] **Step 1: Add the single-fund benchmark constants and state**

Import the existing helpers and define the verified official benchmark component:

```js
import {
  fetchEastmoneySectorQuotesBatch,
  fetchFundNetValueRange,
  fetchNavMetricsFromTrendFallback,
  fetchSmartFundNetValueBackward
} from '../api/fund';

const BENCHMARK_INDEX = { secid: '2.930713', name: '中证人工智能主题指数', weight: 80 };
const RISK_SETTINGS_KEY = 'fundTradingCalculatorRiskSettings';
const EQUITY_HISTORY_KEY = 'fundTradingCalculatorEquityHistory';
```

Add state for `dailyChangeByDate`, the latest fund quote, benchmark quote, data status, editable risk rules, equity history, the plus menu, and the optional system-notification switch. Initialize risk rules and history from `storageStore`, never from `window.localStorage`.

- [ ] **Step 2: Replace per-date NAV-only loading with a range that also returns growth**

Keep the current requested flow dates, but call `fetchFundNetValueRange('017811', rangeStart, todayKey())` so every resolved NAV also has its official daily growth. For each requested flow date, map to the latest returned trading-day row on or before that date. If the requested date is today and the latest returned row is earlier than today, leave that date as `null` and set the status to “今日净值待更新”; this prevents yesterday’s NAV from being used for a new same-day cash flow. Store both `navByDate[requestedDate]` and `dailyChangeByDate[requestedDate]` only when the resolved row is valid.

Keep the existing backward lookup only for historical dates that fall on weekends/holidays. Wrap the range request in `try/catch`; on failure preserve inputs and set the fund-data status to “获取失败”.

- [ ] **Step 3: Load the current fund quote and benchmark quote independently**

Use `fetchNavMetricsFromTrendFallback('017811')` for the latest fund NAV. Treat the quote as current only when `jzrq === todayKey()`; otherwise display the latest known NAV with a “待更新” status and set today’s fund daily change to `null`. Use `fetchEastmoneySectorQuotesBatch([BENCHMARK_INDEX.secid])` for the index; its returned `pct` is already a decimal fraction. If this request fails, show “业绩基准指数暂不可用” without blocking fund calculations.

The rendered data contract is:

```js
{
  fund: { nav: Number|null, previousNav: Number|null, dailyChangePct: Number|null, date: String, status: 'updated'|'pending'|'error' },
  benchmark: { name: BENCHMARK_INDEX.name, pct: Number|null, weight: 80, status: 'updated'|'error' }
}
```

- [ ] **Step 4: Commit the data-loading slice**

```bash
git add app/t-calculator/page.jsx
git commit -m "feat: load fund and benchmark daily quotes"
```

### Task 3: Build the trading cockpit, plus action menu, and risk settings

**Files:**

- Modify: `app/t-calculator/page.jsx`
- Modify: `app/t-calculator/calculator.module.css`

- [ ] **Step 1: Add the top cockpit blocks**

Render the existing account metrics as the first row, then add a “今日行情” block and a risk alert strip. The quote block must visibly separate actual fund data from the benchmark reference:

```jsx
<section className={styles.marketPanel} aria-labelledby="market-title">
  <SectionTitle id="market-title" title="今日行情" detail="基金净值确认后才计入实际收益。" />
  <div className={styles.marketGrid}>
    <Metric label="基金净值" value={formatNav(fundQuote.nav)} note={fundQuote.status === 'updated' ? '今日已更新' : '今日待更新'} />
    <Metric label="基金日涨跌幅" value={formatNullablePercent(fundQuote.dailyChangePct)} tone={toneForPct(fundQuote.dailyChangePct)} note={fundQuote.date || '等待净值'} />
    <Metric label="业绩基准指数参考" value={formatNullablePercent(benchmarkQuote.pct)} tone={toneForPct(benchmarkQuote.pct)} note="中证人工智能主题指数 · 80%" />
  </div>
</section>
```

Render risk alerts from `calculateRiskSignals`, passing `fundQuote.dailyChangePct` and `benchmarkQuote.pct * 100`. When the fund daily value is `null`, show a neutral “基金日行情待更新” status; index alerts may still appear and must be prefixed “指数预警”.

- [ ] **Step 2: Replace the two section-level plus buttons with one accessible menu**

Add one button beside the dashboard title:

```jsx
<button type="button" className={styles.addButton} aria-expanded={flowMenuOpen} aria-controls="flow-actions" onClick={() => setFlowMenuOpen((open) => !open)}>+</button>
<div id="flow-actions" className={styles.flowActions} role="menu" hidden={!flowMenuOpen}>
  <button type="button" role="menuitem" onClick={() => openFlowFromMenu('entry')}>入金</button>
  <button type="button" role="menuitem" onClick={() => openFlowFromMenu('exit')}>出金</button>
</div>
```

`openFlowFromMenu` closes the menu and calls the existing `openFlowDialog`; the dialog continues to accept only amount and occurrence time. Preserve keyboard focus rings and close the menu after selecting an action.

- [ ] **Step 3: Add inline editable risk settings and optional reminders**

Use a native `details` block instead of another modal. It contains number inputs for the eight fields in `DEFAULT_RISK_RULES`, a page-alert toggle enabled by default, and a system-notification toggle disabled by default. Persist changes with `storageStore.setItem(RISK_SETTINGS_KEY, JSON.stringify(riskRules))`. Request `Notification.requestPermission()` only from the user’s system-notification toggle handler; never request on page load.

When a signal is active, render a visible alert and use an `aria-live="polite"` region. Deduplicate same-day signal IDs in the stored alert history so refreshes do not repeat them.

- [ ] **Step 4: Correct the top account calculations**

Use `summarizeAccountPosition` with the latest valid fund NAV and equity history. The default “账户盈利率” must be the calculated account rate, which includes remaining holding value and cumulative net出金; preserve the existing snapshot edit control as an explicit manual display override. Show “待更新” instead of a fabricated 0% when there is no valid NAV.

- [ ] **Step 5: Style the cockpit and menu**

Add only the required CSS module selectors: `.marketPanel`, `.marketGrid`, `.riskStrip`, `.riskItem`, `.riskSettings`, `.flowActions`, and their responsive states. Reuse existing variables and semantic `.up`, `.down`, and `.accent` colors. Keep the first row visually dominant, keep the tables horizontally scrollable on narrow screens, and use `16PX` or larger for all mobile-editable inputs.

- [ ] **Step 6: Commit the cockpit slice**

```bash
git add app/t-calculator/page.jsx app/t-calculator/calculator.module.css
git commit -m "feat: add fund trading cockpit and risk alerts"
```

### Task 4: Align the ledgers with the dashboard accounting contract

**Files:**

- Modify: `app/t-calculator/page.jsx`
- Modify: `app/t-calculator/calculator.mjs`
- Modify: `app/t-calculator/calculator.check.mjs`
- Modify: `app/t-calculator/calculator.module.css` only if column widths need adjustment

- [ ] **Step 1: Update both ledger headers and cells**

Change the visible column name from “幅度” to “日涨跌幅”. For dated rows render `row.dailyChange`; for an empty planned node render its configured trigger as a “计划” badge rather than claiming it is a real daily move. Keep amount signs as green `+` and red `−`. Keep the calculated columns for累计、份额、持仓市值、总资产、净值 and the node’s收益率.

- [ ] **Step 2: Verify cash-flow math against a concrete T sequence**

Add assertions for: 10000 initial entry, a 1000 entry at NAV 10, a 10% NAV rise, a 200 exit amount at NAV 11, and a second 200 exit amount at NAV 12. Assert each exit’s sold shares equal `amount / triggerNav`, cumulative exits are 200 then 400, and the second exit’s remaining shares are based on the first exit’s remaining shares. Assert the account summary includes both the remaining holding and realized exit cash.

- [ ] **Step 3: Run the focused math checks**

Run `node app/t-calculator/calculator.check.mjs` and `node --check app/t-calculator/calculator.mjs`. Expected result: both exit with code 0 and produce no error output.

- [ ] **Step 4: Commit the ledger slice**

```bash
git add app/t-calculator/page.jsx app/t-calculator/calculator.mjs app/t-calculator/calculator.check.mjs app/t-calculator/calculator.module.css
git commit -m "fix: align flow ledgers with account returns"
```

### Task 5: Browser verification and delivery

**Files:**

- Modify: `app/t-calculator/page.jsx` only if interaction verification finds a page defect.
- Modify: `app/t-calculator/calculator.module.css` only if responsive verification finds a layout defect.

- [ ] **Step 1: Run the repository’s focused checks**

Run:

```bash
node app/t-calculator/calculator.check.mjs
node --check app/t-calculator/calculator.mjs
npx eslint app/t-calculator/page.jsx
git diff --check
```

Expected result: all commands exit 0. Do not run a full build unless explicitly requested.

- [ ] **Step 2: Verify the desktop cockpit in the local browser**

Open `http://127.0.0.1:3000/t-calculator`. Check that the page has one “＋” button, that it opens 入金/出金 choices, that 今日行情 separately shows 基金净值 and 业绩基准指数参考, and that an unupdated fund quote shows “待更新” plus `--` rather than 0%.

- [ ] **Step 3: Verify a complete cash-flow path**

Add an entry amount and an exit amount through the plus menu. Confirm the dialog defaults the occurrence time, the entry/exit row gets the selected date, amount signs remain green/red, exit shares equal amount divided by that date’s NAV, cumulative amounts increase, and account盈利率 includes realized exit cash.

- [ ] **Step 4: Verify risk and reminder states**

Edit a risk threshold, confirm it persists after reload, simulate or observe a threshold crossing, confirm the page alert has an accessible live region, confirm index alerts are labeled “指数预警”, and confirm the system-notification permission is not requested until its toggle is enabled.

- [ ] **Step 5: Verify keyboard and responsive behavior**

Tab through the plus menu, dialog, risk settings, and table inputs. Check visible focus at desktop and at a 390px viewport; confirm the document itself does not overflow horizontally and each ledger scroll area can scroll horizontally. Check the empty, pending-NAV, fund-error, and benchmark-error states.

- [ ] **Step 6: Final diff and commit any focused fix**

Run `git status --short --branch`, `git log -5 --oneline`, and `git diff HEAD~5..HEAD --check`. If a verification fix is required, commit only the affected files with `fix: refine fund dashboard verification`; otherwise leave the feature commits unchanged.
