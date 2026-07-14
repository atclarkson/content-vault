const crypto = require("crypto");

const BROWSER_SESSION_COOKIE = "content_vault_session";
const OAUTH_STATE_COOKIE = "content_vault_oauth_state";

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

function parseCookies(req) {
  const header = req.headers.cookie;

  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, chunk) => {
    const separatorIndex = chunk.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getAuthSecret() {
  return String(process.env.AUTH_SECRET || "").trim();
}

function getDefaultAllowedEmails() {
  return [
    "clarksontravels@gmail.com"
  ];
}

function getAllowedEmails() {
  const configuredEmails = String(process.env.ALLOWED_EMAILS || process.env.ALLOWED_EMAIL || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return configuredEmails.length > 0 ? configuredEmails : getDefaultAllowedEmails();
}

function getDefaultAllowedDomains() {
  return [
    "clarksontravels.com",
    "adamandlinds.com"
  ];
}

function getAllowedDomains() {
  const configuredDomains = String(process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^@+/, ""))
    .filter(Boolean);

  return configuredDomains.length > 0 ? configuredDomains : getDefaultAllowedDomains();
}

function isAllowedEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return false;
  }

  if (getAllowedEmails().includes(normalizedEmail)) {
    return true;
  }

  const atIndex = normalizedEmail.lastIndexOf("@");

  if (atIndex === -1) {
    return false;
  }

  const domain = normalizedEmail.slice(atIndex + 1);
  return getAllowedDomains().includes(domain);
}

function signValue(value) {
  return crypto.createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function encodeSignedPayload(payload) {
  const json = JSON.stringify(payload);
  const value = Buffer.from(json).toString("base64url");
  return `${value}.${signValue(value)}`;
}

function decodeSignedPayload(token) {
  if (!token || !getAuthSecret()) {
    return null;
  }

  const [value, signature] = String(token).split(".");

  if (!value || !signature) {
    return null;
  }

  const expectedSignature = signValue(value);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (payload.expires_at && Date.now() > Number(payload.expires_at)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function buildCookie(name, value, maxAgeSeconds = null) {
  const authUrl = String(process.env.AUTH_URL || "").trim();
  const isSecure = authUrl.startsWith("https://");
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }

  return parts.join("; ");
}

function clearCookie(res, name) {
  res.append("Set-Cookie", buildCookie(name, "", 0));
}

function createBrowserSession(res, email) {
  const sessionTtlSeconds = 60 * 60 * 24 * 30;
  const payload = encodeSignedPayload({
    email: String(email || "").trim().toLowerCase(),
    expires_at: Date.now() + sessionTtlSeconds * 1000
  });

  res.append("Set-Cookie", buildCookie(BROWSER_SESSION_COOKIE, payload, sessionTtlSeconds));
}

function getBrowserSession(req) {
  const cookies = parseCookies(req);
  const payload = decodeSignedPayload(cookies[BROWSER_SESSION_COOKIE]);

  if (!payload?.email) {
    return null;
  }

  return { email: payload.email };
}

function clearBrowserSession(res) {
  clearCookie(res, BROWSER_SESSION_COOKIE);
}

function createOauthState(res) {
  const stateTtlSeconds = 60 * 10;
  const payload = encodeSignedPayload({
    token: crypto.randomBytes(24).toString("base64url"),
    expires_at: Date.now() + stateTtlSeconds * 1000
  });

  res.append("Set-Cookie", buildCookie(OAUTH_STATE_COOKIE, payload, stateTtlSeconds));
  return payload;
}

function consumeOauthState(req, res) {
  const cookies = parseCookies(req);
  const storedState = cookies[OAUTH_STATE_COOKIE];
  clearCookie(res, OAUTH_STATE_COOKIE);

  return storedState && decodeSignedPayload(storedState) ? storedState : null;
}

function hasBrowserSession(req) {
  return Boolean(getBrowserSession(req));
}

module.exports = {
  clearBrowserSession,
  consumeOauthState,
  createBrowserSession,
  createOauthState,
  getAllowedEmails,
  getAllowedDomains,
  getBrowserSession,
  hasBrowserSession,
  isAllowedEmail,
  requireApiAuth
};
