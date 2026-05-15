import { useEffect, useState } from "react";
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

export default function ExportView() {
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
  const [isImportingDestinations, setIsImportingDestinations] = useState(false);
  const [destinationImportMessage, setDestinationImportMessage] = useState("");
  const [destinationImportError, setDestinationImportError] = useState("");
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingVideoStats, setIsLoadingVideoStats] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncingYouTube, setIsSyncingYouTube] = useState(false);
  const [isRefreshingYouTubeStats, setIsRefreshingYouTubeStats] = useState(false);
  const [youtubeMessage, setYoutubeMessage] = useState("");
  const [youtubeError, setYoutubeError] = useState("");
  const [error, setError] = useState("");

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
      const response = await exportCatalog();
      triggerDownload(response?.data || [], getExportFilename());
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

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[320px] flex-1">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">CSV File</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const nextFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
                setDestinationFile(nextFile);
                setDestinationImportMessage("");
                setDestinationImportError("");
              }}
              className="field"
            />
          </label>

          <button
            type="button"
            onClick={handleImportDestinations}
            disabled={!destinationFile || isImportingDestinations}
            className="btn-primary"
          >
            {isImportingDestinations ? "Importing..." : "Import Destinations"}
          </button>
        </div>

        {destinationFile ? (
          <p className="mt-3 text-sm text-stone-600">
            Selected: {destinationFile.name}
          </p>
        ) : null}

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Photos" value={isLoadingStats ? "..." : stats.totalPhotos} />
        <StatCard label="Total Videos" value={isLoadingVideoStats ? "..." : videoStats.totalVideos} />
        <StatCard label="Missing Alt Text" value={isLoadingStats ? "..." : stats.missingAltText} />
        <StatCard label="Missing People" value={isLoadingStats ? "..." : stats.missingPeople} />
        <StatCard label="Missing Tags" value={isLoadingStats ? "..." : stats.missingTags} />
      </div>

      <div className="mt-8 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleExport} disabled={isExporting || isLoadingStats} className="btn-primary">
            {isExporting ? "Preparing Export..." : "Download JSON Export"}
          </button>
        </div>

        <p className="mt-4 text-sm text-stone-600">Deleted photos are never included in exports.</p>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-[1.75rem] border border-stone-300 bg-stone-50/80 px-5 py-5">
      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-stone-900">{value}</p>
    </div>
  );
}
