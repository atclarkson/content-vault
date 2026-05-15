const express = require("express");
const multer = require("multer");
const { getDb, initializeDatabase } = require("../lib/db");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

initializeDatabase();

const insertDestination = getDb().prepare(`
  INSERT OR IGNORE INTO destinations (
    city,
    country,
    date_start,
    date_end,
    duration_days
  ) VALUES (?, ?, ?, ?, ?)
`);

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const destinations = db.prepare(`
      SELECT *
      FROM destinations
      ORDER BY date_start ASC, id ASC
    `).all();

    return res.json({ data: destinations });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/import", upload.single("file"), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const csvText = req.file.buffer.toString("utf8");
    const rows = parseCsv(csvText);

    if (rows.length <= 1) {
      return res.status(400).json({ error: "CSV file must include a header row and at least one data row" });
    }

    const header = rows[0].map((value) => value.trim());
    const expectedHeader = [
      "Arrival date",
      "Departure date",
      "Duration in days",
      "City",
      "Country"
    ];

    if (!headersMatch(header, expectedHeader)) {
      return res.status(400).json({ error: "CSV header must be: Arrival date, Departure date, Duration in days, City, Country" });
    }

    let added = 0;
    let skipped = 0;
    let total = 0;

    const importRows = getDb().transaction((dataRows) => {
      for (const row of dataRows) {
        if (row.length === 1 && !String(row[0] || "").trim()) {
          continue;
        }

        total += 1;

        const parsedRow = parseDestinationRow(row);

        if (!parsedRow || parsedRow.dateStart < "2022-01-01") {
          skipped += 1;
          continue;
        }

        const result = insertDestination.run(
          parsedRow.city,
          parsedRow.country,
          parsedRow.dateStart,
          parsedRow.dateEnd,
          parsedRow.durationDays
        );

        if (result.changes > 0) {
          added += 1;
        } else {
          skipped += 1;
        }
      }
    });

    importRows(rows.slice(1));

    return res.json({ data: { added, skipped, total } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

function headersMatch(actual, expected) {
  if (actual.length !== expected.length) {
    return false;
  }

  return actual.every((value, index) => value === expected[index]);
}

function parseDestinationRow(row) {
  if (row.length < 5) {
    return null;
  }

  const dateStart = normalizeDate(row[0]);
  const dateEnd = normalizeDate(row[1]);
  const durationValue = String(row[2] || "").trim();
  const city = String(row[3] || "").trim();
  const country = String(row[4] || "").trim();

  if (!dateStart || !dateEnd || !city || !country) {
    return null;
  }

  const durationDays = durationValue ? Number.parseInt(durationValue, 10) : null;

  return {
    dateStart,
    dateEnd,
    durationDays: Number.isInteger(durationDays) ? durationDays : null,
    city,
    country
  };
}

function normalizeDate(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const parsedDate = new Date(text);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString().slice(0, 10);
}

function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

module.exports = router;
