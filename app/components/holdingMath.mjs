export const costFromNavAndRate = (nav, rate) =>
  Number.isFinite(nav) && nav > 0 && Number.isFinite(rate) && rate > -100 ? nav / (1 + rate / 100) : NaN;

export const rateFromNavAndCost = (nav, cost) =>
  Number.isFinite(nav) && nav > 0 && Number.isFinite(cost) && cost > 0 ? ((nav - cost) / cost) * 100 : NaN;
