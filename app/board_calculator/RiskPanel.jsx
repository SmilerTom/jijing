'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Building2, CalendarDays, ChartLine, Coins, Scale, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import {
  fetchEastmoneySectorQuotesBatch,
  fetchFundAnnouncements,
  fetchFundHoldings,
  fetchFundSecidsBatch,
  fetchIndexFundFlow,
  fetchIndexKlines,
  fetchRelatedSectorsBatch,
  fetchSectorNews
} from '@/app/api/fund';
import * as qk from '@/app/lib/query-keys';
import { isTradingDay } from '@/app/lib/tradingCalendar';
import { cn } from '@/lib/utils';
import {
  analyzeSectorTrend,
  buildRiskAlerts,
  classifyRisk,
  drawdownSeries,
  forecastFund,
  sectorKeyword,
  toNavSeries
} from './risk.mjs';
import { attributeMove, classifyAnnouncement, evaluateDecision, summarizeSignals } from './insights.mjs';
import Tabs from './Tabs';
import NewsReader from '@/app/components/NewsReader';
import styles from './page.module.css';

const BENCHMARK_SECID = '1.000300';
const EVIDENCE_ICON = { ma: ChartLine, momentum: TrendingDown, days: CalendarDays, flow: Coins, relative: Scale };
const ALERT_ICON = { trend: TrendingDown, speed: Zap, sector: Building2 };
const STANCE_LABEL = { bull: '偏多', bear: '偏空', neutral: '中性' };
const signed = (value, digits = 2) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%` : '--';
const percent = (value) => `${Math.round(value * 100)}%`;
const toneClass = (value) => (value > 0 ? styles.up : value < 0 ? styles.down : '');

function DrawdownChart({ points, stopLine, level }) {
  if (points.length < 2) return null;
  const top = Math.max(stopLine * 1.1, ...points.map((item) => item.drawdown), 1);
  const y = (value) => 6 + (value / top) * 56;
  const x = (index) => (index / (points.length - 1)) * 600;
  const latest = points.at(-1).drawdown;
  return (
    <svg
      className={styles.riskSpark}
      viewBox="0 0 600 70"
      preserveAspectRatio="none"
      role="img"
      aria-label={`近 ${points.length} 个交易日回落幅度，最新 ${latest.toFixed(2)}%，止损线 ${stopLine}%`}
    >
      <rect x="0" y={y(stopLine)} width="600" height={70 - y(stopLine)} className={styles.riskSparkZone} />
      <line x1="0" x2="600" y1={y(stopLine)} y2={y(stopLine)} className={styles.riskSparkStop} />
      <polyline
        className={cn(styles.riskSparkLine, styles[`riskTone_${level}`])}
        points={points.map((item, index) => `${x(index)},${y(item.drawdown)}`).join(' ')}
      />
    </svg>
  );
}

function ForecastChart({ navs, forecast, stopNav }) {
  const past = navs.slice(-10).map((item) => item.nav);
  const toNav = (change) => forecast.startNav * (1 + change / 100);
  const values = [
    ...past,
    forecast.startNav,
    ...forecast.bands.flatMap((band) => [toNav(band.p10), toNav(band.p90)]),
    ...(stopNav > 0 ? [stopNav] : [])
  ];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.01;
  const y = (nav) => 12 + ((max - nav) / span) * 150;
  const pastX = (index) => (past.length > 1 ? (index / (past.length - 1)) * 360 : 360);
  const futureX = (day) => 360 + ((day + 1) / forecast.days) * 236;
  const band = (low, high) =>
    [
      `360,${y(forecast.startNav)}`,
      ...forecast.bands.map((item, day) => `${futureX(day)},${y(toNav(item[high]))}`),
      ...forecast.bands.map((item, day) => `${futureX(day)},${y(toNav(item[low]))}`).reverse()
    ].join(' ');
  const last = forecast.bands.at(-1);
  return (
    <svg
      className={styles.forecastChart}
      viewBox="0 0 600 176"
      role="img"
      aria-label={`以预测起点为 0% 的过去 ${past.length} 日涨跌幅和未来 ${forecast.days} 日预测区间：中位 ${signed(forecast.median)}，80% 区间 ${signed(forecast.low)} 至 ${signed(forecast.high)}`}
    >
      {stopNav > 0 ? (
        <>
          <line x1="0" x2="600" y1={y(stopNav)} y2={y(stopNav)} className={styles.riskSparkStop} />
          <text x="4" y={y(stopNav) - 4} className={styles.forecastStopText}>
            止损线 {signed((stopNav / forecast.startNav - 1) * 100)}
          </text>
        </>
      ) : null}
      <line x1="360" x2="360" y1="4" y2="172" className={styles.forecastDivider} />
      <text x="354" y="14" textAnchor="end" className={styles.forecastAxis}>
        当前 0%
      </text>
      <text x="366" y="14" className={styles.forecastAxis}>
        预测
      </text>
      <polygon points={band('p10', 'p90')} className={styles.forecastBandOuter} />
      <polygon points={band('p25', 'p75')} className={styles.forecastBandInner} />
      <polyline
        points={past.map((nav, index) => `${pastX(index)},${y(nav)}`).join(' ')}
        className={styles.forecastPast}
      />
      <polyline
        points={[
          `360,${y(forecast.startNav)}`,
          ...forecast.bands.map((item, day) => `${futureX(day)},${y(toNav(item.p50))}`)
        ].join(' ')}
        className={styles.forecastMedian}
      />
      <circle cx="360" cy={y(forecast.startNav)} r="4" className={styles.forecastNow} />
      <text x="598" y={y(toNav(last.p90)) - 3} textAnchor="end" className={styles.forecastAxis}>
        {signed(last.p90, 1)}
      </text>
      <text x="598" y={y(toNav(last.p50)) - 3} textAnchor="end" className={styles.forecastMedianText}>
        {signed(last.p50, 1)}
      </text>
      <text x="598" y={y(toNav(last.p10)) + 12} textAnchor="end" className={styles.forecastAxis}>
        {signed(last.p10, 1)}
      </text>
    </svg>
  );
}

const ANALYSIS_TABS = [
  ['trend', '板块走势'],
  ['range', '波动范围'],
  ['news', '资讯']
];

const SIGNAL_LABEL = { stop: '触发止损线', sell: '达到卖出线', buy: '达到买回线' };

function AttributionLine({ attribution }) {
  return (
    <div className={styles.attribution}>
      <p>
        估算：重仓股贡献 <b className={toneClass(attribution.contribution)}>{signed(attribution.contribution)}</b>
        ，其他持仓和误差 <b className={toneClass(attribution.other)}>{signed(attribution.other)}</b>
      </p>
      <p className={styles.riskMuted}>
        影响最大：
        {attribution.top.map((stock, index) => (
          <span key={stock.code || stock.name}>
            {index ? '、' : ''}
            {stock.name} <span className={toneClass(stock.contribution)}>{signed(stock.contribution)}</span>
          </span>
        ))}
        。按前十大持仓占比 {attribution.coveredWeight.toFixed(0)}% 估算
        {attribution.reportDate ? `，持仓截至 ${attribution.reportDate}` : ''}，实际持仓可能已变化。
      </p>
    </div>
  );
}

export function SignalReview({ log, latestNav }) {
  const summary = summarizeSignals(log);
  if (!summary.total && !summary.decisions.length) {
    return <p className={styles.riskMuted}>还没有记录。触发提示或记录决定后，这里会对比之后 5 个交易日的走势。</p>;
  }
  return (
    <>
      <p className={styles.reviewSummary}>
        共 {summary.total} 次提示，{summary.settled} 次已满 5 个交易日
        {summary.settled ? `，其中 ${summary.hits} 次之后的走势与提示方向一致` : ''}。
        {summary.settled && !summary.enoughSamples ? '样本还太少，不能据此判断提示是否可靠。' : ''}
      </p>
      <ul className={styles.reviewList}>
        {summary.recent.map((signal) => (
          <li key={`${signal.status}-${signal.date}`}>
            <span>
              {signal.date.slice(5)} {SIGNAL_LABEL[signal.status]}
            </span>
            {signal.outcome ? (
              <span className={toneClass(signal.outcome.change)}>5 日后 {signed(signal.outcome.change)}</span>
            ) : (
              <span className={styles.riskMuted}>等待结果</span>
            )}
          </li>
        ))}
        {summary.decisions.map((decision) => {
          const result = evaluateDecision(decision, latestNav);
          return (
            <li key={decision.at}>
              <span>
                {decision.date.slice(5)} 决定
                {decision.ratio > 0 ? `卖出 ${Math.round(decision.ratio * 100)}%` : '继续持有'}
              </span>
              {result ? (
                <span className={toneClass(result.change)}>之后净值 {signed(result.change)}</span>
              ) : (
                <span className={styles.riskMuted}>等待净值</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function NewsList({ query, emptyText, onRead, showNoticeLevel = false, today = '' }) {
  if (query.isPending) return <p className={styles.riskMuted}>正在加载资讯…</p>;
  if (query.isError)
    return (
      <p className={styles.riskMuted} role="status">
        资讯加载失败。
        <button type="button" className={styles.riskLink} onClick={() => query.refetch()}>
          重试
        </button>
      </p>
    );
  if (!query.data?.length) return <p className={styles.riskMuted}>{emptyText}</p>;
  return (
    <ul className={styles.newsList}>
      {query.data.map((item) => {
        const notice = classifyAnnouncement(item.title, item.date, today);
        return (
          <li key={item.id}>
            <button type="button" className={styles.newsTitle} onClick={() => onRead(item)}>
              {item.title}
            </button>
            <span className={styles.riskMuted}>
              {showNoticeLevel && notice.level !== 'general' ? (
                <span className={cn(styles.stanceTag, styles[`notice_${notice.level}`])}>{notice.tag}</span>
              ) : null}{' '}
              {item.source} · {item.date.slice(5, 16)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function MarketAnalysis({ fundId, fund, history, reminder, strategy, active }) {
  const [newsTab, setNewsTab] = useState('sector');
  const [tab, setTab] = useState('trend');
  const [readingNews, setReadingNews] = useState(null);
  const state = reminder.strategyState || {};
  const risk = classifyRisk(state);
  const bandMode = strategy?.mode === 'band';
  // 均线带模式不设止损线，不能沿用涨跌滚仓的回落参数
  const stopLine = bandMode ? NaN : Number(strategy?.stopDrawdown);
  const peakNav = Number(reminder.cycle?.peakNav);
  const stopNav =
    strategy?.mode !== 'band' && peakNav > 0 && stopLine > 0 && stopLine < 100 ? peakNav * (1 - stopLine / 100) : null;

  const officialNavs = toNavSeries(history);
  const quote = reminder.signalQuote;
  const navs =
    quote?.estimated && quote.date > (officialNavs.at(-1)?.date || '')
      ? [...officialNavs, { date: quote.date, nav: quote.nav }]
      : officialNavs;

  const sectorQuery = useQuery({
    queryKey: qk.boardSector(fundId),
    queryFn: async () => {
      const label = (await fetchRelatedSectorsBatch([fundId]))?.[fundId] || fund?.relatedSector || '';
      const secid = label ? (await fetchFundSecidsBatch([label]))?.[label] || '' : '';
      return { label, secid };
    },
    enabled: active && Boolean(fundId),
    staleTime: 24 * 60 * 60 * 1000
  });
  const secid = sectorQuery.data?.secid || '';
  const sectorLabel = sectorQuery.data?.label || '';
  const klineQuery = useQuery({
    queryKey: qk.indexKlines(secid),
    queryFn: () => fetchIndexKlines(secid),
    enabled: active && Boolean(secid),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000
  });
  const quoteQuery = useQuery({
    queryKey: ['boardSectorQuotes', secid],
    queryFn: () => fetchEastmoneySectorQuotesBatch([secid, BENCHMARK_SECID]),
    enabled: active && Boolean(secid),
    refetchInterval: 60 * 1000
  });
  const flowQuery = useQuery({
    queryKey: qk.indexFundFlow(secid),
    queryFn: () => fetchIndexFundFlow(secid),
    enabled: active && Boolean(secid),
    staleTime: 5 * 60 * 1000
  });
  const keyword = sectorLabel ? sectorKeyword(sectorLabel) : '';
  const sectorNewsQuery = useQuery({
    queryKey: qk.sectorNews(keyword),
    queryFn: () => fetchSectorNews(keyword),
    enabled: active && Boolean(keyword),
    staleTime: 5 * 60 * 1000
  });
  const fundNewsQuery = useQuery({
    queryKey: qk.fundAnnouncements(fundId),
    queryFn: () => fetchFundAnnouncements(fundId),
    enabled: active && Boolean(fundId),
    staleTime: 30 * 60 * 1000
  });

  const holdingsQuery = useQuery({
    queryKey: ['boardFundHoldings', fundId],
    queryFn: () => fetchFundHoldings(fundId),
    enabled: active && Boolean(fundId),
    staleTime: 5 * 60 * 1000
  });
  const sectorName = keyword || quoteQuery.data?.[secid]?.name || '所属板块';
  const sectorPct = quoteQuery.data?.[secid]?.pct ?? klineQuery.data?.at(-1)?.pct;
  const benchmarkPct = quoteQuery.data?.[BENCHMARK_SECID]?.pct;
  const trend = klineQuery.data
    ? analyzeSectorTrend({ klines: klineQuery.data, flows: flowQuery.data || [], sectorPct, benchmarkPct })
    : null;
  const forecast = forecastFund({
    navs: officialNavs,
    startNav: quote?.nav,
    drift5: trend?.stats.medianForward5,
    stopNav
  });
  const fundPct = navs.length >= 2 ? (navs.at(-1).nav / navs.at(-2).nav - 1) * 100 : NaN;
  const beijingToday = new Date(reminder.now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const comparable = quote?.estimated || quote?.date === beijingToday || !isTradingDay(dayjs(beijingToday));
  const attribution = comparable
    ? attributeMove({
        fundPct,
        stocks: holdingsQuery.data?.holdings || [],
        reportDate: holdingsQuery.data?.holdingsReportDate
      })
    : null;
  // 板块弱于大盘已在今日对比里标出，这里不重复
  const alerts = buildRiskAlerts({ navs, sectorName, sectorPct, benchmarkPct }).filter(
    (item) => item.icon !== 'sector'
  );
  const weakSector = Number.isFinite(sectorPct) && Number.isFinite(benchmarkPct) && sectorPct < benchmarkPct - 0.5;
  const points = drawdownSeries(navs, peakNav, 10, reminder.cycle?.startDate);
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : trend?.direction === 'down' ? TrendingDown : Scale;
  const trendTone = trend?.direction === 'up' ? 'bull' : trend?.direction === 'down' ? 'bear' : 'neutral';

  const todayTiles = [
    { key: 'fund', label: '本基金', value: fundPct },
    { key: 'sector', label: sectorName, value: sectorPct, note: weakSector ? '弱于沪深 300' : '' },
    { key: 'benchmark', label: '沪深 300', value: benchmarkPct }
  ];

  return (
    <div className={styles.marketAnalysis}>
      <div className={styles.todayGrid} aria-label="最新交易日涨跌对比">
        {todayTiles.map((item) => (
          <div key={item.key} className={styles.todayTile}>
            <span>{item.label}</span>
            <b className={toneClass(item.value)}>{signed(item.value)}</b>
            {item.note ? <small className={styles.down}>{item.note}</small> : null}
          </div>
        ))}
      </div>
      {attribution ? <AttributionLine attribution={attribution} /> : null}
      <Tabs
        id={`${fundId}-market`}
        label="市场分析内容"
        tabs={ANALYSIS_TABS}
        value={tab}
        onChange={setTab}
        variant="line"
      >
        {tab === 'trend' ? (
          <>
            <b>板块趋势 · {sectorName}</b>
            {sectorQuery.isPending || (secid && klineQuery.isPending) ? (
              <p className={styles.riskMuted}>正在加载板块行情…</p>
            ) : !secid ? (
              <p className={styles.riskMuted}>暂未匹配到本基金跟踪的板块或指数。</p>
            ) : klineQuery.isError ? (
              <p className={styles.riskMuted} role="status">
                板块行情加载失败。
                <button type="button" className={styles.riskLink} onClick={() => klineQuery.refetch()}>
                  重试
                </button>
              </p>
            ) : !trend ? (
              <p className={styles.riskMuted}>板块历史数据不足，暂不判断趋势。</p>
            ) : (
              <>
                <div className={styles.trendRow}>
                  <span className={cn(styles.trendBadge, styles[`stance_${trendTone}`])}>
                    <TrendIcon size={16} aria-hidden="true" />
                    {trend.label}
                  </span>
                  <span className={styles.riskMuted}>
                    {trend.evidence.length} 项依据：偏多 {trend.bull}、偏空 {trend.bear}、中性 {trend.neutral}
                  </span>
                </div>
                <div className={styles.probBlock}>
                  <div className={styles.riskMeterHead}>
                    <span>下个交易日历史涨跌频率</span>
                    <span>样本 {trend.stats.sampleSize} 次</span>
                  </div>
                  {trend.stats.hasEdge ? (
                    <div
                      className={styles.probBar}
                      role="img"
                      aria-label={`历史同类情形下，次日上涨 ${percent(trend.stats.upRate)}，下跌 ${percent(1 - trend.stats.upRate)}`}
                    >
                      <span className={styles.stance_bull} style={{ width: percent(trend.stats.upRate) }}>
                        涨 {percent(trend.stats.upRate)}
                      </span>
                      <span className={styles.stance_bear} style={{ width: percent(1 - trend.stats.upRate) }}>
                        跌 {percent(1 - trend.stats.upRate)}
                      </span>
                    </div>
                  ) : (
                    <p className={styles.noEdge}>
                      历史上没有明显方向（涨 {percent(trend.stats.upRate)} / 跌 {percent(1 - trend.stats.upRate)}）
                    </p>
                  )}
                  <p className={styles.riskMuted}>
                    {trend.stats.matchedSignal
                      ? `统计近 ${trend.stats.years} 年板块同样“${trend.stats.signalText}”后的下一交易日。`
                      : `同类信号样本不足，改用近 ${trend.stats.years} 年全部交易日统计。`}
                    是历史频率，不是预测。
                  </p>
                </div>
                <ul className={styles.evidenceList}>
                  {trend.evidence.map((item) => {
                    const Icon = EVIDENCE_ICON[item.key];
                    return (
                      <li key={item.key}>
                        <Icon size={15} aria-hidden="true" className={styles[`stanceText_${item.stance}`]} />
                        <span>
                          <span className={styles.riskMuted}>{item.label}</span> {item.text}
                        </span>
                        <span className={cn(styles.stanceTag, styles[`stance_${item.stance}`])}>
                          {STANCE_LABEL[item.stance]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className={styles.riskSection}>
              <b>本基金走势提醒</b>
              {stopLine > 0 ? <DrawdownChart points={points} stopLine={stopLine} level={risk.level} /> : null}
              {alerts.length ? (
                <ul className={styles.alertList}>
                  {alerts.map((item) => {
                    const Icon = ALERT_ICON[item.icon];
                    return (
                      <li key={item.icon}>
                        <Icon size={15} aria-hidden="true" className={styles[`alertTone_${item.tone}`]} />
                        {item.text}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.riskMuted}>近期没有连续下跌或跌势加快。</p>
              )}
            </div>
          </>
        ) : null}
        {tab === 'range' ? (
          <>
            <b>未来 {forecast?.days || 5} 个交易日波动范围</b>
            <span className={styles.riskMuted}> · 未经回测，只用来了解波动</span>
            {!forecast ? (
              <p className={styles.riskMuted}>净值数据不足 20 个交易日，暂不估算。</p>
            ) : (
              <>
                <p className={styles.forecastSummary}>
                  按近期波动，80% 区间约{' '}
                  <b>
                    {signed(forecast.low, 1)} ~ {signed(forecast.high, 1)}
                  </b>
                  {forecast.belowStop ? (
                    <>
                      ，当前已低于止损线（从跟踪最高值回落 <b>{signed(-stopLine)}</b>）
                    </>
                  ) : forecast.touchStop !== null ? (
                    <>
                      ，有 <b>{percent(forecast.touchStop)}</b> 的可能在 {forecast.days} 日内触及止损线
                    </>
                  ) : null}
                  。
                </p>
                <ForecastChart navs={navs} forecast={forecast} stopNav={stopNav} />
                <div className={styles.forecastLegend}>
                  <span>
                    <i className={styles.legendPast} />
                    历史涨跌（当前为 0%）
                  </span>
                  <span>
                    <i className={styles.legendInner} />
                    50% 区间
                  </span>
                  <span>
                    <i className={styles.legendOuter} />
                    80% 区间
                  </span>
                </div>
                <div className={styles.scenarioGrid}>
                  <div>
                    <span>反弹 · 涨超 2%</span>
                    <b className={styles.up}>{percent(forecast.scenarios.up)}</b>
                  </div>
                  <div>
                    <span>震荡 · ±2% 内</span>
                    <b>{percent(forecast.scenarios.flat)}</b>
                  </div>
                  <div>
                    <span>续跌 · 跌超 2%</span>
                    <b className={styles.down}>{percent(forecast.scenarios.down)}</b>
                  </div>
                </div>
                <details className={styles.forecastMethod}>
                  <summary>怎么算的</summary>
                  <ul>
                    <li>
                      区间宽度：本基金近 {forecast.sampleDays} 个交易日波动率（年化 {forecast.annualVol.toFixed(0)}
                      %）
                    </li>
                    <li>
                      中位方向：
                      {trend
                        ? `板块同类信号后 5 日收益中位数 ${signed(trend.stats.medianForward5, 1)}，按波动率封顶`
                        : '板块数据缺失，按无方向处理'}
                    </li>
                    {stopNav ? <li>触及止损概率：模拟 2000 条 5 日路径，统计跌破止损线的比例</li> : null}
                    <li>不含突发消息、政策和资金面变化，越往后误差越大</li>
                  </ul>
                </details>
              </>
            )}
          </>
        ) : null}
        {tab === 'news' ? (
          <>
            <div className={styles.riskSectionHead}>
              <b>最新资讯</b>
              <div className={styles.newsTabs} role="group" aria-label="资讯范围">
                <button
                  type="button"
                  aria-pressed={newsTab === 'sector'}
                  onClick={() => setNewsTab('sector')}
                  disabled={!keyword}
                >
                  {keyword || '板块'}
                </button>
                <button type="button" aria-pressed={newsTab === 'fund'} onClick={() => setNewsTab('fund')}>
                  本基金公告
                </button>
              </div>
            </div>
            {newsTab === 'sector' && keyword ? (
              <NewsList query={sectorNewsQuery} emptyText="暂无板块资讯。" onRead={setReadingNews} />
            ) : (
              <NewsList
                query={fundNewsQuery}
                emptyText="暂无基金公告。"
                onRead={setReadingNews}
                showNoticeLevel
                today={beijingToday}
              />
            )}
            <p className={styles.riskMuted}>资讯来自东方财富。</p>
          </>
        ) : null}
      </Tabs>
      <p className={styles.riskMuted}>趋势、频率和波动范围基于历史统计，仅作提醒，不构成投资建议。</p>
      <NewsReader item={readingNews} onClose={() => setReadingNews(null)} />
    </div>
  );
}
