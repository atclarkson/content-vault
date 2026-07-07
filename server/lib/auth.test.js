const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_URL = "http://localhost:3000";

const {
  consumeOauthState,
  createBrowserSession,
  createOauthState,
  getBrowserSession
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
