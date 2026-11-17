'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchFundHistory } from '@/app/api/fund';
import { buildStrategyPrompt } from '@/app/board_calculator/strategy.mjs';
import useStrategyReminder from '@/app/board_calculator/useStrategyReminder';
import * as qk from '@/app/lib/query-keys';
import { storageStore } from '@/app/stores/storageStore';

function FundPrompt({ fund, onPrompt }) {
  const { data: history = [] } = useQuery({
    queryKey: qk.fundHistory(fund.code, '3m'),
    queryFn: () => fetchFundHistory(fund.code, '3m'),
    staleTime: 10 * 60 * 1000
  });
  const reminder = useStrategyReminder({ fundId: fund.code, fund, history });
  useEffect(() => {
    const prompt = reminder.error
      ? { label: '提醒暂停', tone: 'warn' }
      : buildStrategyPrompt({ strategyState: reminder.strategyState });
    onPrompt(fund.code, prompt);
  }, [fund.code, onPrompt, reminder.error, reminder.strategyState]);
  return null;
}

export const getTrackedFunds = (funds, holdings) =>
  (funds || []).filter((fund) => {
    if (Number(holdings?.[fund.code]?.share) > 0) return true;
    try {
      return Number(storageStore.getItem(`board-calculator:${fund.code}`, {})?.amount) > 0;
    } catch {
      return false;
    }
  });

export default function StrategyTicker({ funds, holdings, navbarHeight = 0, containerPadding = 24 }) {
  const trackedFunds = useMemo(() => getTrackedFunds(funds, holdings), [funds, holdings]);
  const [prompts, setPrompts] = useState({});
  const trackedCodes = new Set(trackedFunds.map((fund) => fund.code));
  const activePrompts = Object.entries(prompts).filter(([code, prompt]) => trackedCodes.has(code) && prompt.tone);
  const updatePrompt = useCallback(
    (code, prompt) =>
      setPrompts((current) => {
        const nextPrompt = prompt.tone ? { label: prompt.label, metric: prompt.metric, tone: prompt.tone } : null;
        const previous = current[code];
        if (
          previous?.label === nextPrompt?.label &&
          previous?.metric === nextPrompt?.metric &&
          previous?.tone === nextPrompt?.tone
        )
          return current;
        const next = { ...current };
        if (nextPrompt) next[code] = nextPrompt;
        else delete next[code];
        return next;
      }),
    []
  );
  if (!trackedFunds.length) return null;

  return (
    <div
      className="strategy-ticker glass"
      style={{ marginTop: Math.max(Number(navbarHeight) - containerPadding + 8, 8) }}
    >
      {trackedFunds.map((fund) => (
        <FundPrompt key={fund.code} fund={fund} onPrompt={updatePrompt} />
      ))}
      <Activity size={16} aria-hidden="true" />
      <span className="strategy-ticker-label">策略看板</span>
      <span className="strategy-ticker-count">
        {trackedFunds.length} 只跟踪 · {activePrompts.length ? `${activePrompts.length} 项重点提示` : '暂无重点提示'}
      </span>
      {activePrompts.length ? (
        <span className="strategy-ticker-signals">
          {activePrompts.map(([code, prompt]) => {
            const fund = trackedFunds.find((item) => item.code === code);
            return (
              <span className={`strategy-ticker-signal strategy-ticker-${prompt.tone}`} key={code}>
                {fund?.name} · {prompt.label}
                {prompt.metric ? ` ${prompt.metric}` : ''}
              </span>
            );
          })}
        </span>
      ) : null}
      <Link className="strategy-ticker-link" href="/board_calculator" aria-label="打开基金策略看板">
        查看 <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
