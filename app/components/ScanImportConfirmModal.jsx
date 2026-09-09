'use client';

import { useMemo, useState } from 'react';
import { Check, RefreshCw, SearchCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/utils';
import { useUserStore } from '@/app/stores';

export default function ScanImportConfirmModal({
  scannedFunds,
  selectedScannedCodes,
  onClose,
  onToggle,
  onConfirm,
  onRetryOcr,
  refreshing,
  groups = [],
  existingAllCodes = [],
  existingFavCodes = [],
  isOcrScan = false,
  currentGroup = 'all'
}) {
  const user = useUserStore((s) => s.user);
  const [selectedGroupId, setSelectedGroupId] = useState(currentGroup);
  const [expandAfterAdd, setExpandAfterAdd] = useState(true);
  const [autoDataSource, setAutoDataSource] = useState(!!user);
  const [autoImportTags, setAutoImportTags] = useState(true);
  const allCodeSet = useMemo(() => new Set((existingAllCodes || []).filter(Boolean)), [existingAllCodes]);
  const favCodeSet = useMemo(() => new Set((existingFavCodes || []).filter(Boolean)), [existingFavCodes]);

  const handleConfirm = () => {
    onConfirm(selectedGroupId, expandAfterAdd, autoDataSource, autoImportTags);
  };

  const formatAmount = (val) => {
    if (!val) return null;
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(num)) return null;
    return num;
  };

  const selectedCount = selectedScannedCodes.size;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        showCloseButton={false}
        overlayStyle={{ zIndex: 999 }}
        className="glass flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[560px] flex-col gap-0 overflow-hidden p-0"
        style={{ zIndex: 999 }}
      >
        <DialogTitle className="sr-only">{isOcrScan ? '确认识别结果' : '确认添加基金'}</DialogTitle>
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-6 py-5 pr-5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]">
            <SearchCheck className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--text)]">
              {isOcrScan ? '确认识别结果' : '确认添加基金'}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">已选 {selectedCount} 只基金</p>
          </div>
          {isOcrScan && (
            <Button type="button" variant="ghost" size="sm" onClick={onRetryOcr}>
              <RefreshCw aria-hidden="true" />
              重新识别
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭">
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-y-styled">
          {isOcrScan && (
            <div className="ocr-warning mb-4">
              <span>拍照识别仍在优化，请核对基金代码。</span>
            </div>
          )}
          {scannedFunds.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted)]">未找到有效基金</div>
          ) : (
            <>
              <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1 scrollbar-y-styled">
                {scannedFunds.map((item) => {
                  const isSelected = selectedScannedCodes.has(item.code);
                  const isInvalid = item.status === 'invalid';
                  const targetGroup = selectedGroupId;
                  const inAll = allCodeSet.has(item.code);
                  const inFav = favCodeSet.has(item.code);
                  const groupCodes =
                    targetGroup && targetGroup !== 'all' && targetGroup !== 'fav'
                      ? groups.find((g) => g.id === targetGroup)?.codes || []
                      : [];
                  const inGroup =
                    targetGroup && targetGroup !== 'all' && targetGroup !== 'fav'
                      ? groupCodes.includes(item.code)
                      : false;
                  const holdAmounts = formatAmount(item.holdAmounts);
                  const holdGains = formatAmount(item.holdGains);
                  const hasHoldingData = holdAmounts !== null && holdGains !== null;
                  const isAlreadyInTarget = targetGroup === 'all' ? inAll : targetGroup === 'fav' ? inFav : inGroup;
                  const isDisabled = (isAlreadyInTarget && !hasHoldingData) || isInvalid;
                  const displayName = item.name || (isInvalid ? '未找到基金' : '未知基金');
                  return (
                    <button
                      type="button"
                      key={item.code}
                      disabled={isDisabled}
                      aria-pressed={isSelected}
                      onClick={() => onToggle(item.code)}
                      className={`w-full rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-55 ${isSelected ? 'border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_9%,var(--card))]' : 'border-[var(--border)] bg-[var(--secondary)] hover:border-[color-mix(in_srgb,var(--primary)_55%,var(--border))]'}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[var(--text)]">{displayName}</span>
                          <span className="mt-1 block font-mono text-xs text-[var(--muted)]">#{item.code}</span>
                        </div>
                        {isAlreadyInTarget && !hasHoldingData ? (
                          <span className="text-xs text-[var(--muted)]">已添加</span>
                        ) : isInvalid ? (
                          <span className="text-xs text-[var(--danger)]">未找到</span>
                        ) : (
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${isSelected ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] bg-[var(--input)]'}`}
                          >
                            {isSelected && <Check className="size-4" aria-hidden="true" />}
                          </span>
                        )}
                      </div>
                      {hasHoldingData && !isDisabled && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--border)] pt-3 text-xs">
                          {holdAmounts !== null && (
                            <span className="text-[var(--muted)]">
                              持有金额{' '}
                              <strong className="ml-1 font-medium text-[var(--text)]">
                                {formatMoney(holdAmounts)}
                              </strong>
                            </span>
                          )}
                          {holdGains !== null && (
                            <span className="text-[var(--muted)]">
                              持有收益{' '}
                              <strong
                                className="ml-1 font-medium"
                                style={{ color: holdGains >= 0 ? 'var(--danger)' : 'var(--success)' }}
                              >
                                {holdGains >= 0 ? '+' : '-'}
                                {formatMoney(Math.abs(holdGains))}
                              </strong>
                            </span>
                          )}
                          {isAlreadyInTarget && <span className="ml-auto text-[var(--danger)]">已存在</span>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <section className="mt-5 border-t border-[var(--border)] pt-2" aria-label="添加设置">
                <div className="flex min-h-12 items-center gap-4 border-b border-[var(--border)] py-2">
                  <span className="min-w-0 flex-1 text-sm text-[var(--text)]">添加到</span>
                  <Select value={selectedGroupId} onValueChange={(value) => setSelectedGroupId(value)}>
                    <SelectTrigger className="w-[180px] max-w-[55%]" aria-label="添加到分组">
                      <SelectValue placeholder="选择分组" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {groups
                        .filter((g) => g.id !== 'all')
                        .map((g) => {
                          const isFav = g.id === 'fav' || g.isPreset;
                          return (
                            <SelectItem key={g.id} value={g.id}>
                              {isFav ? '自选' : g.name}
                            </SelectItem>
                          );
                        })}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex min-h-12 cursor-pointer items-center gap-4 border-b border-[var(--border)] py-2">
                  <span className="min-w-0 flex-1 text-sm text-[var(--text)]">添加后展开详情</span>
                  <Switch
                    checked={expandAfterAdd}
                    onCheckedChange={(checked) => setExpandAfterAdd(!!checked)}
                    aria-label="添加后展开详情"
                  />
                </label>
                {user && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-4 border-b border-[var(--border)] py-2">
                    <span className="min-w-0 flex-1 text-sm text-[var(--text)]">自动数据源</span>
                    <Switch
                      checked={autoDataSource}
                      onCheckedChange={(checked) => setAutoDataSource(!!checked)}
                      aria-label="自动数据源"
                    />
                  </label>
                )}
                {isOcrScan && (
                  <label className="flex min-h-12 cursor-pointer items-center gap-4 py-2">
                    <span className="min-w-0 flex-1 text-sm text-[var(--text)]">导入基金标签</span>
                    <Switch
                      checked={autoImportTags}
                      onCheckedChange={(checked) => setAutoImportTags(!!checked)}
                      aria-label="导入基金标签"
                    />
                  </label>
                )}
              </section>
            </>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={selectedCount === 0 || refreshing}>
            {refreshing ? '正在添加' : `确认添加${selectedCount ? ` (${selectedCount})` : ''}`}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
