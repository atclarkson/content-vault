const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbDirectory = path.join(__dirname, '..', 'db');
const dbPath = path.join(dbDirectory, 'content-vault.db');
const schemaPath = path.join(dbDirectory, 'schema.sql');

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
  ensureDestinationsTable(database);
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
    }
  ];

  for (const column of missingColumns) {
    if (!columnNames.has(column.name)) {
      database.exec(column.sql);
    }
  }

  database.exec("CREATE INDEX IF NOT EXISTS idx_photos_geo_status ON photos (geo_status)");
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

function getDb() {
  return ensureDatabase();
}

module.exports = {
  getDb,
  initializeDatabase,
  dbPath
};
