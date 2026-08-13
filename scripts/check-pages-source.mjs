const repository = process.env.GITHUB_REPOSITORY ?? "chameleonjp-lab/hanabin";
const token = process.env.GITHUB_TOKEN?.trim();
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hanabin-pages-source-check",
};

if (token) headers.Authorization = `Bearer ${token}`;

const response = await fetch(`https://api.github.com/repos/${repository}/pages`, { headers });
if (!response.ok) {
  throw new Error(`GitHub Pages API returned ${response.status} for ${repository}`);
}

const pages = await response.json();
if (pages.build_type !== "workflow") {
  const source = pages.source
    ? `${pages.source.branch ?? "unknown"} ${pages.source.path ?? "unknown"}`
    : "none";
  throw new Error(
    `GitHub Pages source mismatch: expected workflow, received ${pages.build_type ?? "unknown"} (${source}). ` +
    "Set Settings > Pages > Source to GitHub Actions before accepting M7.",
  );
}

console.log(JSON.stringify({
  repository,
  buildType: pages.build_type,
  status: pages.status,
  htmlUrl: pages.html_url,
  httpsEnforced: pages.https_enforced,
}, null, 2));
