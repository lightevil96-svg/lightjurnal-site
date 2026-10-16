# YouTube search Edge Function

The function keeps `YOUTUBE_API_KEY` server-side. Never commit that value.
Deploy from this repository after setting the secret in the Supabase project used by LightJurnal.

```sh
supabase secrets set YOUTUBE_API_KEY=YOUR_KEY_FROM_GOOGLE_CLOUD
supabase functions deploy youtube-search --no-verify-jwt
```

This endpoint is intentionally public to the browser, so it validates allowed origins, input size, and basic per-isolate request rate. Origin checks alone are not authentication; monitor YouTube API quota and rotate the Google key if it was exposed in a public repository.
