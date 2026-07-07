const express = require("express");
const {
  clearBrowserSession,
  consumeOauthState,
  createBrowserSession,
  createOauthState,
  getAllowedEmail,
  getBrowserSession,
  hasBrowserSession
} = require("../lib/auth");

const router = express.Router();

function getAuthConfig() {
  return {
    authUrl: String(process.env.AUTH_URL || "").trim().replace(/\/$/, ""),
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    authSecret: String(process.env.AUTH_SECRET || "").trim()
  };
}

function getCallbackUrl() {
  return `${getAuthConfig().authUrl}/api/auth/callback/google`;
}

function requireAuthConfig(res) {
  const config = getAuthConfig();

  if (config.authUrl && config.clientId && config.clientSecret && config.authSecret) {
    return config;
  }

  res.status(500).json({ error: "Browser auth not configured" });
  return null;
}

router.get("/session", (req, res) => {
  const session = getBrowserSession(req);

  res.json({
    data: {
      authenticated: Boolean(session),
      email: session?.email || null
    }
  });
});

router.post("/logout", (req, res) => {
  clearBrowserSession(res);
  res.json({ data: { logged_out: true } });
});

router.get("/login", (req, res) => {
  if (hasBrowserSession(req)) {
    return res.redirect("/");
  }

  const config = requireAuthConfig(res);

  if (!config) {
    return;
  }

  const state = createOauthState(res);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/callback/google", async (req, res) => {
  const config = requireAuthConfig(res);

  if (!config) {
    return;
  }

  const returnedState = String(req.query.state || "");
  const storedState = consumeOauthState(req, res);

  if (!storedState || returnedState !== storedState) {
    clearBrowserSession(res);
    return res.redirect("/login?error=invalid_state");
  }

  if (!req.query.code) {
    clearBrowserSession(res);
    return res.redirect("/login?error=invalid_request");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: getCallbackUrl(),
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/login?error=signin_failed");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });
    const profile = await profileResponse.json();
    const email = String(profile.email || "").trim().toLowerCase();
    const isVerified = profile.email_verified === true;

    if (!profileResponse.ok || !email || !isVerified) {
      clearBrowserSession(res);
      return res.redirect("/login?error=signin_failed");
    }

    if (email !== getAllowedEmail()) {
      clearBrowserSession(res);
      return res.redirect("/login?error=not_authorized");
    }

    createBrowserSession(res, email);
    return res.redirect("/");
  } catch (error) {
    console.error("Google sign-in failed", error);
    clearBrowserSession(res);
    return res.redirect("/login?error=signin_failed");
  }
});

module.exports = router;
