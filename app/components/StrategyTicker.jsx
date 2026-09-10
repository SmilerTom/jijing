'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { isArray, isObject } from 'lodash';
import { fetchFundHistory } from '@/app/api/fund';
import { buildStrategyPrompt, calculateStrategyState, DEFAULT_STRATEGY } from '@/app/board_calculator/strategy.mjs';
import * as qk from '@/app/lib/query-keys';
import { storageStore } from '@/app/stores/storageStore';
import { cn } from '@/lib/utils';

export default function StrategyTicker({ funds, holdings, getHoldingProfit, navbarHeight = 0, containerPadding = 24 }) {
  const trackedFunds = useMemo(
    () =>
      funds
        .map((fund) => {
          const saved = storageStore.getItem(`board-calculator:${fund.code}`, {});
          const holding = holdings?.[fund.code];
          const profit = holding ? getHoldingProfit(fund, holding, null) : null;
          const principal = Number(holding?.share) * Number(holding?.cost);
          const amount = Number.isFinite(profit?.amount) ? profit.amount : Number(saved?.amount);
          const rate =
            Number.isFinite(profit?.profitTotal) && principal > 0
              ? (profit.profitTotal / principal) * 100
              : Number(saved?.rate);
          if (!Number.isFinite(amount) || amount <= 0) return null;
          return {
            fund,
            amount,
            rate: Number.isFinite(rate) ? rate : null,
            rows: isArray(saved?.rows) ? saved.rows : [],
            strategy: isObject(saved?.strategy) ? { ...DEFAULT_STRATEGY, ...saved.strategy } : DEFAULT_STRATEGY
          };
        })
        .filter(Boolean),
    [funds, holdings, getHoldingProfit]
  );

  const historyQueries = useQueries({
    queries: trackedFunds.map(({ fund }) => ({
      queryKey: qk.fundHistory(fund.code, '3m'),
      queryFn: () => fetchFundHistory(fund.code, '3m'),
      staleTime: 10 * 60 * 1000
    }))
  });

  const prompts = trackedFunds.map(({ fund, amount, rate, rows, strategy }, index) => {
    const navHistory = (historyQueries[index]?.data || [])
      .map((item) => Number(item?.unitNetValue ?? item?.value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const storedNav = Number(fund?.dwjz);
    const currentNav = Number.isFinite(storedNav) && storedNav > 0 ? storedNav : navHistory[navHistory.length - 1];
    const soldAmount = rows.reduce(
      (total, row) => (row?.type === 'sell' ? total + (Number(row.amount) || 0) : total),
      0
    );
    const strategyState = calculateStrategyState({
      holdingRate: rate,
      currentHoldingAmount: amount,
      currentNav,
      navHistory,
      soldAmount,
      strategy
    });
    return {
      fund,
      ...buildStrategyPrompt({ strategyState, holdingRate: rate, currentHoldingAmount: amount, strategy })
    };
  });

  if (!prompts.length) return null;

  const content = (hidden = false) => (
    <div className="strategy-ticker-group" aria-hidden={hidden || undefined}>
      {prompts.map((prompt) => (
        <span className="strategy-ticker-item" key={`${hidden ? 'copy-' : ''}${prompt.fund.code}`}>
          <b>{prompt.fund.name}</b>
          <strong
            className={cn(
              prompt.tone === 'up' && 'strategy-ticker-up',
              prompt.tone === 'down' && 'strategy-ticker-down'
            )}
          >
            {prompt.label}
          </strong>
          <span>{prompt.detail}</span>
        </span>
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
