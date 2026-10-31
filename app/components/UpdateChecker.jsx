'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { downloadAppUpdate, getAppReloadUrl, isAppUpdateAvailable } from '../lib/appUpdate.mjs';
import { UpdateIcon } from './Icons';
import UpdatePromptModal from './UpdatePromptModal';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export default function UpdateChecker({ onModalOpenChange }) {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latestBuildId, setLatestBuildId] = useState('');
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [download, setDownload] = useState({ status: 'idle', loaded: 0, total: 0, error: '' });
  const downloadRunRef = useRef(0);
  const currentBuildId = process.env.NEXT_PUBLIC_BUILD_ID || 'development';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  const checkUpdate = useCallback(async () => {
    try {
      const response = await fetch(`${basePath}/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setLatestBuildId(data?.buildId || '');
      setHasUpdate(isAppUpdateAvailable(currentBuildId, data?.buildId));
    } catch (error) {
      console.error('Check update failed:', error);
      setHasUpdate(false);
    }
  }, [basePath, currentBuildId]);

  useEffect(() => {
    onModalOpenChange?.(updateModalOpen);
  }, [updateModalOpen, onModalOpenChange]);

  useEffect(() => {
    checkUpdate();
    const interval = setInterval(checkUpdate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkUpdate]);

  const closeUpdateModal = () => {
    downloadRunRef.current += 1;
    setDownload({ status: 'idle', loaded: 0, total: 0, error: '' });
    setUpdateModalOpen(false);
  };

  const refreshToLatest = async () => {
    const run = ++downloadRunRef.current;
    const reloadUrl = getAppReloadUrl(window.location.href, latestBuildId);
    setDownload({ status: 'downloading', loaded: 0, total: 0, error: '' });
    try {
      await downloadAppUpdate(reloadUrl, ({ loaded, total }) => {
        if (run === downloadRunRef.current) setDownload({ status: 'downloading', loaded, total, error: '' });
      });
      if (run !== downloadRunRef.current) return;
      setDownload((current) => ({ ...current, status: 'installing' }));
      window.location.replace(reloadUrl);
    } catch (error) {
      if (run !== downloadRunRef.current) return;
      console.error('Download update failed:', error);
      setDownload((current) => ({ ...current, status: 'failed', error: error?.message || '下载失败' }));
    }
  };

  return (
    <>
      {hasUpdate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="badge"
              style={{ cursor: 'pointer', borderColor: 'var(--success)', color: 'var(--success)' }}
              onClick={() => setUpdateModalOpen(true)}
            >
              <UpdateIcon width="14" height="14" />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>发现新版本，点击自动更新</p>
          </TooltipContent>
        </Tooltip>
      )}

      <AnimatePresence>
        {updateModalOpen && (
          <UpdatePromptModal
            open={updateModalOpen}
            onClose={closeUpdateModal}
            onRefresh={refreshToLatest}
            download={download}
          />
        )}
      </AnimatePresence>
    </>
  );
}
