import { sanitizePlayerName } from "./local-storage.js";

export const RANKING_STORAGE_KEY = "hanabin:ranking:v1";
export const MAX_RANKING_ENTRIES = 10;

const clone = (value) => JSON.parse(JSON.stringify(value));
const finiteScore = (value) => Number.isFinite(Number(value))
  ? Math.max(0, Math.trunc(Number(value)))
  : 0;
const finiteTimestamp = (value, fallback = 0) => Number.isFinite(Number(value))
  ? Math.max(0, Math.trunc(Number(value)))
  : fallback;

const storageLike = (value) => value &&
  typeof value.getItem === "function" &&
  typeof value.setItem === "function" &&
  typeof value.removeItem === "function"
  ? value
  : null;

const readGlobalStorage = () => {
  try {
    return storageLike(globalThis.localStorage);
  } catch {
    return null;
  }
};

export const normalizeRankingEntry = (value = {}, fallbackOrder = 0) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: sanitizePlayerName(source.name) || "名無し",
    score: finiteScore(source.score),
    maxChain: finiteScore(source.maxChain),
    createdAt: finiteTimestamp(source.createdAt, fallbackOrder),
  };
};

const compareEntries = (left, right) =>
  right.score - left.score ||
  right.maxChain - left.maxChain ||
  left.createdAt - right.createdAt ||
  left.name.localeCompare(right.name, "ja");

export const sortRankingEntries = (entries = []) => entries
  .map((entry, index) => normalizeRankingEntry(entry, index))
  .sort(compareEntries)
  .slice(0, MAX_RANKING_ENTRIES);

/** Defensive, local-only ranking storage. It never participates in scoring. */
export const createRankingStore = (
  storage = readGlobalStorage(),
  key = RANKING_STORAGE_KEY,
  { now = () => Date.now() } = {},
) => {
  const backend = storageLike(storage);
  let memory = [];
  let preferMemory = false;

  const load = () => {
    if (!backend || preferMemory) return clone(memory);
    try {
      const raw = backend.getItem(key);
      memory = raw ? sortRankingEntries(JSON.parse(raw)) : [];
    } catch {
      preferMemory = true;
    }
    return clone(memory);
  };

  const save = (entries) => {
    memory = sortRankingEntries(entries);
    if (backend) {
      try {
        backend.setItem(key, JSON.stringify(memory));
        preferMemory = false;
      } catch {
        preferMemory = true;
      }
    }
    return clone(memory);
  };

  return {
    key,
    load,
    list() {
      return load();
    },
    record({ name = "", score = 0, maxChain = 0 } = {}) {
      const normalizedName = sanitizePlayerName(String(name ?? ""));
      if (!normalizedName) return load();
      const existing = load();
      const timestamp = finiteTimestamp(now(), existing.length);
      return save([...existing, {
        name: normalizedName,
        score: finiteScore(score),
        maxChain: finiteScore(maxChain),
        createdAt: timestamp,
      }]);
    },
    clear() {
      memory = [];
      try {
        backend?.removeItem(key);
        preferMemory = false;
      } catch {
        preferMemory = true;
      }
      return [];
    },
  };
};

export default createRankingStore;
