export function navChange(nav, base) {
  return Number.isFinite(nav) && nav > 0 && Number.isFinite(base) && base > 0 ? (nav / base - 1) * 100 : null;
}

export function triggerDistance(nav, target, buying = false) {
  const change = navChange(target, nav);
  return change === null ? null : Math.max(0, buying ? -change : change);
}

export function bandPercentageSeries(series) {
  return series.map((row) => ({
    ...row,
    nav: navChange(row.nav, row.ma),
    ma: navChange(row.ma, row.ma),
    upper: navChange(row.upper, row.ma),
    lower: navChange(row.lower, row.ma)
  }));
}
