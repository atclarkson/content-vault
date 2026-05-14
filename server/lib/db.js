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
  seedPeople(database);

  return database;
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

function getDb() {
  return ensureDatabase();
}

module.exports = {
  getDb,
  initializeDatabase,
  dbPath
};
