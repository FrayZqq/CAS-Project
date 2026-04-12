# Interactive Timeline - King's College Murcia

1. Open `index.html` in any modern browser.
2. Edit `assets/timeline-data.json` to add or update milestones (keep the schema intact). No build step or tooling required.

## Run as a server (recommended for "online")
Browsers can't write files directly into your project directory. For shared (server-stored) events + uploaded images, run the included Node server:

- Start: `node server.js`
- Open: `http://localhost:3000`

Uploads are saved into `img/uploads/` and events are saved into `data/custom-items.json` + `data/deleted-ids.json`.

To change the teacher password on a server, set either a plaintext env var (hashed in memory) or a precomputed SHA-256 hash:
- PowerShell plaintext: `$env:ADMIN_PASSWORD='your-strong-password'; node server.js`
- PowerShell hash: `$env:ADMIN_PASSWORD_HASH='your_sha256_hex'; node server.js`

## Keyboard & accessibility
- `Tab` / `Shift + Tab` move through filters, cards, and the inline media chips.
- Media chips are actual links, so `Enter` opens the target (image/link/video) in a new tab.

## Teacher panel
- Use the `Teacher login` button in the top-right and enter password `Kings321` by default (or whatever `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` is on your server).
- After logging in, you can use the header `Add event` button (and `Log out` when done).
- The modal captures title, date, summary/details, categories, media URLs, uploaded image files, and link buttons. Selecting the Sustainability category automatically adds the eco highlight.
- If you open the page via `http(s)://...`, entries + deletions are stored on the server. If you open `index.html` directly (file://), entries are stored only in that browser.

## GitHub Pages publish flow (edits saved for everyone)
GitHub Pages is static, so the site cannot commit directly on its own. Use the publish worker:
1. Set up the Cloudflare Worker in `workers/README.md`.
2. Put your Worker URL into the meta tag in `index.html`:
   `<meta name="publish-endpoint" content="https://YOUR_SUBDOMAIN.workers.dev/publish" />`
3. On the site, log in → make edits → click “Publish to GitHub”.

## Developer helpers
The page exposes `window.KCM.timeline` with:
- `setFilter(value)` - apply any of the chip filters.
- `setQuery(text)` - update the search box programmatically.
- `setSort('newest'|'oldest')` - toggle sort order.
- `openById(id)` - scroll the matching card into view and focus it.
- `reset()` - restore default filter, search, and sort.
