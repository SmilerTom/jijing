'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UpdateIcon } from './Icons';

const STATUS_MESSAGE = {
  checking: '正在检查更新...',
  current: '当前已是最新版本。',
  update: '检测到新版本，点击后将自动加载最新内容。',
  error: '暂时无法检查更新，请稍后重试。'
};

export default function UpdatePromptModal({ status, open, onClose, onCheck, onRefresh }) {
  const hasUpdate = status === 'update';
  const isChecking = status === 'checking';

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
          <p className="muted" style={{ fontSize: '14px', lineHeight: '1.6' }}>
            {STATUS_MESSAGE[status] || STATUS_MESSAGE.error}
          </p>
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
            onClick={hasUpdate ? onRefresh : onCheck}
            disabled={isChecking}
            style={{ flex: 1, background: 'var(--success)', color: '#fff', border: 'none' }}
          >
            {isChecking ? '检查中...' : hasUpdate ? '立即更新' : '重新检查'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
