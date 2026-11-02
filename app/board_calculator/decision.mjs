import lodash from 'lodash';

const { isArray, isString } = lodash;

const EPSILON = 1e-6;
const CUTOFF_MINUTES = 15 * 60;
const UNIT_DAYS = { 天: 1, 日: 1, 个月: 30, 月: 30, 年: 365 };
const DURATION = '(\\d+(?:\\.\\d+)?)\\s*(天|日|个月|月|年)';

const toDays = (value, unit) => Number(value) * UNIT_DAYS[unit];
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const addDays = (date, days) => new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
const weekdayOnly = (date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

export const addTradingDays = (date, count, isTrading = weekdayOnly) => {
  let current = date;
  let remaining = count;
  for (let guard = 0; remaining > 0 && guard < 400; guard += 1) {
    current = addDays(current, 1);
    if (isTrading(current)) remaining -= 1;
  }
  return current;
};

/** 解析东方财富赎回费档位，如“7天 ≤ 持有期限 < 30天”；任一档无法识别时返回 null，不猜费率 */
export function parseRedemptionTiers(rows) {
  if (!isArray(rows) || !rows.length) return null;
  const tiers = rows.map((row) => {
    const rate = Number.parseFloat(row?.rate);
    if (!Number.isFinite(rate) || rate < 0) return null;
    const time = String(row?.time || '').trim();
    const lower =
      time.match(new RegExp(`${DURATION}\\s*(?:≤|<=)`)) || time.match(new RegExp(`(?:≥|>=)\\s*${DURATION}`));
    const upper = time.match(new RegExp(`<\\s*${DURATION}`));
    if (time && !lower && !upper) return null;
    return {
      minDays: lower ? toDays(lower[1], lower[2]) : 0,
      maxDays: upper ? toDays(upper[1], upper[2]) : Infinity,
      rate: rate / 100
    };
  });
  return tiers.every(Boolean) ? tiers.sort((a, b) => a.minDays - b.minDays) : null;
}

const rateForDays = (tiers, days) => tiers?.find((tier) => days >= tier.minDays && days < tier.maxDays)?.rate;

const validShare = (holding) => Number.isFinite(Number(holding?.share)) && Number(holding.share) > 0;

/** 合并全局和各分组账本中某只基金的持仓；成本只按有成本的份额加权 */
export function resolvePosition(code, holdings, groupHoldings) {
  const books = [];
  if (validShare(holdings?.[code])) books.push({ holding: holdings[code], groupId: null });
  Object.entries(groupHoldings || {}).forEach(([groupId, bucket]) => {
    if (validShare(bucket?.[code])) books.push({ holding: bucket[code], groupId });
  });
  if (!books.length) return null;
  const share = books.reduce((sum, book) => sum + Number(book.holding.share), 0);
  const costed = books.filter((book) => Number(book.holding.cost) > 0);
  const costedShare = costed.reduce((sum, book) => sum + Number(book.holding.share), 0);
  const cost =
    costed.length === books.length
      ? costed.reduce((sum, book) => sum + Number(book.holding.share) * Number(book.holding.cost), 0) / costedShare
      : null;
  return { share, cost, books, groupIds: books.map((book) => book.groupId).filter(Boolean) };
}

/** 全局和所有分组中持有的基金，供首页提示使用 */
export function mergeHeldPositions(holdings, groupHoldings) {
  const codes = new Set([
    ...Object.keys(holdings || {}),
    ...Object.values(groupHoldings || {}).flatMap((bucket) => Object.keys(bucket || {}))
  ]);
  const merged = {};
  codes.forEach((code) => {
    const position = resolvePosition(code, holdings, groupHoldings);
    if (position) merged[code] = position;
  });
  return merged;
}

/**
 * 用全局和指定分组的交易记录按先进先出还原现存批次。
 * 持仓多于记录的部分没有买入日期，单列为 unknownShare，不假设持有天数。
 */
export function buildLots({
  transactions = [],
  share = 0,
  confirmDays = 1,
  isTrading = weekdayOnly,
  groupIds = []
} = {}) {
  const lots = [];
  (isArray(transactions) ? transactions : [])
    .filter(
      (item) =>
        item &&
        (!item.groupId || groupIds.includes(item.groupId)) &&
        !item.isHistoryOnly &&
        Number(item.share) > 0 &&
        isString(item.date) &&
        /^\d{4}-\d{2}-\d{2}/.test(item.date)
    )
    .map((item, index) => ({ ...item, date: item.date.slice(0, 10), index }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timestamp || 0) - (b.timestamp || 0) || a.index - b.index)
    .forEach((item) => {
      if (item.type === 'buy') {
        let tradeDate = item.date;
        if (item.isAfter3pm || !isTrading(tradeDate)) tradeDate = addTradingDays(tradeDate, 1, isTrading);
        lots.push({ share: Number(item.share), confirmDate: addTradingDays(tradeDate, confirmDays, isTrading) });
      } else if (item.type === 'sell') {
        let remaining = Number(item.share);
        while (remaining > EPSILON && lots.length) {
          const used = Math.min(lots[0].share, remaining);
          lots[0].share -= used;
          remaining -= used;
          if (lots[0].share <= EPSILON) lots.shift();
        }
      }
    });
  let excess = lots.reduce((sum, lot) => sum + lot.share, 0) - share;
  while (excess > EPSILON && lots.length) {
    const used = Math.min(lots[0].share, excess);
    lots[0].share -= used;
    excess -= used;
    if (lots[0].share <= EPSILON) lots.shift();
  }
  return { lots, unknownShare: Math.max(0, -excess > EPSILON ? -excess : 0) };
}

/** 按先进先出估算卖出 sellShare 的赎回费；有无记录份额时 feeIsMinimum 为真 */
export function estimateFee({ lots = [], unknownShare = 0, tiers, sellShare, nav, sellConfirmDate }) {
  if (!tiers) return { fee: null, feeIsMinimum: false };
  let remaining = sellShare;
  const unknownSold = Math.min(unknownShare, remaining);
  remaining -= unknownSold;
  let fee = 0;
  for (const lot of lots) {
    if (remaining <= EPSILON) break;
    const sold = Math.min(lot.share, remaining);
    const rate = rateForDays(tiers, dayNumber(sellConfirmDate) - dayNumber(lot.confirmDate));
    if (rate === undefined) return { fee: null, feeIsMinimum: false };
    fee += sold * nav * rate;
    remaining -= sold;
  }
  const allFree = tiers.every((tier) => tier.rate === 0);
  return { fee, feeIsMinimum: unknownSold > EPSILON && !allFree };
}

/** 15:00 截止和到账时间，一律按北京时间计算 */
export function getSettlement({ now = new Date(), confirmDays = 1, arrivalDays = null, isTrading = weekdayOnly } = {}) {
  const beijing = new Date(now.getTime() + 8 * 3600000);
  const today = beijing.toISOString().slice(0, 10);
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const beforeCutoff = isTrading(today) && minutes < CUTOFF_MINUTES;
  const tradeDate = beforeCutoff ? today : addTradingDays(today, 1, isTrading);
  return {
    today,
    tradeDate,
    beforeCutoff,
    minutesLeft: beforeCutoff ? CUTOFF_MINUTES - minutes : null,
    confirmDate: addTradingDays(tradeDate, confirmDays, isTrading),
    arrivalDate: arrivalDays > 0 ? addTradingDays(tradeDate, arrivalDays, isTrading) : null
  };
}

/** 某个卖出比例的代价和后续涨跌影响 */
export function simulateSale({ ratio, share, cost, nav, lots, unknownShare, tiers, sellConfirmDate, move = 0.05 }) {
  const sellShare = share * ratio;
  const remainingValue = (share - sellShare) * nav;
  const { fee, feeIsMinimum } = estimateFee({ lots, unknownShare, tiers, sellShare, nav, sellConfirmDate });
  const gross = sellShare * nav;
  return {
    ratio,
    sellShare,
    gross,
    fee: ratio === 0 ? 0 : fee,
    feeIsMinimum: ratio > 0 && feeIsMinimum,
    netReceived: fee === null ? null : gross - fee,
    realizedProfit: cost > 0 ? (nav - cost) * sellShare - (fee || 0) : null,
    downside: -remainingValue * move,
    upside: remainingValue * move
  };
}

/** 全部卖出时，再等多久能跨过下一个费率档，能省多少 */
export function findFeeSaving({
  lots,
  unknownShare,
  tiers,
  share,
  nav,
  settlement,
  confirmDays = 1,
  isTrading = weekdayOnly
}) {
  if (!tiers) return null;
  const params = { lots, unknownShare, tiers, sellShare: share, nav };
  const current = estimateFee({ ...params, sellConfirmDate: settlement.confirmDate }).fee;
  if (!(current > 0)) return null;
  const targets = lots
    .map((lot) => {
      const days = dayNumber(settlement.confirmDate) - dayNumber(lot.confirmDate);
      const tier = tiers.find((item) => days >= item.minDays && days < item.maxDays);
      return tier?.rate > 0 && Number.isFinite(tier.maxDays) ? addDays(lot.confirmDate, tier.maxDays) : null;
    })
    .filter(Boolean)
    .sort();
  if (!targets.length) return null;
  let tradeDate = settlement.tradeDate;
  let confirmDate = settlement.confirmDate;
  while (confirmDate < targets[0]) {
    tradeDate = addTradingDays(tradeDate, 1, isTrading);
    confirmDate = addTradingDays(tradeDate, confirmDays, isTrading);
  }
  const later = estimateFee({ ...params, sellConfirmDate: confirmDate }).fee;
  const saving = current - later;
  return saving > 0.005 ? { tradeDate, saving } : null;
}
