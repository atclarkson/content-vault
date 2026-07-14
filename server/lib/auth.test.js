const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_URL = "http://localhost:3000";

const {
  consumeOauthState,
  createBrowserSession,
  createOauthState,
  getAllowedDomains,
  getAllowedEmails,
  getBrowserSession,
  isAllowedEmail
} = require("./auth");

function createResponse() {
  return {
    cookies: [],
    append(name, value) {
      if (name === "Set-Cookie") {
        this.cookies.push(value);
      }
    }
  };
}

function createRequest(cookies) {
  return {
    headers: {
      cookie: cookies.join("; ")
    }
  };
}

test("browser session cookie round-trips", () => {
  const res = createResponse();
  createBrowserSession(res, "clarksontravels@gmail.com");

  const req = createRequest(res.cookies.map((cookie) => cookie.split(";")[0]));
  assert.deepEqual(getBrowserSession(req), {
    email: "clarksontravels@gmail.com"
  });
});

test("oauth state must match stored signed cookie", () => {
  const res = createResponse();
  const state = createOauthState(res);
  const req = createRequest(res.cookies.map((cookie) => cookie.split(";")[0]));
  const tamperedReq = createRequest([
    `${res.cookies[0].split(";")[0]}x`
  ]);

  assert.equal(consumeOauthState(req, res), state);
  assert.equal(consumeOauthState(tamperedReq, res), null);
});

test("allowed emails can be configured as a comma-separated list", () => {
  process.env.ALLOWED_EMAILS = "adam@clarksontravels.com, lindsay@clarksontravels.com";

  assert.deepEqual(getAllowedEmails(), [
    "adam@clarksontravels.com",
    "lindsay@clarksontravels.com"
  ]);

  delete process.env.ALLOWED_EMAILS;
});

test("allowed domains default to family domains", () => {
  delete process.env.ALLOWED_EMAIL_DOMAINS;

  assert.deepEqual(getAllowedDomains(), [
    "clarksontravels.com",
    "adamandlinds.com"
  ]);
});

test("allowed email accepts configured domain suffixes and explicit emails", () => {
  delete process.env.ALLOWED_EMAILS;
  delete process.env.ALLOWED_EMAIL_DOMAINS;

  assert.equal(isAllowedEmail("adam@clarksontravels.com"), true);
  assert.equal(isAllowedEmail("lindsay@adamandlinds.com"), true);
  assert.equal(isAllowedEmail("clarksontravels@gmail.com"), true);
  assert.equal(isAllowedEmail("someone@example.com"), false);
});
