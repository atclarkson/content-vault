# content-vault

Local-only personal media catalog for Adam's family travel content. Runs on macOS, stores metadata in SQLite, stores image files in Cloudflare R2, and exposes a React UI plus JSON APIs for editing and export. This is not a multi-user app and not a SaaS product.

The app has expanded beyond the original timeline-only photo catalog. It now covers:

- photo upload, metadata editing, bulk edits, and soft delete / restore
- timeline browsing across photos and videos
- people, tags, and tag groups management
- destination imports
- Day One journal import, including journal text storage and photo matching
- YouTube sync and video metadata editing
- export and structured query endpoints for AI workflows
- caption settings and AI-generated captions / alt text
- photo correction preview + saved edit recipes

## Run

```bash
npm install
npm run dev
```

Dev setup:

- Express API: `http://localhost:3000`
- Vite client: `http://localhost:5173`

Local production-style run:

```bash
npm run start:local
```

Helper entrypoints already in the repo:

- `start-content-vault.command` for double-click launch on macOS
- `launchd/com.adamclarkson.content-vault.plist` for background local service
- `scripts/run-local.sh` for the launchd path
- `npm run import:dayone -- /path/to/export.zip [--skip-photos]` for large Day One imports from disk

## Stack

- Backend: Node.js, Express, better-sqlite3, sharp, multer, unzipper, `@aws-sdk/client-s3`
- Frontend: React 18, Vite, Tailwind CSS
- Storage: SQLite at `server/db/content-vault.db`, Cloudflare R2 for image files
- macOS dependency: `sips` for HEIC/HEIF conversion before Sharp processing

## Environment Variables

```dotenv
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_URL=
ANTHROPIC_API_KEY=
YOUTUBE_API_KEY=
YOUTUBE_CHANNEL_ID=
PORT=3000
```

## Current App Shape

Top-level UI views in `client/src/App.jsx`:

- `Timeline`
- `People`
- `Tags`
- `Upload`
- `Export`
- `Import`
- `Settings`

Key frontend files:

- `client/src/api.js` is the single fetch layer. Do not inline `fetch` calls in components.
- `client/src/components/TimelineView.jsx` is still the main catalog view.
- `client/src/components/ImportView.jsx` now owns destination import, Day One import, and YouTube sync/stats refresh.
- `client/src/components/ExportView.jsx` handles JSON export plus AI-friendly query/export workflows.
- `client/src/components/SettingsView.jsx` currently edits `caption_bio`, which is autosaved.

## API Surface

Registered in `server/index.js`:

- `/api/health`
- `/api/photos`
- `/api/upload`
- `/api/people`
- `/api/tags`
- `/api/tag-groups`
- `/api/export`
- `/api/caption`
- `/api/import/day-one`
- `/api/destinations`
- `/api/journal-entries`
- `/api/journals`
- `/api/videos`
- `/api/research`
- `/api/settings`
- `/api/processing`
- `/api/reconcile`

Important current workflows:

- `POST /api/photos/query`, `POST /api/videos/query`, `POST /api/journal-entries/query` provide structured query APIs.
- `POST /api/research/brief` returns a combined summary payload across photos, videos, and journals for AI use.
- `POST /api/import/day-one` streams SSE progress in the browser importer.
- `POST /api/videos/sync` syncs new YouTube uploads.
- `POST /api/videos/refresh-stats` refreshes stored YouTube stats.
- `POST /api/caption/:id` and `POST /api/caption/video/:id` generate captions.
- `POST /api/photos/:id/correction-preview` renders a temporary preview for a photo edit recipe.

## Database

Database bootstrap lives in `server/lib/db.js`. `initializeDatabase()` loads `server/db/schema.sql` and also runs additive table/column guards for older local databases.

Current main tables:

- `photos`
- `people`
- `photo_people`
- `tags`
- `photo_tags`
- `tag_groups`
- `destinations`
- `videos`
- `video_people`
- `video_tags`
- `settings`
- `journal_entries`

Notable current columns:

- `photos`: AI caption fields, location fields, Day One linkage via `day_one_uuid`, photo correction fields `edit_recipe_json`, `correction_status`, `photo_correction_applied_at`, `image_version`, and soft delete via `deleted_at`
- `people`: birthday, notes, YouTube channel, Instagram, website
- `tags`: optional `group_id`
- `videos`: YouTube metadata, stats, filmed date/location fields, subtitles text, AI fields, soft delete
- `settings`: generic key/value store, currently used by the caption settings UI
- `journal_entries`: imported Day One text plus place/weather metadata

## Current Behavior

- `better-sqlite3` is synchronous. Do not add `await` around DB calls.
- Photos are soft-deleted, not hard-deleted.
- Accepted upload types: JPEG, PNG, HEIC/HEIF, WebP.
- RAW formats are rejected.
- Image derivatives stored for photos: original, thumbnail, small, large.
- Day One import matches existing photos by MD5 first, then by near timestamp + GPS.
- Day One import stores text-only entries in `journal_entries`.
- YouTube sync classifies videos as `short` when `duration_seconds < 181`, otherwise `longform`.
- Tag groups are first-class and editable through `/api/tag-groups`.
- Export JSON includes both photos and videos.

## Conventions

- Plain JavaScript only. No TypeScript.
- No ORM. Use parameterized `better-sqlite3` queries directly.
- Keep Express routes thin when practical, but follow existing patterns in the touched file instead of forcing abstraction.
- Functional React components only.
- Tailwind CSS only.
- Error shape: `{ error: "message" }`
- Success shape: `{ data: ... }`

## Files Worth Knowing

- `server/lib/photoQuery.js`, `server/lib/videoQuery.js`, `server/lib/journalQuery.js` hold the structured query logic
- `server/lib/dayOneImport.js` is the disk-based Day One importer used by the CLI script
- `server/lib/photoCorrection.js` normalizes saved photo edit recipes
- `scripts/import-dayone.js` is the CLI entrypoint for large imports
- `server/routes/day-one.js` is the browser upload import path
- `server/routes/photos.js` and `server/routes/videos.js` contain most editing behavior

## Do Not Re-Explain The Project As

- "Phase 7 is next"
- "YouTube sync is not built yet"
- "Settings only store channel ID"
- "The app is just a travel photo timeline"

Those are stale. The codebase already includes videos, tag groups, Day One import, journal storage, settings UI, AI query/export helpers, and photo correction support.

## Planned Deployment

This repo is currently local-first, but the planned hosted deployment target is:

- Server: Hostinger KVM 1 on Ubuntu 24.04 LTS
- Domain: subdomain of the existing domain, for example `vault.adamandlinds.com`
- DNS and proxy: Cloudflare, with the subdomain pointed at the VPS IP and SSL handled there
- Access control: Cloudflare Access on the free tier, requiring Google login for browser access
- Process manager: PM2
- Reverse proxy: nginx forwarding `80` and `443` to Node on port `3000`

### Planned Deployment Steps

1. SSH into the VPS and install Node.js via `nvm`, plus `nginx` and `pm2`.
2. Clone the GitHub repo onto the server.
3. Copy the `.env` file to the server. Never commit it.
4. Copy `server/db/content-vault.db` from the local Mac to the server.
5. Run `npm install`.
6. Run `npm run build:client`.
7. Start the app with `pm2 start server/index.js --name content-vault`.
8. Configure nginx to proxy to port `3000`.
9. Point the Cloudflare DNS record at the VPS IP.
10. Enable Cloudflare Access on the subdomain and restrict it to Adam's Google account.
11. Add `API_SECRET_KEY` to `.env` and wire Express auth middleware around the API.

### Planned Security Model

- Browser UI protected by Cloudflare Access
- All API requests protected with `x-api-key: YOUR_SECRET`
- VPS firewall open only on ports `22`, `80`, and `443`
- SSL terminated by Cloudflare

### Linux Migration Work Still Required

These are known macOS-to-Linux gaps that should be treated as pending work, not already solved:

- HEIC conversion: `sips` is macOS-only. On Linux, install `libheif` and update `server/lib/image.js` to use OS detection, `sips` on macOS, and Sharp-native HEIC handling on Linux.
- Sharp: rebuild or reinstall on the VPS for the server architecture.
- File path handling should already be fine because the codebase uses `path.join()`.
- SQLite WAL mode should work on Linux as-is.

### Planned MCP Server

There is a planned MCP surface for direct AI access to the catalog.

- Endpoint: `POST /mcp`
- Protocol: Anthropic MCP over JSON-RPC
- Auth: same `x-api-key` header as the rest of the API
- Likely implementation file: `server/routes/mcp.js`

Planned tools:

- `search_photos` for location, people, date range, and tag queries
- `get_photo` for full photo metadata and URLs
- `search_videos` for filmed location, date, category, and tag queries
- `get_journal_entries` for date-range or location lookup
- `get_destinations` for the travel timeline
- `export_catalog` for filtered export across photos, videos, and journals

Implementation can either use Anthropic MCP server utilities or a manual JSON-RPC handler. Neither is in place yet.
