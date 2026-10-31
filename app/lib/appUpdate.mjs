export const isAppUpdateAvailable = (currentBuildId, latestBuildId) =>
  Boolean(currentBuildId && latestBuildId && currentBuildId !== 'development' && currentBuildId !== latestBuildId);

export const getAppReloadUrl = (href, latestBuildId) => {
  const url = new URL(href);
  url.searchParams.set('_update', latestBuildId);
  return url.toString();
};

/** 从新版页面 HTML 中找出需要预先下载的同源 Next 静态资源（JS/CSS），去重 */
export const extractUpdateAssets = (html, pageUrl) => {
  const origin = new URL(pageUrl).origin;
  const assets = new Set();
  for (const match of String(html || '').matchAll(/(?:src|href)="([^"]+)"/g)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), pageUrl);
      if (url.origin === origin && url.pathname.includes('/_next/static/') && /\.(js|css)$/.test(url.pathname))
        assets.add(url.toString());
    } catch {}
  }
  return [...assets];
};

/**
 * 下载新版本页面和静态资源，写入浏览器缓存，完成后再刷新即可秒开新版。
 * onProgress({ loaded, total }) 按文件计数回调；任一文件失败则整体失败，可重试。
 */
export const downloadAppUpdate = async (reloadUrl, onProgress, concurrency = 4) => {
  const response = await fetch(reloadUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`新版本页面下载失败（HTTP ${response.status}）`);
  const assets = extractUpdateAssets(await response.text(), reloadUrl);
  const total = assets.length + 1;
  let loaded = 1;
  onProgress?.({ loaded, total });
  let next = 0;
  const worker = async () => {
    while (next < assets.length) {
      const url = assets[next++];
      const asset = await fetch(url, { cache: 'reload' });
      if (!asset.ok) throw new Error(`资源下载失败（HTTP ${asset.status}）`);
      await asset.arrayBuffer();
      loaded += 1;
      onProgress?.({ loaded, total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, worker));
  return { total };
};
