import { useEffect, useState } from "react";
import { exportCatalog, getPhotos } from "../api";

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
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadStats() {
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
          missingTags: getMissingCount(photos, "tags")
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

    loadStats();

    return () => {
      isActive = false;
    };
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

  return (
    <section className="panel p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Export</p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">Catalog export</h2>
      </div>

      {error ? <div className="mb-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Photos" value={isLoadingStats ? "..." : stats.totalPhotos} />
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
