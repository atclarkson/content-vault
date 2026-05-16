const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");
const exifReader = require("exif-reader");
const processImage = require("../lib/image");
const { uploadFile, deleteFile } = require("../lib/r2");
const { hashFile, md5File } = require("../lib/hash");
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
  ".srw",
]);

const ACCEPTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp",
]);

const EXTENSION_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".webp": "image/webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    const extension = getExtension(file.originalname);

    if (RAW_EXTENSIONS.has(extension)) {
      return cb(
        new Error(
          `${file.originalname} is not supported. RAW files cannot be imported. Please export a JPEG from your editing software.`,
        ),
      );
    }

    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      return cb(
        new Error(
          `${file.originalname} is not supported. Only JPEG, PNG, HEIC, HEIF, and WebP files can be imported.`,
        ),
      );
    }

    cb(null, true);
  },
});

const findActivePhotoByHash = db.prepare(`
  SELECT *
  FROM photos
  WHERE sha256_hash = ?
    AND deleted_at IS NULL
  LIMIT 1
`);

const findDeletedPhotoByHash = db.prepare(`
  SELECT *
  FROM photos
  WHERE sha256_hash = ?
    AND deleted_at IS NOT NULL
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
    md5_hash,
    width,
    height,
    title,
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectPhotoById = db.prepare(`
  SELECT *
  FROM photos
  WHERE id = ?
`);

const clearPhotoPeople = db.prepare(`
  DELETE FROM photo_people
  WHERE photo_id = ?
`);

const clearPhotoTags = db.prepare(`
  DELETE FROM photo_tags
  WHERE photo_id = ?
`);

const restoreDeletedPhoto = db.prepare(`
  UPDATE photos
  SET uuid = ?,
      original_filename = ?,
      original_extension = ?,
      mime_type = ?,
      file_size_bytes = ?,
      sha256_hash = ?,
      md5_hash = ?,
      width = ?,
      height = ?,
      title = ?,
      description = NULL,
      alt_text = NULL,
      ai_caption = NULL,
      captured_at = ?,
      date_source = ?,
      date_manually_edited = 0,
      location_name = NULL,
      location_label = NULL,
      neighborhood = NULL,
      city = NULL,
      region = NULL,
      country = NULL,
      latitude = ?,
      longitude = ?,
      location_manually_edited = 0,
      camera_make = ?,
      camera_model = ?,
      focal_length = ?,
      iso = ?,
      shutter_speed = ?,
      aperture = ?,
      processing_status = ?,
      geo_status = ?,
      processing_error = NULL,
      geo_error = NULL,
      original_r2_key = ?,
      thumbnail_r2_key = ?,
      small_r2_key = ?,
      large_r2_key = ?,
      original_url = ?,
      thumbnail_url = ?,
      small_url = ?,
      large_url = ?,
      uploaded_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP,
      deleted_at = NULL
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

router.post("/", upload.array("files"), async (req, res) => {
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
      return res
        .status(400)
        .json({ error: "Each file must be 50MB or smaller" });
    }
  }

  if (error) {
    return res
      .status(getUploadErrorStatusCode(error))
      .json({ error: error.message });
  }

  next();
});

async function processUpload(file) {
  const originalExtension = getExtension(file.originalname);
  const originalMimeType =
    file.mimetype ||
    EXTENSION_MIME_TYPES[originalExtension] ||
    "application/octet-stream";
  const fileHash = hashFile(file.buffer);
  const md5Hash = md5File(file.buffer);
  const derivedTitle = buildTitleFromFilename(file.originalname);
  const existingPhoto = findActivePhotoByHash.get(fileHash);
  const deletedPhoto = existingPhoto ? null : findDeletedPhotoByHash.get(fileHash);

  if (existingPhoto) {
    return {
      skipped: true,
      reason: "duplicate",
      filename: file.originalname,
      photo: existingPhoto,
    };
  }

  const processedImage = await processImage(file.buffer, file.originalname);
  const uuid = crypto.randomUUID();
  const keys = {
    original: `photos/original/${uuid}${originalExtension}`,
    thumbnail: `photos/thumb/${uuid}.jpg`,
    small: `photos/small/${uuid}.jpg`,
    large: `photos/large/${uuid}.jpg`,
  };

  try {
    const [originalUrl, thumbnailUrl, smallUrl, largeUrl] = await Promise.all([
      uploadFile(
        keys.original,
        processedImage.buffers.original,
        originalMimeType,
      ),
      uploadFile(
        keys.thumbnail,
        processedImage.buffers.thumbnail,
        processedImage.mimeType,
      ),
      uploadFile(
        keys.small,
        processedImage.buffers.small,
        processedImage.mimeType,
      ),
      uploadFile(
        keys.large,
        processedImage.buffers.large,
        processedImage.mimeType,
      ),
    ]);

    const extractedExif = extractExifFields(processedImage.exif);
    const hasGps =
      extractedExif.gpsLat !== null && extractedExif.gpsLng !== null;
    const processingStatus = hasGps ? "processing" : "complete";
    const geoStatus = hasGps ? "queued" : "skipped";

    let photoId;

    if (deletedPhoto) {
      restoreDeletedPhoto.run(
        uuid,
        file.originalname,
        originalExtension,
        originalMimeType,
        file.size,
        fileHash,
        md5Hash,
        processedImage.exif.width || null,
        processedImage.exif.height || null,
        derivedTitle,
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
        largeUrl,
        deletedPhoto.id,
      );

      clearPhotoPeople.run(deletedPhoto.id);
      clearPhotoTags.run(deletedPhoto.id);
      photoId = deletedPhoto.id;
      await cleanupUploadedFiles(
        [
          deletedPhoto.original_r2_key,
          deletedPhoto.thumbnail_r2_key,
          deletedPhoto.small_r2_key,
          deletedPhoto.large_r2_key,
        ].filter(Boolean),
      );
    } else {
      const insertResult = insertPhoto.run(
        uuid,
        file.originalname,
        originalExtension,
        originalMimeType,
        file.size,
        fileHash,
        md5Hash,
        processedImage.exif.width || null,
        processedImage.exif.height || null,
        derivedTitle,
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
        largeUrl,
      );

      photoId = insertResult.lastInsertRowid;
    }

    const photo = selectPhotoById.get(photoId);

    if (hasGps) {
      queueReverseGeocode(photo.id, extractedExif.gpsLat, extractedExif.gpsLng);
    }

    return { photo };
  } catch (error) {
    await cleanupUploadedFiles(Object.values(keys));
    throw error;
  }
}

function buildTitleFromFilename(originalFilename) {
  const basename = path.basename(originalFilename, path.extname(originalFilename));

  return basename
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queueReverseGeocode(photoId, lat, lng) {
  defaultQueue
    .add(async () => {
      const location = await reverseGeocode(lat, lng);

      if (!location) {
        updatePhotoLocation.run(
          null,
          null,
          null,
          null,
          null,
          null,
          "failed",
          "complete",
          photoId,
        );
        return;
      }

      const locationName =
        location.neighborhood ||
        location.city ||
        location.region ||
        location.country ||
        null;
      const locationLabel =
        [
          location.neighborhood,
          location.city,
          location.region,
          location.country,
        ]
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
        photoId,
      );
    })
    .catch(() => {
      updatePhotoLocation.run(
        null,
        null,
        null,
        null,
        null,
        null,
        "failed",
        "complete",
        photoId,
      );
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
    }),
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
  try {
    if (!Buffer.isBuffer(metadata.exif) || metadata.exif.length === 0) {
      return allNulls();
    }

    const parsed = exifReader(metadata.exif);

    return {
      dateTaken:
        parsed.Photo?.DateTimeOriginal?.toISOString() ||
        parsed.Image?.DateTime?.toISOString() ||
        null,
      gpsLat: convertGps(
        parsed.GPSInfo?.GPSLatitude,
        parsed.GPSInfo?.GPSLatitudeRef,
      ),
      gpsLng: convertGps(
        parsed.GPSInfo?.GPSLongitude,
        parsed.GPSInfo?.GPSLongitudeRef,
      ),
      cameraMake: parsed.Image?.Make || null,
      cameraModel: parsed.Image?.Model || null,
      focalLength: parsed.Photo?.FocalLength
        ? `${Math.round(parsed.Photo.FocalLength * 10) / 10}mm`
        : null,
      iso: parsed.Photo?.ISOSpeedRatings || null,
      shutterSpeed: parsed.Photo?.ExposureTime
        ? `1/${Math.round(1 / parsed.Photo.ExposureTime)}`
        : null,
      aperture: parsed.Photo?.FNumber ? `f/${Math.round(parsed.Photo.FNumber * 10) / 10}` : null,
    };
  } catch {
    return allNulls();
  }
}

function convertGps(values, ref) {
  if (!Array.isArray(values) || values.length < 3) {
    return null;
  }

  const [degrees, minutes, seconds] = values;
  let decimal = degrees + minutes / 60 + seconds / 3600;

  if (ref === "S" || ref === "W") {
    decimal *= -1;
  }

  return Number(decimal.toFixed(8));
}

function allNulls() {
  return {
    dateTaken: null,
    gpsLat: null,
    gpsLng: null,
    cameraMake: null,
    cameraModel: null,
    focalLength: null,
    iso: null,
    shutterSpeed: null,
    aperture: null,
  };
}

module.exports = router;
module.exports.processUpload = processUpload;
