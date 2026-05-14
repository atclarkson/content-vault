const path = require("path");
const sharp = require("sharp");

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

function getNormalizedExtension(originalFilename) {
  return path.extname(originalFilename || "").toLowerCase();
}

function validateExtension(originalFilename) {
  const extension = getNormalizedExtension(originalFilename);

  if (RAW_EXTENSIONS.has(extension)) {
    throw new Error(
      `${originalFilename} is not supported. RAW files cannot be imported. Please export a JPEG from your editing software.`
    );
  }

  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `${originalFilename} is not supported. Only JPEG, PNG, HEIC, HEIF, and WebP files can be imported.`
    );
  }
}

async function createDerivative(buffer, width) {
  return sharp(buffer)
    .resize({
      width,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg()
    .toBuffer();
}

async function processImage(buffer, originalFilename) {
  validateExtension(originalFilename);

  const image = sharp(buffer, { sequentialRead: true });
  const exif = await image.metadata();

  const [thumbnail, small, large] = await Promise.all([
    createDerivative(buffer, 200),
    createDerivative(buffer, 400),
    createDerivative(buffer, 1000)
  ]);

  return {
    buffers: {
      original: buffer,
      thumbnail,
      small,
      large
    },
    exif,
    mimeType: "image/jpeg"
  };
}

module.exports = processImage;
