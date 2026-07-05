const path = require("path");
const { execFile } = require("child_process");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp");
const { applyEditRecipeToSharp } = require("./photoCorrection");

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

async function createDerivative(buffer, width, editRecipe = null) {
  return applyEditRecipeToSharp(sharp(buffer), editRecipe)
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

async function createPreviewDerivative(buffer, width, editRecipe = null) {
  return createDerivative(buffer, width, editRecipe);
}

async function processImage(buffer, originalFilename, options = {}) {
  validateExtension(originalFilename);
  const extension = getNormalizedExtension(originalFilename);
  let workingBuffer = buffer;
  const editRecipe = options.editRecipe || null;
  const isMacOs = os.platform() === "darwin";

  if (isMacOs && (extension === ".heic" || extension === ".heif")) {
    workingBuffer = await convertHeicWithSips(buffer);
  }

  const image = sharp(workingBuffer, { sequentialRead: true });
  const exif = await image.metadata();

  const [thumbnail, small, large] = await Promise.all([
    createDerivative(workingBuffer, 200, editRecipe),
    createDerivative(workingBuffer, 400, editRecipe),
    createDerivative(workingBuffer, 1000, editRecipe)
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
module.exports.createPreviewDerivative = createPreviewDerivative;
