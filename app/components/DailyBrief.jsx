'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Bell, CircleCheck, Clock, Scale, TriangleAlert } from 'lucide-react';
import {
  fetchFundAnnouncements,
  fetchFundHistory,
  fetchFundHoldings,
  fetchFundSecidsBatch,
  fetchFundTradeRules,
  fetchIndexFundFlow,
  fetchRelatedSectorsBatch
} from '@/app/api/fund';
import {
  buildLots,
  findFeeSaving,
  getSettlement,
  parseRedemptionTiers,
  resolvePosition
} from '@/app/board_calculator/decision.mjs';
import { attributeMove, buildExposure, classifyAnnouncement, outflowStreak } from '@/app/board_calculator/insights.mjs';
import { classifyRisk, sectorKeyword, toNavSeries } from '@/app/board_calculator/risk.mjs';
import {
  buildStrategyPrompt,
  calculateStrategyState,
  getStrategyQuote,
  normalizeStrategy,
  observeStrategyPeak
} from '@/app/board_calculator/strategy.mjs';
import * as qk from '@/app/lib/query-keys';
import { isTradingDay, loadHolidaysForYears } from '@/app/lib/tradingCalendar';
import { storageStore } from '@/app/stores/storageStore';
import { cn } from '@/lib/utils';
import styles from './DailyBrief.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const isTrading = (date) => isTradingDay(dayjs(date));
const money = (value) =>
  `${value >= 0 ? '+' : '−'}¥${Math.abs(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
const signed = (value, digits = 2) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%`;
const percent = (value) => `${Math.round(value * 100)}%`;
const toneClass = (value) => (value > 0 ? styles.up : value < 0 ? styles.down : '');
const boardHref = (fund) =>
  `/board_calculator?fundCode=${encodeURIComponent(fund.code)}&fundName=${encodeURIComponent(fund.name)}`;

const readFundSignal = (fund, history, now) => {
  try {
    const cycle = storageStore.getItem(`board-strategy-cycle:${fund.code}`, null);
    if (!cycle) return null;
    const settings = storageStore.getItem(`board-calculator:${fund.code}`, null);
    const official = getStrategyQuote(fund, history);
    const quote = getStrategyQuote(fund, history, { preferEstimate: true, now });
    const state = calculateStrategyState({
      currentNav: quote?.nav,
      quoteDate: quote?.date,
      estimated: Boolean(quote?.estimated),
      quoteTime: quote?.time,
      cycle: observeStrategyPeak(cycle, official, history),
      strategy: normalizeStrategy(settings?.strategy),
      now
    });
    return { state, prompt: buildStrategyPrompt({ strategyState: state }), risk: classifyRisk(state) };
  } catch {
    return null;
  }
};

function FeedItem({ item, masked }) {
  const body = (
    <>
      <span className={styles.itemTitle}>{item.title}</span>
      <span className={styles.itemMeta}>
        {item.tag ? <span className={cn(styles.tag, styles[`tag_${item.level}`])}>{item.tag}</span> : null}
        {masked ? item.metaMasked || item.meta : item.meta}
      </span>
    </>
  );
  return (
    <li className={styles.item}>
      {item.external ? (
        <a href={item.href} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <Link href={item.href}>{body}</Link>
      )}
    </li>
  );
}

function ExposureView({ exposure, masked }) {
  const top = exposure.sectors[0];
  return (
    <details className={styles.fold}>
      <summary>
        <b>组合穿透</b>
        <span className={styles.muted}>
          {exposure.concentrated ? `${percent(top.share)} 的资金集中在${top.name}` : `${exposure.fundCount} 只基金`}
        </span>
      </summary>
      <ul className={styles.bars}>
        {exposure.sectors.slice(0, 6).map((sector) => (
          <li key={sector.name}>
            <div className={styles.barHead}>
              <span>
                {sector.name} <span className={styles.muted}>{sector.funds.length} 只</span>
              </span>
              <span>{percent(sector.share)}</span>
            </div>
            <div className={styles.bar}>
              <i style={{ width: percent(sector.share) }} />
            </div>
          </li>
        ))}
      </ul>
      {exposure.overlaps.length ? (
        <>
          <p className={styles.subhead}>多只基金同时重仓</p>
          <ul className={styles.overlaps}>
            {exposure.overlaps.map((stock) => (
              <li key={stock.code || stock.name}>
                <span>
                  {stock.name} <span className={styles.muted}>{stock.funds.length} 只基金</span>
                </span>
                <span>{masked ? percent(stock.share) : `${percent(stock.share)} · ¥${Math.round(stock.value)}`}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.muted}>已披露的重仓股里，没有多只基金同时持有的股票。</p>
      )}
      <p className={styles.muted}>
        重仓股只覆盖组合的 {percent(exposure.disclosedShare)}，来自基金定期报告，有滞后，实际持仓可能已变化。
      </p>
    </details>
  );
}

export default function DailyBrief({ funds, holdings, groupHoldings, getHoldingProfit, masked = false }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const positions = useMemo(
    () => (funds || []).filter((fund) => resolvePosition(fund.code, holdings, groupHoldings)),
    [funds, holdings, groupHoldings]
  );
  const codes = positions.map((fund) => fund.code);
  const codesKey = codes.join(',');
  const year = now.getFullYear();
  useQuery({
    queryKey: ['tradingCalendarYears', year],
    queryFn: async () => {
      await loadHolidaysForYears([year, year + 1]);
      return true;
    },
    enabled: codes.length > 0,
    staleTime: DAY_MS
  });
  const historyQueries = useQueries({
    queries: positions.map((fund) => ({
      queryKey: qk.fundHistory(fund.code, '3m'),
      queryFn: () => fetchFundHistory(fund.code, '3m'),
      staleTime: 10 * 60 * 1000
    }))
  });
  const noticeQueries = useQueries({
    queries: positions.map((fund) => ({
      queryKey: qk.fundAnnouncements(fund.code),
      queryFn: () => fetchFundAnnouncements(fund.code),
      staleTime: 30 * 60 * 1000
    }))
  });
  const stockQueries = useQueries({
    queries: positions.map((fund) => ({
      queryKey: ['boardFundHoldings', fund.code],
      queryFn: () => fetchFundHoldings(fund.code),
      staleTime: 5 * 60 * 1000
    }))
  });
  const ruleQueries = useQueries({
    queries: positions.map((fund) => ({
      queryKey: qk.fundTradeRules(fund.code),
      queryFn: () => fetchFundTradeRules(fund.code),
      staleTime: DAY_MS
    }))
  });
  const sectorQuery = useQuery({
    queryKey: ['briefSectors', codesKey],
    queryFn: async () => {
      const labels = await fetchRelatedSectorsBatch(codes);
      const unique = [...new Set(Object.values(labels).filter(Boolean))];
      const secids = unique.length ? await fetchFundSecidsBatch(unique) : {};
      return { labels, secids };
    },
    enabled: codes.length > 0,
    staleTime: DAY_MS
  });
  const sectorIds = [...new Set(Object.values(sectorQuery.data?.secids || {}).filter(Boolean))];
  const flowQueries = useQueries({
    queries: sectorIds.map((secid) => ({
      queryKey: qk.indexFundFlow(secid),
      queryFn: () => fetchIndexFundFlow(secid),
      staleTime: 5 * 60 * 1000
    }))
  });

  if (!positions.length) return null;

  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const settlement = getSettlement({ now, isTrading });
  const sectorOf = (code) => sectorQuery.data?.labels?.[code] || '';
  const items = [];
  const rows = positions.map((fund, index) => {
    const position = resolvePosition(fund.code, holdings, groupHoldings);
    const bookProfits = position.books.map((book) => getHoldingProfit?.(fund, book.holding, book.groupId) || null);
    const amount = bookProfits.reduce((sum, profit) => sum + (Number.isFinite(profit?.amount) ? profit.amount : 0), 0);
    const todayProfits = bookProfits.map((profit) => profit?.profitToday).filter(Number.isFinite);
    const history = historyQueries[index].data || [];
    const notices = noticeQueries[index].data || [];
    const stockData = stockQueries[index].data;
    const rules = ruleQueries[index].data;
    const signal = readFundSignal(fund, history, now);
    const navs = toNavSeries(history);
    const estimated = Number(fund.gsz) > 0 && String(fund.gztime || '').startsWith(today) && fund.jzrq !== today;

    if (signal && ['stop', 'sell', 'buy'].includes(signal.state.status)) {
      items.push({
        id: `${fund.code}-signal`,
        level: 'action',
        tag: '策略提醒',
        title: `${fund.name}：${signal.prompt.label}`,
        meta: signal.prompt.metric || '',
        href: boardHref(fund)
      });
    } else if (signal?.risk.level === 'mid') {
      items.push({
        id: `${fund.code}-near`,
        level: 'action',
        tag: '接近止损',
        title: `${fund.name}：距你设定的止损线还差 ${signal.risk.remaining.toFixed(2)}%`,
        meta: `已回落 ${signal.risk.drawdown.toFixed(1)}%`,
        href: boardHref(fund)
      });
    }

    notices.forEach((notice) => {
      const { level, tag } = classifyAnnouncement(notice.title, notice.date, today);
      const age = dayjs(today).diff(dayjs(notice.date.slice(0, 10)), 'day');
      if (age > 30) return;
      items.push({
        id: `${fund.code}-${notice.id}`,
        level,
        tag,
        title: notice.title,
        meta: `${fund.name} · ${notice.date.slice(5, 10)}`,
        href: notice.url,
        external: true,
        date: notice.date
      });
    });

    const fundPct = estimated
      ? Number(fund.gszzl)
      : navs.length >= 2
        ? (navs.at(-1).nav / navs.at(-2).nav - 1) * 100
        : NaN;
    const comparable = estimated || fund.jzrq === today || !isTrading(today);
    const attribution = comparable
      ? attributeMove({ fundPct, stocks: stockData?.holdings || [], reportDate: stockData?.holdingsReportDate })
      : null;
    const leader = attribution?.top[0];
    if (leader && Math.abs(leader.contribution) >= 0.3) {
      items.push({
        id: `${fund.code}-stock-${leader.name}`,
        level: 'judge',
        tag: '重仓股',
        title: `${leader.name} ${signed(leader.change)}，约${leader.contribution >= 0 ? '拉动' : '拖累'} ${fund.name} ${Math.abs(leader.contribution).toFixed(2)}%`,
        meta: `占基金 ${leader.weight}%${attribution.reportDate ? `（截至 ${attribution.reportDate}）` : ''}`,
        href: boardHref(fund)
      });
    }

    const tiers = parseRedemptionTiers(rules?.redeemRows);
    const nav = Number(fund.gsz) > 0 && estimated ? Number(fund.gsz) : navs.at(-1)?.nav;
    if (tiers && nav > 0) {
      const { lots, unknownShare } = buildLots({
        transactions: storageStore.getItem('transactions', {})?.[fund.code],
        share: position.share,
        confirmDays: rules.buyConfirmDays ?? 1,
        isTrading,
        groupIds: position.groupIds
      });
      const feeSettlement = getSettlement({
        now,
        confirmDays: rules.confirmDays ?? 1,
        arrivalDays: rules.arrivalDays,
        isTrading
      });
      const saving = findFeeSaving({
        lots,
        unknownShare,
        tiers,
        share: position.share,
        nav,
        settlement: feeSettlement,
        confirmDays: rules.confirmDays ?? 1,
        isTrading
      });
      if (saving && dayjs(saving.tradeDate).diff(dayjs(today), 'day') <= 7) {
        items.push({
          id: `${fund.code}-fee`,
          level: 'judge',
          tag: '费率',
          title: `${fund.name}：${saving.tradeDate.slice(5)} 起全部卖出的赎回费会降低`,
          meta: `预计少 ¥${saving.saving.toFixed(2)}`,
          metaMasked: '可少付部分赎回费',
          href: boardHref(fund)
        });
      }
    }

    return {
      fund,
      amount,
      profitToday: todayProfits.length ? todayProfits.reduce((sum, value) => sum + value, 0) : null,
      estimated,
      sector: sectorKeyword(sectorOf(fund.code)),
      stocks: stockData?.holdings || []
    };
  });

  sectorIds.forEach((secid, index) => {
    const streak = outflowStreak(flowQueries[index]?.data || []);
    if (streak.days < 3) return;
    const label = Object.entries(sectorQuery.data?.secids || {}).find(([, value]) => value === secid)?.[0] || '';
    const affected = rows.filter((row) => sectorOf(row.fund.code) === label);
    if (!affected.length) return;
    items.push({
      id: `flow-${secid}`,
      level: 'judge',
      tag: '资金',
      title: `${sectorKeyword(label)}主力资金连续 ${streak.days >= (flowQueries[index]?.data || []).length ? `${streak.days} 日以上` : `${streak.days} 日`}净流出，累计 ${Math.abs(streak.total / 1e8).toFixed(1)} 亿`,
      meta: `影响你 ${affected.length} 只基金`,
      href: boardHref(affected[0].fund)
    });
  });

  const profits = rows.filter((row) => row.profitToday !== null);
  const totalToday = profits.reduce((sum, row) => sum + row.profitToday, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const base = totalAmount - totalToday;
  const totalPct = base > 0 ? (totalToday / base) * 100 : null;
  const anyEstimated = profits.some((row) => row.estimated);
  const driver = [...profits]
    .filter((row) => Math.sign(row.profitToday) === Math.sign(totalToday) && row.profitToday !== 0)
    .sort((a, b) => Math.abs(b.profitToday) - Math.abs(a.profitToday))[0];
  const exposure = buildExposure(
    rows.map((row) => ({ name: row.fund.name, value: row.amount, sector: row.sector, stocks: row.stocks }))
  );
  const topSector = exposure?.concentrated ? exposure.sectors[0] : null;
  const actionItems = items.filter((item) => item.level === 'action');
  const judgeItems = items
    .filter((item) => item.level === 'judge')
    .sort((a, b) => Boolean(a.date) - Boolean(b.date) || String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 6);
  const generalItems = items.filter((item) => item.level === 'general').slice(0, 5);
  const loading = noticeQueries.some((query) => query.isPending) || historyQueries.some((query) => query.isPending);
  const failed = noticeQueries.filter((query) => query.isError).length;

  return (
    <section className={styles.brief} aria-label="今日简报">
      <div className={styles.head}>
        <b>今日简报</b>
        <span className={styles.muted}>{anyEstimated ? '含盘中估值' : '按最新净值'}</span>
      </div>
      {profits.length ? (
        <div className={styles.total}>
          <b className={cn(styles.totalValue, toneClass(totalToday))}>{masked ? '****' : money(totalToday)}</b>
          {totalPct !== null ? <span className={toneClass(totalToday)}>{signed(totalPct)}</span> : null}
        </div>
      ) : (
        <p className={styles.muted}>今日盈亏暂时无法计算，请确认持仓成本和净值。</p>
      )}
      <p className={styles.summary}>
        {driver ? `主要来自${driver.fund.name}${masked ? '' : `（${money(driver.profitToday)}）`}。` : ''}
        {topSector ? `你 ${percent(topSector.share)} 的资金集中在${topSector.name}。` : ''}
      </p>
      <div className={styles.status}>
        {actionItems.length ? (
          <span className={styles.statusAction}>
            <Bell size={13} aria-hidden="true" /> {actionItems.length} 件需要关注
          </span>
        ) : loading ? (
          <span className={styles.muted}>正在检查持仓…</span>
        ) : (
          <span className={styles.statusCalm}>
            <CircleCheck size={13} aria-hidden="true" /> 今天没有需要处理的事项
          </span>
        )}
        {actionItems.length && settlement.beforeCutoff ? (
          <span className={styles.muted}>
            <Clock size={13} aria-hidden="true" /> 15:00 前提交按今日净值成交
          </span>
        ) : null}
      </div>

      {actionItems.length ? (
        <>
          <p className={cn(styles.tier, styles.tierAction)}>
            <TriangleAlert size={14} aria-hidden="true" /> 需要关注
          </p>
          <ul className={styles.feed}>
            {actionItems.map((item) => (
              <FeedItem key={item.id} item={item} masked={masked} />
            ))}
          </ul>
        </>
      ) : null}
      {judgeItems.length ? (
        <details className={styles.fold} open={!actionItems.length}>
          <summary>
            <Scale size={14} aria-hidden="true" />
            <b>影响判断</b>
            <span className={styles.muted}>{judgeItems.length} 条</span>
          </summary>
          <ul className={styles.feed}>
            {judgeItems.map((item) => (
              <FeedItem key={item.id} item={item} masked={masked} />
            ))}
          </ul>
        </details>
      ) : null}
      {generalItems.length ? (
        <details className={styles.fold}>
          <summary>
            <b>一般公告</b>
            <span className={styles.muted}>{generalItems.length} 条</span>
          </summary>
          <ul className={styles.feed}>
            {generalItems.map((item) => (
              <FeedItem key={item.id} item={item} masked={masked} />
            ))}
          </ul>
        </details>
      ) : null}
      {exposure ? <ExposureView exposure={exposure} masked={masked} /> : null}
      <p className={styles.muted}>
        {failed ? `${failed} 只基金的公告暂时没拿到。` : ''}
        公告分级按标题规则判断，归因是估算。仅作提醒，买卖由你决定，不构成投资建议。
      </p>
    </section>
  );
}
