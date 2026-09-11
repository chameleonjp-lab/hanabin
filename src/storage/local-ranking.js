import { sanitizePlayerName } from "./local-storage.js";

// Keep the existing key so old local records remain available for migration.
// Entries without a ruleVersion are treated as legacy, never as current.
export const RANKING_STORAGE_KEY = "hanabin:ranking:v1";
export const MAX_RANKING_ENTRIES = 10;

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeRuleVersion = (value) => typeof value === "string" ? value.slice(0, 64) : "";
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
    ruleVersion: normalizeRuleVersion(source.ruleVersion),
  };
};

const compareEntries = (left, right) =>
  right.score - left.score ||
  right.maxChain - left.maxChain ||
  left.createdAt - right.createdAt ||
  left.name.localeCompare(right.name, "ja");

const normalizeEntries = (entries = []) => Array.isArray(entries)
  ? entries.map((entry, index) => normalizeRankingEntry(entry, index))
  : [];

const orderEntries = (entries) => entries.sort(compareEntries);

/** Sort one rule's entries and keep the existing top-ten contract. */
export const sortRankingEntries = (entries = []) => orderEntries(normalizeEntries(entries))
  .slice(0, MAX_RANKING_ENTRIES);

// A global top ten would allow ten old-rule records to hide every current
// record. Keep a bounded top ten for each rule version instead.
const sortStoredEntries = (entries = []) => {
  const groups = new Map();
  for (const entry of normalizeEntries(entries)) {
    const group = groups.get(entry.ruleVersion) ?? [];
    group.push(entry);
    groups.set(entry.ruleVersion, group);
  }
  return orderEntries([...groups.values()]
    .flatMap((group) => orderEntries(group).slice(0, MAX_RANKING_ENTRIES)));
};

const entriesForRule = (entries, ruleVersion) => orderEntries(
  entries.filter((entry) => entry.ruleVersion === ruleVersion),
).slice(0, MAX_RANKING_ENTRIES);

/** Defensive, local-only ranking storage. It never participates in scoring. */
export const createRankingStore = (
  storage = readGlobalStorage(),
  key = RANKING_STORAGE_KEY,
  { now = () => Date.now(), ruleVersion = "" } = {},
) => {
  const backend = storageLike(storage);
  const currentRuleVersion = normalizeRuleVersion(ruleVersion);
  let memory = [];
  let preferMemory = false;

  const load = () => {
    if (!backend || preferMemory) return clone(memory);
    try {
      const raw = backend.getItem(key);
      memory = raw ? sortStoredEntries(JSON.parse(raw)) : [];
    } catch {
      preferMemory = true;
    }
    return clone(memory);
  };

  const save = (entries) => {
    memory = sortStoredEntries(entries);
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
      const entries = load();
      return currentRuleVersion ? clone(entriesForRule(entries, currentRuleVersion)) : clone(entries);
    },
    listForRule(rule = currentRuleVersion) {
      const entries = load();
      return clone(entriesForRule(entries, normalizeRuleVersion(rule)));
    },
    legacyList() {
      const entries = load();
      if (!currentRuleVersion) return [];
      return clone(orderEntries(entries.filter((entry) => entry.ruleVersion !== currentRuleVersion)));
    },
    record({ name = "", score = 0, maxChain = 0, ruleVersion: entryRuleVersion = currentRuleVersion } = {}) {
      const normalizedName = sanitizePlayerName(String(name ?? ""));
      const existing = load();
      if (!normalizedName) {
        return currentRuleVersion
          ? clone(entriesForRule(existing, currentRuleVersion))
          : existing;
      }
      const timestamp = finiteTimestamp(now(), existing.length);
      return save([...existing, {
        name: normalizedName,
        score: finiteScore(score),
        maxChain: finiteScore(maxChain),
        createdAt: timestamp,
        ruleVersion: normalizeRuleVersion(entryRuleVersion),
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
