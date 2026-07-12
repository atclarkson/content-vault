const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDocumentKey,
  parseDocumentKey,
  parseSemanticSearchResponse
} = require("./semanticSearch");

test("buildDocumentKey creates stable AI search object keys", () => {
  assert.equal(buildDocumentKey("ai-search", "photo", 42), "ai-search/photos/42.md");
  assert.equal(buildDocumentKey("vault-index", "journal", 7), "vault-index/journals/7.md");
});

test("parseDocumentKey reads content type and record id from object keys", () => {
  assert.deepEqual(parseDocumentKey("ai-search/photos/42.md"), {
    contentType: "photo",
    recordId: 42
  });
  assert.deepEqual(parseDocumentKey("ai-search/videos/9.md"), {
    contentType: "video",
    recordId: 9
  });
  assert.equal(parseDocumentKey("ai-search/other/9.md"), null);
});

test("parseSemanticSearchResponse extracts hits from nested Cloudflare payloads", () => {
  const hits = parseSemanticSearchResponse({
    result: {
      data: [
        {
          score: 0.87,
          text: "Trip notes from Rome",
          item: {
            key: "ai-search/journals/15.md"
          }
        }
      ]
    }
  });

  assert.deepEqual(hits, [
    {
      contentType: "journal",
      recordId: 15,
      key: "ai-search/journals/15.md",
      score: 0.87,
      excerpt: "Trip notes from Rome"
    }
  ]);
});
