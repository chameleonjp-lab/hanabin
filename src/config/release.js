import {
  GAME_VERSION,
  INPUT_SCHEMA_VERSION,
  RULE_VERSION,
} from "./rules.js";

// These identifiers are part of the MVP release contract.  Change them only
// with a migration note and a new release report.
export const MVP_RELEASE_VERSION = "0.1.0";
export const STORAGE_FORMAT_VERSION = "v1";
export const PROFILE_STORAGE_KEY = `hanabin:profile:${STORAGE_FORMAT_VERSION}`;
// The experiment site is navigation-only in this release. No score or player
// data is sent there; the result screen labels its ranking as local until the
// server-authoritative ranking contract is implemented.
export const EXPERIMENT_URL = "https://chameleonjp-lab.github.io/chameleonjp_lab/";

export const RELEASE_MANIFEST = Object.freeze({
  releaseVersion: MVP_RELEASE_VERSION,
  gameVersion: GAME_VERSION,
  ruleVersion: RULE_VERSION,
  inputSchemaVersion: INPUT_SCHEMA_VERSION,
  storageFormatVersion: STORAGE_FORMAT_VERSION,
  profileStorageKey: PROFILE_STORAGE_KEY,
  experimentUrl: EXPERIMENT_URL,
  runtimeDependencies: 0,
});

export default RELEASE_MANIFEST;
