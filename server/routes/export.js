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
    const videos = db.prepare(`
      SELECT videos.*
      FROM videos
      WHERE videos.deleted_at IS NULL
      ORDER BY videos.date_published DESC, videos.id DESC
    `).all();

    const exportedPhotos = mapExportPhotos(db, photos);
    const exportedVideos = mapExportVideos(db, videos);
    return res.json({ data: { photos: exportedPhotos, videos: exportedVideos } });
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
    SELECT
      photo_people.photo_id,
      people.id,
      people.name,
      people.birthday,
      people.notes,
      people.youtube_channel,
      people.instagram,
      people.website
    FROM photo_people
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photo_people.photo_id IN (${placeholders})
    ORDER BY people.name
  `).all(...photoIds);
  const tagRows = db.prepare(`
    SELECT photo_tags.photo_id, tags.name, tags.color
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

    peopleMap.get(row.photo_id).push({
      id: row.id,
      name: row.name,
      birthday: row.birthday,
      notes: row.notes,
      youtube_channel: row.youtube_channel,
      instagram: row.instagram,
      website: row.website
    });
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.photo_id)) {
      tagsMap.set(row.photo_id, []);
    }

    tagsMap.get(row.photo_id).push({
      name: row.name,
      color: row.color || null
    });
  }

  return photos.map((photo) => ({
    id: photo.id,
    title: photo.title,
    description: photo.description,
    alt_text: photo.alt_text,
    ai_caption: photo.ai_caption || null,
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

function mapExportVideos(db, videos) {
  if (videos.length === 0) {
    return [];
  }

  const videoIds = videos.map((video) => video.id);
  const placeholders = createPlaceholders(videoIds.length);
  const peopleRows = db.prepare(`
    SELECT
      video_people.video_id,
      people.id,
      people.name,
      people.birthday,
      people.notes,
      people.youtube_channel,
      people.instagram,
      people.website
    FROM video_people
    INNER JOIN people ON people.id = video_people.person_id
    WHERE video_people.video_id IN (${placeholders})
    ORDER BY people.name
  `).all(...videoIds);
  const tagRows = db.prepare(`
    SELECT video_tags.video_id, tags.name, tags.color
    FROM video_tags
    INNER JOIN tags ON tags.id = video_tags.tag_id
    WHERE video_tags.video_id IN (${placeholders})
    ORDER BY tags.name
  `).all(...videoIds);

  const peopleMap = new Map();
  const tagsMap = new Map();

  for (const row of peopleRows) {
    if (!peopleMap.has(row.video_id)) {
      peopleMap.set(row.video_id, []);
    }

    peopleMap.get(row.video_id).push({
      id: row.id,
      name: row.name,
      birthday: row.birthday,
      notes: row.notes,
      youtube_channel: row.youtube_channel,
      instagram: row.instagram,
      website: row.website
    });
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.video_id)) {
      tagsMap.set(row.video_id, []);
    }

    tagsMap.get(row.video_id).push({
      name: row.name,
      color: row.color || null
    });
  }

  return videos.map((video) => ({
    id: video.id,
    youtube_id: video.youtube_id,
    youtube_url: video.youtube_url,
    title: video.title,
    description: video.description,
    thumbnail_url: video.thumbnail_url,
    video_type: video.video_type,
    video_category: video.video_category,
    duration_seconds: video.duration_seconds,
    date_published: video.date_published,
    date_filmed: video.date_filmed,
    date_filmed_end: video.date_filmed_end,
    date_filmed_source: video.date_filmed_source,
    filmed_city: video.filmed_city,
    filmed_country: video.filmed_country,
    filmed_location_source: video.filmed_location_source,
    people: peopleMap.get(video.id) || [],
    tags: tagsMap.get(video.id) || [],
    stats: {
      view_count: video.view_count,
      like_count: video.like_count,
      comment_count: video.comment_count,
      refreshed_at: video.stats_refreshed_at
    },
    ai_caption: video.ai_caption || null,
    alt_text: video.alt_text || null,
    notes_for_ai: video.notes_for_ai || null
  }));
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

module.exports = router;
