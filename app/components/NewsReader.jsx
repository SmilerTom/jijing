'use client';

import { ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import styles from './NewsReader.module.css';

/** 应用内阅读资讯：客户端没有浏览器的返回按钮，外链不能把用户带离应用 */
export default function NewsReader({ item, onClose }) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      {item ? (
        <DialogContent className={styles.reader}>
          <DialogHeader className={styles.head}>
            <DialogTitle className={styles.title}>{item.title}</DialogTitle>
            <DialogDescription className={styles.meta}>
              {item.source} · {item.date?.slice(5, 16)}
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.external}>
                <ExternalLink size={13} aria-hidden="true" /> 在浏览器打开
              </a>
            </DialogDescription>
          </DialogHeader>
          <iframe
            key={item.url}
            className={styles.frame}
            src={item.url}
            title={item.title}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
