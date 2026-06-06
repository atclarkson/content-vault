async function request(path, options = {}) {
  const response = await fetch(path, options);
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
      "Content-Type": "application/json"
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
  return request("/api/destinations");
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

export async function importDestinations(file) {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/destinations/import");
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

export async function exportCatalog(filters = {}) {
  return request(`/api/export${buildQueryString(filters)}`);
}

export async function uploadPhotos(files, onProgress) {
  const formData = new FormData();

  for (const file of Array.from(files || [])) {
    formData.append("files", file);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/upload");
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
      } catch (error) {
        reject(new Error("Invalid JSON response"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) {
          onProgress({
            phase: "complete",
            loaded: 0,
            total: 0,
            percent: 100
          });
        }

        resolve(data);
        return;
      }

      reject(new Error(data?.error || "Upload failed"));
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };

    xhr.send(formData);
  });
}

export async function getProcessingStatus() {
  return request("/api/processing/status");
}
