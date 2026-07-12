const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDestinationAggregateQuery, queryDestinations } = require("./destinationQuery");

function createMockDb({ items = [], total = items.length }) {
  return {
    prepare(sql) {
      if (sql.includes("SELECT COUNT(*) AS count")) {
        return {
          get(...params) {
            return { count: typeof total === "function" ? total(sql, params) : total };
          }
        };
      }

      return {
        all(...params) {
          return typeof items === "function" ? items(sql, params) : items;
        }
      };
    }
  };
}

test("get_destinations country filter is case-insensitive exact match", () => {
  const query = buildDestinationAggregateQuery({
    country: "Australia",
    min_photos: null,
    min_videos: null,
    min_total: null,
    sort: null,
    limit: 0
  });

  assert.match(query.sql, /LOWER\(TRIM\(COALESCE\(country, ''\)\)\) = \?/);
  assert.match(query.sql, /LOWER\(TRIM\(COALESCE\(filmed_country, ''\)\)\) = \?/);
  assert.deepEqual(query.params, ["australia", "australia", "australia", "australia"]);
});

test("get_destinations min_photos threshold is applied in the aggregate query", () => {
  const query = buildDestinationAggregateQuery({
    country: null,
    min_photos: 5,
    min_videos: null,
    min_total: null,
    sort: null,
    limit: 0
  });

  assert.match(query.sql, /HAVING photos >= \?/);
  assert.deepEqual(query.params, [5]);
});

test("get_destinations limit applies after total count is computed", () => {
  const db = createMockDb({
    items: [{ city: "Sydney", country: "Australia", photos: 10, videos: 2, journals: 1, date_first: "2022-01-01", date_last: "2022-01-10" }],
    total: 3
  });

  const result = queryDestinations(db, { limit: 1, sort: "photos" });

  assert.equal(result.total, 3);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.applied, {
    country: null,
    min_photos: null,
    min_videos: null,
    min_total: null,
    sort: "photos",
    limit: 1
  });
});

test("get_destinations with no parameters preserves legacy ordering and shape", () => {
  const rows = [
    { city: "Kyoto", country: "Japan", photos: 8, videos: 3, journals: 2, date_first: "2022-05-01", date_last: "2022-05-10" },
    { city: "Osaka", country: "Japan", photos: 4, videos: 1, journals: 0, date_first: "2022-05-11", date_last: "2022-05-13" }
  ];
  let capturedSql = "";
  const db = createMockDb({
    items(sql) {
      capturedSql = sql;
      return rows;
    },
    total: rows.length
  });

  const result = queryDestinations(db);

  assert.match(capturedSql, /ORDER BY \(photos \+ videos \+ journals\) DESC, country ASC, city ASC/);
  assert.deepEqual(result, {
    items: rows,
    total: 2,
    applied: {
      country: null,
      min_photos: null,
      min_videos: null,
      min_total: null,
      sort: null,
      limit: 0
    }
  });
});
