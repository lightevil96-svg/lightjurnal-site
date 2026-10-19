const $ = (selector, root = document) => root.querySelector(selector);
let authMode = "login";

function showMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = "portal-message" + (type ? " " + type : "");
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("#tab-login")?.classList.toggle("active", !signup);
  $("#tab-signup")?.classList.toggle("active", signup);
  $("#tab-login")?.setAttribute("aria-selected", String(!signup));
  $("#tab-signup")?.setAttribute("aria-selected", String(signup));
  $("#name-field").hidden = !signup;
  $("#display-name").required = signup;
  $("#password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("#auth-submit").textContent = signup ? "Buat akun" : "Masuk";
  showMessage($("#auth-message"), "");
}

async function routeSignedInUser(user) {
  const { data } = await window.ljSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Preserve Ludo invitation links through login, without allowing external redirects.
  const requested = new URLSearchParams(window.location.search).get("returnTo");
  if (requested) {
    try {
      const target = new URL(requested, window.location.origin);
      if (target.origin === window.location.origin && target.pathname === "/ludo.html") {
        window.location.replace("ludo.html" + target.search + target.hash);
        return;
      }
      if (target.origin === window.location.origin && target.pathname === "/terminal.html") {
        window.location.replace("terminal.html");
        return;
      }
    } catch (_) {}
  }
  window.location.replace(data?.role === "admin" ? "admin.html" : "dashboard.html");
}

async function initAuth() {
  const form = $("#auth-form");
  if ($("#year")) $("#year").textContent = new Date().getFullYear();

  const themeButton = $("#theme-toggle");
  const themeIcon = $("#theme-icon");
  function syncThemeIcon() {
    if (themeIcon) themeIcon.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
  }
  themeButton?.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = "dark";
    try { localStorage.setItem("lj-theme", dark ? "light" : "dark"); } catch (_) {}
    syncThemeIcon();
  });
  syncThemeIcon();

  $("#tab-login")?.addEventListener("click", () => setAuthMode("login"));
  $("#tab-signup")?.addEventListener("click", () => setAuthMode("signup"));

  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    $("#config-warning").hidden = false;
    $("#auth-submit").disabled = true;
    showMessage($("#auth-message"), "Login belum aktif karena konfigurasi backend belum diisi.", "warn");
    return;
  }

  const { data: sessionData } = await window.ljSupabase.auth.getSession();
  if (sessionData.session?.user) {
    await routeSignedInUser(sessionData.session.user);
    return;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("#auth-submit");
    const message = $("#auth-message");
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    submit.disabled = true;
    showMessage(message, authMode === "signup" ? "Membuat akun…" : "Memeriksa akun…");

    try {
      if (authMode === "signup") {
        const displayName = $("#display-name").value.trim();
        if (displayName.length < 2) throw new Error("Nama tampilan harus berisi minimal 2 karakter.");
        const { data, error } = await window.ljSupabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } }
        });
        if (error) throw error;
        if (data.session?.user) {
          await routeSignedInUser(data.session.user);
          return;
        }
        showMessage(message, "Akun berhasil dibuat. Periksa email untuk konfirmasi, lalu masuk menggunakan akun tersebut.", "success");
        setAuthMode("login");
        $("#email").value = email;
      } else {
        const { data, error } = await window.ljSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await routeSignedInUser(data.user);
        return;
      }
    } catch (error) {
      showMessage(message, error?.message || "Permintaan gagal. Periksa koneksi atau konfigurasi Supabase.", "error");
    } finally {
      submit.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", initAuth);