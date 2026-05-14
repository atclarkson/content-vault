import { useMemo, useRef, useState } from "react";
import { uploadPhotos } from "../api";

const ACCEPTED_FILE_TYPES = ".jpg,.jpeg,.png,.heic,.heif,.webp";

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

function flattenUploadResults(responseData, files) {
  const results = Array.isArray(responseData) ? responseData : [];

  return files.map((file, index) => {
    const result = results[index];

    if (!result) {
      return {
        filename: file.name,
        status: "error",
        message: "No result returned"
      };
    }

    if (result.photo) {
      return {
        filename: result.photo.original_filename || file.name,
        status: "done",
        message: "Uploaded"
      };
    }

    if (result.skipped) {
      return {
        filename: result.filename || file.name,
        status: "duplicate",
        message: result.reason || "duplicate"
      };
    }

    return {
      filename: file.name,
      status: "error",
      message: "Unexpected upload result"
    };
  });
}

function buildFileEntries(nextFiles) {
  return nextFiles.map((file) => ({
    file,
    key: `${file.name}-${file.lastModified}-${file.size}`,
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

export default function UploadView({ onNavigate }) {
  const inputRef = useRef(null);
  const [fileEntries, setFileEntries] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const totalFilesSize = useMemo(
    () => fileEntries.reduce((sum, entry) => sum + entry.file.size, 0),
    [fileEntries]
  );
  const hasCompletedUpload = fileEntries.length > 0 && !isUploading;

  function openFilePicker() {
    inputRef.current?.click();
  }

  async function startUpload(nextFiles) {
    if (!nextFiles || nextFiles.length === 0) {
      return;
    }

    if (isUploading) {
      return;
    }

    const mergedFiles = mergeFiles([], nextFiles);
    const nextEntries = buildFileEntries(mergedFiles);

    setFileEntries(nextEntries);
    setIsUploading(true);
    setProgress(0);
    setError("");

    try {
      setFileEntries((currentEntries) => currentEntries.map((entry) => ({
        ...entry,
        status: "uploading",
        message: "Uploading now"
      })));

      const response = await uploadPhotos(mergedFiles, setProgress);
      const resultEntries = flattenUploadResults(response?.data, mergedFiles);

      setFileEntries((currentEntries) => currentEntries.map((entry, index) => ({
        ...entry,
        status: resultEntries[index]?.status || "error",
        message: resultEntries[index]?.message || "Unexpected upload result"
      })));
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed");
      setFileEntries((currentEntries) =>
        currentEntries.map((entry) => ({
          ...entry,
          status: "error",
          message: uploadError.message || "Upload failed"
        }))
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handleFilesSelected(nextFiles) {
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
    setProgress(0);
    setIsDragging(false);
  }

  return (
    <section className="panel p-6">
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
        <p className="text-lg font-semibold text-stone-900">Drag photos here</p>
        <p className="mt-3 text-sm text-stone-600">or click to choose JPG, PNG, HEIC, HEIF, or WebP files</p>
        <p className="mt-2 text-xs uppercase tracking-[0.24em] text-stone-500">Upload starts automatically</p>
      </button>

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

      {isUploading ? (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm text-stone-600">
            <span>Uploading...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-stone-900 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={resetUploadState} className="btn-secondary" disabled={isUploading}>
          Upload More
        </button>

        <button type="button" onClick={() => onNavigate("photos")} className="btn-secondary" disabled={!hasCompletedUpload}>
          View Photos
        </button>
      </div>
    </section>
  );
}
