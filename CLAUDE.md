# content-vault

A locally-run personal content management tool for organizing and cataloging family travel media. Built and used by one person (Adam) on macOS. Not a SaaS product — a personal content engine that stores structured metadata for use with AI tools and blog workflows.

The primary view is a **Timeline** — a chronological travel history where destinations act as the spine and photos, videos, and other content slot in where they belong.

Current state: Phases 1–6.5 complete. Phase 7 (YouTube video sync) is next.

---

## How to Run

```bash
npm install
npm run dev
# App at http://localhost:5173 (Vite dev) proxying API to http://localhost:3000
```

---

## Tech Stack

**Backend:** Node.js, Express, better-sqlite3, sharp, multer, @aws-sdk/client-s3, exif-reader

**Frontend:** React, Vite, Tailwind CSS — lives in `/client`, served by Express in production

**Storage:** Cloudflare R2 (images, public bucket), SQLite (`server/db/content-vault.db`)

**External APIs:**

- Nominatim/OpenStreetMap — reverse geocoding, no key, rate-limited to 1 req/sec, `accept-language=en`
- Anthropic Claude API — AI caption + alt text (`claude-sonnet-4-6`)
- YouTube Data API v3 — Phase 7, channel ID and API key in `.env`

---

## Project Structure

```
content-vault/
├── server/
│   ├── index.js
│   ├── routes/
│   │   ├── upload.js         # POST /api/upload
│   │   ├── photos.js         # GET/PUT/DELETE /api/photos
│   │   ├── people.js         # GET/POST /api/people
│   │   ├── tags.js           # GET /api/tags
│   │   ├── destinations.js   # GET /api/destinations, POST /api/destinations/import
│   │   ├── caption.js        # POST /api/caption/:id
│   │   ├── export.js         # GET /api/export
│   │   ├── processing.js     # GET /api/processing/status
│   │   ├── reconcile.js      # POST /api/reconcile
│   │   ├── videos.js         # Phase 7
│   │   └── settings.js       # Phase 7
│   ├── lib/
│   │   ├── image.js          # sharp + sips HEIC, resize, EXIF
│   │   ├── r2.js             # R2 upload/delete, singleton
│   │   ├── db.js             # SQLite singleton, initializeDatabase(), getDb()
│   │   ├── geo.js            # Nominatim, rate-limited, English names
│   │   ├── queue.js          # Async job queue, max 3 concurrent
│   │   ├── hash.js           # SHA-256 duplicate detection
│   │   ├── reconcile.js      # R2/SQLite integrity
│   │   └── youtube.js        # Phase 7 — YouTube Data API v3 wrapper
│   └── db/
│       └── schema.sql
├── client/src/
│   ├── App.jsx               # View state, fetches people/tags on mount
│   ├── api.js                # ALL fetch calls — never inline fetch in components
│   └── components/
│       ├── Sidebar.jsx
│       ├── TimelineView.jsx  # Main view — destinations, photos, videos, filters
│       ├── PhotoGrid.jsx     # Reusable thumbnail grid, supports embedded mode
│       ├── PhotoFilters.jsx  # Missing fields, country, city, people, tags
│       ├── PhotoEditor.jsx   # Edit photo metadata, AI caption, notes for AI
│       ├── VideoEditor.jsx   # Phase 7 — edit video metadata, AI location suggestion
│       ├── BulkActionBar.jsx
│       ├── TagInput.jsx
│       ├── PeopleSelector.jsx
│       ├── UploadView.jsx
│       └── ExportView.jsx    # Import destinations CSV, YouTube sync, export JSON
```

---

## Environment Variables

```
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

---

## Database

- **Engine:** better-sqlite3 (synchronous — no async/await on DB calls)
- **Location:** `server/db/content-vault.db` — local only, never committed
- **Schema:** `server/db/schema.sql` — single source of truth
- **Migrations:** `ensurePhotoColumns()`, `ensureDestinationsTable()` in `db.js`

### Tables

**`photos`**

- R2 keys + URLs for 4 sizes: original, thumbnail (200px), small (400px), large (1000px)
- EXIF stored, GPS → `latitude`/`longitude`
- `processing_status`: queued, processing, complete, failed, needs_review
- `geo_status`: queued, complete, skipped, failed
- `date_source`: exif, file_created, file_modified, uploaded_at, manual
- `date_manually_edited`, `location_manually_edited` — once set manually, never auto-overwrite
- `ai_caption`, `alt_text`, `notes_for_ai`
- `deleted_at` — soft delete only

**`people`** — seeded: Adam, Lindsay, Lily, Cora, Harper. Extensible via UI.

**`photo_people`**, **`photo_tags`** — join tables

**`tags`** — powers autocomplete

**`destinations`**

- `city`, `country`, `date_start`, `date_end`, `duration_days`, `sort_order`
- Unique on `city + date_start`
- Only `date_start >= 2022-01-01` imported
- INSERT OR IGNORE — safe to re-import

**`videos`** — Phase 7

- `youtube_id` (unique), `youtube_url`, `title`, `description`, `thumbnail_url`
- `duration_seconds`, `video_type` (short/longform), `video_type_manually_set`
- `video_category`: travel, sponsored, review, other — defaults to travel
  - travel: needs filmed date + location, appears in timeline destination blocks
  - sponsored/review/other: no location required, appears in "Brand & Sponsored Content" section at bottom of timeline
- `date_published`, `date_filmed`, `date_filmed_end`
- `date_filmed_source`: manual, ai_suggested, confirmed
- `view_count`, `like_count`, `comment_count`, `stats_refreshed_at`
- `filmed_city`, `filmed_country`
- `filmed_location_source`: manual, ai_suggested, confirmed
- `ai_caption`, `alt_text`, `notes_for_ai`
- `deleted_at`, `created_at`, `updated_at`

**`video_people`**, **`video_tags`** — join tables

**`settings`** — key/value, used for YouTube channel ID

---

## Coding Conventions

- No TypeScript. Plain JavaScript.
- No ORM. better-sqlite3 directly, parameterized queries only.
- All API calls through `client/src/api.js`. Never inline fetch in components.
- Express routes stay thin — logic in `server/lib/`.
- No async/await on better-sqlite3 calls.
- Tailwind only. Reuse: `panel`, `field`, `btn-primary`, `btn-secondary`.
- Functional React components only.
- Error responses: `{ error: "message" }` + HTTP status.
- Success responses: `{ data: ... }`

---

## Image Processing

- Accepted: JPEG, PNG, HEIC/HEIF, WebP
- Rejected: all RAW formats — rejected immediately, nothing stored
- HEIC: converted via macOS `sips` before sharp processes it. Original stored as-is in R2.
- 4 sizes: original, thumbnail (200px), small (400px), large (1000px). All auto-rotated.
- R2 key pattern: `photos/{size}/{uuid}.ext`

---

## Timeline View

- Fetches destinations + photos (+ videos in Phase 7) on mount
- Groups content into destination blocks by date range matching
- **Matching priority:** (1) city match + date proximity, (2) country + date range, (3) pure date range, (4) Undated bucket
- Videos use `date_filmed` if `date_filmed_source` is confirmed or manual, else `date_published`
- Videos with `video_category` != travel go to "Brand & Sponsored Content" section at bottom
- Undated photos always at bottom
- Sort: Newest First / Oldest First
- Content type: All | Photos | Videos (Videos enabled in Phase 7)
- Filters active → flat PhotoGrid, no timeline grouping
- Empty destination blocks → drag-and-drop zone (pre-tags city/country only if photo has none)

---

## AI Caption Generation

- `POST /api/caption/:id`
- Downloads `large_url`, sends to Anthropic as base64 image + all metadata
- Prompt rules: casual family travel blog tone, mention people by name, no em dashes, no AI vocabulary (vibrant, nestled, showcasing, highlighting, testament, pivotal, underscore, foster, enhance), no participial phrase endings, no rule of three, write like you were there
- Saves `ai_caption`. Generates `alt_text` if currently null.
- `notes_for_ai` provides private context for better captions

---

## Phase 7: YouTube Video Sync

### Credentials (both in .env)

- `YOUTUBE_API_KEY` — Google Cloud API key, YouTube Data API v3 enabled
- `YOUTUBE_CHANNEL_ID` — your channel ID

### Sync Flow

1. Call `channels.list` to get uploads playlist ID
2. Call `playlistItems.list` (paginated) to get all video IDs
3. Filter out IDs already in DB
4. Call `videos.list` in batches of 50 for full details
5. Classify: duration < 60s = short, >= 60s = longform
6. Insert new records, default `video_category` = travel

### Stats Refresh

- Calls `videos.list` with statistics part only
- Updates view/like/comment counts + `stats_refreshed_at`

### AI Location Suggestion

- `POST /api/videos/:id/suggest-location`
- Sends title + description + full destinations list to Claude
- Claude guesses filmed city, country, date range based on content clues
- Returns `{ filmed_city, filmed_country, date_filmed, confidence, reasoning }`
- User confirms or overrides in VideoEditor
- On confirm: saves with `date_filmed_source: confirmed`, `filmed_location_source: confirmed`

### VideoEditor UI

- YouTube thumbnail, title, description (read-only from YouTube)
- View/like/comment counts + "Refresh Stats" button
- Short/Longform badge with manual override
- `video_category` selector: Travel | Sponsored | Review | Other
- Filmed date fields
- "Ask AI" button → shows suggestion with reasoning → Confirm / Override
- Filmed location fields (city, country)
- People selector, tag input, notes for AI
- AI caption + alt text (same as PhotoEditor)

### ExportView additions

- "Check for New Videos" button → calls `/api/videos/sync`
- "Refresh All Stats" button → calls `/api/videos/refresh-stats`
- Shows video counts: total, shorts, longform, by category

---

## Key Decisions — Do Not Revisit

- SQLite over hosted DB
- Cloudflare R2 over AWS S3 — owner does not use AWS
- Public R2 URLs
- Soft deletes only
- Nominatim over paid geocoding
- sips for HEIC — macOS native
- No TypeScript
- Express serves React build in production
- Timeline is the primary view — destinations are the spine
- `video_type` (short/longform) and `video_category` (travel/sponsored/etc) are separate fields
- Sponsored/brand videos never require filmed date or location
- YouTube channel ID and API key both in .env, not in settings table
