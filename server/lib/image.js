const path = require("path");
const { execFile } = require("child_process");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
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
    .rotate()
    .resize({
      width,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg()
    .toBuffer();
}

async function convertHeicWithSips(buffer) {
  const tmpDir = os.tmpdir();
  const tmpId = crypto.randomBytes(8).toString("hex");
  const inputPath = path.join(tmpDir, `cv-${tmpId}.heic`);
  const outputPath = path.join(tmpDir, `cv-${tmpId}.jpg`);

  try {
    fs.writeFileSync(inputPath, buffer);

    await new Promise((resolve, reject) => {
      execFile("sips", ["-s", "format", "jpeg", inputPath, "--out", outputPath], (error) => {
        if (error) {
          reject(new Error(`HEIC conversion failed: ${error.message}`));
          return;
        }

        resolve();
      });
    });

    return fs.readFileSync(outputPath);
  } finally {
    try {
      fs.unlinkSync(inputPath);
    } catch {}

    try {
      fs.unlinkSync(outputPath);
    } catch {}
  }
}

async function processImage(buffer, originalFilename) {
  validateExtension(originalFilename);
  const extension = getNormalizedExtension(originalFilename);
  let workingBuffer = buffer;

  if (extension === ".heic" || extension === ".heif") {
    workingBuffer = await convertHeicWithSips(buffer);
  }

  const image = sharp(workingBuffer, { sequentialRead: true });
  const exif = await image.metadata();

  const [thumbnail, small, large] = await Promise.all([
    createDerivative(workingBuffer, 200),
    createDerivative(workingBuffer, 400),
    createDerivative(workingBuffer, 1000)
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
