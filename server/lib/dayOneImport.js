const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { getDb, initializeDatabase } = require("./db");
const { processUpload } = require("../routes/upload");

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp"
]);

const VIDEO_EXTENSIONS = new Set([
  ".mov",
  ".mp4",
  ".m4v",
  ".avi",
  ".mkv",
  ".webm",
  ".mpg",
  ".mpeg",
  ".3gp"
]);

function createDayOneImporter() {
  initializeDatabase();
  const db = getDb();

  const selectPhotoByMd5 = db.prepare(`
    SELECT *
    FROM photos
    WHERE md5_hash = ?
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const selectPhotoByDateAndGps = db.prepare(`
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

  const selectPhotoById = db.prepare(`
    SELECT *
    FROM photos
    WHERE id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const updatePhotoFromDayOne = db.prepare(`
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

  const selectJournalEntryByUuid = db.prepare(`
    SELECT id
    FROM journal_entries
    WHERE day_one_uuid = ?
    LIMIT 1
  `);

  const insertJournalEntry = db.prepare(`
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

  return async function importDayOneFromPath(options = {}) {
    const inputPath = String(options.inputPath || "").trim();
    const skipPhotos = options.skipPhotos === true;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};

    if (!inputPath) {
      throw new Error("An inputPath is required");
    }

    const resolvedInputPath = path.resolve(inputPath);
    const source = await openDayOneSource(resolvedInputPath);

    try {
      const journal = await source.readJournal();
      const journalRows = getJournalRows(journal);
      const totalEntries = journalRows.length;

      onProgress({
        type: "scan",
        source_type: source.type,
        input_path: resolvedInputPath,
        total_entries: totalEntries,
        total_files: source.summary.totalFiles,
        image_files: source.summary.imageFiles,
        video_files: source.summary.videoFiles,
        other_files: source.summary.otherFiles,
        image_bytes: source.summary.imageBytes,
        video_bytes: source.summary.videoBytes,
        other_bytes: source.summary.otherBytes,
        largest_files: source.summary.largestFiles
      });

      onProgress({
        type: "start",
        total: totalEntries
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
        const entryPhotos = skipPhotos ? [] : (Array.isArray(entry.photos) ? entry.photos : []);
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
                photoDate
              );
            }

            if (matchedPhoto) {
              applyDayOneMetadataToPhoto(
                selectPhotoById,
                updatePhotoFromDayOne,
                matchedPhoto.id,
                entryTitle,
                cleanedText,
                entryUuid,
                photoLocation
              );
              matchedPhotos += 1;
              entryMatchedCount += 1;
              continue;
            }

            const photoAsset = photoMd5 ? await source.getPhotoAsset(photoMd5) : null;

            if (!photoAsset) {
              continue;
            }

            const originalFilename =
              normalizeString(photo.filename) ||
              photoAsset.filename;
            const importResult = await processUpload({
              originalname: originalFilename,
              mimetype: getMimeTypeFromFilename(originalFilename),
              size: photoAsset.buffer.length,
              buffer: photoAsset.buffer
            });

            const importedPhoto = importResult.photo || null;

            if (!importedPhoto) {
              continue;
            }

            applyDayOneMetadataToPhoto(
              selectPhotoById,
              updatePhotoFromDayOne,
              importedPhoto.id,
              entryTitle,
              cleanedText,
              entryUuid,
              photoLocation
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

          onProgress({
            type: "progress",
            current: currentEntry,
            total: totalEntries,
            action: entryAction,
            matched_photos: matchedPhotos,
            uploaded_photos: uploadedPhotos,
            text_entries_added: textEntriesAdded,
            skipped_duplicates: skippedDuplicates
          });

          continue;
        }

        if (!entryUuid) {
          onProgress({
            type: "progress",
            current: currentEntry,
            total: totalEntries,
            action: entryAction,
            matched_photos: matchedPhotos,
            uploaded_photos: uploadedPhotos,
            text_entries_added: textEntriesAdded,
            skipped_duplicates: skippedDuplicates
          });
          continue;
        }

        if (selectJournalEntryByUuid.get(entryUuid)) {
          skippedDuplicates += 1;
          onProgress({
            type: "progress",
            current: currentEntry,
            total: totalEntries,
            action: entryAction,
            matched_photos: matchedPhotos,
            uploaded_photos: uploadedPhotos,
            text_entries_added: textEntriesAdded,
            skipped_duplicates: skippedDuplicates
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
          weather.humidity
        );
        textEntriesAdded += 1;
        entryAction = "journal";

        onProgress({
          type: "progress",
          current: currentEntry,
          total: totalEntries,
          action: entryAction,
          matched_photos: matchedPhotos,
          uploaded_photos: uploadedPhotos,
          text_entries_added: textEntriesAdded,
          skipped_duplicates: skippedDuplicates
        });
      }

      const result = {
        matched_photos: matchedPhotos,
        uploaded_photos: uploadedPhotos,
        text_entries_added: textEntriesAdded,
        skipped_duplicates: skippedDuplicates,
        total_entries: totalEntries,
        source_type: source.type,
        input_path: resolvedInputPath
      };

      onProgress({
        type: "complete",
        ...result
      });

      return result;
    } finally {
      await source.close();
    }
  };
}

async function openDayOneSource(inputPath) {
  const stats = fs.statSync(inputPath);

  if (stats.isDirectory()) {
    return openDayOneDirectory(inputPath);
  }

  if (stats.isFile() && path.extname(inputPath).toLowerCase() === ".zip") {
    return openDayOneZip(inputPath);
  }

  throw new Error("Input path must be a Day One zip file or extracted folder");
}

async function openDayOneZip(inputPath) {
  const directory = await unzipper.Open.file(inputPath);
  const entries = directory.files || [];
  const journalEntry = entries.find((entry) => entry.type === "File" && /(^|\/)Journal\.json$/i.test(entry.path));

  if (!journalEntry) {
    throw new Error("Journal.json not found in zip");
  }

  const { photoFileMap, summary } = buildPhotoFileMapFromZipEntries(entries);

  return {
    type: "zip",
    summary,
    async readJournal() {
      return JSON.parse((await journalEntry.buffer()).toString("utf8"));
    },
    async getPhotoAsset(md5) {
      const asset = photoFileMap.get(md5);

      if (!asset) {
        return null;
      }

      return {
        filename: asset.filename,
        buffer: await asset.entry.buffer()
      };
    },
    async close() {
      return null;
    }
  };
}

function openDayOneDirectory(inputPath) {
  const files = walkFiles(inputPath);
  const journalPath = files.find((filePath) => /(^|\/)Journal\.json$/i.test(filePath));

  if (!journalPath) {
    throw new Error("Journal.json not found in folder");
  }

  const { photoFileMap, summary } = buildPhotoFileMapFromDirectoryFiles(files);

  return {
    type: "directory",
    summary,
    async readJournal() {
      return JSON.parse(fs.readFileSync(journalPath, "utf8"));
    },
    async getPhotoAsset(md5) {
      const asset = photoFileMap.get(md5);

      if (!asset) {
        return null;
      }

      return {
        filename: asset.filename,
        buffer: fs.readFileSync(asset.path)
      };
    },
    async close() {
      return null;
    }
  };
}

function buildPhotoFileMapFromZipEntries(entries) {
  const photoFileMap = new Map();
  const summary = createSourceSummary();

  for (const entry of entries) {
    if (entry.type !== "File") {
      continue;
    }

    const extension = path.extname(entry.path).toLowerCase();
    const filename = path.basename(entry.path);
    const size = Number(entry.uncompressedSize || entry.vars?.uncompressedSize || 0);
    trackSourceFile(summary, entry.path, extension, size);

    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    const basename = path.basename(entry.path, extension).toLowerCase();

    if (!basename || photoFileMap.has(basename)) {
      continue;
    }

    photoFileMap.set(basename, {
      filename,
      entry
    });
  }

  finalizeSourceSummary(summary);

  return { photoFileMap, summary };
}

function buildPhotoFileMapFromDirectoryFiles(files) {
  const photoFileMap = new Map();
  const summary = createSourceSummary();

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    trackSourceFile(summary, filePath, extension, stats.size);

    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    const basename = path.basename(filePath, extension).toLowerCase();

    if (!basename || photoFileMap.has(basename)) {
      continue;
    }

    photoFileMap.set(basename, {
      filename,
      path: filePath
    });
  }

  finalizeSourceSummary(summary);

  return { photoFileMap, summary };
}

function walkFiles(rootPath) {
  const stack = [rootPath];
  const files = [];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const stats = fs.statSync(currentPath);

    if (stats.isDirectory()) {
      const entries = fs.readdirSync(currentPath);

      for (const entry of entries) {
        stack.push(path.join(currentPath, entry));
      }

      continue;
    }

    if (stats.isFile()) {
      files.push(currentPath);
    }
  }

  return files;
}

function createSourceSummary() {
  return {
    totalFiles: 0,
    imageFiles: 0,
    videoFiles: 0,
    otherFiles: 0,
    imageBytes: 0,
    videoBytes: 0,
    otherBytes: 0,
    largestFiles: []
  };
}

function trackSourceFile(summary, filePath, extension, size) {
  summary.totalFiles += 1;

  if (IMAGE_EXTENSIONS.has(extension)) {
    summary.imageFiles += 1;
    summary.imageBytes += size;
  } else if (VIDEO_EXTENSIONS.has(extension)) {
    summary.videoFiles += 1;
    summary.videoBytes += size;
  } else {
    summary.otherFiles += 1;
    summary.otherBytes += size;
  }

  summary.largestFiles.push({
    path: filePath,
    size
  });
}

function finalizeSourceSummary(summary) {
  summary.largestFiles = summary.largestFiles
    .sort((left, right) => right.size - left.size)
    .slice(0, 10);
}

function getJournalRows(journal) {
  if (Array.isArray(journal)) {
    return journal;
  }

  if (Array.isArray(journal.entries)) {
    return journal.entries;
  }

  return [];
}

function applyDayOneMetadataToPhoto(selectPhotoById, updatePhotoFromDayOne, photoId, title, text, dayOneUuid, location) {
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
    photoId
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
      text: null
    };
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      title: null,
      text: null
    };
  }

  if (lines.length === 1) {
    return {
      title: lines[0],
      text: null
    };
  }

  return {
    title: lines[0],
    text: lines.slice(1).join("\n").trim() || null
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
      null
  };
}

function extractWeather(weather) {
  return {
    weatherConditions: normalizeString(weather?.weatherCode) || null,
    weatherDescription: normalizeString(weather?.conditionsDescription) || null,
    temperatureCelsius: normalizeNumber(weather?.temperatureCelsius),
    windSpeedKph: normalizeNumber(weather?.windSpeedKPH),
    humidity: normalizeInteger(weather?.relativeHumidity)
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

module.exports = {
  createDayOneImporter
};
