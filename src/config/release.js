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

export const RELEASE_MANIFEST = Object.freeze({
  releaseVersion: MVP_RELEASE_VERSION,
  gameVersion: GAME_VERSION,
  ruleVersion: RULE_VERSION,
  inputSchemaVersion: INPUT_SCHEMA_VERSION,
  storageFormatVersion: STORAGE_FORMAT_VERSION,
  profileStorageKey: PROFILE_STORAGE_KEY,
  runtimeDependencies: 0,
});

export default RELEASE_MANIFEST;
