const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const processImage = require("../lib/image");
const { createPreviewDerivative } = require("../lib/image");
const { uploadFile } = require("../lib/r2");
const { normalizeEditRecipe } = require("../lib/photoCorrection");

const router = express.Router();

initializeDatabase();

router.post("/:id/correction-preview", async (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const photo = db.prepare(`
      SELECT *
      FROM photos
      WHERE id = ?
        AND deleted_at IS NULL
    `).get(photoId);

    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const editRecipe = normalizeEditRecipe(req.body?.edit_recipe);

    if (!editRecipe) {
      return res.status(400).json({ error: "A valid edit_recipe is required" });
    }

    const previewWidth = normalizePreviewWidth(req.body?.preview_width);
    const sourceUrl = photo.small_url || photo.large_url;

    if (!sourceUrl) {
      return res.status(400).json({ error: "Photo does not have a preview image URL" });
    }

    const sourceBuffer = await fetchImageBuffer(sourceUrl);
    const previewBuffer = await createPreviewDerivative(sourceBuffer, previewWidth, editRecipe);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(previewBuffer);
  } catch (error) {
    if (error.message === "Invalid photo id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message || "Failed to generate correction preview" });
  }
});

router.post("/bulk-update", (req, res) => {
  try {
    const db = getDb();
    const photoIds = normalizeIdArray(req.body?.photo_ids);
    const updates = req.body?.updates;

    if (photoIds.length === 0) {
      return res.status(400).json({ error: "photo_ids must be a non-empty array" });
    }

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(400).json({ error: "updates must be an object" });
    }

    const existingCount = countExistingPhotos(db, photoIds);

    if (existingCount !== photoIds.length) {
      return res.status(404).json({ error: "One or more photos were not found" });
    }

    const addPeople = normalizeIdArray(updates.add_people || []);
    const removePeople = normalizeIdArray(updates.remove_people || []);
    const addTags = normalizeTagNames(updates.add_tags || []);
    const removeTags = normalizeTagNames(updates.remove_tags || []);
    const locationUpdates = pickLocationUpdates(updates);

    const applyBulkUpdate = db.transaction(() => {
      if (Object.keys(locationUpdates).length > 0) {
        updatePhotosLocationFields(db, photoIds, locationUpdates);
      }

      if (addPeople.length > 0) {
        ensurePeopleExist(db, addPeople);
        addPeopleToPhotos(db, photoIds, addPeople);
      }

      if (removePeople.length > 0) {
        removePeopleFromPhotos(db, photoIds, removePeople);
      }

      if (addTags.length > 0) {
        const tagIds = ensureTagsExist(db, addTags);
        addTagsToPhotos(db, photoIds, tagIds);
      }

      if (removeTags.length > 0) {
        const tagIds = findTagIdsByNames(db, removeTags);
        if (tagIds.length > 0) {
          removeTagsFromPhotos(db, photoIds, tagIds);
        }
      }
    });

    applyBulkUpdate();

    return res.json({ data: { updated: photoIds.length } });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === "One or more photos were not found") {
      return res.status(404).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const filters = buildPhotoFilters(req.query);
    const orderByClause = buildPhotoOrderByClause(req.query.sort);
    const photos = db.prepare(`
      SELECT photos.*
      FROM photos
      ${filters.whereClause}
      ${orderByClause}
    `).all(...filters.params);

    const enrichedPhotos = attachPeopleAndTags(db, photos);
    return res.json({ data: enrichedPhotos });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const includeDeleted = parseBooleanFlag(req.query.include_deleted);
    const params = [photoId];
    let sql = `
      SELECT *
      FROM photos
      WHERE id = ?
    `;

    if (!includeDeleted) {
      sql += " AND deleted_at IS NULL";
    }

    const photo = db.prepare(sql).get(...params);

    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const [enrichedPhoto] = attachPeopleAndTags(db, [photo]);
    return res.json({ data: enrichedPhoto });
  } catch (error) {
    if (error.message === "Invalid photo id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const payload = req.body || {};
    const existingPhoto = db.prepare("SELECT * FROM photos WHERE id = ?").get(photoId);

    if (!existingPhoto) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const people = Object.prototype.hasOwnProperty.call(payload, "people")
      ? normalizeIdArray(payload.people)
      : null;
    const tags = Object.prototype.hasOwnProperty.call(payload, "tags")
      ? normalizeTagNames(payload.tags)
      : null;
    const editRecipe = Object.prototype.hasOwnProperty.call(payload, "edit_recipe")
      ? normalizeEditRecipe(payload.edit_recipe)
      : null;
    const shouldApplyPhotoCorrection = parseBooleanFlag(payload.apply_photo_correction);
    const shouldSkipPhotoCorrection = parseBooleanFlag(payload.skip_photo_correction);

    const updates = [];
    const params = [];

    addScalarUpdate(updates, params, payload, "title");
    addScalarUpdate(updates, params, payload, "description");
    addScalarUpdate(updates, params, payload, "notes_for_ai");
    addScalarUpdate(updates, params, payload, "alt_text");
    addScalarUpdate(updates, params, payload, "ai_caption");
    addScalarUpdate(updates, params, payload, "camera_make");
    addScalarUpdate(updates, params, payload, "camera_model");

    if (Object.prototype.hasOwnProperty.call(payload, "edit_recipe")) {
      updates.push("edit_recipe_json = ?");
      params.push(editRecipe ? JSON.stringify(editRecipe) : null);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "captured_at")) {
      updates.push("captured_at = ?");
      params.push(payload.captured_at || null);
      updates.push("date_manually_edited = 1");
      updates.push("date_source = 'manual'");
    }

    const locationFields = pickLocationUpdates(payload);

    if (Object.keys(locationFields).length > 0) {
      for (const [field, value] of Object.entries(locationFields)) {
        updates.push(`${field} = ?`);
        params.push(value);
      }

      updates.push("location_manually_edited = 1");
    }

    let nextCorrectionStatus = null;

    if (Object.prototype.hasOwnProperty.call(payload, "edit_recipe")) {
      nextCorrectionStatus = editRecipe ? "suggested" : "none";
    }

    if (shouldSkipPhotoCorrection && editRecipe) {
      nextCorrectionStatus = "skipped";
    }

    if (nextCorrectionStatus) {
      updates.push("correction_status = ?");
      params.push(nextCorrectionStatus);
    }

    const applyUpdate = db.transaction(() => {
      if (updates.length > 0) {
        params.push(photoId);
        db.prepare(`
          UPDATE photos
          SET ${updates.join(", ")},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(...params);
      }

      if (people !== null) {
        ensurePeopleExist(db, people);
        replacePhotoPeople(db, photoId, people);
      }

      if (tags !== null) {
        const tagIds = ensureTagsExist(db, tags);
        replacePhotoTags(db, photoId, tagIds);
      }
    });

    if (shouldApplyPhotoCorrection) {
      if (!editRecipe) {
        return res.status(400).json({ error: "A valid edit_recipe is required to apply correction" });
      }

      await applyPhotoCorrection(existingPhoto, editRecipe);
    }

    applyUpdate();

    if (shouldApplyPhotoCorrection) {
      db.prepare(`
        UPDATE photos
        SET correction_status = 'applied',
            photo_correction_applied_at = CURRENT_TIMESTAMP,
            image_version = COALESCE(image_version, 1) + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(photoId);
    }

    const updatedPhoto = db.prepare("SELECT * FROM photos WHERE id = ?").get(photoId);
    const [enrichedPhoto] = attachPeopleAndTags(db, [updatedPhoto]);
    return res.json({ data: enrichedPhoto });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const result = db.prepare(`
      UPDATE photos
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND deleted_at IS NULL
    `).run(photoId);

    if (result.changes === 0) {
      const photo = db.prepare("SELECT id FROM photos WHERE id = ?").get(photoId);

      if (!photo) {
        return res.status(404).json({ error: "Photo not found" });
      }
    }

    return res.json({ data: { success: true } });
  } catch (error) {
    if (error.message === "Invalid photo id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.post("/:id/restore", (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const result = db.prepare(`
      UPDATE photos
      SET deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(photoId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }

    return res.json({ data: { success: true } });
  } catch (error) {
    if (error.message === "Invalid photo id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function buildPhotoFilters(query) {
  const conditions = [];
  const params = [];
  const includeDeleted = parseBooleanFlag(query.include_deleted);

  if (!includeDeleted) {
    conditions.push("photos.deleted_at IS NULL");
  }

  const people = parseCsvList(query.people);

  if (people.length > 0) {
    const placeholders = createPlaceholders(people.length);
    conditions.push(`
      photos.id IN (
        SELECT photo_people.photo_id
        FROM photo_people
        INNER JOIN people ON people.id = photo_people.person_id
        WHERE people.name IN (${placeholders})
        GROUP BY photo_people.photo_id
        HAVING COUNT(DISTINCT people.name) = ?
      )
    `);
    params.push(...people, people.length);
  }

  const tags = parseCsvList(query.tags);

  if (tags.length > 0) {
    const placeholders = createPlaceholders(tags.length);
    conditions.push(`
      photos.id IN (
        SELECT photo_tags.photo_id
        FROM photo_tags
        INNER JOIN tags ON tags.id = photo_tags.tag_id
        WHERE tags.name IN (${placeholders})
        GROUP BY photo_tags.photo_id
        HAVING COUNT(DISTINCT tags.name) = ?
      )
    `);
    params.push(...tags, tags.length);
  }

  if (query.country) {
    conditions.push("LOWER(COALESCE(photos.country, '')) LIKE ?");
    params.push(`%${String(query.country).trim().toLowerCase()}%`);
  }

  if (query.city) {
    conditions.push("LOWER(COALESCE(photos.city, '')) LIKE ?");
    params.push(`%${String(query.city).trim().toLowerCase()}%`);
  }

  if (query.date_from) {
    conditions.push("photos.captured_at >= ?");
    params.push(query.date_from);
  }

  if (query.date_to) {
    conditions.push("photos.captured_at <= ?");
    params.push(query.date_to);
  }

  if (query.processing_status) {
    conditions.push("photos.processing_status = ?");
    params.push(query.processing_status);
  }

  if (query.geo_status) {
    conditions.push("photos.geo_status = ?");
    params.push(query.geo_status);
  }

  const missingFilters = parseCsvList(query.missing);

  for (const missingFilter of missingFilters) {
    const missingCondition = buildMissingCondition(missingFilter);

    if (missingCondition) {
      conditions.push(missingCondition);
    }
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

function buildMissingCondition(field) {
  if (field === "city") {
    return "NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NULL";
  }

  if (field === "country") {
    return "NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NULL";
  }

  if (field === "people") {
    return `
      NOT EXISTS (SELECT 1 FROM photo_people WHERE photo_people.photo_id = photos.id)
      AND NOT EXISTS (
        SELECT 1
        FROM photo_tags
        INNER JOIN tags ON tags.id = photo_tags.tag_id
        WHERE photo_tags.photo_id = photos.id
          AND LOWER(tags.name) = 'no-people'
      )
    `;
  }

  if (field === "tags") {
    return "NOT EXISTS (SELECT 1 FROM photo_tags WHERE photo_tags.photo_id = photos.id)";
  }

  if (field === "title") {
    return "NULLIF(TRIM(COALESCE(photos.title, '')), '') IS NULL";
  }

  if (field === "alt_text") {
    return "NULLIF(TRIM(COALESCE(photos.alt_text, '')), '') IS NULL";
  }

  if (field === "ai_caption") {
    return "NULLIF(TRIM(COALESCE(photos.ai_caption, '')), '') IS NULL";
  }

  return null;
}

function buildPhotoOrderByClause(sort) {
  switch (sort) {
    case "oldest":
      return "ORDER BY COALESCE(photos.captured_at, photos.uploaded_at) ASC, photos.id ASC";
    case "uploaded_newest":
      return "ORDER BY photos.uploaded_at DESC, photos.id DESC";
    case "uploaded_oldest":
      return "ORDER BY photos.uploaded_at ASC, photos.id ASC";
    case "country":
      return "ORDER BY NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NULL, LOWER(COALESCE(photos.country, '')) ASC, COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
    case "city":
      return "ORDER BY NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NULL, LOWER(COALESCE(photos.city, '')) ASC, COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
    case "filename":
      return "ORDER BY LOWER(COALESCE(photos.original_filename, '')) ASC, photos.id ASC";
    case "newest":
    default:
      return "ORDER BY COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
  }
}

function attachPeopleAndTags(db, photos) {
  if (photos.length === 0) {
    return photos;
  }

  const photoIds = photos.map((photo) => photo.id);
  const placeholders = createPlaceholders(photoIds.length);
  const peopleRows = db.prepare(`
    SELECT photo_people.photo_id, people.id, people.name
    FROM photo_people
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photo_people.photo_id IN (${placeholders})
    ORDER BY people.name
  `).all(...photoIds);
  const tagRows = db.prepare(`
    SELECT photo_tags.photo_id, tags.id, tags.name
    FROM photo_tags
    INNER JOIN tags ON tags.id = photo_tags.tag_id
    WHERE photo_tags.photo_id IN (${placeholders})
    ORDER BY tags.name
  `).all(...photoIds);

  const peopleMap = new Map();
  const tagsMap = new Map();

  for (const row of peopleRows) {
    if (!peopleMap.has(row.photo_id)) {
      peopleMap.set(row.photo_id, []);
    }

    peopleMap.get(row.photo_id).push({ id: row.id, name: row.name });
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.photo_id)) {
      tagsMap.set(row.photo_id, []);
    }

    tagsMap.get(row.photo_id).push(row.name);
  }

  return photos.map((photo) => ({
    ...photo,
    edit_recipe: parseEditRecipeJson(photo.edit_recipe_json),
    people: peopleMap.get(photo.id) || [],
    tags: tagsMap.get(photo.id) || []
  }));
}

function parseBooleanFlag(value) {
  return value === true || value === "true";
}

function normalizePreviewWidth(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 520;
  }

  return Math.max(240, Math.min(720, Math.round(numericValue)));
}

function parseCsvList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function normalizeSingleId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid photo id");
  }

  return id;
}

function normalizeIdArray(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected an array of positive integer ids");
  }

  const ids = values.map((value) => Number(value));

  if (ids.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("Expected an array of positive integer ids");
  }

  return [...new Set(ids)];
}

function normalizeTagNames(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected an array of tag names");
  }

  return [...new Set(
    values
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function addScalarUpdate(updates, params, payload, field) {
  if (Object.prototype.hasOwnProperty.call(payload, field)) {
    updates.push(`${field} = ?`);
    params.push(payload[field] || null);
  }
}

function pickLocationUpdates(payload) {
  const locationFields = ["neighborhood", "city", "region", "country"];
  const updates = {};

  for (const field of locationFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      const value = payload[field];

      if (typeof value === "string") {
        const trimmedValue = value.trim();

        if (trimmedValue !== "") {
          updates[field] = trimmedValue;
        }
      } else if (value !== undefined && value !== null) {
        updates[field] = value;
      }
    }
  }

  return updates;
}

function countExistingPhotos(db, photoIds) {
  const placeholders = createPlaceholders(photoIds.length);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM photos
    WHERE id IN (${placeholders})
  `).get(...photoIds);

  return row.count;
}

function ensurePeopleExist(db, peopleIds) {
  if (peopleIds.length === 0) {
    return;
  }

  const placeholders = createPlaceholders(peopleIds.length);
  const rows = db.prepare(`
    SELECT id
    FROM people
    WHERE id IN (${placeholders})
  `).all(...peopleIds);

  if (rows.length !== peopleIds.length) {
    const existingIds = new Set(rows.map((row) => row.id));
    const missingIds = peopleIds.filter((id) => !existingIds.has(id));
    throw new Error(`Unknown people ids: ${missingIds.join(", ")}`);
  }
}

function replacePhotoPeople(db, photoId, peopleIds) {
  db.prepare("DELETE FROM photo_people WHERE photo_id = ?").run(photoId);

  if (peopleIds.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO photo_people (photo_id, person_id)
    VALUES (?, ?)
  `);

  for (const personId of peopleIds) {
    insert.run(photoId, personId);
  }
}

function replacePhotoTags(db, photoId, tagIds) {
  db.prepare("DELETE FROM photo_tags WHERE photo_id = ?").run(photoId);

  if (tagIds.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO photo_tags (photo_id, tag_id)
    VALUES (?, ?)
  `);

  for (const tagId of tagIds) {
    insert.run(photoId, tagId);
  }
}

function ensureTagsExist(db, tagNames) {
  if (tagNames.length === 0) {
    return [];
  }

  for (const tagName of tagNames) {
    const existingTag = db.prepare(`
      SELECT id
      FROM tags
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
    `).get(tagName);

    if (!existingTag) {
      db.prepare(`
        INSERT INTO tags (name)
        VALUES (?)
      `).run(tagName);
    }
  }

  return findTagIdsByNames(db, tagNames);
}

function findTagIdsByNames(db, tagNames) {
  if (tagNames.length === 0) {
    return [];
  }

  const placeholders = createPlaceholders(tagNames.length);
  const rows = db.prepare(`
    SELECT id, name
    FROM tags
    WHERE LOWER(name) IN (${placeholders})
  `).all(...tagNames);
  const idByName = new Map(rows.map((row) => [String(row.name).toLowerCase(), row.id]));

  return tagNames
    .map((tagName) => idByName.get(String(tagName).toLowerCase()))
    .filter((tagId) => Number.isInteger(tagId));
}

function addPeopleToPhotos(db, photoIds, peopleIds) {
  const insert = db.prepare(`
    INSERT INTO photo_people (photo_id, person_id)
    VALUES (?, ?)
    ON CONFLICT(photo_id, person_id) DO NOTHING
  `);

  for (const photoId of photoIds) {
    for (const personId of peopleIds) {
      insert.run(photoId, personId);
    }
  }
}

function removePeopleFromPhotos(db, photoIds, peopleIds) {
  const deleteStatement = db.prepare(`
    DELETE FROM photo_people
    WHERE photo_id = ?
      AND person_id = ?
  `);

  for (const photoId of photoIds) {
    for (const personId of peopleIds) {
      deleteStatement.run(photoId, personId);
    }
  }
}

function addTagsToPhotos(db, photoIds, tagIds) {
  const insert = db.prepare(`
    INSERT INTO photo_tags (photo_id, tag_id)
    VALUES (?, ?)
    ON CONFLICT(photo_id, tag_id) DO NOTHING
  `);

  for (const photoId of photoIds) {
    for (const tagId of tagIds) {
      insert.run(photoId, tagId);
    }
  }
}

function removeTagsFromPhotos(db, photoIds, tagIds) {
  const deleteStatement = db.prepare(`
    DELETE FROM photo_tags
    WHERE photo_id = ?
      AND tag_id = ?
  `);

  for (const photoId of photoIds) {
    for (const tagId of tagIds) {
      deleteStatement.run(photoId, tagId);
    }
  }
}

function updatePhotosLocationFields(db, photoIds, locationUpdates) {
  const updates = [];
  const values = [];

  for (const [field, value] of Object.entries(locationUpdates)) {
    updates.push(`${field} = ?`);
    values.push(value);
  }

  const placeholders = createPlaceholders(photoIds.length);
  db.prepare(`
    UPDATE photos
    SET ${updates.join(", ")},
        location_manually_edited = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(...values, ...photoIds);
}

function isBadRequestError(error) {
  return error.message === "Invalid photo id"
    || error.message === "Expected an array of positive integer ids"
    || error.message === "Expected an array of tag names"
    || error.message.startsWith("Unknown people ids");
}

function parseEditRecipeJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function fetchImageBuffer(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function applyPhotoCorrection(photo, editRecipe) {
  if (!photo.original_url) {
    throw new Error("Photo does not have an original image URL");
  }

  const originalBuffer = await fetchImageBuffer(photo.original_url);
  const processedImage = await processImage(originalBuffer, photo.original_filename, {
    editRecipe
  });

  await Promise.all([
    uploadFile(photo.thumbnail_r2_key, processedImage.buffers.thumbnail, "image/jpeg"),
    uploadFile(photo.small_r2_key, processedImage.buffers.small, "image/jpeg"),
    uploadFile(photo.large_r2_key, processedImage.buffers.large, "image/jpeg")
  ]);
}

module.exports = router;
