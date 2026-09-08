import { DEFAULT_RULES } from "../config/rules.js";

// advanceGame appends waves at ticks up to and including maxTicks, before
// terminal input is resolved. Forecasts must use that same boundary. This
// reads metadata only; it neither generates a wave nor awards any points.
export const isWaveWithinSession = (wave, rules = DEFAULT_RULES) =>
  Number.isInteger(wave?.fireTick) && wave.fireTick >= 0 &&
  wave.fireTick <= rules.maxTicks;
