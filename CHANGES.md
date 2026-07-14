# Changes

## Added

- `photo_usages` tracking for blog/photo reuse awareness.
- MCP tool `mark_photo_used` to record post usage per photo UUID.
- `used_in` arrays in `search_photos` `blog` and `full` views.
- `search_photos` `index` view for cheap shortlist scanning.
- MCP tool `preview_photo` to return actual thumbnail/small image content blocks.

## Notes

- `preview_photo` uses the existing R2 server configuration already required by uploads and image serving:
  - `R2_ACCOUNT_ID`
  - `R2_BUCKET_NAME`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_PUBLIC_URL`
- No new R2 environment variables were added.
- `search_photos` MCP schemas are now strict, so unknown parameters return validation errors instead of being ignored.

## Migration

- The app auto-creates the `photo_usages` table and indexes on startup via `initializeDatabase()`.
- Manual migration command:

```bash
node -e "require('./server/lib/db').initializeDatabase()"
```
