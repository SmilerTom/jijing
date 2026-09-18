export const getFreshQueryData = (queryClient, queryKey, maxAgeMs) => {
  const state = queryClient.getQueryState(queryKey);
  if (!state || state.data === undefined || Date.now() - state.dataUpdatedAt >= maxAgeMs) return undefined;
  return state.data;
};

export const clearFundRefreshCache = (queryClient, codes, queryKeys) => {
  for (const code of codes) {
    queryClient.removeQueries({ queryKey: queryKeys.pingzhongdata(code) });
    queryClient.removeQueries({ queryKey: queryKeys.fundHoldingsArchives(code) });
    queryClient.removeQueries({ queryKey: ['fundHoldingsQuotes', String(code).trim()] });
    queryClient.removeQueries({ queryKey: queryKeys.fundValuationLast(code) });
    queryClient.removeQueries({ queryKey: queryKeys.qdiiValuation(code) });
  }
  queryClient.removeQueries({ queryKey: ['eastSectorQuote'] });
  queryClient.removeQueries({ queryKey: queryKeys.marketIndices() });
  queryClient.removeQueries({ queryKey: queryKeys.shanghaiIndexDate() });
};
