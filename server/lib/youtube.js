const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const VIDEO_BATCH_SIZE = 50;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildUrl(path, params) {
  const url = new URL(`${YOUTUBE_API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function youtubeRequest(path, params) {
  const apiKey = getRequiredEnv("YOUTUBE_API_KEY");
  const url = buildUrl(path, {
    ...params,
    key: apiKey
  });

  const response = await fetch(url);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || "YouTube API request failed";
    throw new Error(message);
  }

  if (data?.error?.message) {
    throw new Error(data.error.message);
  }

  return data;
}

function chunkArray(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function parseDurationToSeconds(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }

  const match = value.match(/^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/);

  if (!match) {
    return 0;
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);

  return Math.round((days * 86400) + (hours * 3600) + (minutes * 60) + seconds);
}

function pickBestThumbnail(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") {
    return null;
  }

  return (
    thumbnails.maxres?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null
  );
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function getUploadsPlaylistId() {
  const channelId = getRequiredEnv("YOUTUBE_CHANNEL_ID");
  const data = await youtubeRequest("/channels", {
    part: "contentDetails",
    id: channelId
  });

  const playlistId = data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!playlistId) {
    throw new Error(`YouTube channel not found for YOUTUBE_CHANNEL_ID: ${channelId}`);
  }

  return playlistId;
}

async function getPlaylistVideoIds(playlistId) {
  if (!playlistId) {
    throw new Error("playlistId is required");
  }

  const videoIds = [];
  let pageToken = "";

  do {
    const data = await youtubeRequest("/playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: VIDEO_BATCH_SIZE,
      pageToken
    });

    for (const item of data?.items || []) {
      const videoId = item?.contentDetails?.videoId;

      if (videoId) {
        videoIds.push(videoId);
      }
    }

    pageToken = data?.nextPageToken || "";
  } while (pageToken);

  return videoIds;
}

async function getVideoDetails(videoIds) {
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return [];
  }

  const results = [];
  const batches = chunkArray(videoIds, VIDEO_BATCH_SIZE);

  for (const batch of batches) {
    const data = await youtubeRequest("/videos", {
      part: "snippet,contentDetails,statistics",
      id: batch.join(","),
      maxResults: VIDEO_BATCH_SIZE
    });

    for (const item of data?.items || []) {
      results.push({
        youtube_id: item.id,
        youtube_url: `https://www.youtube.com/watch?v=${item.id}`,
        title: item?.snippet?.title || "",
        description: item?.snippet?.description || "",
        thumbnail_url: pickBestThumbnail(item?.snippet?.thumbnails),
        duration_seconds: parseDurationToSeconds(item?.contentDetails?.duration),
        date_published: item?.snippet?.publishedAt || null,
        view_count: normalizeInteger(item?.statistics?.viewCount),
        like_count: normalizeInteger(item?.statistics?.likeCount),
        comment_count: normalizeInteger(item?.statistics?.commentCount)
      });
    }
  }

  return results;
}

async function getVideoStats(videoIds) {
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return [];
  }

  const results = [];
  const batches = chunkArray(videoIds, VIDEO_BATCH_SIZE);

  for (const batch of batches) {
    const data = await youtubeRequest("/videos", {
      part: "statistics",
      id: batch.join(","),
      maxResults: VIDEO_BATCH_SIZE
    });

    for (const item of data?.items || []) {
      results.push({
        youtube_id: item.id,
        view_count: normalizeInteger(item?.statistics?.viewCount),
        like_count: normalizeInteger(item?.statistics?.likeCount),
        comment_count: normalizeInteger(item?.statistics?.commentCount)
      });
    }
  }

  return results;
}

module.exports = {
  getUploadsPlaylistId,
  getPlaylistVideoIds,
  getVideoDetails,
  getVideoStats
};
