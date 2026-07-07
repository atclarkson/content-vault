const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { getDb } = require("../lib/db");
const { queryPhotos } = require("../lib/photoQuery");

const router = express.Router();

const METHOD_NOT_ALLOWED_ERROR = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message: "Method not allowed"
  },
  id: null
};

const INTERNAL_SERVER_ERROR = {
  jsonrpc: "2.0",
  error: {
    code: -32603,
    message: "Internal server error"
  },
  id: null
};

function getServer() {
  const server = new McpServer({
    name: "content-vault",
    version: "1.0.0"
  });

  server.registerTool("search_photos", {
    description: "Search the family travel photo catalog by date range, location, people, or tags. Returns photos with embeddable image URLs (thumbnail, small, large).",
    inputSchema: {
      text: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      tags_any: z.array(z.string()).optional(),
      people_any: z.array(z.string()).optional(),
      has_location: z.boolean().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
      sort: z.enum([
        "newest",
        "oldest",
        "uploaded_newest",
        "uploaded_oldest",
        "country",
        "city",
        "filename"
      ]).default("newest"),
      view: z.enum(["summary", "full"]).default("summary")
    }
  }, async (args) => {
    try {
      const db = getDb();
      const result = queryPhotos(db, args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error.message })
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

router.post("/", async (req, res) => {
  const server = getServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: ["al-vault.com", "127.0.0.1:3000", "localhost:3000"]
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json(INTERNAL_SERVER_ERROR);
    }
  }
});

router.get("/", (req, res) => {
  res.status(405).json(METHOD_NOT_ALLOWED_ERROR);
});

router.delete("/", (req, res) => {
  res.status(405).json(METHOD_NOT_ALLOWED_ERROR);
});

module.exports = router;
