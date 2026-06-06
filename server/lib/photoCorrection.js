function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumber(value, fallback, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return clamp(numericValue, min, max);
}

function contrastToLinear(contrast) {
  const slope = contrast;
  const intercept = 128 * (1 - slope);
  return { slope, intercept };
}

function normalizeEditRecipe(rawRecipe) {
  if (!rawRecipe || typeof rawRecipe !== "object" || Array.isArray(rawRecipe)) {
    return null;
  }

  const sharpness = ["none", "light", "medium"].includes(rawRecipe.sharpness)
    ? rawRecipe.sharpness
    : "none";

  return {
    apply: Boolean(rawRecipe.apply),
    brightness: normalizeNumber(rawRecipe.brightness, 1, 0.92, 1.12),
    contrast: normalizeNumber(rawRecipe.contrast, 1, 0.9, 1.18),
    saturation: normalizeNumber(rawRecipe.saturation, 1, 0.9, 1.18),
    sharpness,
    warmth: normalizeNumber(rawRecipe.warmth, 0, -0.08, 0.08),
    rotateDegrees: normalizeNumber(rawRecipe.rotateDegrees, 0, -45, 45),
    crop: null,
    notes: String(rawRecipe.notes || "").trim().slice(0, 220)
  };
}

function applyEditRecipeToSharp(image, recipe) {
  const normalizedRecipe = normalizeEditRecipe(recipe);

  if (!normalizedRecipe) {
    return image.rotate();
  }

  let pipeline = image.rotate();
  pipeline = pipeline.modulate({
    brightness: normalizedRecipe.brightness,
    saturation: normalizedRecipe.saturation
  });

  const { slope, intercept } = contrastToLinear(normalizedRecipe.contrast);
  pipeline = pipeline.linear(slope, intercept);

  if (normalizedRecipe.warmth !== 0) {
    const warmth = normalizedRecipe.warmth;
    pipeline = pipeline.recomb([
      [1 + warmth, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - warmth]
    ]);
  }

  if (normalizedRecipe.sharpness === "light") {
    pipeline = pipeline.sharpen({ sigma: 0.5 });
  } else if (normalizedRecipe.sharpness === "medium") {
    pipeline = pipeline.sharpen({ sigma: 0.8 });
  }

  return pipeline;
}

module.exports = {
  applyEditRecipeToSharp,
  normalizeEditRecipe
};
