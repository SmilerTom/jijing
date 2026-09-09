'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import FundTradingBoard from './FundTradingBoard';
import styles from './page.module.css';

const DEFAULT_FUND_ID = '017811';
const DEFAULT_FUND_NAME = '东方人工智能主题混合 C';

function BoardCalculatorContent() {
  const searchParams = useSearchParams();
  const rawFundId = searchParams.get('fundCode') || DEFAULT_FUND_ID;
  const fundId = /^\d{6}$/.test(rawFundId) ? rawFundId : DEFAULT_FUND_ID;
  const fundName = searchParams.get('fundName')?.trim() || DEFAULT_FUND_NAME;
  return (
    <main className={styles.page}>
      <h1>交易驾驶舱</h1>
      <p className={styles.subtitle}>查看持仓收益、行情和策略状态，记录本基金的出入金流水。</p>
      <div className={styles.boardOptions}>
        <article className={`${styles.boardOption} ${styles.boardSelected}`}>
          <div className={styles.cardImage}>
            <div className={styles.mockup}>
              <div className={styles.mockupHeader}>A · 交易驾驶舱</div>
              <div className={styles.mockupBody}>
                <FundTradingBoard key={fundId} fundId={fundId} fundName={fundName} />
              </div>
            </div>
          </div>
          <div className={styles.cardBody}>
            <h3>交易驾驶舱</h3>
            <p>先看仓位、收益和策略提示，再看流水。策略只提供建议，实际买卖仍通过出入金手动记录。</p>
          </div>
        </article>
      </div>
    </main>
  );
}

export default function BoardCalculatorPage() {
  return (
    <Suspense fallback={null}>
      <BoardCalculatorContent />
    </Suspense>
  );
}
