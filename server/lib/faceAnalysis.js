require("@tensorflow/tfjs-node");

const path = require("path");
const faceapi = require("@vladmandic/face-api");

const FAMILY_MEMBER_NAMES = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];
const MIN_FACE_SIZE = 80;
const MIN_DETECTION_SCORE = 0.45;
const MIN_QUALITY_SCORE = 0.4;
const MAX_MATCH_DISTANCE = 0.58;
const MIN_DISTANCE_GAP = 0.04;
const MAX_CANDIDATES = 3;

const MODEL_DIR = path.join(
  path.dirname(require.resolve("@vladmandic/face-api/package.json")),
  "model",
);

const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 512,
  scoreThreshold: 0.4,
});

let modelLoadPromise = null;

function getEmptyFacePrematchResult(photo) {
  return {
    photo_id: photo?.id || null,
    image_version: Number(photo?.image_version) || 1,
    people: [],
    faces: [],
    expressionTags: [],
  };
}

async function ensureModelsLoaded() {
  if (!modelLoadPromise) {
    modelLoadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceLandmark68TinyNet.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceExpressionNet.loadFromDisk(MODEL_DIR),
    ]);
  }

  return modelLoadPromise;
}

async function analyzePhotoFaces(db, photo) {
  if (!photo || !photo.id) {
    throw new Error("Photo is required for face analysis");
  }

  await ensureModelsLoaded();

  const detections = await detectFacesForPhoto(photo);
  const imageVersion = Number(photo.image_version) || 1;

  db.prepare(`
    DELETE FROM photo_face_matches
    WHERE photo_id = ?
      AND image_version = ?
  `).run(photo.id, imageVersion);

  if (detections.length === 0) {
    return getEmptyFacePrematchResult(photo);
  }

  const faceReferenceGroups = loadFaceReferenceGroups(db);
  const insertFaceMatch = db.prepare(`
    INSERT INTO photo_face_matches (
      photo_id,
      image_version,
      face_index,
      face_box_json,
      embedding_json,
      top_person_id,
      top_score,
      candidate_json,
      expression_json,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested')
  `);

  const faces = [];
  const expressionTagMap = new Map();

  for (const detection of detections) {
    const candidates = buildFaceCandidates(
      detection.descriptor,
      faceReferenceGroups,
    );
    const resolvedMatch = resolveBestCandidate(candidates);
    const expressionTags = deriveExpressionTags(detection.expressions);
    const resultBox = normalizeFaceBox(detection.box);
    const serializedDescriptor = JSON.stringify(Array.from(detection.descriptor));
    const serializedCandidates = JSON.stringify(candidates);
    const serializedExpressions = JSON.stringify(detection.expressions);
    const insertResult = insertFaceMatch.run(
      photo.id,
      imageVersion,
      detection.face_index,
      JSON.stringify(resultBox),
      serializedDescriptor,
      resolvedMatch.person_id,
      resolvedMatch.score,
      serializedCandidates,
      serializedExpressions,
    );

    for (const tag of expressionTags) {
      const existingTag = expressionTagMap.get(tag.name);

      if (!existingTag || tag.score > existingTag.score) {
        expressionTagMap.set(tag.name, tag);
      }
    }

    faces.push({
      id: Number(insertResult.lastInsertRowid),
      face_index: detection.face_index,
      box: resultBox,
      quality_score: detection.quality_score,
      detection_score: detection.detection_score,
      top_person_id: resolvedMatch.person_id,
      top_name: resolvedMatch.name,
      top_score: resolvedMatch.score,
      candidates,
      expressions: detection.expressions,
      suggested_expression_tags: expressionTags,
      status: "suggested",
    });
  }

  return {
    photo_id: photo.id,
    image_version: imageVersion,
    people: aggregatePrematchPeople(faces),
    faces,
    expressionTags: Array.from(expressionTagMap.values()).sort(
      (left, right) => right.score - left.score,
    ),
  };
}

async function seedPhotoFaceReference(db, photo, personId, source = "seed_backfill") {
  if (!photo || !photo.id) {
    throw new Error("Photo is required to seed a face reference");
  }

  await ensureModelsLoaded();

  const detections = await detectFacesForPhoto(photo);

  if (detections.length !== 1) {
    return {
      seeded: false,
      reason: `expected 1 clear face, found ${detections.length}`,
    };
  }

  const [faceDetection] = detections;

  upsertFaceReference(db, {
    personId,
    photoId: photo.id,
    faceIndex: faceDetection.face_index,
    faceBox: normalizeFaceBox(faceDetection.box),
    descriptor: faceDetection.descriptor,
    qualityScore: faceDetection.quality_score,
    source,
  });

  return {
    seeded: true,
    quality_score: faceDetection.quality_score,
  };
}

function acceptPhotoFaceMatches(db, photoId, faceMatchIds) {
  if (!Array.isArray(faceMatchIds) || faceMatchIds.length === 0) {
    return;
  }

  const rows = loadFaceMatchesByIds(db, photoId, faceMatchIds);
  const updateStatus = db.prepare(`
    UPDATE photo_face_matches
    SET status = 'accepted',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const row of rows) {
    if (!row.top_person_id) {
      throw new Error(`Face match ${row.id} does not have a suggested person`);
    }

    upsertFaceReference(db, {
      personId: row.top_person_id,
      photoId,
      faceIndex: row.face_index,
      faceBox: safeParseJson(row.face_box_json, {}),
      descriptor: safeParseJson(row.embedding_json, []),
      qualityScore: computeQualityScoreFromBox(
        safeParseJson(row.face_box_json, {}),
        row.top_score,
      ),
      source: "manual_confirmed",
    });
    updateStatus.run(row.id);
  }
}

function rejectPhotoFaceMatches(db, photoId, faceMatchIds) {
  if (!Array.isArray(faceMatchIds) || faceMatchIds.length === 0) {
    return;
  }

  loadFaceMatchesByIds(db, photoId, faceMatchIds);

  const updateStatus = db.prepare(`
    UPDATE photo_face_matches
    SET status = 'rejected',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const faceMatchId of faceMatchIds) {
    updateStatus.run(faceMatchId);
  }
}

async function detectFacesForPhoto(photo) {
  const imageUrl = photo.large_url || photo.small_url;

  if (!imageUrl) {
    return [];
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch photo for face analysis: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const imageTensor = faceapi.tf.node.decodeImage(buffer, 3);
  const inputTensor = faceapi.tf.expandDims(imageTensor, 0);

  try {
    const results = await faceapi
      .detectAllFaces(inputTensor, DETECTOR_OPTIONS)
      .withFaceLandmarks(true)
      .withFaceDescriptors()
      .withFaceExpressions();

    return results
      .map((result, index) => {
        const box = normalizeFaceBox(result.detection.box);
        const detectionScore = roundNumber(result.detection.score || 0);
        const qualityScore = computeQualityScoreFromBox(box, detectionScore);

        return {
          face_index: index,
          box,
          detection_score: detectionScore,
          quality_score: qualityScore,
          descriptor: Array.from(result.descriptor || []),
          expressions: normalizeExpressions(result.expressions || {}),
        };
      })
      .filter((result) => {
        return (
          result.box.width >= MIN_FACE_SIZE &&
          result.box.height >= MIN_FACE_SIZE &&
          result.detection_score >= MIN_DETECTION_SCORE &&
          result.quality_score >= MIN_QUALITY_SCORE &&
          result.descriptor.length === 128
        );
      });
  } finally {
    faceapi.tf.dispose([imageTensor, inputTensor]);
  }
}

function loadFaceReferenceGroups(db) {
  const placeholders = FAMILY_MEMBER_NAMES.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT
      person_face_refs.person_id,
      person_face_refs.embedding_json,
      people.name
    FROM person_face_refs
    INNER JOIN people ON people.id = person_face_refs.person_id
    WHERE people.name IN (${placeholders})
    ORDER BY person_face_refs.created_at DESC
  `).all(...FAMILY_MEMBER_NAMES);

  const refsByPersonId = new Map();

  for (const row of rows) {
    const descriptor = safeParseJson(row.embedding_json, []);

    if (!Array.isArray(descriptor) || descriptor.length !== 128) {
      continue;
    }

    if (!refsByPersonId.has(row.person_id)) {
      refsByPersonId.set(row.person_id, {
        person_id: row.person_id,
        name: row.name,
        descriptors: [],
      });
    }

    refsByPersonId.get(row.person_id).descriptors.push(descriptor);
  }

  return Array.from(refsByPersonId.values());
}

function buildFaceCandidates(descriptor, referenceGroups) {
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    return [];
  }

  return referenceGroups
    .map((group) => {
      const distances = group.descriptors
        .map((candidateDescriptor) =>
          faceapi.euclideanDistance(descriptor, candidateDescriptor),
        )
        .sort((left, right) => left - right);
      const distance = distances[0];

      return {
        person_id: group.person_id,
        name: group.name,
        distance: roundNumber(distance),
        score: roundNumber(convertDistanceToScore(distance)),
      };
    })
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_CANDIDATES);
}

function resolveBestCandidate(candidates) {
  const bestCandidate = candidates[0];
  const secondCandidate = candidates[1];

  if (!bestCandidate) {
    return {
      person_id: null,
      name: null,
      score: 0,
    };
  }

  const hasDistanceGap =
    !secondCandidate ||
    secondCandidate.distance - bestCandidate.distance >= MIN_DISTANCE_GAP;

  if (bestCandidate.distance > MAX_MATCH_DISTANCE || !hasDistanceGap) {
    return {
      person_id: null,
      name: null,
      score: bestCandidate.score,
    };
  }

  return {
    person_id: bestCandidate.person_id,
    name: bestCandidate.name,
    score: bestCandidate.score,
  };
}

function aggregatePrematchPeople(faces) {
  const matchesByPersonId = new Map();

  for (const face of faces) {
    if (!face.top_person_id || !face.top_name) {
      continue;
    }

    if (!matchesByPersonId.has(face.top_person_id)) {
      matchesByPersonId.set(face.top_person_id, {
        person_id: face.top_person_id,
        name: face.top_name,
        score: face.top_score,
        face_match_ids: [],
      });
    }

    const entry = matchesByPersonId.get(face.top_person_id);
    entry.score = Math.max(entry.score, face.top_score);
    entry.face_match_ids.push(face.id);
  }

  return Array.from(matchesByPersonId.values()).sort(
    (left, right) => right.score - left.score,
  );
}

function deriveExpressionTags(expressions) {
  const tags = [];

  if (expressions.happy >= 0.65) {
    tags.push({ name: "smiling", score: roundNumber(expressions.happy) });
  }

  if (expressions.surprised >= 0.5) {
    tags.push({ name: "surprised", score: roundNumber(expressions.surprised) });
  }

  if (expressions.sad >= 0.55) {
    tags.push({ name: "sad", score: roundNumber(expressions.sad) });
  }

  if (expressions.angry >= 0.55) {
    tags.push({ name: "angry", score: roundNumber(expressions.angry) });
  }

  return tags;
}

function normalizeExpressions(expressions) {
  return Object.fromEntries(
    Object.entries(expressions).map(([key, value]) => [
      key,
      roundNumber(value || 0),
    ]),
  );
}

function normalizeFaceBox(box) {
  return {
    x: roundNumber(box.x || 0),
    y: roundNumber(box.y || 0),
    width: roundNumber(box.width || 0),
    height: roundNumber(box.height || 0),
  };
}

function computeQualityScoreFromBox(box, detectionScore) {
  const minSide = Math.min(Number(box.width) || 0, Number(box.height) || 0);
  const sizeScore = Math.max(0, Math.min(1, (minSide - MIN_FACE_SIZE) / 160));
  return roundNumber(Math.min(1, detectionScore * 0.45 + sizeScore * 0.55));
}

function convertDistanceToScore(distance) {
  return Math.max(0, Math.min(1, 1 - distance / MAX_MATCH_DISTANCE));
}

function loadFaceMatchesByIds(db, photoId, faceMatchIds) {
  const placeholders = faceMatchIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT *
    FROM photo_face_matches
    WHERE photo_id = ?
      AND id IN (${placeholders})
  `).all(photoId, ...faceMatchIds);

  if (rows.length !== faceMatchIds.length) {
    throw new Error("One or more face matches were not found for this photo");
  }

  return rows;
}

function upsertFaceReference(db, input) {
  const deleteExistingRef = db.prepare(`
    DELETE FROM person_face_refs
    WHERE person_id = ?
      AND photo_id = ?
      AND face_index = ?
      AND source = ?
  `);
  const insertRef = db.prepare(`
    INSERT INTO person_face_refs (
      person_id,
      photo_id,
      face_index,
      face_box_json,
      embedding_json,
      quality_score,
      source
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  deleteExistingRef.run(
    input.personId,
    input.photoId,
    input.faceIndex,
    input.source,
  );
  insertRef.run(
    input.personId,
    input.photoId,
    input.faceIndex,
    JSON.stringify(input.faceBox),
    JSON.stringify(Array.from(input.descriptor || [])),
    input.qualityScore,
    input.source,
  );
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function roundNumber(value) {
  return Number((Number(value) || 0).toFixed(6));
}

module.exports = {
  FAMILY_MEMBER_NAMES,
  analyzePhotoFaces,
  acceptPhotoFaceMatches,
  rejectPhotoFaceMatches,
  seedPhotoFaceReference,
};
