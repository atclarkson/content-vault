const Database = require("better-sqlite3");
const { dbPath } = require("../server/lib/db");
const { normalizePlaceName } = require("../server/lib/placeNames");

const SHOULD_APPLY = process.argv.includes("--apply");
const SAMPLE_LIMIT = 5;
const TABLES = [
  {
    name: "photos",
    candidateColumns: ["neighborhood", "city", "region", "country", "location_name", "location_label"]
  },
  {
    name: "videos",
    candidateColumns: ["filmed_city", "filmed_country"]
  },
  {
    name: "journal_entries",
    candidateColumns: ["city", "country", "place_name"]
  }
];

function getExistingColumns(database, tableName) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.map((column) => column.name);
}

function buildChangedValues(row, columns) {
  const changedValues = {};

  for (const column of columns) {
    const currentValue = row[column];
    const normalizedValue = normalizePlaceName(currentValue);

    if (currentValue !== normalizedValue) {
      changedValues[column] = normalizedValue;
    }
  }

  return changedValues;
}

function formatSample(row, changedValues) {
  return Object.entries(changedValues).map(([column, nextValue]) => ({
    column,
    before: row[column],
    after: nextValue
  }));
}

function main() {
  const database = new Database(dbPath);
  let totalRowsScanned = 0;
  let totalRowsChanged = 0;
  const pendingUpdates = [];

  try {
    for (const table of TABLES) {
      const existingColumns = getExistingColumns(database, table.name);
      const columns = table.candidateColumns.filter((column) => existingColumns.includes(column));

      if (columns.length === 0) {
        console.log(`${table.name}: skipped (no matching columns)`);
        continue;
      }

      const selectSql = `SELECT id, ${columns.join(", ")} FROM ${table.name}`;
      const rows = database.prepare(selectSql).all();
      const changedRows = [];

      totalRowsScanned += rows.length;

      for (const row of rows) {
        const changedValues = buildChangedValues(row, columns);

        if (Object.keys(changedValues).length === 0) {
          continue;
        }

        changedRows.push({
          id: row.id,
          changedValues,
          sample: formatSample(row, changedValues)
        });
      }

      totalRowsChanged += changedRows.length;

      console.log(
        `${table.name}: ${rows.length} scanned, ${changedRows.length} ${SHOULD_APPLY ? "changed" : "would change"}`
      );

      for (const row of changedRows.slice(0, SAMPLE_LIMIT)) {
        for (const sample of row.sample) {
          console.log(`  #${row.id} ${sample.column}: ${JSON.stringify(sample.before)} -> ${JSON.stringify(sample.after)}`);
        }
      }

      if (changedRows.length > SAMPLE_LIMIT) {
        console.log(`  ... ${changedRows.length - SAMPLE_LIMIT} more row(s)`);
      }

      pendingUpdates.push({
        tableName: table.name,
        columns,
        rows: changedRows
      });
    }

    if (!SHOULD_APPLY) {
      console.log("");
      console.log(`Dry run only. Re-run with --apply to write changes.`);
      console.log(`Summary: ${totalRowsScanned} scanned, ${totalRowsChanged} would change.`);
      return;
    }

    const applyUpdates = database.transaction((updates) => {
      for (const table of updates) {
        for (const row of table.rows) {
          const assignments = Object.keys(row.changedValues).map((column) => `${column} = @${column}`).join(", ");
          const statement = database.prepare(`UPDATE ${table.tableName} SET ${assignments} WHERE id = @id`);

          statement.run({
            id: row.id,
            ...row.changedValues
          });
        }
      }
    });

    applyUpdates(pendingUpdates);

    console.log("");
    console.log(`Applied changes.`);
    console.log(`Summary: ${totalRowsScanned} scanned, ${totalRowsChanged} changed.`);
  } finally {
    database.close();
  }
}

main();
