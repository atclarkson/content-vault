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
const { getFile } = require("../lib/r2");

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

const searchPhotosSchema = z.strictObject({
  ids: z.array(z.string().trim().min(1)).optional(),
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
  limit: z.number().int().min(0).default(50),
  offset: z.number().int().min(0).default(0),
  sort: z.enum([
    "newest",
    "oldest",
    "uploaded_newest",
    "uploaded_oldest",
    "country",
    "city",
    "filename"
  ]).default("newest"),
  view: z.enum(["summary", "index", "blog", "full"]).default("summary")
});

const markPhotoUsedSchema = z.strictObject({
  photo_uuids: z.array(z.string().trim().min(1)).min(1),
  post_slug: z.string().trim().min(1),
  post_title: z.string().optional(),
  placement: z.string().optional()
});

const previewPhotoSchema = z.strictObject({
  photo_uuids: z.array(z.string().trim().min(1)).min(1).max(4),
  size: z.enum(["thumbnail", "small"]).default("thumbnail")
});

const searchVideosSchema = z.strictObject({
  text: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
  tags_any: z.array(z.string()).optional(),
  people_any: z.array(z.string()).optional(),
  has_location: z.boolean().optional(),
  limit: z.number().int().min(0).default(20),
  offset: z.number().int().min(0).default(0),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  view: z.enum(["summary", "full"]).default("summary")
});

const getJournalEntriesSchema = z.strictObject({
  text: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  date_from: z.iso.date().optional(),
  date_to: z.iso.date().optional(),
  has_location: z.boolean().optional(),
  limit: z.number().int().min(0).default(10),
  offset: z.number().int().min(0).default(0),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  view: z.enum(["summary", "full"]).default("summary")
});

const getTripSchema = z.strictObject({
  date_from: z.iso.date(),
  date_to: z.iso.date(),
  city: z.string().optional(),
  country: z.string().optional(),
  limit_per_type: z.number().int().min(1).max(100).default(25)
});

const getDestinationsSchema = z.strictObject({
  country: z.string().optional(),
  min_photos: z.number().int().min(0).optional(),
  min_videos: z.number().int().min(0).optional(),
  min_total: z.number().int().min(0).optional(),
  sort: z.enum(["photos", "videos", "date_last", "city"]).optional(),
  limit: z.number().int().min(0).default(0)
});

function buildTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload)
      }
    ]
  };
}

function buildErrorResult(error) {
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

async function handleSearchPhotos(args, db = getDb()) {
  return queryPhotos(db, args);
}

async function handleMarkPhotoUsed(args, db = getDb()) {
  const normalizedPlacement = normalizeOptionalString(args.placement);
  const normalizedPostTitle = normalizeOptionalString(args.post_title);
  const photoUuids = [...new Set(args.photo_uuids.map((value) => String(value).trim()).filter(Boolean))];
  const knownRows = db.prepare(`
    SELECT uuid
    FROM photos
    WHERE uuid IN (${createPlaceholders(photoUuids.length)})
  `).all(...photoUuids);
  const knownUuids = new Set(knownRows.map((row) => row.uuid));
  const unknown = photoUuids.filter((uuid) => !knownUuids.has(uuid));
  const validUuids = photoUuids.filter((uuid) => knownUuids.has(uuid));

  if (validUuids.length === 0) {
    return {
      marked: 0,
      updated: 0,
      unknown
    };
  }

  const selectExistingUsage = db.prepare(`
    SELECT id
    FROM photo_usages
    WHERE photo_uuid = ?
      AND post_slug = ?
      AND (
        (placement IS NULL AND ? IS NULL)
        OR placement = ?
      )
  `);
  const updateUsage = db.prepare(`
    UPDATE photo_usages
    SET post_title = ?,
        used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const insertUsage = db.prepare(`
    INSERT INTO photo_usages (
      photo_uuid,
      post_slug,
      post_title,
      placement
    ) VALUES (?, ?, ?, ?)
  `);

  const summary = db.transaction(() => {
    let marked = 0;
    let updated = 0;

    for (const photoUuid of validUuids) {
      const existingRow = selectExistingUsage.get(
        photoUuid,
        args.post_slug,
        normalizedPlacement,
        normalizedPlacement
      );

      if (existingRow) {
        updateUsage.run(normalizedPostTitle, existingRow.id);
        updated += 1;
      } else {
        insertUsage.run(photoUuid, args.post_slug, normalizedPostTitle, normalizedPlacement);
        marked += 1;
      }
    }

    return { marked, updated };
  })();

  return {
    marked: summary.marked,
    updated: summary.updated,
    unknown
  };
}

async function handlePreviewPhoto(args, db = getDb(), fileFetcher = getFile) {
  const keyColumnName = args.size === "small" ? "small_r2_key" : "thumbnail_r2_key";
  const rows = db.prepare(`
    SELECT uuid, title, width, height, captured_at, ${keyColumnName} AS image_key
    FROM photos
    WHERE uuid IN (${createPlaceholders(args.photo_uuids.length)})
  `).all(...args.photo_uuids);
  const rowByUuid = new Map(rows.map((row) => [row.uuid, row]));
  const content = [];

  for (const photoUuid of args.photo_uuids) {
    const row = rowByUuid.get(photoUuid);

    if (!row) {
      content.push({
        type: "text",
        text: `Error: unknown photo uuid ${photoUuid}`
      });
      continue;
    }

    if (!row.image_key) {
      content.push({
        type: "text",
        text: `Error: ${photoUuid} is missing a ${args.size} image`
      });
      continue;
    }

    content.push({
      type: "text",
      text: [
        `uuid: ${row.uuid}`,
        `title: ${normalizeOptionalString(row.title) || "untitled"}`,
        `dimensions: ${row.width || "?"}x${row.height || "?"}`,
        `captured_at: ${row.captured_at || "unknown"}`
      ].join("\n")
    });

    try {
      const file = await fileFetcher(row.image_key);
      content.push({
        type: "image",
        data: file.buffer.toString("base64"),
        mimeType: file.contentType || inferMimeTypeFromKey(row.image_key)
      });
    } catch (error) {
      content.push({
        type: "text",
        text: `Error: failed to load ${args.size} image for ${photoUuid}: ${error.message}`
      });
    }
  }

  return { content };
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function inferMimeTypeFromKey(key) {
  const normalizedKey = String(key || "").toLowerCase();

  if (normalizedKey.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedKey.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function getServer() {
  const server = new McpServer({
    name: "content-vault",
    version: "1.0.0"
  });

  server.registerTool("search_photos", {
    description: "Search the family travel photo catalog by date range, location, people, tags, orientation, or resolution. Use view \"index\" to scan many candidates cheaply by title/alt text and used_in_count, then re-request a shortlist with the ids filter and view \"blog\" for embeddable image URLs and writing notes. View \"blog\" is for content-writing and caption workflows. View \"full\" returns the complete photo record. The \"blog\" and \"full\" views also include used_in arrays for prior publication awareness.",
    inputSchema: searchPhotosSchema
  }, async (args) => {
    try {
      return buildTextResult(await handleSearchPhotos(args));
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("mark_photo_used", {
    description: "Call after publishing or updating a blog post to record which photos were used. Reuse of photos across posts is fine; this is for awareness only.",
    inputSchema: markPhotoUsedSchema
  }, async (args) => {
    try {
      return buildTextResult(await handleMarkPhotoUsed(args));
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("preview_photo", {
    description: "Returns the actual image content for up to 4 photos so the caller can visually verify a photo before using it. Use view 'index' or 'blog' on search_photos to find candidate uuids first. Prefer size 'thumbnail'; use 'small' only when detail matters.",
    inputSchema: previewPhotoSchema
  }, async (args) => {
    try {
      return await handlePreviewPhoto(args);
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("search_videos", {
    description: "Search the YouTube video catalog by filmed date range, location, people, or tags. Returns videos with YouTube IDs and thumbnail URLs for embedding.",
    inputSchema: searchVideosSchema
  }, async (args) => {
    try {
      return buildTextResult(queryVideos(getDb(), args));
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("get_journal_entries", {
    description: "Search imported Day One journal entries by date range, location, or text. Returns entry text and place metadata for narrative context.",
    inputSchema: getJournalEntriesSchema
  }, async (args) => {
    try {
      return buildTextResult(queryJournals(getDb(), args));
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("get_trip", {
    description: "Get a single chronological trip timeline across journal entries, photos, and videos for a date window and optional location filter. Preferred starting point for writing about a specific trip.",
    inputSchema: getTripSchema
  }, async (args) => {
    try {
      return buildTextResult(getTrip(getDb(), args));
    } catch (error) {
      return buildErrorResult(error);
    }
  });

  server.registerTool("get_destinations", {
    description: "List travel destinations with photo, video, and journal counts plus content date ranges. Supports filtering and limiting for narrow checks. Example: country=\"Australia\" answers whether the catalog has Australia content in one small call.",
    inputSchema: getDestinationsSchema
  }, async (args) => {
    try {
      return buildTextResult(queryDestinations(getDb(), args));
    } catch (error) {
      return buildErrorResult(error);
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
module.exports.getServer = getServer;
module.exports.handleMarkPhotoUsed = handleMarkPhotoUsed;
module.exports.handlePreviewPhoto = handlePreviewPhoto;
module.exports.handleSearchPhotos = handleSearchPhotos;
module.exports.schemas = {
  markPhotoUsedSchema,
  previewPhotoSchema,
  searchPhotosSchema
};
