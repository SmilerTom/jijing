'use client';

import { toast as sonnerToast } from 'sonner';
import { CONTACT_QQ, CONTACT_QQ_CHAT_URL } from '@/app/constants';

const actionStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--primary)',
  cursor: 'pointer',
  padding: '0 4px',
  textDecoration: 'underline',
  fontSize: 'inherit',
  fontWeight: 600
};

async function copyContactQq() {
  try {
    await navigator.clipboard.writeText(CONTACT_QQ);
    sonnerToast.success(`QQ 号已复制：${CONTACT_QQ}`);
  } catch {
    sonnerToast.error(`复制失败，请手动复制 QQ：${CONTACT_QQ}`);
  }
}

export default function QqContact({ lead = '联系 QQ：', align = 'center' }) {
  return (
    <span
      style={{
        margin: 0,
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: align,
        gap: 2
      }}
    >
      {lead}
      <a
        href={CONTACT_QQ_CHAT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="link-button"
        style={actionStyle}
        title="打开 QQ 联系"
      >
        {CONTACT_QQ}
      </a>
      <button type="button" className="link-button" onClick={copyContactQq} style={actionStyle} title="复制 QQ 号">
        复制
      </button>
    </span>
  );
}
