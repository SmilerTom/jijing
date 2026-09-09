export const hasFundEstimate = (fund) =>
  (fund?.gsz != null && fund.gsz !== '' && Number.isFinite(Number(fund.gsz))) ||
  (fund?.gszzl != null && fund.gszzl !== '' && Number.isFinite(Number(fund.gszzl)));

export const shouldShowTradingSessionData = ({ dataDate, todayStr, isTradingDay, currentMinutes }) => {
  if (!dataDate) return false;
  if (!isTradingDay || currentMinutes < 9 * 60 + 30) return true;
  return String(dataDate).startsWith(todayStr);
};
