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
        status: "success",
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

export default function UploadView({ onNavigate }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  const totalFilesSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files]
  );

  function openFilePicker() {
    inputRef.current?.click();
  }

  function handleFilesSelected(nextFiles) {
    if (!nextFiles || nextFiles.length === 0) {
      return;
    }

    setFiles((currentFiles) => mergeFiles(currentFiles, nextFiles));
    setResults([]);
    setError("");
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

  function removeFile(fileToRemove) {
    setFiles((currentFiles) =>
      currentFiles.filter(
        (file) =>
          !(
            file.name === fileToRemove.name
            && file.size === fileToRemove.size
            && file.lastModified === fileToRemove.lastModified
          )
      )
    );
  }

  async function handleUpload() {
    if (files.length === 0 || isUploading) {
      return;
    }

    setIsUploading(true);
    setProgress(0);
    setResults([]);
    setError("");

    try {
      const response = await uploadPhotos(files, setProgress);
      setResults(flattenUploadResults(response?.data, files));
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed");
      setResults(
        files.map((file) => ({
          filename: file.name,
          status: "error",
          message: uploadError.message || "Upload failed"
        }))
      );
    } finally {
      setIsUploading(false);
    }
  }

  function resetUploadState() {
    setFiles([]);
    setResults([]);
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

        {files.length > 0 ? (
          <p className="text-sm text-stone-500">
            {files.length} file{files.length === 1 ? "" : "s"} selected, {formatFileSize(totalFilesSize)}
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
      </button>

      {files.length > 0 ? (
        <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Selected files</p>
            <button type="button" onClick={resetUploadState} className="text-sm text-stone-500 hover:text-stone-900">
              Clear all
            </button>
          </div>

          <div className="space-y-3">
            {files.map((file) => (
              <div
                key={`${file.name}-${file.lastModified}-${file.size}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">{file.name}</p>
                  <p className="mt-1 text-xs text-stone-500">{formatFileSize(file.size)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  className="text-sm text-stone-500 transition hover:text-red-700"
                  disabled={isUploading}
                >
                  Remove
                </button>
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

      {results.length > 0 ? (
        <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-white p-4">
          <p className="mb-4 text-xs uppercase tracking-[0.24em] text-stone-500">Results</p>
          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={`${result.filename}-${result.status}`}
                className={`rounded-2xl px-4 py-3 text-sm ${
                  result.status === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : result.status === "duplicate"
                      ? "bg-amber-50 text-amber-800"
                      : "bg-red-50 text-red-700"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">{result.filename}</span>
                  <span className="uppercase tracking-[0.2em]">{result.status}</span>
                </div>
                <p className="mt-1">{result.message}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={handleUpload} disabled={files.length === 0 || isUploading} className="btn-primary">
          {isUploading ? "Uploading..." : "Upload"}
        </button>

        <button type="button" onClick={resetUploadState} className="btn-secondary" disabled={isUploading}>
          Upload More
        </button>

        <button type="button" onClick={() => onNavigate("photos")} className="btn-secondary">
          View Photos
        </button>
      </div>
    </section>
  );
}
