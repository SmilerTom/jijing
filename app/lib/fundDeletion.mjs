export const buildFundDeleteConfirmation = (fund, { groupId = null, hasHolding = false, otherGroups = [] } = {}) =>
  groupId
    ? { code: fund.code, name: fund.name, scope: 'group', groupId }
    : { code: fund.code, name: fund.name, scope: 'global', hasHolding, otherGroups };
