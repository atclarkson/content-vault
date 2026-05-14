const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");
const processImage = require("../lib/image");
const { uploadFile, deleteFile } = require("../lib/r2");
const hashFile = require("../lib/hash");
const reverseGeocode = require("../lib/geo");
const { defaultQueue } = require("../lib/queue");
const { initializeDatabase } = require("../lib/db");

const router = express.Router();
const db = initializeDatabase();

const RAW_EXTENSIONS = new Set([
  ".cr2",
  ".cr3",
  ".arw",
  ".nef",
  ".rw2",
  ".orf",
  ".raf",
  ".dng",
  ".pef",
  ".srw"
]);

const ACCEPTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp"
]);

const EXTENSION_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".webp": "image/webp"
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 20
  },
  fileFilter(req, file, cb) {
    const extension = getExtension(file.originalname);

    if (RAW_EXTENSIONS.has(extension)) {
      return cb(
        new Error(
          `${file.originalname} is not supported. RAW files cannot be imported. Please export a JPEG from your editing software.`
        )
      );
    }

    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      return cb(
        new Error(
          `${file.originalname} is not supported. Only JPEG, PNG, HEIC, HEIF, and WebP files can be imported.`
        )
      );
    }

    cb(null, true);
  }
});

const findPhotoByHash = db.prepare(`
  SELECT *
  FROM photos
  WHERE sha256_hash = ?
  LIMIT 1
`);

const insertPhoto = db.prepare(`
  INSERT INTO photos (
    uuid,
    original_filename,
    original_extension,
    mime_type,
    file_size_bytes,
    sha256_hash,
    width,
    height,
    captured_at,
    date_source,
    latitude,
    longitude,
    camera_make,
    camera_model,
    focal_length,
    iso,
    shutter_speed,
    aperture,
    processing_status,
    geo_status,
    original_r2_key,
    thumbnail_r2_key,
    small_r2_key,
    large_r2_key,
    original_url,
    thumbnail_url,
    small_url,
    large_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectPhotoById = db.prepare(`
  SELECT *
  FROM photos
  WHERE id = ?
`);

const updatePhotoLocation = db.prepare(`
  UPDATE photos
  SET neighborhood = ?,
      location_name = ?,
      location_label = ?,
      city = ?,
      region = ?,
      country = ?,
      geo_status = ?,
      processing_status = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

router.post("/", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const results = [];

    for (const file of req.files) {
      const result = await processUpload(file);
      results.push(result);
    }

    return res.json({ data: results });
  } catch (error) {
    const statusCode = getUploadErrorStatusCode(error);
    return res.status(statusCode).json({ error: error.message });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Each file must be 50MB or smaller" });
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "A maximum of 20 files can be uploaded per request" });
    }
  }

  if (error) {
    return res.status(getUploadErrorStatusCode(error)).json({ error: error.message });
  }

  next();
});

async function processUpload(file) {
  const originalExtension = getExtension(file.originalname);
  const originalMimeType = file.mimetype || EXTENSION_MIME_TYPES[originalExtension] || "application/octet-stream";
  const fileHash = hashFile(file.buffer);
  const existingPhoto = findPhotoByHash.get(fileHash);

  if (existingPhoto) {
    return {
      skipped: true,
      reason: "duplicate",
      filename: file.originalname
    };
  }

  const processedImage = await processImage(file.buffer, file.originalname);
  const uuid = crypto.randomUUID();
  const keys = {
    original: `photos/original/${uuid}${originalExtension}`,
    thumbnail: `photos/thumb/${uuid}.jpg`,
    small: `photos/small/${uuid}.jpg`,
    large: `photos/large/${uuid}.jpg`
  };

  try {
    const [originalUrl, thumbnailUrl, smallUrl, largeUrl] = await Promise.all([
      uploadFile(keys.original, processedImage.buffers.original, originalMimeType),
      uploadFile(keys.thumbnail, processedImage.buffers.thumbnail, processedImage.mimeType),
      uploadFile(keys.small, processedImage.buffers.small, processedImage.mimeType),
      uploadFile(keys.large, processedImage.buffers.large, processedImage.mimeType)
    ]);

    const extractedExif = extractExifFields(processedImage.exif);
    const hasGps = extractedExif.gpsLat !== null && extractedExif.gpsLng !== null;
    const processingStatus = hasGps ? "processing" : "complete";
    const geoStatus = hasGps ? "queued" : "skipped";

    const insertResult = insertPhoto.run(
      uuid,
      file.originalname,
      originalExtension,
      originalMimeType,
      file.size,
      fileHash,
      processedImage.exif.width || null,
      processedImage.exif.height || null,
      extractedExif.dateTaken,
      extractedExif.dateTaken ? "exif" : "uploaded_at",
      extractedExif.gpsLat,
      extractedExif.gpsLng,
      extractedExif.cameraMake,
      extractedExif.cameraModel,
      extractedExif.focalLength,
      extractedExif.iso,
      extractedExif.shutterSpeed,
      extractedExif.aperture,
      processingStatus,
      geoStatus,
      keys.original,
      keys.thumbnail,
      keys.small,
      keys.large,
      originalUrl,
      thumbnailUrl,
      smallUrl,
      largeUrl
    );

    const photo = selectPhotoById.get(insertResult.lastInsertRowid);

    if (hasGps) {
      queueReverseGeocode(photo.id, extractedExif.gpsLat, extractedExif.gpsLng);
    }

    return { photo };
  } catch (error) {
    await cleanupUploadedFiles(Object.values(keys));
    throw error;
  }
}

function queueReverseGeocode(photoId, lat, lng) {
  defaultQueue.add(async () => {
    const location = await reverseGeocode(lat, lng);

    if (!location) {
      updatePhotoLocation.run(null, null, null, null, null, null, "failed", "complete", photoId);
      return;
    }

    const locationName = location.neighborhood || location.city || location.region || location.country || null;
    const locationLabel = [location.neighborhood, location.city, location.region, location.country]
      .filter(Boolean)
      .join(", ") || null;

    updatePhotoLocation.run(
      location.neighborhood,
      locationName,
      locationLabel,
      location.city,
      location.region,
      location.country,
      "complete",
      "complete",
      photoId
    );
  }).catch(() => {
    updatePhotoLocation.run(null, null, null, null, null, null, "failed", "complete", photoId);
  });
}

async function cleanupUploadedFiles(keys) {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await deleteFile(key);
      } catch (error) {
        return null;
      }

      return null;
    })
  );
}

function getExtension(filename) {
  return path.extname(filename || "").toLowerCase();
}

function getUploadErrorStatusCode(error) {
  if (error instanceof multer.MulterError) {
    return 400;
  }

  if (error && typeof error.message === "string") {
    if (error.message.includes("not supported")) {
      return 400;
    }

    if (error.message.startsWith("Missing required environment variable")) {
      return 500;
    }
  }

  return 500;
}

function extractExifFields(metadata) {
  const exif = metadata.exif || {};
  const gps = metadata.gps || {};

  return {
    dateTaken: normalizeExifDate(exif.DateTimeOriginal || exif.DateTime),
    gpsLat: gps.latitude ?? null,
    gpsLng: gps.longitude ?? null,
    cameraMake: exif.Make || null,
    cameraModel: exif.Model || null,
    focalLength: formatExifNumber(exif.FocalLength),
    iso: normalizeIso(exif.ISO),
    shutterSpeed: formatExifNumber(exif.ExposureTime),
    aperture: formatExifNumber(exif.FNumber)
  };
}

function normalizeExifDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function normalizeIso(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function formatExifNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Number(value.toFixed(6));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

module.exports = router;
