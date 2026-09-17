import { useState, useEffect } from 'react';
import { nowInTz } from '../lib/fundHelpers';
import { isMarketOpen } from '../lib/fundValuation.mjs';
import { isTradingDay as isDateTradingDay, loadHolidaysForYear } from '../lib/tradingCalendar';

/**
 * 检测当前是否为 A 股交易日
 * - 周末直接判定为非交易日
 * - 工作日通过交易日历判断节假日，避免开盘后指数报价延迟造成误判
 * - 每 30 分钟自动重新检查一次
 * @returns {{ isTradingDay: boolean, isMarketOpenNow: boolean }}
 */
export function useTradingDay() {
  const [isTradingDay, setIsTradingDay] = useState(true); // 默认为交易日，通过接口校正
  const [isMarketOpenNow, setIsMarketOpenNow] = useState(() => {
    const now = nowInTz();
    return isMarketOpen({ isTradingDay: true, currentMinutes: now.hour() * 60 + now.minute() });
  });

  const checkTradingDay = async () => {
    const now = nowInTz();
    const isWeekend = now.day() === 0 || now.day() === 6;

    // 周末直接判定为非交易日
    if (isWeekend) {
      setIsTradingDay(false);
      return;
    }

    await loadHolidaysForYear(now.year());
    setIsTradingDay(isDateTradingDay(now));
  };

  useEffect(() => {
    checkTradingDay();
    // 每30分钟检查一次
    const timer = setInterval(checkTradingDay, 60000 * 30);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateSession = () => {
      const now = nowInTz();
      setIsMarketOpenNow(isMarketOpen({ isTradingDay, currentMinutes: now.hour() * 60 + now.minute() }));
    };
    updateSession();
    const timer = setInterval(updateSession, 30000);
    return () => clearInterval(timer);
  }, [isTradingDay]);

  return { isTradingDay, isMarketOpenNow };
}
