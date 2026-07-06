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

router.get("/raw", (req, res) => {
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

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const contentByLocation = new Map();
    const destinationRows = db.prepare(`
      SELECT DISTINCT city, country
      FROM destinations
      ORDER BY city ASC, country ASC
    `).all();

    for (const row of destinationRows) {
      upsertLocation(contentByLocation, row.city, row.country);
    }

    mergePhotos(contentByLocation, safeAll(db, `
      SELECT
        city,
        country,
        COUNT(*) AS count,
        MIN(captured_at) AS date_first,
        MAX(captured_at) AS date_last
      FROM photos
      WHERE deleted_at IS NULL
        AND NULLIF(TRIM(COALESCE(city, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(country, '')), '') IS NOT NULL
      GROUP BY city, country
    `));

    mergeVideos(contentByLocation, safeAll(db, `
      SELECT
        filmed_city AS city,
        filmed_country AS country,
        COUNT(*) AS count,
        MIN(COALESCE(date_filmed, date_published)) AS date_first,
        MAX(COALESCE(date_filmed, date_published)) AS date_last
      FROM videos
      WHERE deleted_at IS NULL
        AND NULLIF(TRIM(COALESCE(filmed_city, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(filmed_country, '')), '') IS NOT NULL
      GROUP BY filmed_city, filmed_country
    `));

    mergeJournals(contentByLocation, safeAll(db, `
      SELECT
        city,
        country,
        COUNT(*) AS count,
        MIN(entry_date) AS date_first,
        MAX(entry_date) AS date_last
      FROM journal_entries
      WHERE NULLIF(TRIM(COALESCE(city, '')), '') IS NOT NULL
        AND NULLIF(TRIM(COALESCE(country, '')), '') IS NOT NULL
      GROUP BY city, country
    `));

    const destinations = Array.from(contentByLocation.values()).sort((left, right) => {
      const leftTotal = left.photos + left.videos + left.journals;
      const rightTotal = right.photos + right.videos + right.journals;

      if (rightTotal !== leftTotal) {
        return rightTotal - leftTotal;
      }

      return `${left.country} ${left.city}`.localeCompare(`${right.country} ${right.city}`);
    });

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
    let filtered = 0;
    let total = 0;

    const importRows = getDb().transaction((dataRows) => {
      for (const row of dataRows) {
        if (row.length === 1 && !String(row[0] || "").trim()) {
          continue;
        }

        total += 1;

        const parsedRow = parseDestinationRow(row);

        if (!parsedRow || parsedRow.dateStart < "2022-01-01") {
          filtered += 1;
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

    return res.json({ data: { added, skipped, filtered, total } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code });
  }

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  next();
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

function safeAll(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch (error) {
    if (error.message && error.message.includes("no such table:")) {
      return [];
    }

    throw error;
  }
}

function upsertLocation(contentByLocation, city, country) {
  const normalizedCity = String(city || "").trim();
  const normalizedCountry = String(country || "").trim();
  const key = `${normalizedCity}::${normalizedCountry}`;

  if (!contentByLocation.has(key)) {
    contentByLocation.set(key, {
      city: normalizedCity,
      country: normalizedCountry,
      photos: 0,
      videos: 0,
      journals: 0,
      date_first: null,
      date_last: null
    });
  }

  return contentByLocation.get(key);
}

function mergePhotos(contentByLocation, rows) {
  for (const row of rows) {
    const destination = upsertLocation(contentByLocation, row.city, row.country);
    destination.photos = Number(row.count) || 0;
    mergeDateBounds(destination, row.date_first, row.date_last);
  }
}

function mergeVideos(contentByLocation, rows) {
  for (const row of rows) {
    const destination = upsertLocation(contentByLocation, row.city, row.country);
    destination.videos = Number(row.count) || 0;
    mergeDateBounds(destination, row.date_first, row.date_last);
  }
}

function mergeJournals(contentByLocation, rows) {
  for (const row of rows) {
    const destination = upsertLocation(contentByLocation, row.city, row.country);
    destination.journals = Number(row.count) || 0;
    mergeDateBounds(destination, row.date_first, row.date_last);
  }
}

function mergeDateBounds(destination, dateFirst, dateLast) {
  if (dateFirst && (!destination.date_first || dateFirst < destination.date_first)) {
    destination.date_first = dateFirst;
  }

  if (dateLast && (!destination.date_last || dateLast > destination.date_last)) {
    destination.date_last = dateLast;
  }
}

module.exports = router;
