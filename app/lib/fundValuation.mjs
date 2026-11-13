import { isArray } from 'lodash';

export const hasFundEstimate = (fund) =>
  (fund?.gsz != null && fund.gsz !== '' && Number.isFinite(Number(fund.gsz))) ||
  (fund?.gszzl != null && fund.gszzl !== '' && Number.isFinite(Number(fund.gszzl)));

/** 交易日 9:30–15:00，含午休。这段时间里昨天的净值不能再显示成最新涨幅。 */
export const isTradingDayQuoteWindow = ({ isTradingDay, currentMinutes }) =>
  Boolean(isTradingDay) && currentMinutes >= 9 * 60 + 30 && currentMinutes <= 15 * 60;

export const shouldShowTradingSessionData = ({ dataDate, todayStr, isTradingDay, currentMinutes }) => {
  if (!dataDate) return false;
  if (!isTradingDayQuoteWindow({ isTradingDay, currentMinutes })) return true;
  return String(dataDate).startsWith(todayStr);
};

export const isMarketOpen = ({ isTradingDay, currentMinutes }) =>
  Boolean(isTradingDay) &&
  ((currentMinutes >= 9 * 60 + 30 && currentMinutes <= 11 * 60 + 30) ||
    (currentMinutes >= 13 * 60 && currentMinutes <= 15 * 60));

export const shouldAutoRefresh = ({ isTradingDay, currentMinutes, refreshOutsideTradingHours }) =>
  isMarketOpen({ isTradingDay, currentMinutes }) || refreshOutsideTradingHours === true;

export const trimValuationSeriesAtClose = (series) =>
  isArray(series)
    ? series.filter((point) => {
        const time = String(point?.time || '').slice(0, 5);
        return !/^\d{2}:\d{2}$/.test(time) || time <= '15:00';
      })
    : [];
