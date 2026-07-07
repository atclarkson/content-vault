# content-vault

`content-vault` is a local photo catalog for organizing family travel media. It stores image files in Cloudflare R2 and metadata in a local SQLite database, with a React UI for upload, tagging, editing, filtering, and export.

## Prerequisites

- Node.js 20+
- npm
- macOS

macOS is required for current HEIC support. The app uses the built-in `sips` tool to convert HEIC/HEIF files before derivative generation.

## Setup

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root:

```dotenv
# Cloudflare R2
R2_ACCOUNT_ID=
R2_BUCKET_NAME=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_URL=

# Anthropic (not used yet)
ANTHROPIC_API_KEY=

# YouTube (not used yet)
YOUTUBE_API_KEY=

# App
PORT=3000
AUTH_SECRET=
AUTH_URL=http://localhost:3000
ALLOWED_EMAIL=clarksontravels@gmail.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

4. Start the app:

```bash
npm run dev
```

The Express app runs at `http://localhost:3000`. Vite runs alongside it for the frontend during development.

## Google Login Setup

Browser login uses Google OAuth directly in the Express app and keeps API/MCP auth unchanged.

- Redirect URI: `${AUTH_URL}/api/auth/callback/google`
- Local redirect URI: `http://localhost:3000/api/auth/callback/google`
- Hosted redirect URI example: `https://al-vault.com/api/auth/callback/google`

Set these env vars:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_SECRET`
- `AUTH_URL`
- `ALLOWED_EMAIL`

If you are testing Google login locally, open the app through `http://localhost:3000`. The Vite dev server on `http://localhost:5173` does not enforce the server-side page redirect.

## Run Without VSCode

For normal local use, you do not need the dev server.

### Option 1: One command

```bash
npm run start:local
```

That builds the frontend and starts the Express app on `http://localhost:3000`.

### Option 2: Double-click launcher on macOS

Use [start-content-vault.command](/Users/adamclarkson/dev/content-vault/start-content-vault.command:1).

- Double-click it in Finder.
- It installs dependencies if needed.
- It rebuilds the frontend.
- It starts the app in a Terminal window.

### Option 3: Always run in the background with `launchd`

1. Build the frontend once:

```bash
npm run build:client
```

2. Copy the plist into your LaunchAgents folder:

```bash
cp /Users/adamclarkson/dev/content-vault/launchd/com.adamclarkson.content-vault.plist ~/Library/LaunchAgents/
```

3. Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.adamclarkson.content-vault.plist
```

4. Open `http://localhost:3000`.

Useful commands:

```bash
launchctl unload ~/Library/LaunchAgents/com.adamclarkson.content-vault.plist
launchctl kickstart -k gui/$(id -u)/com.adamclarkson.content-vault
tail -f ~/Library/Logs/content-vault.log
tail -f ~/Library/Logs/content-vault-error.log
```

`launchd` uses [scripts/run-local.sh](/Users/adamclarkson/dev/content-vault/scripts/run-local.sh:1), which starts the server and auto-builds the client only if `client/dist` is missing. After frontend code changes, run `npm run build:client` again before restarting the service.

## Import Large Day One Exports

The browser upload importer is only suitable for smaller archives. For large Day One exports, use the local importer script, which reads from disk and supports either a zip file path or an extracted folder path.

```bash
npm run import:dayone -- /Users/adamclarkson/Downloads/06-07-2026_15-38-.zip
```

The importer:

- reads the zip from disk instead of loading the whole file into browser memory
- skips video assets automatically
- imports journal text and photos only
- prints ongoing progress in Terminal
- shows a scan summary first, including image/video counts and largest files

If you want to import journal text without bringing in photos yet:

```bash
npm run import:dayone -- /Users/adamclarkson/Downloads/06-07-2026_15-38-.zip --skip-photos
```

## How To Use It

## Query API For AI Workflows

Use `POST /api/photos/query` when an AI tool needs to ask for photos with structured filters instead of reusing UI query strings.

Example request:

```json
{
  "filters": {
    "text": "beach sunset",
    "people_any": ["Lindsay", "Lily"],
    "tags_all": ["hawaii"],
    "country": "Japan",
    "date_from": "2024-01-01",
    "date_to": "2024-12-31",
    "missing": ["alt_text"],
    "has_location": true
  },
  "sort": "newest",
  "limit": 24,
  "offset": 0,
  "view": "summary"
}
```

Supported filters:

- `text`: case-insensitive search across title, description, AI caption, alt text, notes, city, country, tags, and people names
- `ids`: exact photo ids
- `people_all`, `people_any`
- `tags_all`, `tags_any`
- `city`, `country`
- `date_from`, `date_to`
- `processing_status`, `geo_status`
- `missing`: `city`, `country`, `people`, `tags`, `title`, `alt_text`, `ai_caption`
- `has_people`, `has_tags`, `has_location`
- `include_deleted`

Response shape:

```json
{
  "data": {
    "items": [],
    "total": 0,
    "limit": 24,
    "offset": 0,
    "sort": "newest",
    "view": "summary",
    "applied_filters": {}
  }
}
```

Use `view: "summary"` for lightweight browsing by an AI writer and `view: "full"` if you want the same full photo payload the UI uses.

### Upload

- Open the `Upload` tab.
- Drop files onto the upload zone or click to pick files.
- Upload starts immediately.
- Supported formats: `jpg`, `jpeg`, `png`, `heic`, `heif`, `webp`.
- RAW formats are rejected.

### Organize

- Open the `Photos` tab.
- Filter by people, tags, city, country, or missing metadata.
- Click a photo to open the editor.
- Edits autosave.
- Use the bulk action bar to update tags, people, or location across multiple photos.

### Export

- Open the `Export` tab.
- Review counts for missing metadata.
- Download the catalog as JSON.
- Soft-deleted photos are never included in exports.

## Data And Backups

Back up both of these:

- SQLite database: `server/db/content-vault.db`
- Cloudflare R2 bucket contents

The database contains all catalog metadata, tags, people links, statuses, and location edits. The R2 bucket contains the original files and generated image derivatives. You need both for a complete restore.

## Auth Smoke Test

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `ALLOWED_EMAIL`, `API_SECRET_KEY`, and `VITE_API_KEY`.
2. Add `http://localhost:3000/api/auth/callback/google` to the Google Cloud Console OAuth client.
3. Start the app and open `http://localhost:3000`.
4. Confirm an unauthenticated request to `/` redirects to `/login`.
5. Sign in with `clarksontravels@gmail.com` and confirm you land on `/`.
6. Sign out and confirm you return to `/login`.
7. Try a different Google account and confirm `/login` shows `Not authorized`.
8. Confirm your MCP endpoint and API callers still work with their existing auth headers.
