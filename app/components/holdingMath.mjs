export const costFromNavAndRate = (nav, rate) =>
  Number.isFinite(nav) && nav > 0 && Number.isFinite(rate) && rate > -100 ? nav / (1 + rate / 100) : NaN;

export const rateFromNavAndCost = (nav, cost) =>
  Number.isFinite(nav) && nav > 0 && Number.isFinite(cost) && cost > 0 ? ((nav - cost) / cost) * 100 : NaN;

export const profitFromAmountAndRate = (amount, rate) => {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= -100) return NaN;
  return amount - amount / (1 + rate / 100);
};

export const rateFromAmountAndProfit = (amount, profit) => {
  if (!Number.isFinite(amount) || !Number.isFinite(profit)) return NaN;
  const principal = amount - profit;
  return principal > 0 ? (profit / principal) * 100 : NaN;
};
