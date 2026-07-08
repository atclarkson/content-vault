const API_KEY = import.meta.env.VITE_API_KEY;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...options.headers,
      "x-api-key": API_KEY
    }
  });
  const data = await parseJson(response);

  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

async function parseJson(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Invalid JSON response");
  }
}

function buildQueryString(filters = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function getPhotos(filters = {}) {
  return request(`/api/photos${buildQueryString(filters)}`);
}

export async function queryPhotos(query = {}) {
  return jsonRequest("/api/photos/query", "POST", query);
}

export async function queryVideos(query = {}) {
  return jsonRequest("/api/videos/query", "POST", query);
}

export async function queryJournalEntries(query = {}) {
  return jsonRequest("/api/journal-entries/query", "POST", query);
}

export async function getPhoto(id) {
  return request(`/api/photos/${id}`);
}

export async function generateCaption(id, options = {}) {
  const notesForAi = typeof options.notes_for_ai === "string" ? options.notes_for_ai : null;
  const people = Array.isArray(options.people) ? options.people : null;

  if (notesForAi !== null || people !== null) {
    return jsonRequest(`/api/caption/${id}`, "POST", {
      ...(notesForAi !== null ? { notes_for_ai: notesForAi } : {}),
      ...(people !== null ? { people } : {})
    });
  }

  return request(`/api/caption/${id}`, {
    method: "POST"
  });
}

export async function generateVideoCaption(id) {
  return request(`/api/caption/video/${id}`, {
    method: "POST"
  });
}

export async function updatePhoto(id, data) {
  return jsonRequest(`/api/photos/${id}`, "PUT", data);
}

export async function getPhotoCorrectionPreview(id, editRecipe, options = {}) {
  const previewWidth = Number(options.previewWidth);
  const response = await fetch(`/api/photos/${id}/correction-preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY
    },
    body: JSON.stringify({
      edit_recipe: editRecipe,
      ...(Number.isFinite(previewWidth) ? { preview_width: previewWidth } : {})
    })
  });

  if (!response.ok) {
    let errorMessage = "Failed to load correction preview";

    try {
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      errorMessage = data?.error || errorMessage;
    } catch {}

    throw new Error(errorMessage);
  }

  return response.blob();
}

export async function deletePhoto(id) {
  return request(`/api/photos/${id}`, {
    method: "DELETE"
  });
}

export async function restorePhoto(id) {
  return request(`/api/photos/${id}/restore`, {
    method: "POST"
  });
}

export async function bulkUpdate(photoIds, updates) {
  return jsonRequest("/api/photos/bulk-update", "POST", {
    photo_ids: photoIds,
    updates
  });
}

export async function getPeople() {
  return request("/api/people");
}

export async function createPerson(name) {
  return jsonRequest("/api/people", "POST", { name });
}

export async function updatePerson(id, data) {
  return jsonRequest(`/api/people/${id}`, "PUT", data);
}

export async function deletePerson(id) {
  return request(`/api/people/${id}`, {
    method: "DELETE"
  });
}

export async function getTags(sort) {
  const query = sort ? `?sort=${encodeURIComponent(sort)}` : "";
  return request(`/api/tags${query}`);
}

export async function getTagGroups() {
  return request("/api/tag-groups");
}

export async function mergeTags(sourceId, targetId) {
  return jsonRequest("/api/tags/merge", "POST", {
    source_id: sourceId,
    target_id: targetId
  });
}

export async function updateTag(id, data) {
  return jsonRequest(`/api/tags/${id}`, "PUT", data);
}

export async function deleteTag(id) {
  return request(`/api/tags/${id}`, {
    method: "DELETE"
  });
}

export async function getDestinations() {
  return request("/api/destinations/raw");
}

export async function getJournalEntries() {
  return request("/api/journal-entries");
}

export async function getVideos() {
  return request("/api/videos");
}

export async function getVideo(id) {
  return request(`/api/videos/${id}`);
}

export async function updateVideo(id, data) {
  return jsonRequest(`/api/videos/${id}`, "PUT", data);
}

export async function deleteVideo(id) {
  return request(`/api/videos/${id}`, {
    method: "DELETE"
  });
}

export async function syncYouTube() {
  return request("/api/videos/sync", {
    method: "POST"
  });
}

export async function refreshVideoStats() {
  return request("/api/videos/refresh-stats", {
    method: "POST"
  });
}

export async function suggestVideoLocation(id) {
  return request(`/api/videos/${id}/suggest-location`, {
    method: "POST"
  });
}

export async function getSettings() {
  return request("/api/settings");
}

export async function updateSetting(key, value) {
  return jsonRequest(`/api/settings/${encodeURIComponent(key)}`, "PUT", { value });
}

export async function logoutBrowserSession() {
  return request("/api/auth/logout", {
    method: "POST"
  });
}

export async function importDestinations(file) {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/destinations/import");
    xhr.setRequestHeader("x-api-key", API_KEY);
    xhr.responseType = "text";

    xhr.onload = () => {
      let data = null;

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        reject(new Error("Invalid JSON response"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }

      reject(new Error(data?.error || "Destination import failed"));
    };

    xhr.onerror = () => {
      reject(new Error("Destination import failed"));
    };

    xhr.send(formData);
  });
}

export async function importDayOne(file) {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/import/day-one");
    xhr.setRequestHeader("x-api-key", API_KEY);
    xhr.responseType = "text";

    xhr.onload = () => {
      let data = null;

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        reject(new Error("Invalid JSON response"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }

      reject(new Error(data?.error || "Day One import failed"));
    };

    xhr.onerror = () => {
      reject(new Error("Day One import failed"));
    };

    xhr.send(formData);
  });
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
    } catch {
      throw new Error("Invalid streaming response from Day One import");
    }
  }

  return {
    events,
    remainder
  };
}

export async function streamDayOneImport(file, { onEvent }) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/import/day-one", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY
    },
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

export async function exportCatalog(filters = {}) {
  return request(`/api/export${buildQueryString(filters)}`);
}

function buildUploadErrorMessage(status, responseText, parsed) {
  if (parsed?.error) {
    return parsed.error;
  }

  const text = typeof responseText === "string" ? responseText.trim() : "";

  if (text) {
    return text;
  }

  if (status === 413) {
    return "Upload too large";
  }

  return "Upload failed";
}

function uploadPhotoBatch(files, onProgress, progressState) {
  const formData = new FormData();

  for (const file of Array.from(files || [])) {
    formData.append("files", file);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("x-api-key", API_KEY);
    xhr.responseType = "text";

    if (onProgress) {
      onProgress({
        phase: "starting",
        loaded: 0,
        total: 0,
        percent: 0
      });
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) {
        return;
      }

      onProgress({
        phase: "uploading",
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100)
      });
    };

    xhr.upload.onload = () => {
      if (!onProgress) {
        return;
      }

      onProgress({
        phase: "processing",
        loaded: 0,
        total: 0,
        percent: 100
      });
    };

    xhr.onload = () => {
      let data = null;

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {}

      if (xhr.status >= 200 && xhr.status < 300) {
        if (!data) {
          reject(new Error("Invalid JSON response"));
          return;
        }

        if (onProgress) {
          onProgress({
            phase: "complete",
            loaded: progressState.total,
            total: progressState.total,
            percent: 100
          });
        }

        resolve(data);
        return;
      }

      reject(new Error(buildUploadErrorMessage(xhr.status, xhr.responseText, data)));
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };

    xhr.send(formData);
  });
}

export async function uploadPhotos(files, onProgress, onItemResult) {
  const fileList = Array.from(files || []);
  const total = fileList.reduce((sum, file) => sum + (file.size || 0), 0);
  const results = [];
  let completed = 0;

  if (onProgress) {
    onProgress({
      phase: "starting",
      loaded: 0,
      total,
      percent: 0
    });
  }

  for (const [index, file] of fileList.entries()) {
    try {
      const response = await uploadPhotoBatch([file], onProgress ? (event) => {
        const batchLoaded = event.phase === "complete" ? file.size : Math.min(event.loaded || 0, file.size);
        const loaded = Math.min(completed + batchLoaded, total);

        onProgress({
          phase: event.phase,
          loaded,
          total,
          percent: total > 0 ? Math.round((loaded / total) * 100) : 100
        });
      } : null, {
        completed,
        total
      });

      const result = Array.isArray(response?.data) ? response.data[0] : null;

      if (result) {
        results.push(result);
        onItemResult?.(index, result);
      } else {
        const fallbackResult = {
          filename: file.name,
          error: "No result returned"
        };
        results.push(fallbackResult);
        onItemResult?.(index, fallbackResult);
      }
    } catch (error) {
      const errorResult = {
        filename: file.name,
        error: error.message || "Upload failed"
      };
      results.push(errorResult);
      onItemResult?.(index, errorResult);
    }

    completed += file.size || 0;
  }

  if (onProgress) {
    onProgress({
      phase: "complete",
      loaded: total,
      total,
      percent: 100
    });
  }

  return { data: results };
}

export async function getProcessingStatus() {
  return request("/api/processing/status");
}
