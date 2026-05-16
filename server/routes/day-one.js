const path = require("path");
const express = require("express");
const multer = require("multer");
const unzipper = require("unzipper");
const { getDb, initializeDatabase } = require("../lib/db");
const uploadRoute = require("./upload");

initializeDatabase();

const router = express.Router();
const { processUpload } = uploadRoute;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

const selectPhotoByMd5 = getDb().prepare(`
  SELECT *
  FROM photos
  WHERE md5_hash = ?
    AND deleted_at IS NULL
  LIMIT 1
`);

const selectPhotoByDateAndGps = getDb().prepare(`
  SELECT *
  FROM photos
  WHERE deleted_at IS NULL
    AND captured_at IS NOT NULL
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND ABS(strftime('%s', captured_at) - strftime('%s', ?)) <= 60
    AND ABS(latitude - ?) <= 0.001
    AND ABS(longitude - ?) <= 0.001
  ORDER BY ABS(strftime('%s', captured_at) - strftime('%s', ?)) ASC, id ASC
  LIMIT 1
`);

const selectPhotoById = getDb().prepare(`
  SELECT *
  FROM photos
  WHERE id = ?
    AND deleted_at IS NULL
  LIMIT 1
`);

const updatePhotoFromDayOne = getDb().prepare(`
  UPDATE photos
  SET title = ?,
      notes_for_ai = ?,
      day_one_uuid = ?,
      city = ?,
      country = ?,
      latitude = ?,
      longitude = ?,
      location_name = ?,
      location_label = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const selectJournalEntryByUuid = getDb().prepare(`
  SELECT id
  FROM journal_entries
  WHERE day_one_uuid = ?
  LIMIT 1
`);

const insertJournalEntry = getDb().prepare(`
  INSERT INTO journal_entries (
    day_one_uuid,
    entry_date,
    title,
    text,
    city,
    country,
    latitude,
    longitude,
    place_name,
    weather_conditions,
    weather_description,
    temperature_celsius,
    wind_speed_kph,
    humidity
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No zip file uploaded" });
    }

    const directory = await unzipper.Open.buffer(req.file.buffer);
    const zipEntries = directory.files || [];
    const journalEntry = zipEntries.find((entry) => {
      return entry.type === "File" && /(^|\/)Journal\.json$/i.test(entry.path);
    });

    if (!journalEntry) {
      return res.status(400).json({ error: "Journal.json not found in zip" });
    }

    const journal = JSON.parse((await journalEntry.buffer()).toString("utf8"));
    const journalRows = getJournalRows(journal);
    const photoFileMap = buildPhotoFileMap(zipEntries);
    const totalEntries = journalRows.length;

    beginSse(res);
    writeSse(res, {
      type: "start",
      total: totalEntries,
    });

    let matchedPhotos = 0;
    let uploadedPhotos = 0;
    let textEntriesAdded = 0;
    let skippedDuplicates = 0;
    let currentEntry = 0;

    for (const entry of journalRows) {
      currentEntry += 1;
      const entryUuid = normalizeString(entry.uuid);
      const cleanedText = cleanJournalText(entry.text || "");
      const { title: entryTitle, text: entryBody } = splitJournalText(cleanedText);
      const entryLocation = extractLocation(entry.location);
      const entryPhotos = Array.isArray(entry.photos) ? entry.photos : [];
      let entryAction = "skipped";

      if (entryPhotos.length > 0) {
        let entryMatchedCount = 0;
        let entryUploadedCount = 0;

        for (const photo of entryPhotos) {
          const photoMd5 = normalizeMd5(photo.md5);
          const photoDate = normalizeIsoDate(getPhotoDate(photo, entry));
          const photoLocation = extractLocation(photo.location || entry.location);

          let matchedPhoto = null;

          if (photoMd5) {
            matchedPhoto = selectPhotoByMd5.get(photoMd5);
          }

          if (
            !matchedPhoto &&
            photoDate &&
            photoLocation.latitude !== null &&
            photoLocation.longitude !== null
          ) {
            matchedPhoto = selectPhotoByDateAndGps.get(
              photoDate,
              photoLocation.latitude,
              photoLocation.longitude,
              photoDate,
            );
          }

          if (matchedPhoto) {
            applyDayOneMetadataToPhoto(
              matchedPhoto.id,
              entryTitle,
              cleanedText,
              entryUuid,
              photoLocation,
            );
            matchedPhotos += 1;
            entryMatchedCount += 1;
            continue;
          }

          const photoZipEntry = photoMd5 ? photoFileMap.get(photoMd5) : null;

          if (!photoZipEntry) {
            continue;
          }

          const originalFilename =
            normalizeString(photo.filename) ||
            path.basename(photoZipEntry.path);
          const buffer = await photoZipEntry.buffer();
          const importResult = await processUpload({
            originalname: originalFilename,
            mimetype: getMimeTypeFromFilename(originalFilename),
            size: buffer.length,
            buffer,
          });

          const importedPhoto = importResult.photo || null;

          if (!importedPhoto) {
            continue;
          }

          applyDayOneMetadataToPhoto(
            importedPhoto.id,
            entryTitle,
            cleanedText,
            entryUuid,
            photoLocation,
          );

          if (importResult.skipped) {
            matchedPhotos += 1;
            entryMatchedCount += 1;
          } else {
            uploadedPhotos += 1;
            entryUploadedCount += 1;
          }
        }

        if (entryUploadedCount > 0) {
          entryAction = "uploaded";
        } else if (entryMatchedCount > 0) {
          entryAction = "matched";
        }

        writeSse(res, {
          type: "progress",
          current: currentEntry,
          total: totalEntries,
          action: entryAction,
        });
        continue;
      }

      if (!entryUuid) {
        writeSse(res, {
          type: "progress",
          current: currentEntry,
          total: totalEntries,
          action: entryAction,
        });
        continue;
      }

      if (selectJournalEntryByUuid.get(entryUuid)) {
        skippedDuplicates += 1;
        writeSse(res, {
          type: "progress",
          current: currentEntry,
          total: totalEntries,
          action: entryAction,
        });
        continue;
      }

      const weather = extractWeather(entry.weather);
      const entryDate = normalizeIsoDate(getEntryDate(entry));

      insertJournalEntry.run(
        entryUuid,
        entryDate || new Date().toISOString(),
        entryTitle,
        entryBody,
        entryLocation.city,
        entryLocation.country,
        entryLocation.latitude,
        entryLocation.longitude,
        entryLocation.placeName,
        weather.weatherConditions,
        weather.weatherDescription,
        weather.temperatureCelsius,
        weather.windSpeedKph,
        weather.humidity,
      );
      textEntriesAdded += 1;
      entryAction = "journal";

      writeSse(res, {
        type: "progress",
        current: currentEntry,
        total: totalEntries,
        action: entryAction,
      });
    }

    writeSse(res, {
      type: "complete",
      matched_photos: matchedPhotos,
      uploaded_photos: uploadedPhotos,
      text_entries_added: textEntriesAdded,
      skipped_duplicates: skippedDuplicates,
    });
    return res.end();
  } catch (error) {
    if (res.headersSent) {
      writeSse(res, {
        type: "error",
        error: error.message,
      });
      return res.end();
    }

    return res.status(500).json({ error: error.message });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Zip file must be 500MB or smaller" });
  }

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  next();
});

function getJournalRows(journal) {
  if (Array.isArray(journal)) {
    return journal;
  }

  if (Array.isArray(journal.entries)) {
    return journal.entries;
  }

  return [];
}

function beginSse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildPhotoFileMap(zipEntries) {
  const photoFileMap = new Map();

  for (const entry of zipEntries) {
    if (entry.type !== "File") {
      continue;
    }

    const extension = path.extname(entry.path).toLowerCase();

    if (![".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"].includes(extension)) {
      continue;
    }

    const filename = path.basename(entry.path, extension).toLowerCase();

    if (!filename || photoFileMap.has(filename)) {
      continue;
    }

    photoFileMap.set(filename, entry);
  }

  return photoFileMap;
}

function applyDayOneMetadataToPhoto(photoId, title, text, dayOneUuid, location) {
  const currentPhoto = selectPhotoById.get(photoId);

  if (!currentPhoto) {
    return;
  }

  const nextTitle = title || currentPhoto.title || null;
  const nextNotes = normalizeString(text) || null;
  const city = currentPhoto.city || location.city || null;
  const country = currentPhoto.country || location.country || null;
  const latitude = currentPhoto.latitude ?? location.latitude ?? null;
  const longitude = currentPhoto.longitude ?? location.longitude ?? null;
  const locationName = currentPhoto.location_name || city || country || null;
  const locationLabel =
    currentPhoto.location_label ||
    [city, country].filter(Boolean).join(", ") ||
    null;

  updatePhotoFromDayOne.run(
    nextTitle,
    nextNotes,
    dayOneUuid || currentPhoto.day_one_uuid || null,
    city,
    country,
    latitude,
    longitude,
    locationName,
    locationLabel,
    photoId,
  );
}

function cleanJournalText(text) {
  return normalizeString(text)
    .replace(/!\[\]\(dayone-moment:[^)]+\)/gi, "")
    .replace(/\\([.!?,()])/g, "$1")
    .replace(/^#\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitJournalText(text) {
  const normalizedText = normalizeString(text);

  if (!normalizedText) {
    return {
      title: null,
      text: null,
    };
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      title: null,
      text: null,
    };
  }

  if (lines.length === 1) {
    return {
      title: lines[0],
      text: null,
    };
  }

  return {
    title: lines[0],
    text: lines.slice(1).join("\n").trim() || null,
  };
}

function extractLocation(location) {
  return {
    city:
      normalizeString(location?.localityName) ||
      normalizeString(location?.city) ||
      null,
    country:
      normalizeString(location?.country) ||
      normalizeString(location?.countryName) ||
      null,
    latitude: normalizeCoordinate(location?.latitude),
    longitude: normalizeCoordinate(location?.longitude),
    placeName:
      normalizeString(location?.placeName) ||
      normalizeString(location?.administrativeArea) ||
      null,
  };
}

function extractWeather(weather) {
  return {
    weatherConditions: normalizeString(weather?.weatherCode) || null,
    weatherDescription: normalizeString(weather?.conditionsDescription) || null,
    temperatureCelsius: normalizeNumber(weather?.temperatureCelsius),
    windSpeedKph: normalizeNumber(weather?.windSpeedKPH),
    humidity: normalizeInteger(weather?.relativeHumidity),
  };
}

function getPhotoDate(photo, entry) {
  return (
    photo?.date ||
    photo?.creationDate ||
    photo?.createdAt ||
    entry?.date ||
    entry?.creationDate ||
    entry?.createdAt ||
    null
  );
}

function getEntryDate(entry) {
  return entry?.date || entry?.creationDate || entry?.createdAt || null;
}

function normalizeIsoDate(value) {
  const normalizedValue = normalizeString(value);

  if (!normalizedValue) {
    return null;
  }

  const parsed = new Date(normalizedValue);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeInteger(value) {
  const number = normalizeNumber(value);

  if (number === null) {
    return null;
  }

  return Math.round(number);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeMd5(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function getMimeTypeFromFilename(filename) {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}

module.exports = router;
