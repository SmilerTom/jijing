'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { fetchFundHistory } from '@/app/api/fund';
import { buildStrategyPrompt } from '@/app/board_calculator/strategy.mjs';
import useStrategyReminder from '@/app/board_calculator/useStrategyReminder';
import * as qk from '@/app/lib/query-keys';
import { storageStore } from '@/app/stores/storageStore';
import { cn } from '@/lib/utils';

function FundPrompt({ fund }) {
  const { data: history = [] } = useQuery({
    queryKey: qk.fundHistory(fund.code, '3m'),
    queryFn: () => fetchFundHistory(fund.code, '3m'),
    staleTime: 10 * 60 * 1000
  });
  const reminder = useStrategyReminder({ fundId: fund.code, fund, history });
  const prompt = reminder.error
    ? { label: '提醒暂停', detail: reminder.error }
    : buildStrategyPrompt({ strategyState: reminder.strategyState });
  return (
    <span className="strategy-ticker-item">
      <b>{fund.name}</b>
      <strong
        className={cn(prompt.tone === 'up' && 'strategy-ticker-up', prompt.tone === 'down' && 'strategy-ticker-down')}
      >
        {prompt.label}
      </strong>
      <span>{prompt.detail}</span>
    </span>
  );
}

export default function StrategyTicker({ funds, holdings, navbarHeight = 0, containerPadding = 24 }) {
  const trackedFunds = useMemo(
    () =>
      funds.filter((fund) => {
        if (Number(holdings?.[fund.code]?.share) > 0) return true;
        try {
          return Number(storageStore.getItem(`board-calculator:${fund.code}`, {})?.amount) > 0;
        } catch {
          return false;
        }
      }),
    [funds, holdings]
  );
  if (!trackedFunds.length) return null;
  const content = (hidden = false) => (
    <div className="strategy-ticker-group" aria-hidden={hidden || undefined}>
      {trackedFunds.map((fund) => (
        <FundPrompt key={fund.code} fund={fund} />
      ))}
    </div>
  );

  return (
    <div
      className="strategy-ticker glass"
      role="status"
      aria-label="基金策略提示"
      style={{ marginTop: Math.max(Number(navbarHeight) - containerPadding + 8, 8) }}
    >
      <Activity size={16} aria-hidden="true" />
      <span className="strategy-ticker-label">策略提示</span>
      <div className="strategy-ticker-viewport">
        <div className="strategy-ticker-track">
          {content()}
          {content(true)}
        </div>
      </div>
    </div>
  );
}
