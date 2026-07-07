const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_URL = "http://localhost:3000";
process.env.ALLOWED_EMAIL = "clarksontravels@gmail.com";
process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.API_SECRET_KEY = "api-secret";
process.env.MCP_PATH_TOKEN = "test-mcp-token";

const { handleBrowserAppRequest } = require("./index");
const authRouter = require("./routes/auth");
const mcpRouter = require("./routes/mcp");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    redirectedTo: null,
    sentFile: null,
    end() {},
    append(name, value) {
      const currentValue = this.headers[name];
      this.headers[name] = currentValue ? [].concat(currentValue, value) : value;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.end();
      return this;
    },
    redirect(location) {
      this.statusCode = 302;
      this.redirectedTo = location;
      this.end();
      return this;
    },
    sendFile(filePath, callback) {
      this.sentFile = filePath;
      if (callback) {
        callback(null);
      }
      this.end();
      return this;
    }
  };
}

function runRouter(router, req, res) {
  return new Promise((resolve, reject) => {
    const response = res || createResponse();
    const request = {
      method: "GET",
      url: "/",
      originalUrl: "/",
      path: "/",
      headers: {},
      query: {},
      ...req
    };

    response.end = () => {
      resolve(response);
    };

    try {
      router.handle(request, response, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

test("unauthenticated GET /api/auth/google returns 302 to Google", async () => {
  const response = await runRouter(authRouter, {
    method: "GET",
    url: "/google",
    originalUrl: "/api/auth/google",
    path: "/google"
  });

  assert.equal(response.statusCode, 302);
  assert.match(response.redirectedTo || "", /^https:\/\/accounts\.google\.com\//);
});

test("unauthenticated GET /api/auth/callback/google without params redirects safely", async () => {
  const response = await runRouter(authRouter, {
    method: "GET",
    url: "/callback/google",
    originalUrl: "/api/auth/callback/google",
    path: "/callback/google"
  });

  assert.equal(response.statusCode, 302);
  assert.equal(response.redirectedTo, "/login?error=oauth");
});

test("unauthenticated GET / redirects to /login", async () => {
  const response = createResponse();
  handleBrowserAppRequest("/tmp/client-dist", { path: "/", headers: {} }, response);

  assert.equal(response.statusCode, 302);
  assert.equal(response.redirectedTo, "/login");
});

test("unauthenticated GET /login returns 200", async () => {
  const response = createResponse();
  handleBrowserAppRequest("/tmp/client-dist", { path: "/login", headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.sentFile || "", /index\.html$/);
});

test("/mcp/* is not redirected to /login", async () => {
  const response = await runRouter(mcpRouter, {
    method: "GET",
    url: "/",
    originalUrl: `/mcp/${process.env.MCP_PATH_TOKEN}`,
    path: "/"
  });

  assert.equal(response.statusCode, 405);
  assert.equal(response.redirectedTo, null);
});
