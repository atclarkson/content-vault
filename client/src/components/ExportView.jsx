import { useEffect, useMemo, useRef, useState } from "react";
import {
  exportCatalog,
  getPhotos,
  getVideos,
  importDestinations,
  refreshVideoStats,
  syncYouTube
} from "../api";

function getMissingCount(photos, field) {
  if (field === "alt_text") {
    return photos.filter((photo) => !photo.alt_text || !String(photo.alt_text).trim()).length;
  }

  if (field === "people") {
    return photos.filter((photo) => !Array.isArray(photo.people) || photo.people.length === 0).length;
  }

  if (field === "tags") {
    return photos.filter((photo) => !Array.isArray(photo.tags) || photo.tags.length === 0).length;
  }

  return 0;
}

function getExportFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `content-vault-export-${date}.json`;
}

function triggerDownload(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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

function formatDayOneAction(action) {
  switch (action) {
    case "matched":
      return "Matched existing photos";
    case "uploaded":
      return "Uploaded new photos";
    case "journal":
      return "Imported journal entry";
    case "skipped":
      return "Skipped duplicate or empty entry";
    default:
      return "Processing";
  }
}

function parseSseEvents(buffer) {
  const segments = buffer.split("\n\n");
  const remainder = segments.pop() || "";
  const events = [];

  for (const segment of segments) {
    const lines = segment
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const dataLine = lines.find((line) => line.startsWith("data:"));

    if (!dataLine) {
      continue;
    }

    const payload = dataLine.slice(5).trim();

    if (!payload) {
      continue;
    }

    try {
      events.push(JSON.parse(payload));
    } catch (error) {
      throw new Error("Invalid streaming response from Day One import");
    }
  }

  return {
    events,
    remainder
  };
}

async function streamDayOneImport(file, { onEvent }) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/import/day-one", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const payload = text ? JSON.parse(text) : null;
      throw new Error(payload?.error || "Day One import failed");
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Day One import failed");
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Day One import failed");
    }
  }

  if (!response.body) {
    throw new Error("Streaming response not available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completePayload = null;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const parsed = parseSseEvents(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      onEvent(event);

      if (event.type === "complete") {
        completePayload = event;
      }

      if (event.type === "error") {
        throw new Error(event.error || "Day One import failed");
      }
    }
  }

  if (!completePayload) {
    throw new Error("Day One import did not complete");
  }

  return completePayload;
}

export default function ExportView({ people }) {
  const [stats, setStats] = useState({
    totalPhotos: 0,
    missingAltText: 0,
    missingPeople: 0,
    missingTags: 0
  });
  const [videoStats, setVideoStats] = useState({
    totalVideos: 0,
    shorts: 0,
    longform: 0
  });
  const [destinationFile, setDestinationFile] = useState(null);
  const [dayOneFile, setDayOneFile] = useState(null);
  const [exportFilters, setExportFilters] = useState({
    date_from: "",
    date_to: "",
    country: "",
    city: "",
    people: []
  });
  const [isImportingDestinations, setIsImportingDestinations] = useState(false);
  const [isImportingDayOne, setIsImportingDayOne] = useState(false);
  const [destinationImportMessage, setDestinationImportMessage] = useState("");
  const [destinationImportError, setDestinationImportError] = useState("");
  const [dayOneImportMessage, setDayOneImportMessage] = useState("");
  const [dayOneImportError, setDayOneImportError] = useState("");
  const [dayOneProgress, setDayOneProgress] = useState({
    current: 0,
    total: 0,
    action: ""
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingVideoStats, setIsLoadingVideoStats] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncingYouTube, setIsSyncingYouTube] = useState(false);
  const [isRefreshingYouTubeStats, setIsRefreshingYouTubeStats] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState("");
  const [youtubeError, setYoutubeError] = useState("");
  const [error, setError] = useState("");
  const destinationInputRef = useRef(null);
  const dayOneInputRef = useRef(null);

  const activeExportFilters = useMemo(() => buildExportFilters(exportFilters), [exportFilters]);

  async function loadPhotoStats() {
    setIsLoadingStats(true);
    setError("");

    try {
      const response = await getPhotos();
      const photos = response?.data || [];

      setStats({
        totalPhotos: photos.length,
        missingAltText: getMissingCount(photos, "alt_text"),
        missingPeople: getMissingCount(photos, "people"),
        missingTags: getMissingCount(photos, "tags")
      });
    } catch (loadError) {
      setError(loadError.message || "Failed to load export stats");
    } finally {
      setIsLoadingStats(false);
    }
  }

  async function loadVideoStats() {
    setIsLoadingVideoStats(true);
    setYoutubeError("");

    try {
      const response = await getVideos();
      const videos = response?.data || [];

      setVideoStats({
        totalVideos: videos.length,
        shorts: videos.filter((video) => video.video_type === "short").length,
        longform: videos.filter((video) => video.video_type !== "short").length
      });
    } catch (loadError) {
      setYoutubeError(loadError.message || "Failed to load YouTube stats");
    } finally {
      setIsLoadingVideoStats(false);
    }
  }

  useEffect(() => {
    loadPhotoStats();
    loadVideoStats();
  }, []);

  async function handleExport() {
    setIsExporting(true);
    setError("");

    try {
      const response = await exportCatalog(activeExportFilters);
      triggerDownload(response?.data || {}, getExportFilename());
    } catch (exportError) {
      setError(exportError.message || "Failed to export catalog");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImportDestinations() {
    if (!destinationFile) {
      return;
    }

    setIsImportingDestinations(true);
    setDestinationImportMessage("");
    setDestinationImportError("");

    try {
      const response = await importDestinations(destinationFile);
      const summary = response?.data;

      setDestinationImportMessage(
        `${summary?.added || 0} destinations added, ${summary?.skipped || 0} already existed, ${summary?.filtered || 0} pre-2022 entries skipped`
      );
      setDestinationFile(null);
    } catch (importError) {
      setDestinationImportError(importError.message || "Failed to import destinations");
    } finally {
      setIsImportingDestinations(false);
    }
  }

  async function handleImportDayOne(file) {
    if (!file) {
      return;
    }

    setIsImportingDayOne(true);
    setDayOneImportMessage("");
    setDayOneImportError("");
    setDayOneProgress({
      current: 0,
      total: 0,
      action: ""
    });

    try {
      const summary = await streamDayOneImport(file, {
        onEvent(event) {
          if (event.type === "start") {
            setDayOneProgress({
              current: 0,
              total: event.total || 0,
              action: "start"
            });
            return;
          }

          if (event.type === "progress") {
            setDayOneProgress({
              current: event.current || 0,
              total: event.total || 0,
              action: event.action || ""
            });
            return;
          }

          if (event.type === "error") {
            throw new Error(event.error || "Day One import failed");
          }
        }
      });

      setDayOneImportMessage(
        `${summary.matched_photos || 0} photos matched, `
        + `${summary.uploaded_photos || 0} photos uploaded, `
        + `${summary.text_entries_added || 0} journal entries added, `
        + `${summary.skipped_duplicates || 0} duplicates skipped`
      );
      setDayOneFile(null);
      setDayOneProgress((currentValue) => ({
        current: currentValue.total,
        total: currentValue.total,
        action: "complete"
      }));

      if (dayOneInputRef.current) {
        dayOneInputRef.current.value = "";
      }
    } catch (importError) {
      setDayOneImportError(importError.message || "Failed to import Day One journal");
    } finally {
      setIsImportingDayOne(false);
    }
  }

  const dayOneProgressPercent = dayOneProgress.total > 0
    ? Math.min(100, Math.round((dayOneProgress.current / dayOneProgress.total) * 100))
    : 0;

  async function handleSyncYouTube() {
    setIsSyncingYouTube(true);
    setYoutubeMessage("");
    setYoutubeError("");

    try {
      const response = await syncYouTube();
      const summary = response?.data || {};
      setYoutubeMessage(`${summary.added || 0} videos added, ${summary.skipped || 0} already up to date.`);
      await loadVideoStats();
    } catch (syncError) {
      setYoutubeError(syncError.message || "Failed to sync YouTube videos");
    } finally {
      setIsSyncingYouTube(false);
    }
  }

  async function handleRefreshYouTubeStats() {
    setIsRefreshingYouTubeStats(true);
    setYoutubeMessage("");
    setYoutubeError("");

    try {
      const response = await refreshVideoStats();
      const summary = response?.data || {};
      setYoutubeMessage(`Stats updated for ${summary.updated || 0} videos.`);
      await loadVideoStats();
    } catch (refreshError) {
      setYoutubeError(refreshError.message || "Failed to refresh YouTube stats");
    } finally {
      setIsRefreshingYouTubeStats(false);
    }
  }

  function toggleExportPerson(personName) {
    setExportFilters((currentValue) => ({
      ...currentValue,
      people: currentValue.people.includes(personName)
        ? currentValue.people.filter((currentPerson) => currentPerson !== personName)
        : [...currentValue.people, personName]
    }));
  }

  return (
    <section className="panel p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Export</p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">Catalog export</h2>
      </div>

      {error ? <div className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="mb-8 border border-stone-300 bg-stone-50 p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Import Destinations</p>
            <p className="mt-3 text-sm text-stone-600">
              Re-importing is safe. Existing destination rows are skipped automatically.
            </p>
          </div>
        </div>

        <input
          ref={destinationInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const nextFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
            setDestinationFile(nextFile);
            setDestinationImportMessage("");
            setDestinationImportError("");
          }}
          className="hidden"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => destinationInputRef.current?.click()}
            className="btn-secondary"
          >
            Choose CSV
          </button>

          <span className="text-sm text-stone-600">
            {destinationFile ? destinationFile.name : "No file selected"}
          </span>

          <button
            type="button"
            onClick={handleImportDestinations}
            disabled={!destinationFile || isImportingDestinations}
            className="btn-primary"
          >
            {isImportingDestinations ? "Importing..." : "Import Destinations"}
          </button>
        </div>

        {isImportingDestinations ? (
          <p className="mt-3 text-sm text-stone-600">Uploading and processing destination CSV...</p>
        ) : null}

        {destinationImportMessage ? (
          <div className="mt-4 bg-green-50 px-4 py-3 text-sm text-green-700">
            {destinationImportMessage}
          </div>
        ) : null}

        {destinationImportError ? (
          <div className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {destinationImportError}
          </div>
        ) : null}
      </div>

      <div className="mb-8 border border-stone-300 bg-stone-50 p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Import Day One Journal</p>
            <p className="mt-3 text-sm text-stone-600">
              Drop a Day One export zip to import photos and journal entries. Re-importing is safe — duplicates are skipped automatically.
            </p>
          </div>
        </div>

        <input
          ref={dayOneInputRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const nextFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
            setDayOneFile(nextFile);
            setDayOneImportMessage("");
            setDayOneImportError("");

            if (nextFile) {
              handleImportDayOne(nextFile);
            }
          }}
          className="hidden"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => dayOneInputRef.current?.click()}
            className="btn-secondary"
            disabled={isImportingDayOne}
          >
            {isImportingDayOne ? "Importing..." : "Choose ZIP"}
          </button>

          <span className="text-sm text-stone-600">
            {dayOneFile ? dayOneFile.name : "No file selected"}
          </span>
        </div>

        {isImportingDayOne ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-stone-600">
              {dayOneProgress.total > 0
                ? `Processing entry ${dayOneProgress.current} of ${dayOneProgress.total}...`
                : "Processing Day One export..."}
            </p>
            {dayOneProgress.total > 0 ? (
              <div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
                  <div
                    className="h-full bg-stone-900 transition-all"
                    style={{ width: `${dayOneProgressPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-stone-500">
                  {dayOneProgress.action === "start"
                    ? `Processing ${dayOneProgress.total} entries...`
                    : `Latest action: ${formatDayOneAction(dayOneProgress.action)}`}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {dayOneImportMessage ? (
          <div className="mt-4 bg-green-50 px-4 py-3 text-sm text-green-700">
            {dayOneImportMessage}
          </div>
        ) : null}

        {dayOneImportError ? (
          <div className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {dayOneImportError}
          </div>
        ) : null}
      </div>

      <div className="mb-8 border border-stone-300 bg-stone-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">YouTube</p>
            <p className="mt-3 text-sm text-stone-600">
              Sync new uploads and refresh live video statistics from YouTube.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatCard label="Total Videos" value={isLoadingVideoStats ? "..." : videoStats.totalVideos} />
          <StatCard label="Shorts" value={isLoadingVideoStats ? "..." : videoStats.shorts} />
          <StatCard label="Longform" value={isLoadingVideoStats ? "..." : videoStats.longform} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSyncYouTube}
            disabled={isSyncingYouTube || isRefreshingYouTubeStats}
            className="btn-primary"
          >
            {isSyncingYouTube ? "Checking..." : "Check for New Videos"}
          </button>
          <button
            type="button"
            onClick={handleRefreshYouTubeStats}
            disabled={isRefreshingYouTubeStats || isSyncingYouTube}
            className="btn-secondary"
          >
            {isRefreshingYouTubeStats ? "Refreshing..." : "Refresh All Stats"}
          </button>
        </div>

        {youtubeMessage ? (
          <div className="mt-4 bg-green-50 px-4 py-3 text-sm text-green-700">
            {youtubeMessage}
          </div>
        ) : null}

        {youtubeError ? (
          <div className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {youtubeError}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Photos" value={isLoadingStats ? "..." : stats.totalPhotos} />
        <StatCard label="Total Videos" value={isLoadingVideoStats ? "..." : videoStats.totalVideos} />
        <StatCard label="Missing Alt Text" value={isLoadingStats ? "..." : stats.missingAltText} />
        <StatCard label="Missing People" value={isLoadingStats ? "..." : stats.missingPeople} />
        <StatCard label="Missing Tags" value={isLoadingStats ? "..." : stats.missingTags} />
      </div>

      <div className="mt-8 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-6">
        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Export Filters</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Date From</span>
            <input
              type="date"
              value={exportFilters.date_from}
              onChange={(event) => setExportFilters((currentValue) => ({ ...currentValue, date_from: event.target.value }))}
              className="field"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Date To</span>
            <input
              type="date"
              value={exportFilters.date_to}
              onChange={(event) => setExportFilters((currentValue) => ({ ...currentValue, date_to: event.target.value }))}
              className="field"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Country</span>
            <input
              type="text"
              value={exportFilters.country}
              onChange={(event) => setExportFilters((currentValue) => ({ ...currentValue, country: event.target.value }))}
              className="field"
              placeholder="Filter by country"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">City</span>
            <input
              type="text"
              value={exportFilters.city}
              onChange={(event) => setExportFilters((currentValue) => ({ ...currentValue, city: event.target.value }))}
              className="field"
              placeholder="Filter by city"
            />
          </label>
        </div>

        <div className="mt-5">
          <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">People</p>
          <div className="flex flex-wrap gap-3">
            {people.map((person) => (
              <label key={person.id} className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700">
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
          <button type="button" onClick={handleExport} disabled={isExporting || isLoadingStats} className="btn-primary">
            {isExporting ? "Preparing Export..." : "Download JSON Export"}
          </button>
          <button
            type="button"
            onClick={() => setExportFilters({ date_from: "", date_to: "", country: "", city: "", people: [] })}
            className="btn-secondary"
          >
            Clear Filters
          </button>
        </div>

        <p className="mt-4 text-sm text-stone-600">Deleted photos are never included in exports.</p>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="border border-stone-300 bg-white px-5 py-4">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-stone-900">{value}</p>
    </div>
  );
}
