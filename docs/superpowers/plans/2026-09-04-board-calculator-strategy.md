# 单只基金看板策略接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `/board_calculator` 单只基金看板中接入附件条件策略，提供可恢复的默认参数、真实数据驱动的建议和正确的策略资金展示，同时不保留任何模拟功能。

**Architecture:** 用一个无 DOM 的纯计算模块负责默认参数、均线、止盈和踏空锁定判断；`page.jsx` 负责按基金代码持久化策略参数、展示建议并把用户确认的流水作为输入。净值或均线数据缺失时返回待更新，不生成随机数据，也不自动写入交易。

**Tech Stack:** Next.js App Router、React、CSS Module、浏览器 `localStorage`、Node 内置 `assert`。

---

### Task 1: 建立策略纯计算模块和最小检查

**Files:**

- Create: `app/board_calculator/strategy.mjs`
- Create: `app/board_calculator/strategy.check.mjs`

- [ ] **Step 1: 写失败检查，锁定附件规则**

在 `strategy.check.mjs` 中导入模块并覆盖：默认参数为 20、30、3、20、10；持有收益率 20% 且当前金额 10000 时建议卖出 3000；卖出金额 3000 时每份策略资金为 1000；20 个真实净值可计算均线；不足 20 个净值返回 `null`；当前净值高于最近卖出净值 10% 时返回锁定；没有净值时状态为 `pending`。

```js
import assert from 'node:assert/strict';
import { DEFAULT_STRATEGY, calculateMovingAverage, calculateStrategyState } from './strategy.mjs';

assert.deepEqual(DEFAULT_STRATEGY, { targetRate: 20, sellRatio: 30, cashTranches: 3, maPeriod: 20, lockRiseRate: 10 });
assert.equal(
  calculateMovingAverage(
    Array.from({ length: 20 }, (_, index) => index + 1),
    20
  ),
  10.5
);
assert.equal(calculateMovingAverage([1, 2, 3], 20), null);
assert.equal(calculateStrategyState({ holdingRate: 20, currentHoldingAmount: 10000 }).suggestedSellAmount, 3000);
assert.equal(calculateStrategyState({ soldAmount: 3000 }).cashPerTranche, 1000);
assert.equal(calculateStrategyState({ currentNav: 1.1, lastSellNav: 1 }).locked, true);
assert.equal(calculateStrategyState({ holdingRate: 20 }).status, 'pending');
```

- [ ] **Step 2: 运行失败检查**

运行 `node app/board_calculator/strategy.check.mjs`，预期因 `strategy.mjs` 尚不存在而失败。

- [ ] **Step 3: 实现最小纯计算**

在 `strategy.mjs` 中实现以下接口。所有比例使用百分数点数，例如 `30` 表示 30%；函数只返回建议，不修改流水。

```js
export const DEFAULT_STRATEGY = Object.freeze({
  targetRate: 20,
  sellRatio: 30,
  cashTranches: 3,
  maPeriod: 20,
  lockRiseRate: 10
});

export function calculateMovingAverage(values = [], period = 20) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length >= period ? valid.slice(-period).reduce((sum, value) => sum + value, 0) / period : null;
}

export function calculateStrategyState({
  holdingRate = null,
  currentHoldingAmount = null,
  currentNav = null,
  navHistory = [],
  lastSellNav = null,
  soldAmount = 0,
  strategy = DEFAULT_STRATEGY
} = {}) {
  const rate = Number(holdingRate);
  const amount = Number(currentHoldingAmount);
  const nav = Number(currentNav);
  const sellTriggered = Number.isFinite(rate) && rate >= strategy.targetRate;
  const suggestedSellAmount = sellTriggered && Number.isFinite(amount) ? (amount * strategy.sellRatio) / 100 : null;
  const movingAverage = calculateMovingAverage(navHistory, strategy.maPeriod);
  const locked =
    Number.isFinite(nav) &&
    Number.isFinite(Number(lastSellNav)) &&
    nav >= Number(lastSellNav) * (1 + strategy.lockRiseRate / 100);
  const canSuggestBuy =
    !locked && Number.isFinite(nav) && movingAverage !== null && nav <= movingAverage && Number(soldAmount) > 0;
  return {
    status: locked
      ? 'locked'
      : canSuggestBuy
        ? 'buy'
        : sellTriggered
          ? 'sell'
          : movingAverage === null
            ? 'pending'
            : 'watch',
    sellTriggered,
    suggestedSellAmount,
    movingAverage,
    locked,
    cashPerTranche: Number(soldAmount) > 0 ? Number(soldAmount) / strategy.cashTranches : 0
  };
}
```

- [ ] **Step 4: 运行通过检查并提交**

运行 `node app/board_calculator/strategy.check.mjs`，预期输出为空且退出码为 0；随后提交：

```bash
git add app/board_calculator/strategy.mjs app/board_calculator/strategy.check.mjs
git commit -m "feat: add single fund strategy calculations"
```

### Task 2: 将默认策略和建议接入现有看板

**Files:**

- Modify: `app/board_calculator/page.jsx`

- [ ] **Step 1: 接入纯计算和按基金保存的策略状态**

导入 `DEFAULT_STRATEGY` 和 `calculateStrategyState`；在 `PreviewA` 中增加 `strategy` 状态，初始值为默认对象的字符串表现，并从现有 `board-calculator:${fundId}` 对象读取 `saved.strategy`。保存时把 `strategy` 一并写回同一基金键，不能使用跨基金的单一全局键。

- [ ] **Step 2: 添加“默认”恢复按钮**

实现 `applyDefaultStrategy`，将表单恢复为 `20`、`30`、`3`、`20`、`10` 并触发已有保存效果。按钮文字固定为“默认”，具备 `type="button"`、可见焦点和 `aria-label="恢复默认策略"`。

- [ ] **Step 3: 渲染原样式策略行和策略状态**

在现有 `stats` 后、`miniTable` 前增加紧凑策略行，字段依次为目标收益率、每次卖出、现金分份、补仓条件、踏空锁定线和“默认”按钮；沿用现有深色背景、等宽字体、边框、红绿语义色，不创建白色卡片或新的页面层级。

用以下输入调用纯计算：`holdingRate=rate`、`currentHoldingAmount=amount`、`soldAmount=rows.filter((row) => row.type === 'sell').reduce(...)`。由于当前看板没有真实净值序列，`currentNav`、`navHistory` 和 `lastSellNav` 没有值时必须显示“待更新”；只有真实有效值存在时才显示“建议补仓”或“暂停补仓”。收益率达到目标时显示参考卖出金额，但不新增流水。

- [ ] **Step 4: 保证模拟内容不回归**

检查 `page.jsx` 中不新增随机净值、模拟天数、运行模拟、单步、重置或模拟日志；保留真实流水入口和原有账户编辑逻辑。没有净值时显示 `待更新`，不把空值转成 `0.00`。

- [ ] **Step 5: 提交页面接入**

运行 `node app/board_calculator/strategy.check.mjs`，确认策略逻辑仍通过后提交：

```bash
git add app/board_calculator/page.jsx
git commit -m "feat: add default strategy controls to fund board"
```

### Task 3: 使用原有看板视觉完成策略样式

**Files:**

- Modify: `app/board_calculator/page.module.css`

- [ ] **Step 1: 添加最小 CSS 选择器**

新增 `.strategyBox`、`.strategyFields`、`.strategyField`、`.strategyInput`、`.strategyDefault`、`.strategyStatus` 及窄屏规则；复用当前 `#0b1220`、`#101b2d`、`#263752`、`#75e6c1`、`#ff8d8d` 视觉变量，不引入渐变、阴影或新组件库。

- [ ] **Step 2: 检查交互基础**

保证每个输入有可见文本标签，输入字号在窄屏不小于 16px，按钮有 `:focus-visible`，策略行在 520px 以下自然换行且页面不产生横向溢出；提示文字与现有 `riskBanner` 对齐。

- [ ] **Step 3: 提交样式**

运行 `git diff --check` 后提交：

```bash
git add app/board_calculator/page.module.css
git commit -m "style: match strategy controls to fund board"
```

### Task 4: 聚焦验证和浏览器检查

**Files:**

- Modify: `app/board_calculator/page.jsx` only when a verified browser defect is found
- Modify: `app/board_calculator/page.module.css` only when a verified layout defect is found

- [ ] **Step 1: 运行纯计算和语法检查**

运行：

```bash
node app/board_calculator/strategy.check.mjs
node --check app/board_calculator/strategy.mjs
```

预期两个命令均退出码为 0。

- [ ] **Step 2: 运行 ESLint 和 diff 检查**

运行 `npx eslint app/board_calculator/page.jsx` 和 `git diff --check`，预期无错误；不运行完整 build。

- [ ] **Step 3: 浏览器验证关键状态**

打开 `http://127.0.0.1:3000/board_calculator?fundCode=017811`，检查桌面宽度和窄屏宽度：策略行与原看板对齐；点击“默认”后五个参数恢复；修改目标收益率/卖出比例后保存并刷新仍保持；填写收益率达到 20% 时显示建议卖出金额但流水条数不变；无净值时显示待更新；切换另一个基金代码后策略参数和流水不串数据；使用 Tab 可到达输入框和默认按钮。

- [ ] **Step 4: 完成交付前检查**

确认 `git status --short` 只包含本次有意修改，保留 `.superpowers/brainstorm` 未跟踪文件不纳入提交；不要恢复 `/t-calculator`，不要运行完整构建。
