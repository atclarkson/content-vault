const test = require("node:test");
const assert = require("node:assert/strict");

const { createDescriptionExcerpt, getTrip } = require("./tripQuery");

test("getTrip merges journals, photos, and videos in ascending date order", () => {
  const result = getTrip(null, {
    date_from: "2022-05-14",
    date_to: "2022-05-30",
    limit_per_type: 25
  }, {
    queryPhotos() {
      return {
        items: [
          {
            uuid: "photo-1",
            title: "Temple courtyard",
            ai_caption: "Morning at the temple",
            notes_for_ai: "Use as the arrival visual.",
            large_url: "https://cdn.example.com/photo-1.jpg",
            width: 2400,
            height: 1600,
            captured_at: "2022-05-15T09:00:00.000Z",
            city: "Kyoto",
            country: "Japan",
            people: [{ id: 1, name: "Adam" }],
            tags: ["temple"]
          }
        ],
        total: 1
      };
    },
    queryVideos() {
      return {
        items: [
          {
            youtube_id: "yt-1",
            title: "Station arrival",
            description: "We rolled into Kyoto and filmed the walk from the station.",
            duration_seconds: 420,
            city: "Kyoto",
            country: "Japan",
            date_filmed: "2022-05-16T12:00:00.000Z",
            published_at: "2022-05-20T12:00:00.000Z"
          }
        ],
        total: 1
      };
    },
    queryJournals() {
      return {
        items: [
          {
            title: "Arrival day",
            body: "First ramen, then a long walk through Gion.",
            date: "2022-05-14T18:00:00.000Z",
            city: "Kyoto",
            country: "Japan"
          }
        ],
        total: 1
      };
    }
  });

  assert.deepEqual(result.counts, {
    photos: 1,
    videos: 1,
    journals: 1
  });

  assert.deepEqual(result.timeline, [
    {
      type: "journal",
      date: "2022-05-14T18:00:00.000Z",
      title: "Arrival day",
      body: "First ramen, then a long walk through Gion.",
      city: "Kyoto",
      country: "Japan"
    },
    {
      type: "photo",
      date: "2022-05-15T09:00:00.000Z",
      uuid: "photo-1",
      title: "Temple courtyard",
      ai_caption: "Morning at the temple",
      notes_for_ai: "Use as the arrival visual.",
      large_url: "https://cdn.example.com/photo-1.jpg",
      width: 2400,
      height: 1600,
      city: "Kyoto",
      country: "Japan",
      people: [{ id: 1, name: "Adam" }],
      tags: ["temple"]
    },
    {
      type: "video",
      date: "2022-05-16T12:00:00.000Z",
      youtube_id: "yt-1",
      title: "Station arrival",
      description_excerpt: "We rolled into Kyoto and filmed the walk from the station.",
      duration_seconds: 420,
      city: "Kyoto",
      country: "Japan"
    }
  ]);
});

test("getTrip sets per-type truncation flags when totals exceed limit_per_type", () => {
  const result = getTrip(null, {
    date_from: "2022-05-14",
    date_to: "2022-05-30",
    limit_per_type: 1
  }, {
    queryPhotos() {
      return { items: [{ captured_at: "2022-05-15", uuid: "photo-1", people: [], tags: [] }], total: 3 };
    },
    queryVideos() {
      return { items: [{ title: "Video", youtube_id: "yt-1", description: null, duration_seconds: 12, city: null, country: null, date_filmed: null, published_at: "2022-05-16" }], total: 1 };
    },
    queryJournals() {
      return { items: [{ title: "Journal", body: "Body", date: "2022-05-14", city: null, country: null }], total: 4 };
    }
  });

  assert.deepEqual(result.counts, {
    photos: 3,
    photos_truncated: true,
    videos: 1,
    journals: 4,
    journals_truncated: true
  });
});

test("getTrip applies city filter to photos, videos, and journals", () => {
  const calls = [];

  getTrip(null, {
    date_from: "2022-05-14",
    date_to: "2022-05-30",
    city: "Kyoto",
    country: "Japan",
    limit_per_type: 10
  }, {
    queryPhotos(db, options) {
      calls.push(["photos", options]);
      return { items: [], total: 0 };
    },
    queryVideos(db, options) {
      calls.push(["videos", options]);
      return { items: [], total: 0 };
    },
    queryJournals(db, options) {
      calls.push(["journals", options]);
      return { items: [], total: 0 };
    }
  });

  assert.deepEqual(calls, [
    ["photos", {
      filters: {
        date_from: "2022-05-14",
        date_to: "2022-05-30",
        city: "Kyoto",
        country: "Japan"
      },
      limit: 10,
      offset: 0,
      sort: "oldest",
      view: "blog"
    }],
    ["videos", {
      filters: {
        date_from: "2022-05-14",
        date_to: "2022-05-30",
        city: "Kyoto",
        country: "Japan"
      },
      limit: 10,
      offset: 0,
      sort: "oldest",
      view: "full"
    }],
    ["journals", {
      filters: {
        date_from: "2022-05-14",
        date_to: "2022-05-30",
        city: "Kyoto",
        country: "Japan"
      },
      limit: 10,
      offset: 0,
      sort: "oldest",
      view: "full"
    }]
  ]);
});

test("createDescriptionExcerpt truncates at a word boundary with ellipsis", () => {
  const longText = `${"word ".repeat(70)}tail`;
  const excerpt = createDescriptionExcerpt(longText);

  assert.ok(excerpt.length <= 303);
  assert.match(excerpt, /\.\.\.$/);
  assert.doesNotMatch(excerpt, /ta\.\.\.$/);
});
