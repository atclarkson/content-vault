const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const { normalizeEditRecipe } = require("../lib/photoCorrection");

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
    const captionBio = loadCaptionBio(db);
    const tagTaxonomy = loadTagTaxonomy(db);
    const imageBase64 = await fetchImageAsBase64(enrichedVideo.thumbnail_url);
    const prompt = buildVideoCaptionPrompt(enrichedVideo);
    const anthropicResponse = await requestCaptionFromAnthropic(
      apiKey,
      captionBio,
      tagTaxonomy,
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
        suggested_tags: parsedResponse.tagSuggestions || [],
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
    const notesForAiOverride = normalizeOptionalString(req.body?.notes_for_ai);
    const peopleOverrideIds = normalizeOptionalIdArray(req.body?.people);

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
    let promptPhoto = enrichedPhoto;

    if (notesForAiOverride !== null) {
      promptPhoto = {
        ...promptPhoto,
        notes_for_ai: notesForAiOverride
      };
    }

    if (peopleOverrideIds !== null) {
      promptPhoto = {
        ...promptPhoto,
        people: loadPeopleByIds(db, peopleOverrideIds)
      };
    }

    const tagTaxonomy = loadTagTaxonomy(db);
    const captionBio = loadCaptionBio(db);
    const captionMemory = loadRecentCaptionMemory(db, photoId);
    const imageBase64 = await fetchImageAsBase64(promptPhoto.large_url);
    const prompt = buildCaptionPrompt(promptPhoto, captionMemory);
    const anthropicResponse = await requestCaptionFromAnthropic(
      apiKey,
      captionBio,
      tagTaxonomy,
      imageBase64,
      prompt,
    );
    const parsedResponse = parseAnthropicText(anthropicResponse);

    if (!parsedResponse.aiCaption) {
      throw new Error("Anthropic response did not include a caption");
    }

    const normalizedEditRecipe = normalizeEditRecipe(parsedResponse.editRecipe);

    db.prepare(`
      UPDATE photos
      SET edit_recipe_json = ?,
          correction_status = ?
      WHERE id = ?
    `).run(
      normalizedEditRecipe ? JSON.stringify(normalizedEditRecipe) : null,
      normalizedEditRecipe ? "suggested" : "none",
      photoId
    );

    return res.json({
      data: {
        ai_caption: parsedResponse.aiCaption,
        alt_text: parsedResponse.altText || null,
        suggested_title: parsedResponse.suggestedTitle || null,
        suggested_people: parsedResponse.peopleSuggestions || [],
        suggested_tags: parsedResponse.tagSuggestions || [],
        edit_recipe: normalizedEditRecipe,
        notes_for_ai_used: promptPhoto.notes_for_ai || "",
        people_used: (promptPhoto.people || []).map((person) => person.id),
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

async function requestCaptionFromAnthropic(apiKey, captionBio, tagTaxonomy, imageBase64, prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
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
              type: "text",
              text: [
                "FAMILY CONTEXT — always apply this to every caption:",
                captionBio || "No caption bio configured.",
                "",
                "TAG TAXONOMY — use these groups and tags as a guide when suggesting tags. Prefer existing tags over inventing new ones:",
                tagTaxonomy || "No tag taxonomy configured."
              ].join("\n"),
              cache_control: {
                type: "ephemeral",
              },
            },
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64,
              },
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

function loadCaptionBio(db) {
  const row = db
    .prepare(
      `
    SELECT value
    FROM settings
    WHERE key = 'caption_bio'
    LIMIT 1
  `,
    )
    .get();

  return row?.value ? String(row.value) : "";
}

function parseAnthropicText(response) {
  const text = (response?.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  const aiCaptionMatch = text.match(
    /AI_CAPTION:\s*([\s\S]*?)(?:\nPEOPLE_SUGGESTIONS:|\nTAG_SUGGESTIONS:|\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const altTextMatch = text.match(
    /ALT_TEXT:\s*([\s\S]*?)(?:\nPEOPLE_SUGGESTIONS:|\nTAG_SUGGESTIONS:|\nTITLE_SUGGESTION:|$)/i,
  );
  const tagSuggestionsMatch = text.match(
    /TAG_SUGGESTIONS:\s*([\s\S]*?)(?:\nPEOPLE_SUGGESTIONS:|\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const peopleSuggestionsMatch = text.match(
    /PEOPLE_SUGGESTIONS:\s*([\s\S]*?)(?:\nAI_CAPTION:|\nTAG_SUGGESTIONS:|\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const editRecipeMatch = text.match(
    /EDIT_RECIPE_JSON:\s*([\s\S]*?)(?:\nPEOPLE_SUGGESTIONS:|\nAI_CAPTION:|\nTAG_SUGGESTIONS:|\nALT_TEXT:|\nTITLE_SUGGESTION:|$)/i,
  );
  const titleSuggestionMatch = text.match(/TITLE_SUGGESTION:\s*([\s\S]*?)$/i);

  return {
    aiCaption: cleanGeneratedText(aiCaptionMatch ? aiCaptionMatch[1] : text),
    altText: cleanGeneratedText(altTextMatch ? altTextMatch[1] : ""),
    suggestedTitle: cleanGeneratedText(
      titleSuggestionMatch ? titleSuggestionMatch[1] : "",
    ),
    peopleSuggestions: parseSuggestedPeople(
      peopleSuggestionsMatch ? peopleSuggestionsMatch[1] : "",
    ),
    editRecipe: parseEditRecipe(editRecipeMatch ? editRecipeMatch[1] : ""),
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

function parseSuggestedPeople(value) {
  const allowedPeople = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];
  const suggestions = [];
  const seen = new Set();

  for (const item of String(value || "").split(",")) {
    const trimmedItem = item.trim();

    if (!trimmedItem) {
      continue;
    }

    const matchingName = allowedPeople.find((name) => name.toLowerCase() === trimmedItem.toLowerCase());

    if (!matchingName || seen.has(matchingName)) {
      continue;
    }

    seen.add(matchingName);
    suggestions.push(matchingName);
  }

  return suggestions;
}

function parseEditRecipe(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    return JSON.parse(trimmedValue);
  } catch {
    return null;
  }
}

function buildCaptionPrompt(photo, captionMemory) {
  const people = (photo.people || []).map((person) => person.name);
  const tags = photo.tags || [];
  const locationParts = [
    photo.neighborhood,
    photo.city,
    photo.region,
    photo.country,
  ].filter(Boolean);

  return [
    "You are Adam Clarkson, a travel blogger writing for adamandlinds.com. Write captions in first person plural (we/our) as if speaking directly to your audience. Casual, specific, direct. No fluff.",
    "",
    "CAPTION RULES:",
    "- 1-2 sentences max",
    "- Only mention people who appear in the People list below. If notes mention someone is NOT in the photo, do not mention them at all. The People list is the ground truth.",
    "- Never invent people, relationships, or actions not supported by the metadata or image",
    "- Notes are low-priority background context. The caption should primarily come from what you see in the image and the structured metadata above. Do not let notes dominate or dictate the caption.",
    "- Prefer seasons and approximate time over exact dates. Say 'spring of 2025' not 'April 3, 2025' unless the exact date is unusually meaningful like a birthday",
    "- If a birthday is evident from the metadata or notes, mention it naturally",
    "- Be specific, not generic. A bad caption describes the photo. A good caption tells you something about the moment.",
    "- Write like you were there, as Adam speaking to his audience, not like an outside observer describing a scene",
    "- When referring to people, use their names or personal terms like 'the girls', 'our family', 'the kids'. Never use cold generic descriptions like 'three girls', 'a family', 'a woman', 'a man', 'a child', or 'two adults'. The difference: 'the girls' is personal, 'three girls' is a stranger describing a photo.",
    "- Never end a sentence with a participial phrase like '...capturing a moment of...' or '...reflecting their...' or '...highlighting the...'",
    "- Never use em dashes (—). Use a comma, period, or rephrase instead",
    "- Never use: vibrant, nestled, showcasing, highlighting, testament, stunning, beautiful, picturesque, perfect, incredible, amazing, breathtaking, remarkable, pivotal, enduring, foster, underscore, delve, tapestry, landscape (as abstract noun)",
    "- Never use 'not just X, but Y' or 'more than just' constructions",
    "- Do not list three things in a row for emphasis (rule of three is an AI tell)",
    "- Do not editorialize about significance, legacy, or meaning",
    "- Do not use words like 'content', 'storytelling', 'narrative', 'authenticity', or 'the viewer'",
    "",
    "TITLE RULES:",
    "- 4-8 words, written like a travel blog post title or vlog title",
    "- Specific and evocative, not generic. 'Harper's Noodle Lunch in Southampton' not 'Lunch Stop in England'",
    "- Do not use the filename as inspiration",
    "- Do not use colons or em dashes in the title",
    "",
    "TAG RULES:",
    "- Suggest 3-6 tags using the taxonomy provided in your context",
    "- Prefer existing tags from the taxonomy over inventing new ones",
    "- Always include one shot type tag when it can be inferred from the image",
    "- Do not suggest country names, city names, or broad geographic tags — location is stored separately",
    "- Do not suggest year, season, or time-based tags — date is stored separately",
    "- Format as: GroupName>tagname (e.g. Food & Drink>dim sum, Shot Type>wide shot)",
    "",
    "PEOPLE SUGGESTION RULES:",
    "- Suggest only from this exact list: Adam, Lindsay, Lily, Cora, Harper",
    "- Only suggest a person if the image gives a reasonable visual basis for it",
    "- If you are unsure, leave them out",
    "- Never suggest anyone outside that list",
    "- Format as a comma-separated list of names, or leave blank if uncertain",
    "",
    "PHOTO CORRECTION RULES:",
    "- Return a conservative Sharp correction recipe only",
    "- This is for mild cleanup, not artistic editing",
    "- Do not invent crop, object removal, sky replacement, or beauty retouching",
    "- rotateDegrees must stay 0 for now",
    "- crop must always be null for now",
    "- Keep notes short",
    "- Use this exact JSON shape and keys",
    `- Allowed values: {"apply": boolean, "brightness": 0.92-1.12, "contrast": 0.90-1.18, "saturation": 0.90-1.18, "sharpness": "none"|"light"|"medium", "warmth": -0.08 to 0.08, "rotateDegrees": 0, "crop": null, "notes": "short explanation"}`,
    "",
    "PHOTO METADATA:",
    `People IN this photo: ${people.length > 0 ? people.join(", ") : "None — do not mention any people by name"}`,
    `Location: ${locationParts.length > 0 ? locationParts.join(", ") : "Unknown"}`,
    `Date taken: ${photo.captured_at || "Unknown"}`,
    `Existing tags: ${tags.length > 0 ? tags.join(", ") : "None"}`,
    `Title: ${photo.title || "Not set"}`,
    `Description (public, owner-written): ${photo.description || "Not set"}`,
    `Notes (background context only, low priority): ${photo.notes_for_ai || "Not set"}`,
    "",
    "RECENT CAPTION MEMORY:",
    captionMemory || "No recent caption memory available.",
    "",
    "Return exactly this format with no preamble:",
    'EDIT_RECIPE_JSON: {"apply":false,"brightness":1,"contrast":1,"saturation":1,"sharpness":"none","warmth":0,"rotateDegrees":0,"crop":null,"notes":""}',
    "PEOPLE_SUGGESTIONS: <comma-separated names from the allowed list, or blank>",
    "AI_CAPTION: <caption here>",
    "TAG_SUGGESTIONS: <comma-separated GroupName>tagname pairs>",
    "ALT_TEXT: <one sentence describing what is visually in the image for accessibility>",
    "TITLE_SUGGESTION: <title here>",
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

function loadRecentCaptionMemory(db, currentPhotoId) {
  const rows = db.prepare(`
    SELECT original_filename, ai_caption, title, captured_at, city, country
    FROM photos
    WHERE deleted_at IS NULL
      AND id != ?
      AND NULLIF(TRIM(COALESCE(ai_caption, '')), '') IS NOT NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 8
  `).all(currentPhotoId);

  if (rows.length === 0) {
    return "";
  }

  return rows.map((row, index) => {
    const meta = [
      row.title ? `title=${row.title}` : null,
      row.captured_at ? `date=${row.captured_at}` : null,
      row.city || row.country ? `location=${[row.city, row.country].filter(Boolean).join(", ")}` : null
    ].filter(Boolean).join(" | ");

    return `${index + 1}. ${row.original_filename}${meta ? ` [${meta}]` : ""}: ${row.ai_caption}`;
  }).join("\n");
}

function buildVideoCaptionPrompt(video) {
  const people = (video.people || []).map((person) => person.name);
  const tags = video.tags || [];
  const locationParts = [video.filmed_city, video.filmed_country].filter(Boolean);

  return [
    "You are Adam Clarkson, a travel blogger writing for adamandlinds.com. Write captions in first person plural (we/our) as if speaking directly to your audience. Casual, specific, direct. No fluff.",
    "",
    "CAPTION RULES:",
    "- 1-2 sentences max",
    "- Only mention people who appear in the People list below. If notes mention someone is NOT in the video, do not mention them at all. The People list is the ground truth.",
    "- Never invent people, relationships, or actions not supported by the metadata",
    "- Prefer seasons and approximate time over exact dates. Say 'spring of 2025' not 'April 3, 2025' unless the exact date is unusually meaningful like a birthday",
    "- If a birthday is evident from the metadata or notes, mention it naturally",
    "- Be specific, not generic. A bad caption describes the video. A good caption tells you something about the moment.",
    "- Write like you were there, as Adam speaking to his audience, not like an outside observer describing a scene",
    "- Never end a sentence with a participial phrase like '...capturing a moment of...' or '...reflecting their...' or '...highlighting the...'",
    "- Never use em dashes (—). Use a comma, period, or rephrase instead",
    "- Never use: vibrant, nestled, showcasing, highlighting, testament, stunning, beautiful, picturesque, perfect, incredible, amazing, breathtaking, remarkable, pivotal, enduring, foster, underscore, delve, tapestry, landscape (as abstract noun)",
    "- Never use 'not just X, but Y' or 'more than just' constructions",
    "- Do not list three things in a row for emphasis (rule of three is an AI tell)",
    "- Do not editorialize about significance, legacy, or meaning",
    "- Do not use words like 'content', 'storytelling', 'narrative', 'authenticity', or 'the viewer'",
    "",
    "TITLE RULES:",
    "- 4-8 words, written like a travel blog post title or vlog title",
    "- Specific and evocative, not generic",
    "- Do not use the filename or existing title too literally as inspiration",
    "- Do not use colons or em dashes in the title",
    "",
    "TAG RULES:",
    "- Suggest 3-6 tags using the taxonomy provided in your context",
    "- Prefer existing tags from the taxonomy over inventing new ones",
    "- Do not suggest country names, city names, or broad geographic tags — location is stored separately",
    "- Do not suggest year, season, or time-based tags — date is stored separately",
    "- Format as: GroupName>tagname",
    "",
    "VIDEO METADATA:",
    `People IN this video: ${people.length > 0 ? people.join(", ") : "None — do not mention any people by name"}`,
    `Location: ${locationParts.length > 0 ? locationParts.join(", ") : "Unknown"}`,
    `Filmed date: ${video.date_filmed || "Unknown"}`,
    `Published date: ${video.date_published || "Unknown"}`,
    `Existing tags: ${tags.length > 0 ? tags.join(", ") : "None"}`,
    `Video category: ${video.video_category || "Unknown"}`,
    `Title: ${video.title || "Not set"}`,
    `Description (public, owner-written): ${video.description || "Not set"}`,
    `Notes for AI (private context, never quote verbatim): ${video.notes_for_ai || "Not set"}`,
    "",
    "Return exactly this format with no preamble:",
    "AI_CAPTION: <caption here>",
    "TAG_SUGGESTIONS: <comma-separated GroupName>tagname pairs>",
    "ALT_TEXT: <one sentence describing what is visually in the image for accessibility>",
    "TITLE_SUGGESTION: <title here>",
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

function loadPeopleByIds(db, peopleIds) {
  if (peopleIds.length === 0) {
    return [];
  }

  const placeholders = peopleIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id, name
    FROM people
    WHERE id IN (${placeholders})
    ORDER BY name
  `).all(...peopleIds);

  const rowIds = new Set(rows.map((row) => row.id));

  for (const personId of peopleIds) {
    if (!rowIds.has(personId)) {
      throw new Error("One or more selected people were not found");
    }
  }

  return rows;
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

function normalizeOptionalString(value) {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return "";
  }

  return String(value);
}

function normalizeOptionalIdArray(value) {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error("people must be an array");
  }

  const ids = [];
  const seen = new Set();

  for (const item of value) {
    const id = Number(item);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("people must contain valid ids");
    }

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

module.exports = router;
