CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  original_extension TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER,
  sha256_hash TEXT UNIQUE,
  md5_hash TEXT,
  day_one_uuid TEXT,
  width INTEGER,
  height INTEGER,
  title TEXT,
  description TEXT,
  notes_for_ai TEXT,
  alt_text TEXT,
  ai_caption TEXT,
  captured_at TEXT,
  date_source TEXT NOT NULL DEFAULT 'uploaded_at' CHECK (date_source IN ('exif', 'file_created', 'file_modified', 'uploaded_at', 'manual')),
  date_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (date_manually_edited IN (0, 1)),
  location_name TEXT,
  location_label TEXT,
  neighborhood TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  latitude REAL,
  longitude REAL,
  location_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (location_manually_edited IN (0, 1)),
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  iso INTEGER,
  shutter_speed TEXT,
  aperture TEXT,
  focal_length TEXT,
  processing_status TEXT NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'complete', 'failed', 'needs_review')),
  geo_status TEXT NOT NULL DEFAULT 'skipped' CHECK (geo_status IN ('queued', 'complete', 'skipped', 'failed')),
  processing_error TEXT,
  geo_error TEXT,
  original_r2_key TEXT,
  thumbnail_r2_key TEXT,
  small_r2_key TEXT,
  large_r2_key TEXT,
  original_url TEXT,
  thumbnail_url TEXT,
  small_url TEXT,
  large_url TEXT,
  edit_recipe_json TEXT,
  correction_status TEXT NOT NULL DEFAULT 'none' CHECK (correction_status IN ('none', 'suggested', 'applied', 'skipped')),
  photo_correction_applied_at TEXT,
  image_version INTEGER NOT NULL DEFAULT 1,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  birthday TEXT,
  notes TEXT,
  youtube_channel TEXT,
  instagram TEXT,
  website TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_people (
  photo_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, person_id),
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS person_face_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,
  face_index INTEGER NOT NULL,
  face_box_json TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  quality_score REAL,
  source TEXT NOT NULL CHECK (source IN ('manual_confirmed', 'seed_backfill')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS photo_face_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL,
  image_version INTEGER NOT NULL DEFAULT 1,
  face_index INTEGER NOT NULL,
  face_box_json TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  top_person_id INTEGER,
  top_score REAL,
  candidate_json TEXT,
  expression_json TEXT,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (top_person_id) REFERENCES people (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  group_id INTEGER REFERENCES tag_groups(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  duration_days INTEGER,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(city, date_start)
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id TEXT NOT NULL UNIQUE,
  youtube_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  video_type TEXT NOT NULL DEFAULT 'longform' CHECK (video_type IN ('short', 'longform')),
  video_type_manually_set INTEGER NOT NULL DEFAULT 0,
  video_category TEXT NOT NULL DEFAULT 'travel' CHECK (video_category IN ('travel', 'sponsored', 'review', 'other')),
  date_published TEXT,
  date_filmed TEXT,
  date_filmed_end TEXT,
  date_filmed_source TEXT DEFAULT 'none' CHECK (date_filmed_source IN ('none', 'manual', 'ai_suggested', 'confirmed')),
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  stats_refreshed_at TEXT,
  filmed_city TEXT,
  filmed_country TEXT,
  filmed_location_source TEXT DEFAULT 'none' CHECK (filmed_location_source IN ('none', 'manual', 'ai_suggested', 'confirmed')),
  alt_text TEXT,
  ai_caption TEXT,
  subtitles_text TEXT,
  notes_for_ai TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS video_people (
  video_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (video_id, person_id),
  FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (video_id, tag_id),
  FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_one_uuid TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  title TEXT,
  text TEXT,
  city TEXT,
  country TEXT,
  latitude REAL,
  longitude REAL,
  place_name TEXT,
  weather_conditions TEXT,
  weather_description TEXT,
  temperature_celsius REAL,
  wind_speed_kph REAL,
  humidity INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photos_processing_status ON photos (processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos (deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_captured_at ON photos (captured_at);
CREATE INDEX IF NOT EXISTS idx_photos_correction_applied_at ON photos (photo_correction_applied_at);
CREATE INDEX IF NOT EXISTS idx_person_face_refs_person_id ON person_face_refs (person_id);
CREATE INDEX IF NOT EXISTS idx_person_face_refs_photo_id ON person_face_refs (photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_face_matches_photo_id_image_version ON photo_face_matches (photo_id, image_version);
CREATE INDEX IF NOT EXISTS idx_photo_face_matches_status ON photo_face_matches (status);
CREATE INDEX IF NOT EXISTS idx_tag_groups_sort_order ON tag_groups (sort_order);
CREATE INDEX IF NOT EXISTS idx_destinations_date_start ON destinations (date_start);
CREATE INDEX IF NOT EXISTS idx_videos_date_published ON videos (date_published);
CREATE INDEX IF NOT EXISTS idx_videos_date_filmed ON videos (date_filmed);
CREATE INDEX IF NOT EXISTS idx_videos_deleted_at ON videos (deleted_at);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date);
