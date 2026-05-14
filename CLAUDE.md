# content-vault

A locally-run personal content management tool for organizing and cataloging family travel media. Built and used by one person (Adam) on macOS. Not a SaaS product, not a gallery app — a personal content engine that stores structured metadata for use with AI tools and blog workflows.

Phase 1 is photos. Phase 7 (future) adds YouTube video sync. Do not build ahead of the current phase.

---

## How to Run

```bash
# Install dependencies (from project root)
npm install

# Start the dev server (Express + Vite concurrently)
npm run dev

# The app runs at http://localhost:3000
```

---

## Tech Stack

**Backend:** Node.js, Express, better-sqlite3, sharp, multer, @aws-sdk/client-s3

**Frontend:** React, Vite, Tailwind CSS — lives in `/client`, served by Express in production

**Storage:** Cloudflare R2 (images), SQLite (metadata, single `.db` file at `server/db/content-vault.db`)

**External APIs:** Nominatim/OpenStreetMap (reverse geocoding, no key), Anthropic Claude API (Phase 6), YouTube Data API v3 (Phase 7)

---

## Project Structure

```
content-vault/
├── server/
│   ├── index.js              # Express entry point, serves React build in production
│   ├── routes/
│   │   ├── upload.js         # POST /api/upload — full ingest pipeline
│   │   ├── photos.js         # GET/PUT/DELETE /api/photos
│   │   ├── people.js         # GET/POST /api/people
│   │   ├── tags.js           # GET /api/tags
│   │   ├── export.js         # GET /api/export
│   │   ├── processing.js     # GET /api/processing/status
│   │   ├── reconcile.js      # POST /api/reconcile
│   │   ├── videos.js         # Phase 7 — do not build yet
│   │   └── settings.js       # Phase 7 — do not build yet
│   ├── lib/
│   │   ├── image.js          # sharp: HEIC conversion, resize, EXIF extraction
│   │   ├── r2.js             # Cloudflare R2 upload/delete helpers
│   │   ├── db.js             # SQLite connection singleton and query helpers
│   │   ├── geo.js            # Nominatim reverse geocode, rate-limited to 1 req/sec
│   │   ├── queue.js          # Simple controlled processing queue
│   │   ├── hash.js           # File hash for duplicate detection
│   │   ├── reconcile.js      # R2/SQLite integrity check helpers
│   │   └── youtube.js        # Phase 7 — do not build yet
│   └── db/
│       └── schema.sql        # Single source of truth for DB schema
├── client/
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       └── components/
│           ├── UploadForm.jsx
│           ├── ProcessingStatus.jsx
│           ├── PhotoGrid.jsx
│           ├── PhotoFilters.jsx
│           ├── BulkActionBar.jsx
│           ├── PhotoEditor.jsx
│           ├── PeopleSelector.jsx
│           ├── TagInput.jsx
│           ├── LocationFields.jsx
│           ├── DateTakenField.jsx
│           └── ExportButton.jsx
├── CLAUDE.md
├── AGENTS.md
├── .env
├── .gitignore
├── package.json
└── README.md
```

---

## Environment Variables

All secrets live in `.env` at the project root. Never hardcode credentials.

```
# Cloudflare R2
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_URL=

# Anthropic (Phase 6)
ANTHROPIC_API_KEY=

# YouTube (Phase 7)
YOUTUBE_API_KEY=

# App
PORT=3000
```

---

## Database

- **Engine:** better-sqlite3 (synchronous, single-file SQLite)
- **Location:** `server/db/content-vault.db` — local only, never committed
- **Schema:** `server/db/schema.sql` — always keep this in sync with actual DB structure
- **Migrations:** No migration framework. Schema changes are made manually during development.

### Tables (Phase 1)

- `photos` — core photo records with all metadata, EXIF, R2 keys, processing status
- `people` — known people, seeded with Adam, Lindsay, Lily, Cora, Harper
- `photo_people` — join table
- `tags` — tag names for autocomplete
- `photo_tags` — join table

### Key schema patterns

- Soft deletes: `deleted_at TEXT` — never hard delete photos
- Processing status: `processing_status TEXT` — queued, processing, complete, failed, needs_review
- Date source tracking: `date_source TEXT` — exif, file_created, file_modified, uploaded_at, manual
- Manual edit flags: `date_manually_edited INTEGER`, `location_manually_edited INTEGER` — once manually set, auto values must not overwrite

---

## Coding Conventions

- **No TypeScript.** Plain JavaScript throughout.
- **No ORM.** Use better-sqlite3 directly with parameterized queries.
- **All API calls from the frontend go through `client/src/api.js`.** No inline fetch calls in components.
- **Express routes stay thin.** Business logic lives in `server/lib/`, not in route handlers.
- **No async/await in better-sqlite3 calls** — it is synchronous by design.
- **Tailwind only for styling.** No custom CSS files unless absolutely necessary.
- **Functional React components only.** No class components.
- Error responses always use the shape `{ error: "message" }` with an appropriate HTTP status code.

---

## Image Processing Rules

- Accepted: JPEG, PNG, HEIC/HEIF, WebP
- Rejected: all RAW formats (CR2, CR3, ARW, NEF, RW2, ORF, RAF, DNG, etc.) — reject immediately, nothing written to DB or R2
- HEIC/HEIF converted to JPG for derivatives; original stored as-is
- Four versions per photo: original, thumbnail (200px wide), small (400px wide), large (1000px wide)
- R2 key pattern: `photos/{size}/{uuid}.ext`

---

## Processing Queue

- Each photo has `processing_status` updated throughout the pipeline
- Geocoding rate-limited to 1 req/sec (Nominatim policy), never blocks upload completion
- Failed jobs can be retried

---

## API Shape

- All endpoints under `/api/`
- List responses: `{ data: [...] }`
- Single item: `{ data: { ... } }`
- Errors: `{ error: "message" }`
- Soft-deleted photos excluded from all responses unless `?include_deleted=true`

---

## Current Phase: Phase 1 — Foundation

In scope:

- Project initialization and folder structure
- package.json with all dependencies installed
- Basic Express server running on localhost:3000
- SQLite schema.sql written and db initialized
- Default people seeded (Adam, Lindsay, Lily, Cora, Harper)
- .env file structure in place (no real values yet)

Not in scope yet:

- Upload logic or R2 integration
- React UI
- Image processing
- Geocoding
- Any Phase 2+ features

---

## Key Decisions — Do Not Revisit

- SQLite over hosted DB — local, single-file, no server
- Cloudflare R2 over AWS S3 — owner does not use AWS
- Public R2 URLs — images are for blog use
- Soft deletes only — never hard delete photo records
- Nominatim over paid geocoding — free, sufficient for personal use
- No TypeScript
- Express serves the React build in production — one process, one port
