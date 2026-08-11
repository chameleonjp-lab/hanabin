const DEFAULT_KEY = "hanabin:profile:v1";
const QUALITY_LEVELS = Object.freeze(["low", "medium", "high"]);

export const DEFAULT_PROFILE = Object.freeze({
  name: "",
  bestScore: 0,
  bestChain: 0,
  quality: "high",
  qualityManual: false,
  soundEnabled: false,
  practiceCompleted: false,
  practiceSkipped: false,
});

const finiteInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
};

const storageLike = (value) => value &&
  typeof value.getItem === "function" &&
  typeof value.setItem === "function" &&
  typeof value.removeItem === "function"
  ? value
  : null;

/** Return a safe player name or an empty value for rejected input. */
export const sanitizePlayerName = (value, { maxLength = 12 } = {}) => {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return "";
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) return "";
  return normalized;
};

export const normalizeProfile = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const name = sanitizePlayerName(source.name);
  return {
    name,
    bestScore: finiteInteger(source.bestScore),
    bestChain: finiteInteger(source.bestChain),
    quality: QUALITY_LEVELS.includes(source.quality) ? source.quality : DEFAULT_PROFILE.quality,
    qualityManual: source.qualityManual === true,
    soundEnabled: source.soundEnabled === true,
    practiceCompleted: source.practiceCompleted === true,
    practiceSkipped: source.practiceSkipped === true,
  };
};

const readGlobalStorage = () => {
  try {
    return storageLike(globalThis.localStorage);
  } catch {
    return null;
  }
};

/**
 * A defensive localStorage adapter. Storage failures are non-fatal: the game
 * continues with an in-memory profile and never treats saved data as core
 * simulation input.
 */
export const createProfileStore = (storage = readGlobalStorage(), key = DEFAULT_KEY) => {
  const backend = storageLike(storage);
  let memory = { ...DEFAULT_PROFILE };

  const load = () => {
    if (!backend) return { ...memory };
    try {
      const raw = backend.getItem(key);
      if (!raw) return { ...memory };
      const parsed = JSON.parse(raw);
      memory = normalizeProfile(parsed);
    } catch {
      memory = { ...DEFAULT_PROFILE };
    }
    return { ...memory };
  };

  const save = (value) => {
    memory = normalizeProfile(value);
    if (backend) {
      try {
        backend.setItem(key, JSON.stringify(memory));
      } catch {
        // Private browsing and quota errors must not block a new run.
      }
    }
    return { ...memory };
  };

  return {
    key,
    load,
    save,
    update(patch = {}) {
      return save({ ...load(), ...(patch && typeof patch === "object" ? patch : {}) });
    },
    clear() {
      memory = { ...DEFAULT_PROFILE };
      try {
        backend?.removeItem(key);
      } catch {
        // Best effort only.
      }
      return { ...memory };
    },
  };
};

export { DEFAULT_KEY as PROFILE_STORAGE_KEY, QUALITY_LEVELS };

export default createProfileStore;
