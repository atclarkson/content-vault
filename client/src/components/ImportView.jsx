import { useEffect, useRef, useState } from "react";
import { getVideos, importDestinations, refreshVideoStats, streamDayOneImport, syncYouTube } from "../api";

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

export default function ImportView() {
  const [videoStats, setVideoStats] = useState({
    totalVideos: 0,
    shorts: 0,
    longform: 0
  });
  const [destinationFile, setDestinationFile] = useState(null);
  const [dayOneFile, setDayOneFile] = useState(null);
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
  const [isLoadingVideoStats, setIsLoadingVideoStats] = useState(true);
  const [isSyncingYouTube, setIsSyncingYouTube] = useState(false);
  const [isRefreshingYouTubeStats, setIsRefreshingYouTubeStats] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState("");
  const [youtubeError, setYoutubeError] = useState("");
  const destinationInputRef = useRef(null);
  const dayOneInputRef = useRef(null);

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
    loadVideoStats();
  }, []);

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

      if (destinationInputRef.current) {
        destinationInputRef.current.value = "";
      }
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

  const dayOneProgressPercent = dayOneProgress.total > 0
    ? Math.min(100, Math.round((dayOneProgress.current / dayOneProgress.total) * 100))
    : 0;

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Import</p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">Import tools</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
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
            <button type="button" onClick={() => destinationInputRef.current?.click()} className="btn-secondary">
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
                Drop a Day One export zip to import photos and journal entries. Re-importing is safe and duplicates are skipped automatically.
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

        <div className="border border-stone-300 bg-stone-50 p-6">
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
