import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const allowedOrigins = new Set([
  "https://lightjurnal.my.id",
  "https://www.lightjurnal.my.id",
  "https://lightevil96-svg.github.io",
]);

const rateBuckets = new Map<string, { start: number; count: number }>();
const responseCache = new Map<string, { expires: number; body: unknown }>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const CACHE_TTL_MS = 60_000;

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function allowRate(ip: string) {
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json({ error: { message: "Metode tidak diizinkan." } }, 405, origin || "https://lightjurnal.my.id");
  if (!allowedOrigins.has(origin)) return json({ error: { message: "Origin tidak diizinkan." } }, 403, "https://lightjurnal.my.id");

  // Accept the currently configured public Supabase key(s), never a Google secret.
  const suppliedKey = request.headers.get("apikey") || "";
  const acceptedPublicKeys = new Set<string>();
  const legacyAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (legacyAnonKey) acceptedPublicKeys.add(legacyAnonKey);
  try {
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    for (const value of Object.values(publishableKeys)) {
      if (typeof value === "string" && value) acceptedPublicKeys.add(value);
    }
  } catch {
    // If the injected publishable-key map is unavailable, origin restrictions
    // and per-isolate rate-limits still apply.
  }
  if (acceptedPublicKeys.size > 0 && !acceptedPublicKeys.has(suppliedKey)) {
    return json({ error: { message: "Kunci aplikasi tidak valid." } }, 401, origin);
  }

  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown";
  const ip = forwarded.split(",")[0].trim().slice(0, 80);
  if (!allowRate(ip)) return json({ error: { message: "Terlalu banyak pencarian. Tunggu satu menit lalu coba lagi." } }, 429, origin);

  let body: { q?: unknown; pageToken?: unknown; maxResults?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: "Permintaan pencarian tidak valid." } }, 400, origin);
  }
  const q = typeof body.q === "string" ? body.q.trim().slice(0, 160) : "";
  const pageToken = typeof body.pageToken === "string" ? body.pageToken.slice(0, 500) : "";
  if (q.length < 2) return json({ error: { message: "Masukkan kata kunci minimal 2 karakter." } }, 400, origin);

  const cacheKey = q.toLocaleLowerCase("id") + "|" + pageToken;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return json(cached.body, 200, origin);

  const googleApiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!googleApiKey) return json({ error: { message: "Secret YOUTUBE_API_KEY belum dipasang pada Supabase Edge Function." } }, 503, origin);

  const params = new URLSearchParams({
    key: googleApiKey,
    part: "snippet",
    type: "video",
    q,
    maxResults: "10",
    safeSearch: "moderate",
    regionCode: "ID",
    relevanceLanguage: "id",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    fields: "nextPageToken,items(id/videoId,snippet(title,description,channelTitle,publishedAt,thumbnails))",
  });
  if (pageToken) params.set("pageToken", pageToken);

  try {
    const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString(), {
      headers: {
        "Accept": "application/json",
        "Referer": "https://lightjurnal.my.id/",
      },
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      const reason = payload?.error?.errors?.[0]?.reason || "";
      const message = response.status === 403 && /quota|dailyLimit/i.test(reason + " " + (payload?.error?.message || ""))
        ? "Kuota pencarian YouTube untuk hari ini mungkin sudah habis. Coba lagi nanti."
        : response.status === 403
          ? "Akses YouTube API ditolak. Periksa pembatasan API key di Google Cloud."
          : payload?.error?.message || "Pencarian YouTube gagal.";
      return json({ error: { message } }, response.status >= 400 && response.status < 600 ? response.status : 502, origin);
    }
    responseCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, body: payload });
    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, entry] of responseCache.entries()) if (entry.expires <= now) responseCache.delete(key);
      if (responseCache.size > 150) responseCache.clear();
    }
    return json(payload, 200, origin);
  } catch {
    return json({ error: { message: "Koneksi pencarian bermasalah. Coba lagi sebentar." } }, 502, origin);
  }
});
