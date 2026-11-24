'use client';

import { cn } from '@/lib/utils';
import styles from './page.module.css';

/** 可键盘操作的标签页：方向键切换，Home / End 跳到首尾 */
export default function Tabs({ id, label, tabs, value, onChange, variant = 'pill', children }) {
  const tabId = (key) => `${id}-${key}-tab`;
  const panelId = (key) => `${id}-${key}-panel`;
  const onKeyDown = (event) => {
    const index = tabs.findIndex(([key]) => key === value);
    const last = tabs.length - 1;
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + last) % tabs.length,
      Home: 0,
      End: last
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = tabs[next][0];
    onChange(key);
    document.getElementById(tabId(key))?.focus();
  };
  return (
    <>
      <div
        className={cn(styles.tabList, variant === 'line' && styles.tabListLine)}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {tabs.map(([key, text, badge]) => (
          <button
            key={key}
            id={tabId(key)}
            type="button"
            role="tab"
            aria-selected={value === key}
            aria-controls={panelId(key)}
            tabIndex={value === key ? 0 : -1}
            onClick={() => onChange(key)}
          >
            {text}
            {badge ? (
              <>
                <span className={styles.tabBadge} aria-hidden="true" />
                <span className={styles.srOnly}>（有待处理）</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
      <div id={panelId(value)} role="tabpanel" aria-labelledby={tabId(value)} tabIndex={0} className={styles.tabPanel}>
        {children}
      </div>
    </>
  );
}
