const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");

const router = express.Router();

initializeDatabase();

router.post("/video/:id", async (req, res) => {
  try {
    const db = getDb();
    const videoId = normalizeVideoId(req.params.id);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "ANTHROPIC_API_KEY is not configured" });
    }

    const video = db
      .prepare(
        `
      SELECT *
      FROM videos
      WHERE id = ?
        AND deleted_at IS NULL
    `,
      )
      .get(videoId);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    if (!video.thumbnail_url) {
      return res
        .status(400)
        .json({ error: "Video does not have a thumbnail URL" });
    }

    const enrichedVideo = attachVideoPeopleAndTags(db, video);
    const imageBase64 = await fetchImageAsBase64(enrichedVideo.thumbnail_url);
    const prompt = buildVideoCaptionPrompt(enrichedVideo);
    const anthropicResponse = await requestCaptionFromAnthropic(
      apiKey,
      imageBase64,
      prompt,
    );
    const parsedResponse = parseAnthropicText(anthropicResponse);

    if (!parsedResponse.aiCaption) {
      throw new Error("Anthropic response did not include a caption");
    }

    const nextAltText =
      enrichedVideo.alt_text && String(enrichedVideo.alt_text).trim()
        ? enrichedVideo.alt_text
        : parsedResponse.altText;

    db.prepare(
      `
      UPDATE videos
      SET ai_caption = ?,
          alt_text = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(parsedResponse.aiCaption, nextAltText || null, videoId);

    return res.json({
      data: {
        ai_caption: parsedResponse.aiCaption,
        alt_text: nextAltText || null,
        suggested_title: parsedResponse.suggestedTitle || null,
      },
    });
  } catch (error) {
    if (error.message === "Invalid video id") {
      return res.status(400).json({ error: error.message });
    }

    return res
      .status(500)
      .json({ error: error.message || "Failed to generate video caption" });
  }
});

router.post("/:id", async (req, res) => {
  try {
    const db = getDb();
    const photoId = normalizeSingleId(req.params.id);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "ANTHROPIC_API_KEY is not configured" });
    }

    const photo = db
      .prepare(
        `
      SELECT *
      FROM photos
      WHERE id = ?
        AND deleted_at IS NULL
    `,
      )
      .get(photoId);

    if (!photo) {
      return res.status(404).json({ error: "Photo not found" });
    }

    if (!photo.large_url) {
      return res
        .status(400)
        .json({ error: "Photo does not have a large image URL" });
    }

    const enrichedPhoto = attachPeopleAndTags(db, photo);
    const tagTaxonomy = loadTagTaxonomy(db);
    const imageBase64 = await fetchImageAsBase64(enrichedPhoto.large_url);
    const prompt = buildCaptionPrompt(enrichedPhoto, tagTaxonomy);
    const anthropicResponse = await requestCaptionFromAnthropic(
      apiKey,
      imageBase64,
      prompt,
    );
    const parsedResponse = parseAnthropicText(anthropicResponse);

    if (!parsedResponse.aiCaption) {
      throw new Error("Anthropic response did not include a caption");
    }

    return res.json({
      data: {
        ai_caption: parsedResponse.aiCaption,
        alt_text: parsedResponse.altText || null,
        suggested_title: parsedResponse.suggestedTitle || null,
        suggested_tags: parsedResponse.tagSuggestions || [],
      },
    });
  } catch (error) {
    if (error.message === "Invalid photo id") {
      return res.status(400).json({ error: error.message });
    }

    return res
      .status(500)
      .json({ error: error.message || "Failed to generate caption" });
  }
});

async function fetchImageAsBase64(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

async function requestCaptionFromAnthropic(apiKey, imageBase64, prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  const bodyText = await response.text();
  let parsedBody = null;

  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      throw new Error("Anthropic API returned invalid JSON");
    }
  }

  if (!response.ok) {
    const apiMessage = parsedBody?.error?.message || parsedBody?.message;
    throw new Error(
      apiMessage || `Anthropic API request failed: ${response.status}`,
    );
  }

  return parsedBody;
}

function parseAnthropicText(response) {
  const text = (response?.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  const aiCaptionMatch = text.match(
    /AI_CAPTION:\s*([\s\S]*?)(?:\nTAG_SUGGESTIONS:|\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const altTextMatch = text.match(
    /ALT_TEXT:\s*([\s\S]*?)(?:\nTAG_SUGGESTIONS:|\nTITLE_SUGGESTION:|$)/i,
  );
  const tagSuggestionsMatch = text.match(
    /TAG_SUGGESTIONS:\s*([\s\S]*?)(?:\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const titleSuggestionMatch = text.match(/TITLE_SUGGESTION:\s*([\s\S]*?)$/i);

  return {
    aiCaption: cleanGeneratedText(aiCaptionMatch ? aiCaptionMatch[1] : text),
    altText: cleanGeneratedText(altTextMatch ? altTextMatch[1] : ""),
    suggestedTitle: cleanGeneratedText(
      titleSuggestionMatch ? titleSuggestionMatch[1] : "",
    ),
    tagSuggestions: parseSuggestedTagsWithGroups(
      tagSuggestionsMatch ? tagSuggestionsMatch[1] : "",
    ),
  };
}

function cleanGeneratedText(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function parseSuggestedTagsWithGroups(value) {
  const suggestions = [];
  const seen = new Set();

  for (const item of String(value || "").split(",")) {
    const trimmedItem = item.trim();

    if (!trimmedItem) {
      continue;
    }

    const [rawGroupName, ...rawTagParts] = trimmedItem.split(">");
    const tagName = (rawTagParts.length > 0 ? rawTagParts.join(">") : rawGroupName)
      .trim()
      .toLowerCase();
    const groupName = rawTagParts.length > 0 ? rawGroupName.trim() : "";
    const key = `${groupName.toLowerCase()}::${tagName}`;

    if (!tagName || seen.has(key)) {
      continue;
    }

    seen.add(key);
    suggestions.push({
      name: tagName,
      group_name: groupName || null
    });
  }

  return suggestions;
}

function buildCaptionPrompt(photo, tagTaxonomy) {
  const people = (photo.people || []).map((person) => person.name);
  const tags = photo.tags || [];
  const locationParts = [
    photo.neighborhood,
    photo.city,
    photo.region,
    photo.country,
  ].filter(Boolean);
  const cameraParts = [photo.camera_make, photo.camera_model].filter(Boolean);

  return [
    "You are writing captions for a personal family travel blog. Write exactly like a real person would — casual, specific, direct.",
    "",
    "Rules:",
    "- 1-2 sentences max for the caption",
    "- Suggest a short, natural title, 4-10 words, not a filename",
    "- Suggest 3-6 useful tags, lowercase, short, comma-separated, no hashtags",
    "- Always include one tag describing the shot itself when it can be inferred from the image, for example: overhead shot, wide shot, close up shot, portrait shot, detail shot, street shot",
    "- Use the tag taxonomy below as a guide when suggesting tags",
    "- Do not suggest country names or broad place names like china, japan, vietnam, portugal, hong kong, or similar. Location is handled separately.",
    "- Do not suggest year, month, season, or time tags like fall 2025, winter 2026, summer, spring, or similar. The photo date is already stored separately.",
    "- Mention people by name, location, and approximate time when available",
    "- Prefer seasons and years over exact dates. For example, say 'in the winter of 2026' instead of 'on January 15, 2026' unless an exact date is unusually important.",
    "- Be specific, not generic. Avoid vague positive filler.",
    "- Never end a sentence with a participial phrase like '...capturing a moment of...' or '...reflecting their...' or '...highlighting the...'",
    "- Never use: vibrant, nestled, showcasing, highlighting, testament, stunning, beautiful, picturesque, perfect, incredible, amazing, breathtaking, remarkable, pivotal, enduring, foster, underscore",
    "- Never use 'not just X, but Y' or 'more than just' constructions",
    "- Do not list three things in a row for emphasis",
    "- Do not editorialize about significance or meaning",
    "- Never use em dashes (—). Use a comma, period, or rephrase the sentence instead. Em dashes are one of the strongest identifiers of AI-written text.",
    "- Write like you were there, not like you are describing a photo",
    "",
    "Photo metadata:",
    `People: ${people.length > 0 ? people.join(", ") : "None listed"}`,
    `Location: ${locationParts.length > 0 ? locationParts.join(", ") : "Unknown"}`,
    `Date taken: ${photo.captured_at || "Unknown"}`,
    `Tags: ${tags.length > 0 ? tags.join(", ") : "None"}`,
    `Title: ${photo.title || "Not set"}`,
    `Private notes/context: ${photo.description || "Not set"}`,
    "Use the private notes/context to understand the moment, but do not quote or paraphrase it too literally unless it naturally fits.",
    "",
    "Tag taxonomy — when suggesting tags use these groups and example tags as a guide:",
    tagTaxonomy,
    "",
    "Return exactly this format:",
    "AI_CAPTION: <caption here>",
    "TAG_SUGGESTIONS: <comma-separated Group>tag pairs here>",
    "ALT_TEXT: <alt text here>",
    "TITLE_SUGGESTION: <suggested title here>",
  ].join("\n");
}

function loadTagTaxonomy(db) {
  const groups = db.prepare(`
    SELECT id, name, color, sort_order
    FROM tag_groups
    ORDER BY sort_order ASC, LOWER(name) ASC
  `).all();
  const tags = db.prepare(`
    SELECT id, name, group_id
    FROM tags
    WHERE group_id IS NOT NULL
    ORDER BY LOWER(name) ASC
  `).all();
  const tagsByGroupId = new Map();

  for (const tag of tags) {
    if (!tagsByGroupId.has(tag.group_id)) {
      tagsByGroupId.set(tag.group_id, []);
    }

    tagsByGroupId.get(tag.group_id).push(tag.name);
  }

  const lines = groups.map((group) => {
    const groupTags = tagsByGroupId.get(group.id) || [];
    return `${group.name}: ${groupTags.length > 0 ? groupTags.join(", ") : "No tags yet"}`;
  });

  return lines.length > 0 ? lines.join("\n") : "No tag groups configured yet.";
}

function buildVideoCaptionPrompt(video) {
  const people = (video.people || []).map((person) => person.name);
  const tags = video.tags || [];
  const locationParts = [video.filmed_city, video.filmed_country].filter(Boolean);

  return [
    "You are writing captions for a personal family travel blog. Write exactly like a real person would, casual, specific, direct.",
    "",
    "Rules:",
    "- 1-2 sentences max for the caption",
    "- Suggest a short, natural title, 4-10 words, not a filename",
    "- Mention people by name, location, and approximate time when available",
    "- Prefer seasons and years over exact dates. For example, say 'in the winter of 2026' instead of 'on January 15, 2026' unless an exact date is unusually important.",
    "- Be specific, not generic. Avoid vague positive filler.",
    "- Never end a sentence with a participial phrase like '...capturing a moment of...' or '...reflecting their...' or '...highlighting the...'",
    "- Never use: vibrant, nestled, showcasing, highlighting, testament, stunning, beautiful, picturesque, perfect, incredible, amazing, breathtaking, remarkable, pivotal, enduring, foster, underscore",
    "- Do not use AI-sounding wording or talk about 'content', 'storytelling', 'narrative', 'authenticity', or 'the viewer'",
    "- Never use 'not just X, but Y' or 'more than just' constructions",
    "- Do not list three things in a row for emphasis",
    "- Do not editorialize about significance or meaning",
    "- Never use em dashes (—). Use a comma, period, or rephrase the sentence instead. Em dashes are one of the strongest identifiers of AI-written text.",
    "- Write like you were there, not like you are describing metadata",
    "",
    "Video metadata:",
    `People: ${people.length > 0 ? people.join(", ") : "None listed"}`,
    `Location: ${locationParts.length > 0 ? locationParts.join(", ") : "Unknown"}`,
    `Filmed date: ${video.date_filmed || "Unknown"}`,
    `Published date: ${video.date_published || "Unknown"}`,
    `Tags: ${tags.length > 0 ? tags.join(", ") : "None"}`,
    `Video category: ${video.video_category || "Unknown"}`,
    `Title: ${video.title || "Not set"}`,
    `Description: ${video.description || "Not set"}`,
    `Private notes/context: ${video.notes_for_ai || "Not set"}`,
    "Use the private notes/context to understand the moment, but do not quote or paraphrase it too literally unless it naturally fits.",
    "",
    "Return exactly this format:",
    "AI_CAPTION: <caption here>",
    "ALT_TEXT: <alt text here>",
    "TITLE_SUGGESTION: <suggested title here>",
  ].join("\n");
}

function attachPeopleAndTags(db, photo) {
  const people = db
    .prepare(
      `
    SELECT people.id, people.name
    FROM photo_people
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photo_people.photo_id = ?
    ORDER BY people.name
  `,
    )
    .all(photo.id);
  const tags = db
    .prepare(
      `
    SELECT tags.name
    FROM photo_tags
    INNER JOIN tags ON tags.id = photo_tags.tag_id
    WHERE photo_tags.photo_id = ?
    ORDER BY tags.name
  `,
    )
    .all(photo.id)
    .map((row) => row.name);

  return {
    ...photo,
    people,
    tags,
  };
}

function attachVideoPeopleAndTags(db, video) {
  const people = db
    .prepare(
      `
    SELECT people.id, people.name
    FROM video_people
    INNER JOIN people ON people.id = video_people.person_id
    WHERE video_people.video_id = ?
    ORDER BY people.name
  `,
    )
    .all(video.id);
  const tags = db
    .prepare(
      `
    SELECT tags.name
    FROM video_tags
    INNER JOIN tags ON tags.id = video_tags.tag_id
    WHERE video_tags.video_id = ?
    ORDER BY tags.name
  `,
    )
    .all(video.id)
    .map((row) => row.name);

  return {
    ...video,
    people,
    tags,
  };
}

function normalizeSingleId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid photo id");
  }

  return id;
}

function normalizeVideoId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid video id");
  }

  return id;
}

module.exports = router;
