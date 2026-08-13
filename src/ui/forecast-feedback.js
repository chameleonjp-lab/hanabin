const forecastBonusEvents = (state = {}) => Array.isArray(state.bonusEvents)
  ? state.bonusEvents.filter((event) => Number(event?.forecastPlanAmount) > 0)
  : [];

export const forecastSuccessCountFor = (state = {}) => forecastBonusEvents(state).length;

export const forecastSuccessForAction = (state = {}, actionId) => {
  if (actionId === null || actionId === undefined) return null;
  const key = String(actionId);
  return forecastBonusEvents(state).find((event) => String(event.actionId) === key) ?? null;
};

export default forecastSuccessCountFor;
