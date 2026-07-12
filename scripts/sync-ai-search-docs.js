#!/usr/bin/env node

require("dotenv").config();

const { initializeDatabase, getDb } = require("../server/lib/db");
const { syncSemanticSearchDocuments, normalizeContentTypes } = require("../server/lib/semanticSearch");

async function main() {
  initializeDatabase();

  const args = process.argv.slice(2);
  const contentTypes = normalizeContentTypes(args.length > 0 ? args : undefined);
  const db = getDb();
  const summaries = await syncSemanticSearchDocuments(db, { contentTypes });

  const totals = summaries.reduce((accumulator, summary) => {
    accumulator.uploaded += summary.uploaded;
    accumulator.deleted += summary.deleted;
    return accumulator;
  }, { uploaded: 0, deleted: 0 });

  console.log(`Synced AI search docs for ${contentTypes.join(", ")}`);

  for (const summary of summaries) {
    console.log(`- ${summary.content_type}: uploaded ${summary.uploaded}, deleted ${summary.deleted}`);
  }

  console.log(`Total uploaded: ${totals.uploaded}`);
  console.log(`Total deleted: ${totals.deleted}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
