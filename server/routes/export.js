const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const photos = db.prepare(`
      SELECT photos.*
      FROM photos
      WHERE photos.deleted_at IS NULL
      ORDER BY COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC
    `).all();

    const exportedPhotos = mapExportPhotos(db, photos);
    return res.json({ data: exportedPhotos });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

function mapExportPhotos(db, photos) {
  if (photos.length === 0) {
    return [];
  }

  const photoIds = photos.map((photo) => photo.id);
  const placeholders = createPlaceholders(photoIds.length);
  const peopleRows = db.prepare(`
    SELECT photo_people.photo_id, people.name
    FROM photo_people
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photo_people.photo_id IN (${placeholders})
    ORDER BY people.name
  `).all(...photoIds);
  const tagRows = db.prepare(`
    SELECT photo_tags.photo_id, tags.name
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

    peopleMap.get(row.photo_id).push(row.name);
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.photo_id)) {
      tagsMap.set(row.photo_id, []);
    }

    tagsMap.get(row.photo_id).push(row.name);
  }

  return photos.map((photo) => ({
    id: photo.id,
    title: photo.title,
    description: photo.description,
    alt_text: photo.alt_text,
    ai_caption: null,
    date_taken: photo.captured_at,
    date_source: photo.date_source,
    people: peopleMap.get(photo.id) || [],
    tags: tagsMap.get(photo.id) || [],
    location: {
      neighborhood: photo.neighborhood,
      city: photo.city,
      region: photo.region,
      country: photo.country,
      gps: {
        lat: photo.latitude,
        lng: photo.longitude
      }
    },
    urls: {
      original: photo.original_url,
      thumbnail: photo.thumbnail_url,
      small: photo.small_url,
      large: photo.large_url
    },
    exif: {
      camera_make: photo.camera_make,
      camera_model: photo.camera_model,
      focal_length: photo.focal_length,
      iso: photo.iso,
      shutter_speed: photo.shutter_speed,
      aperture: photo.aperture
    },
    uploaded_at: photo.uploaded_at
  }));
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

module.exports = router;
