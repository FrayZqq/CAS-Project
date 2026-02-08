Publish Server (Cloudflare Worker)

This worker accepts a timeline JSON payload and commits it to your GitHub repo.

1) Create a GitHub token (fine-grained)
- Repository: your CAS repo
- Permissions: Contents: Read and write

2) Create a Cloudflare Worker
- Create a new Worker
- Paste the code from `workers/publish-worker.js`

3) Set secrets/variables in the Worker
- `PUBLISH_PASSWORD` (the password you will type in the site UI)
- `GITHUB_TOKEN` (the fine-grained token)
- `GITHUB_OWNER` (e.g., `frayzqq`)
- `GITHUB_REPO` (e.g., `CAS-Project`)
- `GITHUB_PATH` (default: `assets/timeline-data.json`)
- `GITHUB_BRANCH` (default: `main`)
- Optional:
  - `GITHUB_MESSAGE` (commit message)
  - `GITHUB_COMMITTER_NAME`
  - `GITHUB_COMMITTER_EMAIL`
  - `CORS_ORIGIN` (e.g., `https://frayzqq.github.io`)

4) Set the publish endpoint in `index.html`
- Put the Worker URL in the meta tag:
  `<meta name="publish-endpoint" content="https://YOUR_SUBDOMAIN.workers.dev/publish" />`

5) Publish workflow
- Teacher logs in → edits timeline → clicks “Publish to GitHub”
