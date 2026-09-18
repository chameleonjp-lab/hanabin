const repository = process.env.GITHUB_REPOSITORY?.trim();
const token = process.env.GITHUB_TOKEN?.trim();
const targetSha = process.env.TARGET_SHA?.trim();
const requiredWorkflows = (process.env.REQUIRED_WORKFLOWS ?? "CI Core,CI Browser")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

if (!repository || !targetSha || !requiredWorkflows.length) {
  throw new Error("GITHUB_REPOSITORY, TARGET_SHA, and REQUIRED_WORKFLOWS are required");
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hanabin-pages-ci-gate",
};
if (token) headers.Authorization = `Bearer ${token}`;

const response = await fetch(
  `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(targetSha)}&per_page=100`,
  { headers },
);
if (!response.ok) {
  throw new Error(`GitHub Actions API returned ${response.status} for ${repository}@${targetSha}`);
}

const payload = await response.json();
const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
const runFor = (workflowName) => runs
  .filter((run) => run.name === workflowName && run.head_sha === targetSha && run.head_branch === "main")
  .sort((left, right) => {
    const leftTime = Date.parse(left.updated_at ?? left.created_at ?? "") || 0;
    const rightTime = Date.parse(right.updated_at ?? right.created_at ?? "") || 0;
    return rightTime - leftTime;
  })[0] ?? null;

const checks = requiredWorkflows.map((workflowName) => {
  const run = runFor(workflowName);
  return {
    workflow: workflowName,
    runId: run?.id ?? null,
    status: run?.status ?? "missing",
    conclusion: run?.conclusion ?? "missing",
    ok: run?.status === "completed" && run?.conclusion === "success",
  };
});

console.log(JSON.stringify({ repository, targetSha, checks }, null, 2));
if (checks.some((check) => !check.ok)) {
  throw new Error(`Required CI has not passed for ${targetSha}`);
}
