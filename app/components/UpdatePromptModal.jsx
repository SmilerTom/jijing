'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UpdateIcon } from './Icons';

export default function UpdatePromptModal({ open, onClose, onRefresh }) {
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
            检测到新版本，点击后将自动加载最新内容。
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
            onClick={onRefresh}
            style={{ flex: 1, background: 'var(--success)', color: '#fff', border: 'none' }}
          >
            立即更新
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
