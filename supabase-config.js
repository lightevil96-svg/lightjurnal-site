/*
 * LightJurnal — konfigurasi browser Supabase.
 * URL project dan anon/publishable key memang digunakan dari browser.
 * JANGAN pernah menaruh service_role/secret key di file ini.
 */
window.LIGHTJURNAL_CONFIG = {
  url: "https://wyxjubvpnshqthtnmbyl.supabase.co",
  anonKey: "sb_publishable_HdOlM0dKlT60-5EWLFabEQ_XTSijgSn"
};

(function () {
  const config = window.LIGHTJURNAL_CONFIG || {};
  const url = String(config.url || "");
  const key = String(config.anonKey || "");
  const ready =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) &&
    key.length > 20 &&
    !url.includes("PROJECT_REF") &&
    !key.includes("PASTE_SUPABASE");

  window.ljSupabaseConfigured = Boolean(ready && window.supabase && window.supabase.createClient);
  window.ljSupabase = window.ljSupabaseConfigured
    ? window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
})();
