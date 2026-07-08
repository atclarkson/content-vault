import { useEffect, useMemo, useRef, useState } from "react";
import { uploadPhotos } from "../api";

const ACCEPTED_FILE_TYPES = "image/*,.jpg,.jpeg,.png,.heic,.heif,.webp";
const ACCEPTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"]);

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 1023.98px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const handler = (event) => setIsMobile(event.matches);

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeFiles(existingFiles, nextFiles) {
  const merged = [...existingFiles];

  for (const file of Array.from(nextFiles)) {
    const alreadyAdded = merged.some(
      (existingFile) =>
        existingFile.name === file.name
        && existingFile.size === file.size
        && existingFile.lastModified === file.lastModified
    );

    if (!alreadyAdded) {
      merged.push(file);
    }
  }

  return merged;
}

function buildFileKey(file) {
  return `${file.name}-${file.lastModified}-${file.size}`;
}

function getFileExtension(filename) {
  const lastDot = String(filename || "").lastIndexOf(".");
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
}

function classifyUploadFile(file) {
  const extension = getFileExtension(file.name);

  if (ACCEPTED_EXTENSIONS.has(extension)) {
    return { valid: true };
  }

  return {
    valid: false,
    message: `${file.name} is not supported. Only JPEG, PNG, HEIC, HEIF, and WebP files can be imported.`
  };
}

function getResultStatus(result) {
  if (result?.photo) {
    return {
      status: "done",
      message: "Uploaded"
    };
  }

  if (result?.skipped) {
    return {
      status: "duplicate",
      message: result.reason || "duplicate"
    };
  }

  if (result?.error) {
    return {
      status: "error",
      message: result.error
    };
  }

  return {
    status: "error",
    message: "Unexpected upload result"
  };
}

function buildFileEntries(nextFiles) {
  return nextFiles.map((file) => ({
    file,
    key: buildFileKey(file),
    filename: file.name,
    sizeLabel: formatFileSize(file.size),
    status: "waiting",
    message: "Queued"
  }));
}

function getStatusClasses(status) {
  if (status === "uploading") {
    return "bg-amber-50 text-amber-800";
  }

  if (status === "done") {
    return "bg-emerald-50 text-emerald-800";
  }

  if (status === "duplicate") {
    return "bg-orange-50 text-orange-800";
  }

  if (status === "error") {
    return "bg-red-50 text-red-700";
  }

  return "bg-stone-100 text-stone-600";
}

function getStatusLabel(status) {
  if (status === "uploading") {
    return "Uploading";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "duplicate") {
    return "Duplicate";
  }

  if (status === "error") {
    return "Error";
  }

  return "Waiting";
}

function buildEmptyProgressState() {
  return {
    phase: "idle",
    percent: 0,
    loaded: 0,
    total: 0
  };
}

export default function UploadView({ onNavigate }) {
  const isMobile = useIsMobile();
  const inputRef = useRef(null);
  const pendingFilesRef = useRef([]);
  const [fileEntries, setFileEntries] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progressState, setProgressState] = useState(buildEmptyProgressState);
  const [error, setError] = useState("");

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => () => {
    pendingFilesRef.current.forEach((entry) => {
      URL.revokeObjectURL(entry.url);
    });
  }, []);

  const totalFilesSize = useMemo(
    () => fileEntries.reduce((sum, entry) => sum + entry.file.size, 0),
    [fileEntries]
  );
  const hasCompletedUpload = fileEntries.length > 0 && !isUploading;
  const statusCounts = useMemo(() => {
    return fileEntries.reduce((counts, entry) => {
      counts[entry.status] = (counts[entry.status] || 0) + 1;
      return counts;
    }, { waiting: 0, uploading: 0, done: 0, duplicate: 0, error: 0 });
  }, [fileEntries]);
  const activeStatusLabel = progressState.phase === "uploading"
    ? `Uploading ${formatFileSize(progressState.loaded)} of ${formatFileSize(progressState.total)}`
    : progressState.phase === "processing"
      ? "Upload transfer finished. Server is importing, hashing, and processing your files."
      : progressState.phase === "complete"
        ? "Upload finished."
        : "Preparing upload...";

  function openFilePicker() {
    inputRef.current?.click();
  }

  function revokePendingFiles(entries) {
    entries.forEach((entry) => {
      URL.revokeObjectURL(entry.url);
    });
  }

  function clearPendingFiles() {
    revokePendingFiles(pendingFilesRef.current);
    setPendingFiles([]);
  }

  async function startUpload(nextFiles) {
    if (!nextFiles || nextFiles.length === 0) {
      return;
    }

    if (isUploading) {
      return;
    }

    const mergedFiles = mergeFiles([], nextFiles);
    const supportedFiles = [];
    const invalidEntries = [];

    for (const file of mergedFiles) {
      const classification = classifyUploadFile(file);

      if (classification.valid) {
        supportedFiles.push(file);
        continue;
      }

      invalidEntries.push({
        file,
        key: buildFileKey(file),
        filename: file.name,
        sizeLabel: formatFileSize(file.size),
        status: "error",
        message: classification.message
      });
    }

    const nextEntries = [...buildFileEntries(supportedFiles), ...invalidEntries];

    setFileEntries(nextEntries);
    setProgressState(buildEmptyProgressState());
    setError("");

    if (supportedFiles.length === 0) {
      if (invalidEntries.length > 0) {
        setError("Some files were skipped because they are not supported.");
      }
      return;
    }

    setIsUploading(true);

    try {
      setFileEntries((currentEntries) => currentEntries.map((entry) => (
        entry.status === "waiting"
          ? { ...entry, status: "uploading", message: "Uploading now" }
          : entry
      )));

      await uploadPhotos(supportedFiles, setProgressState, (index, result) => {
        const key = buildFileKey(supportedFiles[index]);
        const nextStatus = getResultStatus(result);

        setFileEntries((currentEntries) => currentEntries.map((entry) => (
          entry.key === key
            ? { ...entry, status: nextStatus.status, message: nextStatus.message }
            : entry
        )));
      });

      if (invalidEntries.length > 0) {
        setError("Some files were skipped because they are not supported.");
      }
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed");
      setFileEntries((currentEntries) =>
        currentEntries.map((entry) => ({
          ...entry,
          status: entry.status === "done" || entry.status === "duplicate" || entry.status === "error"
            ? entry.status
            : "error",
          message: entry.status === "done" || entry.status === "duplicate" || entry.status === "error"
            ? entry.message
            : (uploadError.message || "Upload failed")
        }))
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handleFilesSelected(nextFiles) {
    if (isMobile) {
      setPendingFiles((currentPendingFiles) => {
        const existingFiles = currentPendingFiles.map((entry) => entry.file);
        const mergedFiles = mergeFiles(existingFiles, nextFiles);
        const existingKeys = new Set(currentPendingFiles.map((entry) => entry.key));
        const nextPendingEntries = [];

        for (const file of mergedFiles) {
          const key = buildFileKey(file);

          if (existingKeys.has(key)) {
            continue;
          }

          nextPendingEntries.push({
            file,
            key,
            url: URL.createObjectURL(file)
          });
        }

        return [...currentPendingFiles, ...nextPendingEntries];
      });
      return;
    }

    startUpload(nextFiles);
  }

  function handleFileInputChange(event) {
    handleFilesSelected(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    handleFilesSelected(event.dataTransfer.files);
  }

  function resetUploadState() {
    setFileEntries([]);
    setError("");
    setProgressState(buildEmptyProgressState());
    setIsDragging(false);
  }

  function removePendingFile(key) {
    setPendingFiles((currentPendingFiles) => {
      const entryToRemove = currentPendingFiles.find((entry) => entry.key === key);

      if (entryToRemove) {
        URL.revokeObjectURL(entryToRemove.url);
      }

      return currentPendingFiles.filter((entry) => entry.key !== key);
    });
  }

  function handleConfirmUpload() {
    const filesToUpload = pendingFilesRef.current.map((entry) => entry.file);

    if (filesToUpload.length === 0) {
      return;
    }

    revokePendingFiles(pendingFilesRef.current);
    setPendingFiles([]);
    startUpload(filesToUpload);
  }

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Upload</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900">Import photos</h2>
          </div>

        {fileEntries.length > 0 ? (
          <p className="text-sm text-stone-500">
            {fileEntries.length} file{fileEntries.length === 1 ? "" : "s"} selected, {formatFileSize(totalFilesSize)}
          </p>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onChange={handleFileInputChange}
      />

      <button
        type="button"
        onClick={openFilePicker}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget)) {
            return;
          }

          setIsDragging(false);
        }}
        onDrop={handleDrop}
        className={`flex min-h-[260px] w-full flex-col items-center justify-center rounded-[2rem] border-2 border-dashed px-8 py-12 text-center transition ${
          isDragging
            ? "border-amber-400 bg-amber-50"
            : "border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-white"
        }`}
      >
        <p className="text-lg font-semibold text-stone-900">
          {isMobile ? "Take Photo or Choose Photos" : "Drag photos here"}
        </p>
        <p className="mt-3 text-sm text-stone-600">
          {isMobile
            ? "JPG, PNG, HEIC, HEIF, or WebP"
            : "or click to choose JPG, PNG, HEIC, HEIF, or WebP files"}
        </p>
        {!isMobile ? (
          <p className="mt-2 text-xs uppercase tracking-[0.24em] text-stone-500">Upload starts automatically</p>
        ) : null}
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {isMobile && pendingFiles.length > 0 && !isUploading ? (
          <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                {pendingFiles.length} photo{pendingFiles.length === 1 ? "" : "s"} selected
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {pendingFiles.map((entry) => (
                <PendingFileTile
                  key={entry.key}
                  entry={entry}
                  onRemove={removePendingFile}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={handleConfirmUpload} className="btn-primary">
                Upload
              </button>
              <button type="button" onClick={clearPendingFiles} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {isUploading ? (
          <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Live Upload Status</p>
                <p className="mt-2 text-sm text-stone-700">{activeStatusLabel}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <StatusPill label="Queued" value={statusCounts.waiting} />
                <StatusPill label="Uploading" value={statusCounts.uploading} />
                <StatusPill label="Done" value={statusCounts.done} />
                <StatusPill label="Duplicates" value={statusCounts.duplicate} />
                <StatusPill label="Errors" value={statusCounts.error} />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-sm text-stone-600">
                <span>{progressState.phase === "processing" ? "Server processing" : "Transfer progress"}</span>
                <span>{progressState.percent}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${progressState.percent}%` }} />
              </div>
            </div>
          </div>
        ) : null}

        {fileEntries.length > 0 ? (
          <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Batch status</p>
              <button type="button" onClick={resetUploadState} className="text-sm text-stone-500 hover:text-stone-900">
                Upload More
              </button>
            </div>

            <div className="space-y-3">
              {fileEntries.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">{entry.filename}</p>
                    <p className="mt-1 text-xs text-stone-500">{entry.sizeLabel}</p>
                    {entry.message ? <p className="mt-1 text-xs text-stone-500">{entry.message}</p> : null}
                  </div>

                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${getStatusClasses(entry.status)}`}>
                    <span className={entry.status === "uploading" ? "inline-block h-2 w-2 rounded-full bg-current animate-pulse" : ""}>
                      {entry.status === "done" ? "✓" : ""}
                    </span>
                    <span>{getStatusLabel(entry.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      </div>

      {!isMobile || pendingFiles.length === 0 || isUploading ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={resetUploadState} className="btn-secondary" disabled={isUploading}>
            Upload More
          </button>

          <button type="button" onClick={() => onNavigate("photos")} className="btn-secondary" disabled={!hasCompletedUpload}>
            View Photos
          </button>
        </div>
      ) : null}
    </section>
  );
}

function StatusPill({ label, value }) {
  return (
    <span className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-stone-700">
      {label}: {value}
    </span>
  );
}

function PendingFileTile({ entry, onRemove }) {
  const [hasPreviewError, setHasPreviewError] = useState(false);

  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <button
        type="button"
        onClick={() => onRemove(entry.key)}
        className="absolute right-1 top-1 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/80 text-sm text-white"
        aria-label={`Remove ${entry.file.name}`}
      >
        ✕
      </button>

      {hasPreviewError ? (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-stone-600">
          {entry.file.name}
        </div>
      ) : (
        <img
          src={entry.url}
          alt={entry.file.name}
          className="h-full w-full object-cover"
          onError={() => setHasPreviewError(true)}
        />
      )}
    </div>
  );
}
