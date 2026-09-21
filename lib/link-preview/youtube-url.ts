const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined) {
  return value && videoIdPattern.test(value) ? value : null;
}

export function getYouTubeVideoId(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!youtubeHosts.has(hostname)) return null;
  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    return validVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }
  if (url.pathname === "/watch") return validVideoId(url.searchParams.get("v"));
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return ["embed", "live", "shorts", "v"].includes(kind ?? "") ? validVideoId(id) : null;
}

export function getYouTubeThumbnailUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const videoId = getYouTubeVideoId(new URL(value));
    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}
