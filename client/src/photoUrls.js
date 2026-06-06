export function appendPhotoVersion(url, photo) {
  if (!url) {
    return "";
  }

  const version = photo?.image_version || 1;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}
