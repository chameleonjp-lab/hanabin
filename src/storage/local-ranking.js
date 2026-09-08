import { DEFAULT_RULES } from "../config/rules.js";
import { sanitizePlayerName } from "./local-storage.js";

// This is the pre-Q3 format. It has no rule identity, so it is deliberately
// kept as a historical area and is never used by the current store.
export const RANKING_STORAGE_KEY = "hanabin:ranking:v1";
export const RANKING_STORAGE_FORMAT_VERSION = "v2";
export const RULE_RANKING_STORAGE_PREFIX = `hanabin:ranking:${RANKING_STORAGE_FORMAT_VERSION}:`;
export const RANKING_STORAGE_PREFIX = RULE_RANKING_STORAGE_PREFIX;
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

const safeRuleVersion = (value, fallback = DEFAULT_RULES.ruleVersion) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    return fallback;
  }
  return normalized;
};

/** Return the isolated v2 key for one explicit gameplay rule version. */
export const rankingStorageKeyFor = (ruleVersion = DEFAULT_RULES.ruleVersion) =>
  `${RULE_RANKING_STORAGE_PREFIX}${encodeURIComponent(safeRuleVersion(ruleVersion))}`;

export const rankingStorageKeyForRuleVersion = rankingStorageKeyFor;

// These prefixes are separate on purpose. The ranking list is a bounded
// presentation view; best values are retained independently so a high-chain,
// low-score run that falls outside TOP10 still updates the profile.
const entryPrefixFor = (key) => `${key}:entry:`;
const bestPrefixFor = (key) => `${key}:best:`;

const randomId = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a local opaque identifier.
  }
  randomId.sequence = (randomId.sequence ?? 0) + 1;
  return `${Date.now().toString(36)}-${randomId.sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const keyPart = (value) => encodeURIComponent(String(value ?? ""));

export const normalizeRankingEntry = (value = {}, fallbackOrder = 0) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: sanitizePlayerName(source.name) || "名無し",
    score: finiteScore(source.score),
    maxChain: finiteScore(source.maxChain),
    createdAt: finiteTimestamp(source.createdAt, fallbackOrder),
  };
};

const normalizeBest = (value = {}, fallbackOrder = 0) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: sanitizePlayerName(source.name),
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

const compareBestScore = (left, right) =>
  right.score - left.score ||
  left.createdAt - right.createdAt ||
  left.name.localeCompare(right.name, "ja");

const compareBestChain = (left, right) =>
  right.maxChain - left.maxChain ||
  left.createdAt - right.createdAt ||
  left.name.localeCompare(right.name, "ja");

/** Merge score and maxChain independently; neither is derived from TOP10. */
export const mergeBestValues = (left = {}, right = {}) => {
  const first = normalizeBest(left);
  const second = normalizeBest(right);
  const scoreWinner = compareBestScore(first, second) <= 0 ? first : second;
  const chainWinner = compareBestChain(first, second) <= 0 ? first : second;
  return {
    name: scoreWinner.name || chainWinner.name,
    score: Math.max(first.score, second.score),
    maxChain: Math.max(first.maxChain, second.maxChain),
    createdAt: scoreWinner.createdAt,
  };
};

const emptyDocument = (ruleVersion) => ({
  storageVersion: RANKING_STORAGE_FORMAT_VERSION,
  ruleVersion,
  best: normalizeBest(),
  entries: [],
  // Internal ids make record(runId) idempotent in the fallback document
  // store. They are removed before data is returned to the UI.
  recordIds: [],
});

const isRuleDocument = (value, ruleVersion) => value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  value.storageVersion === RANKING_STORAGE_FORMAT_VERSION &&
  value.ruleVersion === ruleVersion;

const normalizeDocument = (value, ruleVersion) => {
  if (!isRuleDocument(value, ruleVersion)) return emptyDocument(ruleVersion);
  const sourceEntries = Array.isArray(value.entries) ? value.entries : [];
  const entries = sourceEntries
    .filter((entry) => !entry?.ruleVersion || entry.ruleVersion === ruleVersion)
    .map((entry, index) => normalizeRankingEntry(entry, index));
  const ids = Array.isArray(value.recordIds)
    ? value.recordIds.filter((id) => typeof id === "string").slice(-2_048)
    : [];
  return {
    storageVersion: RANKING_STORAGE_FORMAT_VERSION,
    ruleVersion,
    best: normalizeBest(value.best),
    entries: sortRankingEntries(entries),
    recordIds: [...new Set(ids)],
  };
};

const parseDocument = (raw, ruleVersion) => {
  if (!raw) return { document: emptyDocument(ruleVersion), recognized: true };
  try {
    const parsed = JSON.parse(raw);
    if (isRuleDocument(parsed, ruleVersion)) {
      return { document: normalizeDocument(parsed, ruleVersion), recognized: true };
    }
    // An array or an envelope with no explicit version is not assigned to the
    // current rule. Keeping it out of `entries` prevents an old score from
    // becoming a current score by inference.
    return { document: emptyDocument(ruleVersion), recognized: false };
  } catch {
    return { document: emptyDocument(ruleVersion), recognized: false };
  }
};

const supportsKeyEnumeration = (backend) => {
  if (!backend || typeof backend.key !== "function") return false;
  try {
    return Number.isInteger(Number(backend.length)) && Number(backend.length) >= 0;
  } catch {
    return false;
  }
};

const listKeys = (backend, prefix) => {
  if (!supportsKeyEnumeration(backend)) return [];
  const keys = [];
  try {
    const length = Number(backend.length);
    for (let index = 0; index < length; index += 1) {
      const key = backend.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
};

const recordsFromEnumeratedStore = (backend, prefix, ruleVersion, kind) => {
  const records = [];
  for (const key of listKeys(backend, prefix)) {
    try {
      const parsed = JSON.parse(backend.getItem(key));
      if (parsed?.storageVersion !== RANKING_STORAGE_FORMAT_VERSION ||
          parsed?.ruleVersion !== ruleVersion ||
          !parsed?.value || typeof parsed.value !== "object") continue;
      records.push({
        id: typeof parsed.id === "string" ? parsed.id : key,
        value: kind === "entry"
          ? normalizeRankingEntry(parsed.value)
          : normalizeBest(parsed.value),
      });
    } catch {
      // One damaged candidate must not block the rest of the local records.
    }
  }
  return records;
};

const bestFromValues = (values = []) => values.reduce(
  (best, value) => mergeBestValues(best, value),
  normalizeBest(),
);

/**
 * Create a rule-scoped local record store.
 *
 * Passing a string key retains the pre-Q3 array API for callers that
 * explicitly need the opaque v1 area. Omitting the key, or passing an
 * options object, selects the v2 rule-scoped store.
 */
export const createRankingStore = (
  storage = readGlobalStorage(),
  keyOrOptions = undefined,
  legacyOptions = {},
) => {
  const backend = storageLike(storage);
  const explicitLegacyKey = typeof keyOrOptions === "string";
  const options = keyOrOptions && typeof keyOrOptions === "object" && !Array.isArray(keyOrOptions)
    ? keyOrOptions
    : legacyOptions && typeof legacyOptions === "object" ? legacyOptions : {};
  if (explicitLegacyKey && !options.ruleVersion) {
    return createLegacyRankingStore(backend, keyOrOptions, options);
  }

  const ruleVersion = safeRuleVersion(options.ruleVersion ?? DEFAULT_RULES.ruleVersion);
  const key = options.key ?? (explicitLegacyKey ? keyOrOptions : rankingStorageKeyFor(ruleVersion));
  const entryPrefix = entryPrefixFor(key);
  const bestPrefix = bestPrefixFor(key);
  const enumerated = supportsKeyEnumeration(backend);
  let memory = emptyDocument(ruleVersion);
  let preferMemory = false;
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  const loadDocument = () => {
    if (preferMemory || !backend) return clone(memory);
    if (enumerated) {
      // The base document is optional in the append-only browser path. It is
      // used for compatibility with an earlier v2 implementation and for a
      // graceful fallback when a browser blocks one of the side writes.
      let base = emptyDocument(ruleVersion);
      try {
        const parsed = parseDocument(backend.getItem(key), ruleVersion);
        if (parsed.recognized) base = parsed.document;
      } catch {
        // Keep the empty base and continue with independent side records.
      }
      const entries = recordsFromEnumeratedStore(backend, entryPrefix, ruleVersion, "entry");
      const bestRecords = recordsFromEnumeratedStore(backend, bestPrefix, ruleVersion, "best");
      memory = {
        storageVersion: RANKING_STORAGE_FORMAT_VERSION,
        ruleVersion,
        best: bestFromValues([base.best, ...bestRecords.map((record) => record.value)]),
        entries: sortRankingEntries([
          ...base.entries,
          ...entries.map((record) => record.value),
        ]),
        recordIds: [
          ...base.recordIds,
          ...entries.map((record) => record.id),
        ],
      };
      return clone(memory);
    }
    const parsed = parseDocument(backend.getItem(key), ruleVersion);
    if (parsed.recognized) memory = parsed.document;
    return clone(memory);
  };

  const saveDocument = (document) => {
    memory = normalizeDocument(document, ruleVersion);
    if (!backend) return { persisted: false, document: clone(memory) };
    try {
      backend.setItem(key, JSON.stringify(memory));
      preferMemory = false;
      return { persisted: true, document: clone(memory) };
    } catch {
      // A private browsing/quota failure is non-fatal. Keep this tab's latest
      // accepted copy so an immediate render does not roll back.
      preferMemory = true;
      return { persisted: false, document: clone(memory) };
    }
  };

  const currentBest = () => loadDocument().best;
  const list = () => sortRankingEntries(loadDocument().entries);

  const writeEnumeratedRecord = (prefix, id, value) => {
    if (!backend) return false;
    try {
      backend.setItem(`${prefix}${keyPart(id)}`, JSON.stringify({
        storageVersion: RANKING_STORAGE_FORMAT_VERSION,
        ruleVersion,
        id,
        value,
      }));
      return true;
    } catch {
      return false;
    }
  };

  const recordCandidate = (candidate, runId = null, { idPrefix = "run" } = {}) => {
    const id = runId === null || runId === undefined || runId === ""
      ? `${idPrefix}:${randomId()}`
      : String(runId);
    const before = loadDocument();
    if (before.recordIds.includes(id) && !enumerated) {
      return { accepted: true, duplicate: true, persisted: !preferMemory, entries: list(), best: before.best };
    }
    if (enumerated && listKeys(backend, `${entryPrefix}${keyPart(id)}`).length > 0) {
      const after = loadDocument();
      return { accepted: true, duplicate: true, persisted: !preferMemory, entries: list(), best: after.best };
    }
    const best = mergeBestValues(before.best, candidate);
    let persisted = false;
    if (enumerated && !preferMemory) {
      // Best is written first. If a quota error occurs after this write, the
      // independent best is still safer than an entry that cannot be shown.
      const bestWritten = writeEnumeratedRecord(bestPrefix, id, candidate);
      const entryWritten = bestWritten && writeEnumeratedRecord(entryPrefix, id, candidate);
      persisted = bestWritten && entryWritten;
      if (!bestWritten || !entryWritten) preferMemory = true;
      memory = {
        storageVersion: RANKING_STORAGE_FORMAT_VERSION,
        ruleVersion,
        best,
        entries: sortRankingEntries([...before.entries, candidate]),
        recordIds: [...new Set([...before.recordIds, id])],
      };
    } else {
      const result = saveDocument({
        ...before,
        best,
        entries: [...before.entries, { ...candidate, recordId: id }],
        recordIds: [...before.recordIds, id],
      });
      persisted = result.persisted;
    }
    return {
      accepted: true,
      duplicate: false,
      persisted,
      entries: list(),
      best: currentBest(),
    };
  };

  const recordBest = ({ name = "", score = 0, maxChain = 0, migrationId = null } = {}) => {
    const candidate = normalizeBest({ name, score, maxChain, createdAt: now() });
    const idBase = migrationId === null || migrationId === undefined || migrationId === ""
      ? `migration:${randomId()}`
      : String(migrationId);
    // A deterministic migration id is made value-specific. Repeating a
    // lower, stale profile migration therefore creates no overwrite path for
    // a higher value that another tab already imported.
    const id = `${idBase}:${finiteScore(score)}:${finiteScore(maxChain)}`;
    const before = loadDocument();
    if (enumerated && !preferMemory) {
      const existing = listKeys(backend, `${bestPrefix}${keyPart(id)}`).length > 0;
      let written = true;
      if (!existing) written = writeEnumeratedRecord(bestPrefix, id, candidate);
      else written = writeEnumeratedRecord(bestPrefix, id, mergeBestValues(candidate, before.best));
      if (!written) preferMemory = true;
      memory = {
        ...before,
        best: mergeBestValues(before.best, candidate),
      };
      return { migrated: true, persisted: written, best: currentBest() };
    }
    const result = saveDocument({ ...before, best: mergeBestValues(before.best, candidate) });
    return { migrated: true, persisted: result.persisted, best: result.document.best };
  };

  return {
    key,
    ruleVersion,
    storageVersion: RANKING_STORAGE_FORMAT_VERSION,
    list,
    load: list,
    best: currentBest,
    loadBest: currentBest,
    record({ name = "", score = 0, maxChain = 0, runId = null } = {}) {
      const normalizedName = sanitizePlayerName(String(name ?? ""));
      if (!normalizedName) return list();
      const candidate = normalizeRankingEntry({
        name: normalizedName,
        score,
        maxChain,
        createdAt: finiteTimestamp(now(), 0),
      });
      return recordCandidate(candidate, runId).entries;
    },
    recordRun({ name = "", score = 0, maxChain = 0, runId = null } = {}) {
      const normalizedName = sanitizePlayerName(String(name ?? ""));
      if (!normalizedName) {
        return { accepted: false, persisted: false, entries: list(), best: currentBest() };
      }
      const candidate = normalizeRankingEntry({
        name: normalizedName,
        score,
        maxChain,
        createdAt: finiteTimestamp(now(), 0),
      });
      return recordCandidate(candidate, runId);
    },
    importBest({ name = "", score = 0, maxChain = 0, migrationId = null } = {}) {
      return recordBest({ name, score, maxChain, migrationId });
    },
    clear() {
      memory = emptyDocument(ruleVersion);
      preferMemory = false;
      if (backend) {
        try {
          backend.removeItem(key);
          for (const sideKey of [
            ...listKeys(backend, entryPrefix),
            ...listKeys(backend, bestPrefix),
          ]) backend.removeItem(sideKey);
        } catch {
          preferMemory = true;
        }
      }
      return [];
    },
  };
};

const createLegacyRankingStore = (backend, key, { now = () => Date.now() } = {}) => {
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
    ruleVersion: null,
    storageVersion: "v1",
    load,
    list: load,
    best() {
      return bestFromValues(load());
    },
    loadBest() {
      return this.best();
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
    recordRun({ name = "", score = 0, maxChain = 0 } = {}) {
      const entries = this.record({ name, score, maxChain });
      return { accepted: entries.length > 0, persisted: !preferMemory, entries, best: this.best() };
    },
    importBest() {
      return { migrated: false, persisted: false, best: this.best(), reason: "LEGACY_UNVERSIONED" };
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

/** Import only a profile best whose rule version is explicitly present. */
export const migrateProfileBest = ({
  storage = readGlobalStorage(),
  profile = {},
  now = () => Date.now(),
  migrationId = null,
} = {}) => {
  const ruleVersion = safeRuleVersion(profile?.bestRuleVersion, "");
  if (!ruleVersion) return { migrated: false, reason: "RULE_VERSION_UNKNOWN" };
  const store = createRankingStore(storage, { ruleVersion, now });
  const id = migrationId ?? `profile-best:${ruleVersion}`;
  return {
    migrated: true,
    ruleVersion,
    ...store.importBest({
      name: profile?.name,
      score: profile?.bestScore,
      maxChain: profile?.bestChain,
      migrationId: id,
    }),
  };
};

export default createRankingStore;
