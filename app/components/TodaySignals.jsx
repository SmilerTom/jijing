'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchFundHistory, fetchFundPingzhongdata, fetchFundTradeRules } from '@/app/api/fund';
import { todaySignal } from '@/app/board_calculator/backtestEngine.mjs';
import {
  cleanBacktestParams,
  describeSignal,
  loadBacktestParams,
  prepareBacktestData
} from '@/app/board_calculator/backtestSignal';
import { getStrategyQuote } from '@/app/board_calculator/strategy.mjs';
import * as qk from '@/app/lib/query-keys';
import { cn } from '@/lib/utils';

const TONE_CLASS = {
  sell: 'text-[var(--danger)]',
  buy: 'text-[var(--success)]',
  warn: 'text-[var(--chart-5)]',
  calm: 'text-[var(--muted)]'
};

/** 单只基金：拉取与回测标签相同的数据，按其回测参数算今日信号并上报 */
function FundSignalProbe({ fund, share, masked, onResult }) {
  const code = fund.code;
  const historyQuery = useQuery({
    queryKey: qk.fundHistory(code, 'all'),
    queryFn: () => fetchFundHistory(code, 'all'),
    staleTime: 10 * 60 * 1000
  });
  const rulesQuery = useQuery({
    queryKey: qk.fundTradeRules(code),
    queryFn: () => fetchFundTradeRules(code),
    staleTime: 24 * 60 * 60 * 1000
  });
  const profileQuery = useQuery({
    queryKey: ['boardFundProfile', code],
    queryFn: () => fetchFundPingzhongdata(code),
    staleTime: 60 * 60 * 1000
  });
  const paramsKey = JSON.stringify(loadBacktestParams(code));
  const data = useMemo(
    () => prepareBacktestData(historyQuery.data, rulesQuery.data?.redeemRows, profileQuery.data?.fund_Rate),
    [historyQuery.data, rulesQuery.data, profileQuery.data]
  );
  const quote = useMemo(
    () => (historyQuery.data ? getStrategyQuote(fund, historyQuery.data, { preferEstimate: true }) : null),
    [fund, historyQuery.data]
  );
  const result = useMemo(() => {
    if (historyQuery.isError) return { status: 'error' };
    if (historyQuery.isPending || rulesQuery.isPending || profileQuery.isPending) return { status: 'loading' };
    if (!data || !quote) return { status: 'empty' };
    const params = cleanBacktestParams(JSON.parse(paramsKey));
    const signal = todaySignal(data, params, quote, {});
    const positionValue = !masked && share > 0 && quote.nav > 0 ? share * quote.nav : 0;
    return {
      status: 'ready',
      estimated: signal.estimated,
      outlook: signal.outlook?.horizons?.[5] || null,
      ...describeSignal(signal, params, positionValue)
    };
  }, [
    data,
    quote,
    paramsKey,
    masked,
    share,
    historyQuery.isError,
    historyQuery.isPending,
    rulesQuery.isPending,
    profileQuery.isPending
  ]);
  useEffect(() => onResult(code, result), [code, result, onResult]);
  return null;
}

/** 首页列表顶部：持仓基金按各自回测参数给出的今日交易建议 */
export default function TodaySignals({ funds, positions, masked = false, onOpenFund }) {
  const held = useMemo(
    () => (funds || []).filter((fund) => Number(positions?.[fund.code]?.share) > 0),
    [funds, positions]
  );
  const [results, setResults] = useState({});
  const onResult = useCallback(
    (code, result) => setResults((current) => (current[code] === result ? current : { ...current, [code]: result })),
    []
  );
  if (!held.length) return null;

  const rows = held.map((fund) => ({ fund, result: results[fund.code] }));
  const loading = rows.filter((row) => !row.result || row.result.status === 'loading').length;
  const ready = rows.filter((row) => row.result?.status === 'ready');
  const actions = ready.filter((row) => row.result.tone !== 'calm');
  const calm = ready.filter((row) => row.result.tone === 'calm');
  const failed = rows.filter((row) => row.result?.status === 'error' || row.result?.status === 'empty');
  const estimated = ready.some((row) => row.result.estimated);

  return (
    <section className="glass" style={{ marginTop: 10, padding: '12px 16px' }} aria-labelledby="today-signals-title">
      {held.map((fund) => (
        <FundSignalProbe
          key={fund.code}
          fund={fund}
          share={Number(positions[fund.code].share)}
          masked={masked}
          onResult={onResult}
        />
      ))}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="today-signals-title" className="text-sm font-semibold">
          今日交易建议
        </h2>
        <span className="text-xs text-[var(--muted)]" role="status">
          {loading
            ? `正在计算 ${held.length - loading}/${held.length}`
            : `${held.length} 只持仓 · ${estimated ? '按盘中估值' : '按最新净值'} · 按各基金回测参数`}
        </span>
      </div>
      {actions.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {actions.map(({ fund, result }) => (
            <li key={fund.code} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {onOpenFund ? (
                  <button
                    type="button"
                    className="text-left text-sm font-medium underline-offset-2 hover:underline"
                    onClick={() => onOpenFund(fund)}
                  >
                    {fund.name}
                  </button>
                ) : (
                  <span className="text-sm font-medium">{fund.name}</span>
                )}
                <span className={cn('text-sm font-semibold', TONE_CLASS[result.tone])}>{result.headline}</span>
              </div>
              <p className="text-xs text-[var(--muted)]">{result.reason}</p>
              {result.outlook ? (
                <p className="text-xs text-[var(--muted)]">
                  历史同类情况 5 日后平均 {result.outlook.similar.mean >= 0 ? '+' : '−'}
                  {Math.abs(result.outlook.similar.mean).toFixed(2)}%，上涨概率{' '}
                  {result.outlook.similar.upRate.toFixed(0)}% （平常 {result.outlook.base.upRate.toFixed(0)}%）
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !loading ? (
        <p className="mt-2 text-sm">今天所有持仓都不需要操作。</p>
      ) : null}
      {calm.length && actions.length ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          其余 {calm.length} 只不操作：{calm.map(({ fund }) => fund.name).join('、')}
        </p>
      ) : null}
      {failed.length ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {failed.map(({ fund }) => fund.name).join('、')} 净值历史加载失败或不足 30 天，暂无建议。
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        规则信号，假设过去都按同一回测规则操作；参数在基金详情「回测」里调整。仅供参考，不构成投资建议。
      </p>
    </section>
  );
}
