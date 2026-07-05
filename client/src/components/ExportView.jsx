import { useEffect, useMemo, useState } from "react";
import {
  exportCatalog,
  getPhotos,
  queryJournalEntries,
  queryPhotos,
  queryVideos,
} from "../api";

const DEFAULT_CLAUDE_LIMITS = {
  photos: 200,
  videos: 100,
  journals: 200,
};
const MAX_CLAUDE_LIMIT = 200;

const CLAUDE_QUERY_TEMPLATE = `{
  "country": "Japan",
  "city": "Osaka",
  "date_from": "2023-01-01",
  "date_to": "2024-12-31",
  "tags_any": ["food", "street", "temple"],
  "people_any": ["Adam", "Lindsay"],
  "limits": {
    "photos": 20,
    "videos": 5,
    "journals": 3
  }
}`;

function getMissingCount(photos, field) {
  if (field === "alt_text") {
    return photos.filter(
      (photo) => !photo.alt_text || !String(photo.alt_text).trim(),
    ).length;
  }

  if (field === "people") {
    return photos.filter(
      (photo) => !Array.isArray(photo.people) || photo.people.length === 0,
    ).length;
  }

  if (field === "tags") {
    return photos.filter(
      (photo) => !Array.isArray(photo.tags) || photo.tags.length === 0,
    ).length;
  }

  return 0;
}

function slugifyFilenamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getExportFilename(filters) {
  const today = new Date().toISOString().slice(0, 10);
  const parts = ["content-vault-export"];

  if (filters.date_from && filters.date_to) {
    parts.push(`${filters.date_from}-to-${filters.date_to}`);
  } else if (filters.date_from) {
    parts.push(`from-${filters.date_from}`);
  } else if (filters.date_to) {
    parts.push(`to-${filters.date_to}`);
  }

  if (filters.country) {
    const countryPart = slugifyFilenamePart(filters.country);

    if (countryPart) {
      parts.push(countryPart);
    }
  }

  if (filters.city) {
    const cityPart = slugifyFilenamePart(filters.city);

    if (cityPart) {
      parts.push(cityPart);
    }
  }

  if (filters.people) {
    const peoplePart = String(filters.people)
      .split(",")
      .map((person) => slugifyFilenamePart(person))
      .filter(Boolean);

    if (peoplePart.length > 0) {
      parts.push(...peoplePart);
    }
  }

  parts.push(today);

  return `${parts.join("-")}.json`;
}

function getClaudeExportFilename() {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "");

  return `claude-export-${timestamp}.json`;
}

function triggerDownload(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function buildExportFilters(formState) {
  const filters = {};

  if (formState.date_from) {
    filters.date_from = formState.date_from;
  }

  if (formState.date_to) {
    filters.date_to = formState.date_to;
  }

  if (formState.country.trim()) {
    filters.country = formState.country.trim();
  }

  if (formState.city.trim()) {
    filters.city = formState.city.trim();
  }

  if (formState.people.length > 0) {
    filters.people = formState.people.join(",");
  }

  return filters;
}

function normalizeClaudeQueryLimits(limits) {
  const source =
    limits && typeof limits === "object" && !Array.isArray(limits)
      ? limits
      : {};

  return {
    photos: normalizeClaudeLimit(
      source.photos,
      DEFAULT_CLAUDE_LIMITS.photos,
      "photos",
    ),
    videos: normalizeClaudeLimit(
      source.videos,
      DEFAULT_CLAUDE_LIMITS.videos,
      "videos",
    ),
    journals: normalizeClaudeLimit(
      source.journals,
      DEFAULT_CLAUDE_LIMITS.journals,
      "journals",
    ),
  };
}

function normalizeClaudeLimit(value, defaultValue, label) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numericValue = Number(value);

  if (
    !Number.isInteger(numericValue) ||
    numericValue < 0 ||
    numericValue > MAX_CLAUDE_LIMIT
  ) {
    throw new Error(
      `limits.${label} must be an integer between 0 and ${MAX_CLAUDE_LIMIT}`,
    );
  }

  return numericValue;
}

function buildClaudeFilters(query) {
  const source =
    query && typeof query === "object" && !Array.isArray(query) ? query : {};
  const filters = {};

  for (const key of ["text", "city", "country", "date_from", "date_to"]) {
    if (typeof source[key] === "string" && source[key].trim()) {
      filters[key] = source[key].trim();
    }
  }

  if (source.tags_any !== undefined) {
    if (!Array.isArray(source.tags_any)) {
      throw new Error("tags_any must be an array of strings");
    }

    filters.tags_any = source.tags_any
      .map((value) => String(value).trim())
      .filter(Boolean);
  }

  if (source.people_any !== undefined) {
    if (!Array.isArray(source.people_any)) {
      throw new Error("people_any must be an array of strings");
    }

    filters.people_any = source.people_any
      .map((value) => String(value).trim())
      .filter(Boolean);
  }

  return filters;
}

function buildClaudeExportPayload(query, responses) {
  const limits = normalizeClaudeQueryLimits(query.limits);
  const photoData = responses.photos?.data || {};
  const videoData = responses.videos?.data || {};
  const journalData = responses.journals?.data || {};

  return {
    data: {
      summary: {
        photos: {
          total: photoData.total || 0,
          returned: Array.isArray(photoData.items) ? photoData.items.length : 0,
          limit: limits.photos,
        },
        videos: {
          total: videoData.total || 0,
          returned: Array.isArray(videoData.items) ? videoData.items.length : 0,
          limit: limits.videos,
        },
        journals: {
          total: journalData.total || 0,
          returned: Array.isArray(journalData.items)
            ? journalData.items.length
            : 0,
          limit: limits.journals,
        },
      },
      photos: photoData.items || [],
      videos: videoData.items || [],
      journals: journalData.items || [],
    },
  };
}

export default function ExportView({ people }) {
  const [stats, setStats] = useState({
    totalPhotos: 0,
    missingAltText: 0,
    missingPeople: 0,
    missingTags: 0,
  });
  const [exportFilters, setExportFilters] = useState({
    date_from: "",
    date_to: "",
    country: "",
    city: "",
    people: [],
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [claudeQueryText, setClaudeQueryText] = useState("");
  const [claudeQueryError, setClaudeQueryError] = useState("");
  const [claudeQuerySummary, setClaudeQuerySummary] = useState("");
  const [isRunningClaudeExport, setIsRunningClaudeExport] = useState(false);
  const [claudeTemplateMessage, setClaudeTemplateMessage] = useState("");

  const activeExportFilters = useMemo(
    () => buildExportFilters(exportFilters),
    [exportFilters],
  );

  useEffect(() => {
    let isActive = true;

    async function loadPhotoStats() {
      setIsLoadingStats(true);
      setError("");

      try {
        const response = await getPhotos();
        const photos = response?.data || [];

        if (!isActive) {
          return;
        }

        setStats({
          totalPhotos: photos.length,
          missingAltText: getMissingCount(photos, "alt_text"),
          missingPeople: getMissingCount(photos, "people"),
          missingTags: getMissingCount(photos, "tags"),
        });
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load export stats");
      } finally {
        if (isActive) {
          setIsLoadingStats(false);
        }
      }
    }

    loadPhotoStats();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleExport() {
    setIsExporting(true);
    setError("");

    try {
      const response = await exportCatalog(activeExportFilters);
      triggerDownload(
        response?.data || {},
        getExportFilename(activeExportFilters),
      );
    } catch (exportError) {
      setError(exportError.message || "Failed to export catalog");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleClaudeExport() {
    setIsRunningClaudeExport(true);
    setClaudeQueryError("");
    setClaudeQuerySummary("");

    try {
      if (!claudeQueryText.trim()) {
        throw new Error("Paste a Claude query in JSON format.");
      }

      let parsedQuery;

      try {
        parsedQuery = JSON.parse(claudeQueryText);
      } catch {
        throw new Error(
          "Invalid JSON. Paste a valid Claude query and try again.",
        );
      }

      if (
        !parsedQuery ||
        typeof parsedQuery !== "object" ||
        Array.isArray(parsedQuery)
      ) {
        throw new Error("Claude query must be a JSON object.");
      }

      const filters = buildClaudeFilters(parsedQuery);
      const limits = normalizeClaudeQueryLimits(parsedQuery.limits);

      const [photosResponse, videosResponse, journalsResponse] =
        await Promise.all([
          queryPhotos({
            filters: {
              text: filters.text,
              city: filters.city,
              country: filters.country,
              date_from: filters.date_from,
              date_to: filters.date_to,
              tags_any: filters.tags_any,
              people_any: filters.people_any,
            },
            view: "full",
            limit: limits.photos,
            offset: 0,
            sort: "newest",
          }),
          queryVideos({
            filters: {
              text: filters.text,
              city: filters.city,
              country: filters.country,
              date_from: filters.date_from,
              date_to: filters.date_to,
            },
            view: "full",
            limit: limits.videos,
            offset: 0,
            sort: "newest",
          }),
          queryJournalEntries({
            filters: {
              text: filters.text,
              city: filters.city,
              country: filters.country,
              date_from: filters.date_from,
              date_to: filters.date_to,
            },
            view: "summary",
            limit: limits.journals,
            offset: 0,
            sort: "newest",
          }),
        ]);

      const exportPayload = buildClaudeExportPayload(parsedQuery, {
        photos: photosResponse,
        videos: videosResponse,
        journals: journalsResponse,
      });
      const filename = getClaudeExportFilename();

      setClaudeQuerySummary(
        `Found ${exportPayload.data.summary.photos.returned} photos · ` +
          `${exportPayload.data.summary.videos.returned} videos · ` +
          `${exportPayload.data.summary.journals.returned} journals — downloaded as ${filename}`,
      );
      triggerDownload(exportPayload, filename);
    } catch (runError) {
      setClaudeQueryError(runError.message || "Failed to run Claude export");
    } finally {
      setIsRunningClaudeExport(false);
    }
  }

  async function handleCopyClaudeTemplate() {
    try {
      await navigator.clipboard.writeText(CLAUDE_QUERY_TEMPLATE);
      setClaudeTemplateMessage("Template copied.");
    } catch {
      setClaudeTemplateMessage(
        "Could not copy automatically. Copy the template from the box manually.",
      );
    }
  }

  function toggleExportPerson(personName) {
    setExportFilters((currentValue) => ({
      ...currentValue,
      people: currentValue.people.includes(personName)
        ? currentValue.people.filter(
            (currentPerson) => currentPerson !== personName,
          )
        : [...currentValue.people, personName],
    }));
  }

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
          Export
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">
          Catalog export
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {error ? (
          <div className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Total Photos"
            value={isLoadingStats ? "..." : stats.totalPhotos}
          />
          <StatCard
            label="Missing Alt Text"
            value={isLoadingStats ? "..." : stats.missingAltText}
          />
          <StatCard
            label="Missing People"
            value={isLoadingStats ? "..." : stats.missingPeople}
          />
          <StatCard
            label="Missing Tags"
            value={isLoadingStats ? "..." : stats.missingTags}
          />
        </div>

        <div className="mt-8 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
            Export Filters
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">
                Date From
              </span>
              <input
                type="date"
                value={exportFilters.date_from}
                onChange={(event) =>
                  setExportFilters((currentValue) => ({
                    ...currentValue,
                    date_from: event.target.value,
                  }))
                }
                className="field"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">
                Date To
              </span>
              <input
                type="date"
                value={exportFilters.date_to}
                onChange={(event) =>
                  setExportFilters((currentValue) => ({
                    ...currentValue,
                    date_to: event.target.value,
                  }))
                }
                className="field"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">
                Country
              </span>
              <input
                type="text"
                value={exportFilters.country}
                onChange={(event) =>
                  setExportFilters((currentValue) => ({
                    ...currentValue,
                    country: event.target.value,
                  }))
                }
                className="field"
                placeholder="Filter by country"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">
                City
              </span>
              <input
                type="text"
                value={exportFilters.city}
                onChange={(event) =>
                  setExportFilters((currentValue) => ({
                    ...currentValue,
                    city: event.target.value,
                  }))
                }
                className="field"
                placeholder="Filter by city"
              />
            </label>
          </div>

          <div className="mt-5">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">
              People
            </p>
            <div className="flex flex-wrap gap-3">
              {people.map((person) => (
                <label
                  key={person.id}
                  className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700"
                >
                  <input
                    type="checkbox"
                    checked={exportFilters.people.includes(person.name)}
                    onChange={() => toggleExportPerson(person.name)}
                    className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                  />
                  <span>{person.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting || isLoadingStats}
              className="btn-primary"
            >
              {isExporting ? "Preparing Export..." : "Download JSON Export"}
            </button>
            <button
              type="button"
              onClick={() =>
                setExportFilters({
                  date_from: "",
                  date_to: "",
                  country: "",
                  city: "",
                  people: [],
                })
              }
              className="btn-secondary"
            >
              Clear Filters
            </button>
          </div>

          <p className="mt-4 text-sm text-stone-600">
            Deleted photos are never included in exports.
          </p>
        </div>

        <div className="mt-8 rounded-[1.75rem] border border-stone-300 bg-white p-6">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
              Claude Query Export
            </p>
            <h3 className="mt-2 text-lg font-semibold text-stone-900">
              Claude Query
            </h3>
            <p className="mt-3 text-sm text-stone-600">
              Paste a machine-readable query from Claude, run the matching vault
              searches, and download just the relevant subset.
            </p>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">
                Claude Query
              </span>
              <textarea
                value={claudeQueryText}
                onChange={(event) => {
                  setClaudeQueryText(event.target.value);
                  setClaudeQueryError("");
                  setClaudeQuerySummary("");
                }}
                rows={8}
                className="field font-mono text-[13px] leading-6"
                placeholder={
                  "Paste a Claude query here (JSON format) then click Run Export."
                }
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCopyClaudeTemplate}
                className="btn-secondary"
              >
                Copy JSON Template
              </button>
              <button
                type="button"
                onClick={handleClaudeExport}
                disabled={isRunningClaudeExport}
                className="btn-primary"
              >
                {isRunningClaudeExport ? "Running Export..." : "Run Export"}
              </button>
            </div>

            {claudeTemplateMessage ? (
              <p className="mt-4 text-sm text-stone-600">
                {claudeTemplateMessage}
              </p>
            ) : null}

            {claudeQuerySummary ? (
              <p className="mt-4 text-sm text-emerald-700">
                {claudeQuerySummary}
              </p>
            ) : null}

            {claudeQueryError ? (
              <p className="mt-4 text-sm text-red-700">{claudeQueryError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="border border-stone-300 bg-white px-5 py-4">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-stone-900">{value}</p>
    </div>
  );
}
