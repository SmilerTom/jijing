'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isEqual } from 'lodash';
import { storageStore } from '@/app/stores/storageStore';
import {
  calculateStrategyState,
  confirmStrategyTrade,
  createStrategyCycle,
  getStrategyQuote,
  isStrategyCycle,
  normalizeStrategy,
  observeStrategyPeak
} from './strategy.mjs';

export const notifyStrategyChange = () => window.dispatchEvent(new Event('board-strategy-change'));
const subscribe = (callback) => {
  window.addEventListener('storage', callback);
  window.addEventListener('board-strategy-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('board-strategy-change', callback);
  };
};
const readSnapshot = (key) => {
  try {
    return JSON.stringify(storageStore.getItem(key, null));
  } catch {
    return '"storage-unavailable"';
  }
};
const serverSnapshot = () => 'null';

export default function useStrategyReminder({ fundId, fund, history = [], strategy, enabled = true }) {
  const cycleKey = `board-strategy-cycle:${fundId}`;
  const cycleJson = useSyncExternalStore(subscribe, () => readSnapshot(cycleKey), serverSnapshot);
  const settingsJson = useSyncExternalStore(
    subscribe,
    () => readSnapshot(`board-calculator:${fundId}`),
    serverSnapshot
  );
  const cycle = useMemo(() => JSON.parse(cycleJson), [cycleJson]);
  const saved = useMemo(() => JSON.parse(settingsJson), [settingsJson]);
  const config = normalizeStrategy(strategy ?? saved?.strategy);
  const [now, setNow] = useState(() => new Date());
  const quote = getStrategyQuote(fund, history);
  const signalQuote = getStrategyQuote(fund, history, { preferEstimate: true, now });
  const [error, setError] = useState('');
  const saveCycle = useCallback(
    (next) => {
      try {
        storageStore.setItem(cycleKey, JSON.stringify(next));
        notifyStrategyChange();
        setError('');
        return true;
      } catch {
        setError('策略状态保存失败，未确认成交；请检查浏览器存储后重试。');
        return false;
      }
    },
    [cycleKey]
  );

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    const timer = setInterval(refreshClock, 60000);
    window.addEventListener('focus', refreshClock);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshClock);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !quote || error || saved === 'storage-unavailable') return;
    try {
      const latest = storageStore.getItem(cycleKey, null);
      if (latest === null) {
        saveCycle(createStrategyCycle(quote.nav, quote.date));
        return;
      }
      if (!isStrategyCycle(latest)) return;
      const next = observeStrategyPeak(latest, quote, history);
      if (!isEqual(next, latest)) saveCycle(next);
    } catch {
      setError('无法更新策略最高值，请检查浏览器存储。');
    }
  }, [cycle, cycleKey, enabled, error, history, quote, saveCycle, saved]);

  const observedCycle = observeStrategyPeak(cycle, quote, history);
  const strategyState = calculateStrategyState({
    currentNav: signalQuote?.nav,
    quoteDate: signalQuote?.date,
    estimated: Boolean(signalQuote?.estimated),
    quoteTime: signalQuote?.time,
    cycle: observedCycle,
    strategy: config,
    now
  });
  const confirmTrade = (status, nav) => {
    try {
      const current = observeStrategyPeak(storageStore.getItem(cycleKey, null), quote, history);
      const confirmationTime = new Date();
      const freshQuote = getStrategyQuote(fund, history, { preferEstimate: true, now: confirmationTime });
      const freshState = calculateStrategyState({
        currentNav: freshQuote?.nav,
        quoteDate: freshQuote?.date,
        estimated: Boolean(freshQuote?.estimated),
        cycle: current,
        strategy: config,
        now: confirmationTime
      });
      if (status !== 'resume' && freshState.status !== status) throw new Error('条件已变化，请根据最新提示确认。');
      const next = confirmStrategyTrade({ cycle: current, status, nav });
      if (!saveCycle(next)) return false;
      setNow(new Date());
      return true;
    } catch (failure) {
      setError(failure.message || '确认失败，请重试。');
      return false;
    }
  };

  return {
    cycle: observedCycle,
    quote,
    signalQuote,
    strategyState,
    confirmTrade,
    error:
      cycle === 'storage-unavailable' || saved === 'storage-unavailable' ? '无法读取本地策略记录，已暂停提醒。' : error
  };
}
