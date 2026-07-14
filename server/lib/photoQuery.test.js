const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPhotoQueryFilters, queryPhotos } = require("./photoQuery");

function createMockDb({ rows, photoRow, total = 1, people = [], tags = [], usages = [], onPrepare = null }) {
  const photoRows = rows || (photoRow ? [photoRow] : []);

  return {
    prepare(sql) {
      onPrepare?.(sql);

      if (sql.includes("SELECT photos.*")) {
        return {
          all() {
            return photoRows;
          }
        };
      }

      if (sql.includes("SELECT\n        photos.uuid")) {
        return {
          all() {
            return photoRows;
          }
        };
      }

      if (sql.includes("SELECT COUNT(*) AS count")) {
        return {
          get() {
            return { count: total };
          }
        };
      }

      if (sql.includes("FROM photo_people")) {
        return {
          all() {
            return people;
          }
        };
      }

      if (sql.includes("FROM photo_tags")) {
        return {
          all() {
            return tags;
          }
        };
      }

      if (sql.includes("FROM photo_usages")) {
        return {
          all() {
            return usages;
          }
        };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
}

function createFullPhotoRow() {
  return {
    id: 42,
    uuid: "photo-uuid-42",
    original_filename: "IMG_0042.JPG",
    title: "Tokyo alley ramen",
    description: "Night walk after dinner",
    alt_text: "A narrow Tokyo alley glowing with lanterns",
    ai_caption: "Lantern-lit alley after ramen",
    notes_for_ai: "Good opener image for the ramen section.",
    original_url: "https://cdn.example.com/original.jpg",
    thumbnail_url: "https://cdn.example.com/thumb.jpg",
    small_url: "https://cdn.example.com/small.jpg",
    large_url: "https://cdn.example.com/large.jpg",
    width: 4032,
    height: 3024,
    captured_at: "2024-04-06T19:15:00.000Z",
    uploaded_at: "2024-04-10T08:30:00.000Z",
    neighborhood: "Shinjuku",
    city: "Tokyo",
    region: "Tokyo Prefecture",
    country: "Japan",
    location_label: "Omoide Yokocho, Shinjuku, Tokyo, Japan",
    latitude: 35.6938,
    longitude: 139.7034,
    sha256_hash: "sha256-value",
    md5_hash: "md5-value",
    original_r2_key: "photos/original/42.jpg",
    thumbnail_r2_key: "photos/thumbnail/42.jpg",
    small_r2_key: "photos/small/42.jpg",
    large_r2_key: "photos/large/42.jpg",
    iso: 1600,
    shutter_speed: "1/60",
    aperture: "f/1.8",
    focal_length: "35mm",
    camera_make: "Sony",
    camera_model: "A7C",
    lens_model: "FE 35mm F1.8",
    processing_status: "done",
    geo_status: "done",
    edit_recipe_json: "{\"crop\":\"4:3\"}",
    correction_status: "applied",
    image_version: 3,
    day_one_uuid: "day-one-uuid-42",
    file_size_bytes: 5123456,
    mime_type: "image/jpeg",
    deleted_at: null
  };
}

test("queryPhotos blog view returns only the blog payload fields", () => {
  const photoRow = createFullPhotoRow();
  const db = createMockDb({
    photoRow,
    people: [
      { photo_id: 42, id: 1, name: "Adam" },
      { photo_id: 42, id: 2, name: "Lindsay" }
    ],
    tags: [
      { photo_id: 42, id: 10, name: "japan" },
      { photo_id: 42, id: 11, name: "ramen" }
    ],
    usages: [
      { photo_uuid: "photo-uuid-42", post_slug: "older-post", placement: "inline", used_at: "2024-05-01T10:00:00.000Z" },
      { photo_uuid: "photo-uuid-42", post_slug: "newer-post", placement: "feature", used_at: "2024-06-01T10:00:00.000Z" }
    ]
  });

  const result = queryPhotos(db, { view: "blog", limit: 30, offset: 0 });
  const item = result.items[0];

  assert.deepEqual(Object.keys(item).sort(), [
    "ai_caption",
    "alt_text",
    "captured_at",
    "city",
    "country",
    "height",
    "id",
    "large_url",
    "location_label",
    "notes_for_ai",
    "people",
    "small_url",
    "tags",
    "title",
    "used_in",
    "uuid",
    "width"
  ]);

  assert.deepEqual(item, {
    id: 42,
    uuid: "photo-uuid-42",
    title: "Tokyo alley ramen",
    alt_text: "A narrow Tokyo alley glowing with lanterns",
    ai_caption: "Lantern-lit alley after ramen",
    notes_for_ai: "Good opener image for the ramen section.",
    large_url: "https://cdn.example.com/large.jpg",
    small_url: "https://cdn.example.com/small.jpg",
    width: 4032,
    height: 3024,
    captured_at: "2024-04-06T19:15:00.000Z",
    city: "Tokyo",
    country: "Japan",
    location_label: "Omoide Yokocho, Shinjuku, Tokyo, Japan",
    people: [
      { id: 1, name: "Adam" },
      { id: 2, name: "Lindsay" }
    ],
    tags: ["japan", "ramen"],
    used_in: [
      { post_slug: "newer-post", placement: "feature", used_at: "2024-06-01T10:00:00.000Z" },
      { post_slug: "older-post", placement: "inline", used_at: "2024-05-01T10:00:00.000Z" }
    ]
  });

  assert.equal(result.total, 1);
  assert.equal(result.limit, 30);
  assert.equal(result.offset, 0);
  assert.equal(result.applied.view, "blog");

  const fullResult = queryPhotos(db, { view: "full", limit: 30, offset: 0 });
  const blogPayloadSize = Buffer.byteLength(JSON.stringify(result.items));
  const fullPayloadSize = Buffer.byteLength(JSON.stringify(fullResult.items));

  assert.ok(blogPayloadSize < fullPayloadSize, `Expected blog payload to remain smaller than full payload (${blogPayloadSize} vs ${fullPayloadSize})`);
});

test("queryPhotos full view is unchanged", () => {
  const photoRow = createFullPhotoRow();
  const db = createMockDb({
    photoRow,
    people: [{ photo_id: 42, id: 1, name: "Adam" }],
    tags: [{ photo_id: 42, id: 10, name: "japan" }],
    usages: [{ photo_uuid: "photo-uuid-42", post_slug: "test-post", placement: null, used_at: "2024-07-01T12:00:00.000Z" }]
  });

  const result = queryPhotos(db, { view: "full", limit: 10, offset: 5 });

  assert.deepEqual(result, {
    items: [
      {
        ...photoRow,
        edit_recipe: { crop: "4:3" },
        people: [{ id: 1, name: "Adam" }],
        tags: ["japan"],
        used_in: [{ post_slug: "test-post", placement: null, used_at: "2024-07-01T12:00:00.000Z" }]
      }
    ],
    total: 1,
    limit: 10,
    offset: 5,
    applied: {
      filters: {
        ids: [],
        text: null,
        peopleAll: [],
        peopleAny: [],
        tagsAll: [],
        tagsAny: [],
        city: null,
        country: null,
        orientation: null,
        minWidth: null,
        minHeight: null,
        dateFrom: null,
        dateTo: null,
        processingStatus: null,
        geoStatus: null,
        missing: [],
        hasPeople: null,
        hasTags: null,
        hasLocation: null,
        includeDeleted: false
      },
      sort: "newest",
      view: "full",
      limit: 10,
      offset: 5
    }
  });
});

test("queryPhotos index view returns only compact scanning fields", () => {
  const db = createMockDb({
    rows: [{
      uuid: "photo-uuid-42",
      title: "Tokyo alley ramen",
      alt_text: "A narrow Tokyo alley glowing with lanterns",
      width: 4032,
      height: 3024,
      captured_at: "2024-04-06T19:15:00.000Z",
      used_in_count: 2
    }]
  });

  const result = queryPhotos(db, { view: "index", limit: 100, offset: 0 });

  assert.deepEqual(result.items, [{
    uuid: "photo-uuid-42",
    title: "Tokyo alley ramen",
    alt_text: "A narrow Tokyo alley glowing with lanterns",
    width: 4032,
    height: 3024,
    captured_at: "2024-04-06T19:15:00.000Z",
    used_in_count: 2
  }]);

  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    "alt_text",
    "captured_at",
    "height",
    "title",
    "used_in_count",
    "uuid",
    "width"
  ]);
});

test("queryPhotos index view returns used_in_count 0 for unused photos", () => {
  const db = createMockDb({
    rows: [{
      uuid: "photo-uuid-99",
      title: "Unused photo",
      alt_text: null,
      width: 1600,
      height: 900,
      captured_at: "2024-04-07T19:15:00.000Z",
      used_in_count: 0
    }]
  });

  const result = queryPhotos(db, { view: "index", limit: 10, offset: 0 });
  assert.equal(result.items[0].used_in_count, 0);
});

test("queryPhotos index view accepts limit 100 and rejects 101", () => {
  const db = createMockDb({
    rows: [{
      uuid: "photo-uuid-42",
      title: "Tokyo alley ramen",
      alt_text: "A narrow Tokyo alley glowing with lanterns",
      width: 4032,
      height: 3024,
      captured_at: "2024-04-06T19:15:00.000Z",
      used_in_count: 0
    }]
  });

  assert.equal(queryPhotos(db, { view: "index", limit: 100, offset: 0 }).limit, 100);
  assert.throws(() => queryPhotos(db, { view: "index", limit: 101, offset: 0 }), /between 0 and 100/);
});

test("queryPhotos blog view returns empty used_in when photo is unused", () => {
  const photoRow = createFullPhotoRow();
  const db = createMockDb({ photoRow, people: [], tags: [], usages: [] });

  const result = queryPhotos(db, { view: "blog", limit: 10, offset: 0 });
  assert.deepEqual(result.items[0].used_in, []);
});

test("queryPhotos uses one grouped photo_usages query for a 30-photo page", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    ...createFullPhotoRow(),
    id: index + 1,
    uuid: `photo-uuid-${index + 1}`
  }));
  let usageQueryCount = 0;
  const db = createMockDb({
    rows,
    people: [],
    tags: [],
    usages: [],
    onPrepare(sql) {
      if (sql.includes("FROM photo_usages")) {
        usageQueryCount += 1;
      }
    }
  });

  queryPhotos(db, { view: "blog", limit: 30, offset: 0 });
  assert.equal(usageQueryCount, 1);
});

test("queryPhotos supports uuid ids filter values", () => {
  const result = buildPhotoQueryFilters({
    ids: ["photo-uuid-42"],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: null,
    orientation: null,
    minWidth: null,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /photos\.uuid IN/);
  assert.deepEqual(result.params, ["photo-uuid-42"]);
});

test("buildPhotoQueryFilters adds landscape orientation filter in SQL", () => {
  const result = buildPhotoQueryFilters({
    ids: [],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: null,
    orientation: "landscape",
    minWidth: null,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /photos\.width IS NOT NULL/);
  assert.match(result.whereClause, /photos\.height IS NOT NULL/);
  assert.match(result.whereClause, /photos\.width > photos\.height/);
  assert.deepEqual(result.params, []);
});

test("buildPhotoQueryFilters adds portrait orientation filter in SQL", () => {
  const result = buildPhotoQueryFilters({
    ids: [],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: null,
    orientation: "portrait",
    minWidth: null,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /photos\.width < photos\.height/);
});

test("buildPhotoQueryFilters adds square orientation filter in SQL", () => {
  const result = buildPhotoQueryFilters({
    ids: [],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: null,
    orientation: "square",
    minWidth: null,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /photos\.width = photos\.height/);
});

test("buildPhotoQueryFilters combines min_width with country using AND semantics", () => {
  const result = buildPhotoQueryFilters({
    ids: [],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: "Japan",
    orientation: null,
    minWidth: 1200,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /LOWER\(COALESCE\(photos\.country, ''\)\) LIKE \?/);
  assert.match(result.whereClause, /photos\.width IS NOT NULL/);
  assert.match(result.whereClause, /photos\.height IS NOT NULL/);
  assert.match(result.whereClause, /photos\.width >= \?/);
  assert.match(result.whereClause, / AND /);
  assert.deepEqual(result.params, ["%japan%", 1200]);
});

test("buildPhotoQueryFilters excludes null-dimension rows when orientation is set", () => {
  const result = buildPhotoQueryFilters({
    ids: [],
    text: null,
    peopleAll: [],
    peopleAny: [],
    tagsAll: [],
    tagsAny: [],
    city: null,
    country: null,
    orientation: "landscape",
    minWidth: null,
    minHeight: null,
    dateFrom: null,
    dateTo: null,
    processingStatus: null,
    geoStatus: null,
    missing: [],
    hasPeople: null,
    hasTags: null,
    hasLocation: null,
    includeDeleted: false
  });

  assert.match(result.whereClause, /photos\.width IS NOT NULL/);
  assert.match(result.whereClause, /photos\.height IS NOT NULL/);
});
