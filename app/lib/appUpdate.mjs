export const isAppUpdateAvailable = (currentBuildId, latestBuildId) =>
  Boolean(currentBuildId && latestBuildId && currentBuildId !== 'development' && currentBuildId !== latestBuildId);

export const getAppReloadUrl = (href, latestBuildId) => {
  const url = new URL(href);
  url.searchParams.set('_update', latestBuildId);
  return url.toString();
};
