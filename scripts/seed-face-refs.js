const { getDb, initializeDatabase } = require("../server/lib/db");
const {
  FAMILY_MEMBER_NAMES,
  seedPhotoFaceReference,
} = require("../server/lib/faceAnalysis");

initializeDatabase();

async function main() {
  const db = getDb();
  const placeholders = FAMILY_MEMBER_NAMES.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT
      photos.id,
      photos.original_filename,
      photos.large_url,
      photos.small_url,
      photos.image_version,
      people.id AS person_id,
      people.name AS person_name
    FROM photos
    INNER JOIN photo_people ON photo_people.photo_id = photos.id
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photos.deleted_at IS NULL
      AND (photos.large_url IS NOT NULL OR photos.small_url IS NOT NULL)
      AND people.name IN (${placeholders})
      AND (
        SELECT COUNT(*)
        FROM photo_people AS matching_photo_people
        WHERE matching_photo_people.photo_id = photos.id
      ) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM person_face_refs
        WHERE person_face_refs.photo_id = photos.id
          AND person_face_refs.person_id = people.id
      )
    ORDER BY photos.id ASC
  `).all(...FAMILY_MEMBER_NAMES);

  let seeded = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const result = await seedPhotoFaceReference(db, row, row.person_id);

      if (result.seeded) {
        seeded += 1;
        console.log(`Seeded ${row.person_name} from ${row.original_filename}`);
      } else {
        skipped += 1;
        console.log(
          `Skipped ${row.original_filename}: ${result.reason || "no face seed created"}`,
        );
      }
    } catch (error) {
      skipped += 1;
      console.error(`Failed ${row.original_filename}: ${error.message}`);
    }
  }

  console.log(
    `Face reference seed complete. Seeded ${seeded}, skipped ${skipped}, total ${rows.length}.`,
  );
}

main().catch((error) => {
  console.error(error.message || "Failed to seed face references");
  process.exitCode = 1;
});
