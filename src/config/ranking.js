export const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";

// This is a Supabase publishable key. It is intentionally limited to the
// browser-safe public API surface; no service-role credential belongs here.
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";

export const RANKING_CONFIG = Object.freeze({
  gameSlug: "hanabin",
  clientVersion: "hanabin-web-20260918-01",
  rpcBaseUrl: `${SUPABASE_URL}/rest/v1/rpc`,
  startRpc: "start_game_play_v1",
  finishRpc: "finish_game_play_v1",
  submitRpc: "submit_score_idempotent_v1",
  rankingRpc: "get_best_score_ranking",
  timeoutMs: 8_000,
  pendingSubmissionStorageKey: "hanabin:ranking-pending:v1",
});

export default RANKING_CONFIG;
