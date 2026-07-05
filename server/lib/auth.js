const crypto = require("crypto");

function requireApiAuth(req, res, next) {
  if (req.path === "/health") {
    return next();
  }

  const expectedApiKey = process.env.API_SECRET_KEY;

  if (!expectedApiKey) {
    return res.status(500).json({ error: "Server auth not configured" });
  }

  if (req.headers["cf-access-jwt-assertion"]) {
    return next();
  }

  const providedApiKey = req.headers["x-api-key"];

  if (typeof providedApiKey !== "string") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const expectedBuffer = Buffer.from(expectedApiKey);
  const providedBuffer = Buffer.from(providedApiKey);

  if (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}

module.exports = { requireApiAuth };
