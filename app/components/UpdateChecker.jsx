'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { getAppReloadUrl, isAppUpdateAvailable } from '../lib/appUpdate.mjs';
import { UpdateIcon } from './Icons';
import UpdatePromptModal from './UpdatePromptModal';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export default function UpdateChecker({ onModalOpenChange }) {
  const [status, setStatus] = useState('checking');
  const [latestBuildId, setLatestBuildId] = useState('');
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const currentBuildId = process.env.NEXT_PUBLIC_BUILD_ID || 'development';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  const checkUpdate = useCallback(async () => {
    setStatus('checking');
    try {
      const response = await fetch(`${basePath}/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setLatestBuildId(data?.buildId || '');
      setStatus(isAppUpdateAvailable(currentBuildId, data?.buildId) ? 'update' : 'current');
    } catch (error) {
      console.error('Check update failed:', error);
      setStatus('error');
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

  useEffect(() => {
    const openUpdatePanel = () => setUpdateModalOpen(true);
    window.addEventListener('ifund:open-update', openUpdatePanel);
    return () => window.removeEventListener('ifund:open-update', openUpdatePanel);
  }, []);

  const refreshToLatest = () => {
    window.location.replace(getAppReloadUrl(window.location.href, latestBuildId));
  };

  return (
    <>
      {status === 'update' && (
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
            status={status}
            onClose={() => setUpdateModalOpen(false)}
            onCheck={checkUpdate}
            onRefresh={refreshToLatest}
          />
        )}
      </AnimatePresence>
    </>
  );
}
