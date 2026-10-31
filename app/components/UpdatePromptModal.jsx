'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { UpdateIcon } from './Icons';

const IDLE_DOWNLOAD = { status: 'idle', loaded: 0, total: 0, error: '' };

export default function UpdatePromptModal({ open, onClose, onRefresh, download = IDLE_DOWNLOAD }) {
  const { status, loaded, total, error } = download;
  const busy = status === 'downloading' || status === 'installing';
  const percent = status === 'installing' ? 100 : total > 0 ? Math.round((loaded / total) * 100) : 0;
  const message =
    status === 'downloading'
      ? total > 0
        ? `正在下载新版本… ${loaded}/${total} 个文件`
        : '正在获取新版本信息…'
      : status === 'installing'
        ? '下载完成，正在重新加载…'
        : status === 'failed'
          ? `更新失败：${error}。请检查网络后重试，当前版本可继续使用。`
          : '检测到新版本，点击后将下载并加载最新内容。';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent
        className="glass card"
        style={{ maxWidth: '400px' }}
        showCloseButton={false}
        role="dialog"
        aria-modal="true"
        aria-label="更新提示"
      >
        <DialogHeader>
          <DialogTitle style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <UpdateIcon width="20" height="20" style={{ color: 'var(--success)' }} />
            <span>更新提示</span>
          </DialogTitle>
        </DialogHeader>

        <div style={{ marginBottom: 24 }}>
          <p
            className="muted"
            style={{ fontSize: '14px', lineHeight: '1.6', color: status === 'failed' ? 'var(--danger)' : undefined }}
            role={status === 'failed' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {message}
          </p>
          {status !== 'idle' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <Progress
                value={percent}
                aria-label="更新下载进度"
                aria-valuenow={percent}
                indicatorClassName={
                  status === 'failed'
                    ? 'from-[var(--danger)] to-[var(--danger)] dark:from-[var(--danger)] dark:to-[var(--danger)]'
                    : 'from-[var(--success)] to-[var(--success)] dark:from-[var(--success)] dark:to-[var(--success)]'
                }
                className="h-2 sm:h-2"
              />
              <span style={{ minWidth: 40, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                {percent}%
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex-row" style={{ gap: 12, display: 'flex' }}>
          <button
            className="button secondary"
            onClick={onClose}
            style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'var(--text)' }}
          >
            取消
          </button>
          <button
            className="button"
            onClick={onRefresh}
            disabled={busy}
            aria-busy={busy}
            style={{
              flex: 1,
              background: 'var(--success)',
              color: '#fff',
              border: 'none',
              opacity: busy ? 0.7 : 1,
              cursor: busy ? 'progress' : 'pointer'
            }}
          >
            {status === 'failed' ? '重试' : busy ? '更新中…' : '立即更新'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
