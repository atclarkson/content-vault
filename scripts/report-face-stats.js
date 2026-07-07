const path = require("path");
const Database = require("better-sqlite3");
const { dbPath: defaultDbPath } = require("../server/lib/db");

const FAMILY_MEMBER_NAMES = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];
const databasePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultDbPath;

function formatNumber(value, digits = 0) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return digits > 0 ? (0).toFixed(digits) : "0";
  }

  return digits > 0 ? numericValue.toFixed(digits) : String(Math.round(numericValue));
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function safeParseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadFamilyIds(db) {
  const placeholders = FAMILY_MEMBER_NAMES.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id, name
    FROM people
    WHERE name IN (${placeholders})
    ORDER BY name ASC
  `).all(...FAMILY_MEMBER_NAMES);

  return rows;
}

function main() {
  const db = new Database(databasePath, { readonly: true });
  const familyRows = loadFamilyIds(db);
  const familyIds = familyRows.map((row) => row.id);

  if (familyIds.length === 0) {
    throw new Error("No family people found for face reporting");
  }

  const familyPlaceholders = familyIds.map(() => "?").join(", ");
  const refSummary = db.prepare(`
    SELECT
      COUNT(*) AS total_refs,
      COUNT(DISTINCT person_id) AS people_with_refs,
      AVG(quality_score) AS avg_quality
    FROM person_face_refs
    WHERE person_id IN (${familyPlaceholders})
  `).get(...familyIds);
  const refsByPerson = db.prepare(`
    SELECT
      people.name,
      COUNT(*) AS refs,
      SUM(CASE WHEN person_face_refs.source = 'seed_backfill' THEN 1 ELSE 0 END) AS seed_refs,
      SUM(CASE WHEN person_face_refs.source = 'manual_confirmed' THEN 1 ELSE 0 END) AS manual_refs,
      AVG(person_face_refs.quality_score) AS avg_quality
    FROM people
    LEFT JOIN person_face_refs ON person_face_refs.person_id = people.id
    WHERE people.id IN (${familyPlaceholders})
    GROUP BY people.id, people.name
    ORDER BY refs DESC, people.name ASC
  `).all(...familyIds);
  const matchSummary = db.prepare(`
    SELECT
      COUNT(*) AS total_faces,
      COUNT(DISTINCT photo_id) AS analyzed_photos,
      SUM(CASE WHEN top_person_id IN (${familyPlaceholders}) THEN 1 ELSE 0 END) AS confident_faces,
      SUM(CASE WHEN top_person_id IS NULL THEN 1 ELSE 0 END) AS unresolved_faces,
      SUM(CASE WHEN status = 'suggested' THEN 1 ELSE 0 END) AS suggested_faces,
      SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_faces,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_faces,
      AVG(CASE WHEN top_person_id IN (${familyPlaceholders}) THEN top_score END) AS avg_confident_score
    FROM photo_face_matches
  `).get(...familyIds, ...familyIds);
  const namedMatchesByPerson = db.prepare(`
    SELECT
      people.name,
      COUNT(*) AS confident_faces,
      SUM(CASE WHEN photo_face_matches.status = 'suggested' THEN 1 ELSE 0 END) AS suggested_faces,
      SUM(CASE WHEN photo_face_matches.status = 'accepted' THEN 1 ELSE 0 END) AS accepted_faces,
      SUM(CASE WHEN photo_face_matches.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_faces,
      AVG(photo_face_matches.top_score) AS avg_score
    FROM photo_face_matches
    INNER JOIN people ON people.id = photo_face_matches.top_person_id
    WHERE photo_face_matches.top_person_id IN (${familyPlaceholders})
    GROUP BY people.id, people.name
    ORDER BY confident_faces DESC, people.name ASC
  `).all(...familyIds);

  const tentativeRows = db.prepare(`
    SELECT id, candidate_json
    FROM photo_face_matches
    WHERE top_person_id IS NULL
      AND candidate_json IS NOT NULL
  `).all();
  const tentativeByPersonId = new Map();
  let tentativeWithTopCandidate = 0;

  for (const row of tentativeRows) {
    const candidates = safeParseJson(row.candidate_json, []);
    const topCandidate = Array.isArray(candidates) ? candidates[0] : null;

    if (!topCandidate?.person_id || !familyIds.includes(topCandidate.person_id)) {
      continue;
    }

    tentativeWithTopCandidate += 1;
    tentativeByPersonId.set(
      topCandidate.person_id,
      (tentativeByPersonId.get(topCandidate.person_id) || 0) + 1,
    );
  }

  const recentAcceptedRefs = db.prepare(`
    SELECT
      people.name,
      person_face_refs.photo_id,
      photos.original_filename,
      person_face_refs.created_at
    FROM person_face_refs
    INNER JOIN people ON people.id = person_face_refs.person_id
    INNER JOIN photos ON photos.id = person_face_refs.photo_id
    WHERE person_face_refs.source = 'manual_confirmed'
      AND people.id IN (${familyPlaceholders})
    ORDER BY person_face_refs.created_at DESC
    LIMIT 10
  `).all(...familyIds);

  console.log(`DB: ${databasePath}`);

  printSection("Reference Pool");
  console.log(
    `total refs: ${formatNumber(refSummary.total_refs)} | people with refs: ${formatNumber(refSummary.people_with_refs)}/${familyIds.length} | avg quality: ${formatNumber(refSummary.avg_quality, 3)}`,
  );
  refsByPerson.forEach((row) => {
    console.log(
      `${row.name}: ${formatNumber(row.refs)} refs (${formatNumber(row.seed_refs)} seed, ${formatNumber(row.manual_refs)} manual), avg quality ${formatNumber(row.avg_quality, 3)}`,
    );
  });

  printSection("Match Pool");
  console.log(
    `faces: ${formatNumber(matchSummary.total_faces)} | analyzed photos: ${formatNumber(matchSummary.analyzed_photos)} | confident: ${formatNumber(matchSummary.confident_faces)} | unresolved: ${formatNumber(matchSummary.unresolved_faces)}`,
  );
  console.log(
    `status: ${formatNumber(matchSummary.suggested_faces)} suggested, ${formatNumber(matchSummary.accepted_faces)} accepted, ${formatNumber(matchSummary.rejected_faces)} rejected | avg confident score: ${formatNumber(matchSummary.avg_confident_score, 3)}`,
  );
  console.log(`tentative top candidates: ${tentativeWithTopCandidate}`);
  familyRows.forEach((row) => {
    console.log(
      `${row.name}: ${formatNumber(tentativeByPersonId.get(row.id) || 0)} tentative top-candidate faces`,
    );
  });

  printSection("Confident Matches By Person");
  namedMatchesByPerson.forEach((row) => {
    console.log(
      `${row.name}: ${formatNumber(row.confident_faces)} confident (${formatNumber(row.suggested_faces)} suggested, ${formatNumber(row.accepted_faces)} accepted, ${formatNumber(row.rejected_faces)} rejected), avg score ${formatNumber(row.avg_score, 3)}`,
    );
  });

  printSection("Recent Manual Confirmations");
  if (recentAcceptedRefs.length === 0) {
    console.log("none");
    return;
  }

  recentAcceptedRefs.forEach((row) => {
    console.log(
      `${row.created_at} | ${row.name} | photo ${row.photo_id} | ${row.original_filename}`,
    );
  });
}

main();
