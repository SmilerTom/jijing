# Fund Trading Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `/t-calculator` page that locally recalculates staged fund entries, exits, cash, portfolio value, average cost, and break-even NAV as the user edits inputs.

**Architecture:** Keep the page as one focused client component and isolate all arithmetic in a pure ES module. The page owns editable form state and renders tables; the calculator module owns validation-free numeric calculations and can run under Node without Next.js. No API, localStorage, store, or existing homepage changes.

**Tech Stack:** Next.js App Router, React JSX, existing CSS variables, plain CSS, Node built-in `assert`.

---

### Task 1: Add pure calculator functions and the runnable check

**Files:**

- Create: `app/t-calculator/calculator.mjs`
- Create: `app/t-calculator/calculator.check.mjs`

- [ ] **Step 1: Write the failing check**

Create `calculator.check.mjs` importing `assert`, `calculateEntryRows`, `calculateExitRows`, and `calculateRecovery`. Assert the default entry plan reaches cumulative investment 7000, cash 3000, total assets within 0.01 of 9312.15, and average cost within 0.0001 of 2.9775. Assert a 40% drawdown from NAV 3.2743 returns recovery NAV within 0.0001 of 5.4572 and recovery rise within 0.0001 of 0.6666667. Assert the first exit row sells the fixed target-unit fraction and preserves cash plus holdings equal to total assets.

- [ ] **Step 2: Run the check and verify it fails**

Run `node app/t-calculator/calculator.check.mjs` from the repository root. Expected result: fail because `app/t-calculator/calculator.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure functions**

Export `DEFAULT_ENTRIES`, `DEFAULT_EXITS`, `calculateEntryRows`, `calculateExitRows`, and `calculateRecovery`. `calculateEntryRows` must subtract each purchase from cash, add `amount / nav` shares, and return cumulative investment, cash, shares, holding value, total assets, average cost, and break-even NAV. `calculateExitRows` must start from a full target position at the base NAV, sell a fixed fraction of original target shares at each `baseNav * (1 + reboundPct)` price, and return cash, remaining shares, remaining holding value, total assets, and total return. `calculateRecovery` must return current NAV, loss percentage, recovery NAV, and required rise; use `recoveryNav = currentNav / (1 - lossPct)` and reject non-positive inputs by returning an error field rather than throwing.

- [ ] **Step 4: Run the check and verify it passes**

Run `node app/t-calculator/calculator.check.mjs`. Expected result: no output and exit code 0.

- [ ] **Step 5: Commit**

Run `git add app/t-calculator/calculator.mjs app/t-calculator/calculator.check.mjs && git commit -m "feat: add fund trading calculator math"`.

### Task 2: Build the `/t-calculator` page shell and live inputs

**Files:**

- Create: `app/t-calculator/page.jsx`
- Create: `app/t-calculator/calculator.css`

- [ ] **Step 1: Add the client page using controlled state**

Create a `'use client'` page with defaults for 10000 principal, 3.2743 base NAV, 3.2743 simulated NAV, 0 redemption fee, and 30 holding days. Store entry rows and exit rows in local state. Every numeric input must have a visible `<label>`, `min`, `step`, and `aria-describedby`; updates must parse finite positive values and display an inline error without crashing. Add reset defaults and “回撤 40%” buttons.

- [ ] **Step 2: Render live result cards and both tables**

Use the pure functions on every render. Show cash, holding value, total assets, P/L, average cost, break-even NAV, and required rise. Render entry rows with the exact columns `节点 / 净值 / 本次买入 / 累计投入 / 剩余现金 / 持仓市值 / 总资产 / 平均成本`. Render exit rows with `节点 / 触发净值 / 卖出现金 / 累计现金 / 剩余持仓市值 / 总资产 / 总收益`. Add a separate recovery block showing current NAV, current assets at the selected scenario, recovery NAV, and recovery rise.

- [ ] **Step 3: Add local styling**

Use existing `--bg`, `--card`, `--text`, `--muted`, `--primary`, `--success`, `--danger`, and `--border` variables. Create a restrained dark trading-lab layout with a responsive two-column desktop grid, single-column mobile layout, visible focus rings, semantic headings, and horizontally scrollable tables. Keep mobile inputs at `16PX` to avoid Safari zoom.

- [ ] **Step 4: Run lint on the changed page and check module syntax**

Run `npx eslint app/t-calculator/page.jsx` and `node --check app/t-calculator/calculator.mjs`. Expected result: both commands pass.

- [ ] **Step 5: Commit**

Run `git add app/t-calculator/page.jsx app/t-calculator/calculator.css && git commit -m "feat: add interactive fund calculator page"`.

### Task 3: Verify the interaction and responsive behavior

**Files:**

- Modify: `app/t-calculator/page.jsx` only if a focused verification finds a page defect.
- Modify: `app/t-calculator/calculator.css` only if a focused verification finds a layout defect.

- [ ] **Step 1: Run the pure calculation check**

Run `node app/t-calculator/calculator.check.mjs`. Expected result: exit code 0.

- [ ] **Step 2: Run focused lint**

Run `npx eslint app/t-calculator/page.jsx`. Expected result: exit code 0.

- [ ] **Step 3: Start the local page for browser verification**

Run `npm run dev -- --hostname 127.0.0.1` and open `http://127.0.0.1:3000/t-calculator` in the local browser. Verify the page loads without console errors, changing本金 updates总资产 immediately, the `跌 40%` shortcut sets the scenario NAV to 60% of the base NAV and shows 66.67% recovery rise, and reset restores defaults.

- [ ] **Step 4: Check responsive and keyboard paths**

Verify desktop and a 375px-wide mobile viewport. Tab through every input and button, confirm visible focus, edit a value, confirm tables remain readable through horizontal scrolling, and enter an invalid negative value to confirm the inline error state remains usable.

- [ ] **Step 5: Inspect the final diff**

Run `git diff HEAD~2..HEAD --stat`, `git diff HEAD~2..HEAD --check`, and `git status --short`. Expected result: only the calculator page, stylesheet, calculator check/module, and the approved documentation files are changed; no build output is generated.

- [ ] **Step 6: Commit any focused verification fix**

If a verification fix is required, run `git add app/t-calculator && git commit -m "fix: refine fund calculator verification issues"`; otherwise leave the existing commits unchanged.
