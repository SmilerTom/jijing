'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
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
      <Link href="/" className={styles.backHome}>
        <ArrowLeft size={15} aria-hidden="true" /> 返回首页
      </Link>
      <h1 className={styles.srOnly}>交易驾驶舱</h1>
      <FundTradingBoard key={fundId} fundId={fundId} fundName={fundName} />
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
