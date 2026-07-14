const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbDirectory = path.join(__dirname, '..', 'db');
const dbPath = path.join(dbDirectory, 'content-vault.db');
const schemaPath = path.join(dbDirectory, 'schema.sql');
const DEFAULT_UPLOADER_EMAIL = 'clarksontravels@gmail.com';

let db;

function ensureDatabase() {
  if (db) {
    return db;
  }

  fs.mkdirSync(dbDirectory, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}

function initializeDatabase() {
  const database = ensureDatabase();
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  database.exec(schemaSql);
  ensurePhotoColumns(database);
  ensureJournalTables(database);
  ensurePeopleAndTagColumns(database);
  ensureTagGroupsTable(database);
  ensureDestinationsTable(database);
  ensureVideoTables(database);
  ensureFaceTables(database);
  ensurePhotoUsagesTable(database);
  seedPeople(database);

  return database;
}

function ensurePhotoColumns(database) {
  const columns = database.prepare("PRAGMA table_info(photos)").all();
  const columnNames = new Set(columns.map((column) => column.name));

  const missingColumns = [
    {
      name: "title",
      sql: "ALTER TABLE photos ADD COLUMN title TEXT"
    },
    {
      name: "description",
      sql: "ALTER TABLE photos ADD COLUMN description TEXT"
    },
    {
      name: "notes_for_ai",
      sql: "ALTER TABLE photos ADD COLUMN notes_for_ai TEXT"
    },
    {
      name: "alt_text",
      sql: "ALTER TABLE photos ADD COLUMN alt_text TEXT"
    },
    {
      name: "ai_caption",
      sql: "ALTER TABLE photos ADD COLUMN ai_caption TEXT"
    },
    {
      name: "geo_status",
      sql: "ALTER TABLE photos ADD COLUMN geo_status TEXT NOT NULL DEFAULT 'skipped' CHECK (geo_status IN ('queued', 'complete', 'skipped', 'failed'))"
    },
    {
      name: "geo_error",
      sql: "ALTER TABLE photos ADD COLUMN geo_error TEXT"
    },
    {
      name: "original_url",
      sql: "ALTER TABLE photos ADD COLUMN original_url TEXT"
    },
    {
      name: "thumbnail_url",
      sql: "ALTER TABLE photos ADD COLUMN thumbnail_url TEXT"
    },
    {
      name: "neighborhood",
      sql: "ALTER TABLE photos ADD COLUMN neighborhood TEXT"
    },
    {
      name: "small_url",
      sql: "ALTER TABLE photos ADD COLUMN small_url TEXT"
    },
    {
      name: "large_url",
      sql: "ALTER TABLE photos ADD COLUMN large_url TEXT"
    },
    {
      name: "uploader_email",
      sql: `ALTER TABLE photos ADD COLUMN uploader_email TEXT NOT NULL DEFAULT '${DEFAULT_UPLOADER_EMAIL}'`
    },
    {
      name: "edit_recipe_json",
      sql: "ALTER TABLE photos ADD COLUMN edit_recipe_json TEXT"
    },
    {
      name: "correction_status",
      sql: "ALTER TABLE photos ADD COLUMN correction_status TEXT NOT NULL DEFAULT 'none' CHECK (correction_status IN ('none', 'suggested', 'applied', 'skipped'))"
    },
    {
      name: "photo_correction_applied_at",
      sql: "ALTER TABLE photos ADD COLUMN photo_correction_applied_at TEXT"
    },
    {
      name: "image_version",
      sql: "ALTER TABLE photos ADD COLUMN image_version INTEGER NOT NULL DEFAULT 1"
    }
  ];

  for (const column of missingColumns) {
    if (!columnNames.has(column.name)) {
      database.exec(column.sql);
    }
  }

  database.prepare(`
    UPDATE photos
    SET uploader_email = ?
    WHERE uploader_email IS NULL
       OR TRIM(uploader_email) = ''
  `).run(DEFAULT_UPLOADER_EMAIL);

  database.exec("CREATE INDEX IF NOT EXISTS idx_photos_geo_status ON photos (geo_status)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_photos_correction_applied_at ON photos (photo_correction_applied_at)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_photos_uploader_email ON photos (uploader_email)");
}

function seedPeople(database) {
  const insertPerson = database.prepare(`
    INSERT INTO people (name)
    VALUES (?)
    ON CONFLICT(name) DO NOTHING
  `);

  const defaultPeople = ['Adam', 'Lindsay', 'Lily', 'Cora', 'Harper'];

  const insertMany = database.transaction((names) => {
    for (const name of names) {
      insertPerson.run(name);
    }
  });

  insertMany(defaultPeople);
}

function ensurePeopleAndTagColumns(database) {
  ensureTableColumns(database, "people", [
    {
      name: "birthday",
      sql: "ALTER TABLE people ADD COLUMN birthday TEXT"
    },
    {
      name: "notes",
      sql: "ALTER TABLE people ADD COLUMN notes TEXT"
    },
    {
      name: "youtube_channel",
      sql: "ALTER TABLE people ADD COLUMN youtube_channel TEXT"
    },
    {
      name: "instagram",
      sql: "ALTER TABLE people ADD COLUMN instagram TEXT"
    },
    {
      name: "website",
      sql: "ALTER TABLE people ADD COLUMN website TEXT"
    }
  ]);

  ensureTableColumns(database, "tags", [
    {
      name: "color",
      sql: "ALTER TABLE tags ADD COLUMN color TEXT"
    }
  ]);
}

function ensureDestinationsTable(database) {
  database.exec(`
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
    )
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_destinations_date_start ON destinations (date_start)");
}

function ensureJournalTables(database) {
  ensureTableColumns(database, "photos", [
    {
      name: "md5_hash",
      sql: "ALTER TABLE photos ADD COLUMN md5_hash TEXT"
    },
    {
      name: "day_one_uuid",
      sql: "ALTER TABLE photos ADD COLUMN day_one_uuid TEXT"
    }
  ]);

  database.exec(`
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
    )
  `);

  ensureTableColumns(database, "journal_entries", [
    {
      name: "title",
      sql: "ALTER TABLE journal_entries ADD COLUMN title TEXT"
    }
  ]);

  database.exec("CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date)");
}

function ensureTagGroupsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS tag_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_tag_groups_sort_order ON tag_groups (sort_order)");

  ensureTableColumns(database, "tags", [
    {
      name: "group_id",
      sql: "ALTER TABLE tags ADD COLUMN group_id INTEGER REFERENCES tag_groups(id) ON DELETE SET NULL"
    }
  ]);
}

function ensurePhotoUsagesTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS photo_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_uuid TEXT NOT NULL,
      post_slug TEXT NOT NULL,
      post_title TEXT,
      placement TEXT,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (photo_uuid) REFERENCES photos (uuid) ON DELETE CASCADE
    )
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_photo_usages_photo_uuid ON photo_usages (photo_uuid)");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_usages_unique_usage
    ON photo_usages (photo_uuid, post_slug, COALESCE(placement, ''))
  `);
}

function ensureVideoTables(database) {
  database.exec(`
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
    )
  `);

  ensureTableColumns(database, "videos", [
    {
      name: "subtitles_text",
      sql: "ALTER TABLE videos ADD COLUMN subtitles_text TEXT"
    }
  ]);

  database.exec(`
    CREATE TABLE IF NOT EXISTS video_people (
      video_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (video_id, person_id),
      FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
      FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS video_tags (
      video_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (video_id, tag_id),
      FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_videos_date_published ON videos (date_published)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_videos_date_filmed ON videos (date_filmed)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_videos_deleted_at ON videos (deleted_at)");
}

function ensureFaceTables(database) {
  database.exec(`
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
    )
  `);

  database.exec(`
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
    )
  `);

  database.exec("CREATE INDEX IF NOT EXISTS idx_person_face_refs_person_id ON person_face_refs (person_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_person_face_refs_photo_id ON person_face_refs (photo_id)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_photo_face_matches_photo_id_image_version ON photo_face_matches (photo_id, image_version)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_photo_face_matches_status ON photo_face_matches (status)");
}

function ensureTableColumns(database, tableName, missingColumns) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const columnNames = new Set(columns.map((column) => column.name));

  for (const column of missingColumns) {
    if (!columnNames.has(column.name)) {
      database.exec(column.sql);
    }
  }
}

function getDb() {
  return ensureDatabase();
}

module.exports = {
  getDb,
  initializeDatabase,
  dbPath
};
