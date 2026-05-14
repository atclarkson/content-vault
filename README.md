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
```

4. Start the app:

```bash
npm run dev
```

The Express app runs at `http://localhost:3000`. Vite runs alongside it for the frontend during development.

## How To Use It

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
