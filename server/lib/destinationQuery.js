function queryDestinations(db) {
  const contentByLocation = new Map();
  const destinationRows = safeAll(db, `
    SELECT DISTINCT city, country
    FROM destinations
    ORDER BY city ASC, country ASC
  `);

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

  return Array.from(contentByLocation.values()).sort((left, right) => {
    const leftTotal = left.photos + left.videos + left.journals;
    const rightTotal = right.photos + right.videos + right.journals;

    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }

    return `${left.country} ${left.city}`.localeCompare(`${right.country} ${right.city}`);
  });
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

module.exports = {
  queryDestinations
};
