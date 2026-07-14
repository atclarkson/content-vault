const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  handleMarkPhotoUsed,
  handlePreviewPhoto,
  schemas
} = require("./mcp");

function createTestDb() {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      title TEXT,
      alt_text TEXT,
      width INTEGER,
      height INTEGER,
      captured_at TEXT,
      thumbnail_r2_key TEXT,
      small_r2_key TEXT
    );

    CREATE TABLE photo_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_uuid TEXT NOT NULL,
      post_slug TEXT NOT NULL,
      post_title TEXT,
      placement TEXT,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec("CREATE INDEX idx_photo_usages_photo_uuid ON photo_usages (photo_uuid)");
  db.exec("CREATE UNIQUE INDEX idx_photo_usages_unique_usage ON photo_usages (photo_uuid, post_slug, COALESCE(placement, ''))");

  return db;
}

test("mark_photo_used inserts valid uuids and reports unknown uuids without failing", async () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-1", "Photo 1", 1200, 800, "2024-01-01T00:00:00.000Z", "thumb-1.jpg", "small-1.jpg");

  const result = await handleMarkPhotoUsed({
    photo_uuids: ["photo-1", "missing-photo"],
    post_slug: "test-post",
    post_title: "Test Post",
    placement: "feature"
  }, db);

  assert.deepEqual(result, {
    marked: 1,
    updated: 0,
    unknown: ["missing-photo"]
  });
});

test("mark_photo_used updates existing usage rows instead of erroring", async () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-1", "Photo 1", 1200, 800, "2024-01-01T00:00:00.000Z", "thumb-1.jpg", "small-1.jpg");
  db.prepare(`
    INSERT INTO photo_usages (photo_uuid, post_slug, post_title, placement, used_at)
    VALUES (?, ?, ?, ?, '2024-01-01T00:00:00.000Z')
  `).run("photo-1", "test-post", "Old Title", "feature");

  const result = await handleMarkPhotoUsed({
    photo_uuids: ["photo-1"],
    post_slug: "test-post",
    post_title: "New Title",
    placement: "feature"
  }, db);

  assert.deepEqual(result, {
    marked: 0,
    updated: 1,
    unknown: []
  });

  const row = db.prepare("SELECT post_title FROM photo_usages WHERE photo_uuid = ?").get("photo-1");
  assert.equal(row.post_title, "New Title");
});

test("preview_photo returns text and image blocks for one or more uuids", async () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-1", "Photo 1", 1200, 800, "2024-01-01T00:00:00.000Z", "thumb-1.jpg", "small-1.jpg");
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-2", "Photo 2", 800, 1200, "2024-01-02T00:00:00.000Z", "thumb-2.jpg", "small-2.jpg");

  const fetchedKeys = [];
  const result = await handlePreviewPhoto({
    photo_uuids: ["photo-1", "photo-2"],
    size: "thumbnail"
  }, db, async (key) => {
    fetchedKeys.push(key);
    return {
      buffer: Buffer.from(`image:${key}`),
      contentType: "image/jpeg"
    };
  });

  assert.equal(result.content.length, 4);
  assert.deepEqual(fetchedKeys, ["thumb-1.jpg", "thumb-2.jpg"]);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/jpeg");
  assert.equal(result.content[1].data, Buffer.from("image:thumb-1.jpg").toString("base64"));
});

test("preview_photo continues when a uuid is unknown", async () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-1", "Photo 1", 1200, 800, "2024-01-01T00:00:00.000Z", "thumb-1.jpg", "small-1.jpg");

  const result = await handlePreviewPhoto({
    photo_uuids: ["missing-photo", "photo-1"],
    size: "small"
  }, db, async () => ({
    buffer: Buffer.from("small"),
    contentType: "image/jpeg"
  }));

  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /unknown photo uuid missing-photo/);
  assert.equal(result.content[2].type, "image");
});

test("preview_photo chooses the correct key for size", async () => {
  const db = createTestDb();
  db.prepare(`
    INSERT INTO photos (uuid, title, width, height, captured_at, thumbnail_r2_key, small_r2_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("photo-1", "Photo 1", 1200, 800, "2024-01-01T00:00:00.000Z", "thumb-1.jpg", "small-1.jpg");

  const fetchedKeys = [];
  await handlePreviewPhoto({
    photo_uuids: ["photo-1"],
    size: "small"
  }, db, async (key) => {
    fetchedKeys.push(key);
    return {
      buffer: Buffer.from("small"),
      contentType: "image/jpeg"
    };
  });

  assert.deepEqual(fetchedKeys, ["small-1.jpg"]);
});

test("preview_photo schema enforces max 4 uuids and rejects unknown params", () => {
  assert.throws(() => schemas.previewPhotoSchema.parse({
    photo_uuids: ["a", "b", "c", "d", "e"]
  }));

  assert.throws(() => schemas.searchPhotosSchema.parse({
    view: "index",
    unexpected: true
  }));
});
