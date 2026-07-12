const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { getDb } = require("../lib/db");
const { queryPhotos } = require("../lib/photoQuery");
const { queryVideos } = require("../lib/videoQuery");
const { queryJournals } = require("../lib/journalQuery");
const { queryDestinations } = require("../lib/destinationQuery");
const { getTrip } = require("../lib/tripQuery");

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
    description: "Search the family travel photo catalog by date range, location, people, tags, orientation, or resolution. Returns photos with embeddable image URLs. Use view \"blog\" for content-writing and caption workflows. For blog feature images, the intended path is orientation=\"landscape\". Use \"summary\" for lightweight browsing and \"full\" only when you need the complete photo record.",
    inputSchema: {
      text: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      orientation: z.enum(["landscape", "portrait", "square"]).optional(),
      min_width: z.number().int().min(0).optional(),
      min_height: z.number().int().min(0).optional(),
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
      view: z.enum(["summary", "blog", "full"]).default("summary")
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

  server.registerTool("search_videos", {
    description: "Search the YouTube video catalog by filmed date range, location, people, or tags. Returns videos with YouTube IDs and thumbnail URLs for embedding.",
    inputSchema: {
      text: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      tags_any: z.array(z.string()).optional(),
      people_any: z.array(z.string()).optional(),
      has_location: z.boolean().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
      sort: z.enum(["newest", "oldest"]).default("newest"),
      view: z.enum(["summary", "full"]).default("summary")
    }
  }, async (args) => {
    try {
      const db = getDb();
      const result = queryVideos(db, args);

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

  server.registerTool("get_journal_entries", {
    description: "Search imported Day One journal entries by date range, location, or text. Returns entry text and place metadata for narrative context.",
    inputSchema: {
      text: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      date_from: z.iso.date().optional(),
      date_to: z.iso.date().optional(),
      has_location: z.boolean().optional(),
      limit: z.number().default(10),
      offset: z.number().default(0),
      sort: z.enum(["newest", "oldest"]).default("newest"),
      view: z.enum(["summary", "full"]).default("summary")
    }
  }, async (args) => {
    try {
      const db = getDb();
      const result = queryJournals(db, args);

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

  server.registerTool("get_trip", {
    description: "Get a single chronological trip timeline across journal entries, photos, and videos for a date window and optional location filter. Preferred starting point for writing about a specific trip.",
    inputSchema: {
      date_from: z.iso.date(),
      date_to: z.iso.date(),
      city: z.string().optional(),
      country: z.string().optional(),
      limit_per_type: z.number().int().min(1).max(100).default(25)
    }
  }, async (args) => {
    try {
      const db = getDb();
      const result = getTrip(db, args);

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

  server.registerTool("get_destinations", {
    description: "List travel destinations with photo, video, and journal counts plus content date ranges. Supports filtering and limiting for narrow checks. Example: country=\"Australia\" answers whether the catalog has Australia content in one small call.",
    inputSchema: {
      country: z.string().optional(),
      min_photos: z.number().int().min(0).optional(),
      min_videos: z.number().int().min(0).optional(),
      min_total: z.number().int().min(0).optional(),
      sort: z.enum(["photos", "videos", "date_last", "city"]).optional(),
      limit: z.number().int().min(0).default(0)
    }
  }, async (args) => {
    try {
      const db = getDb();
      const result = queryDestinations(db, args);

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
