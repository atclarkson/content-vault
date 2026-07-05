#!/usr/bin/env node

require("dotenv").config();

const path = require("path");
const { createDayOneImporter } = require("../server/lib/dayOneImport");

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith("--"));
  const skipPhotos = args.includes("--skip-photos");

  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const importDayOneFromPath = createDayOneImporter();
  let lastLoggedAt = 0;

  await importDayOneFromPath({
    inputPath,
    skipPhotos,
    onProgress(event) {
      if (event.type === "scan") {
        console.log(`Scanning source: ${event.input_path}`);
        console.log(`Source type: ${event.source_type}`);
        console.log(`Journal entries: ${event.total_entries}`);
        console.log(`Files: ${event.total_files}`);
        console.log(`Images: ${event.image_files} (${formatBytes(event.image_bytes)})`);
        console.log(`Videos: ${event.video_files} (${formatBytes(event.video_bytes)})`);
        console.log(`Other files: ${event.other_files} (${formatBytes(event.other_bytes)})`);

        if (event.largest_files.length > 0) {
          console.log("Largest files:");

          for (const file of event.largest_files) {
            console.log(`- ${formatBytes(file.size)}  ${file.path}`);
          }
        }

        console.log("");
        return;
      }

      if (event.type === "start") {
        console.log(`Starting import of ${event.total} journal entries...`);
        return;
      }

      if (event.type === "progress") {
        const now = Date.now();
        const shouldLog =
          event.current === event.total ||
          event.current === 1 ||
          event.current % 10 === 0 ||
          now - lastLoggedAt >= 2000;

        if (!shouldLog) {
          return;
        }

        lastLoggedAt = now;
        console.log(
          `[${event.current}/${event.total}] action=${event.action} matched=${event.matched_photos} uploaded=${event.uploaded_photos} journals=${event.text_entries_added} skipped=${event.skipped_duplicates}`
        );
        return;
      }

      if (event.type === "complete") {
        console.log("");
        console.log("Import complete.");
        console.log(`Matched photos: ${event.matched_photos}`);
        console.log(`Uploaded photos: ${event.uploaded_photos}`);
        console.log(`Journal entries added: ${event.text_entries_added}`);
        console.log(`Skipped duplicates: ${event.skipped_duplicates}`);
      }
    }
  });
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = -1;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(2)} ${units[unitIndex]}`;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/import-dayone.js /path/to/dayone-export.zip");
  console.log("  node scripts/import-dayone.js /path/to/extracted-folder");
  console.log("");
  console.log("Options:");
  console.log("  --skip-photos   Import journal text only");
}

main().catch((error) => {
  console.error("");
  console.error(`Import failed: ${error.message}`);
  process.exitCode = 1;
});
