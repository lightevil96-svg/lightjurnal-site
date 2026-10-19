(() => {
  const $ = (selector) => document.querySelector(selector);
  const allowedEmail = "rizkyevil9@gmail.com";
  const terminalUrl = "https://terminal.lightjurnal.my.id/";

  function status(title, copy, actionLabel = "", actionHref = "") {
    $("#terminal-status-title").textContent = title;
    $("#terminal-status-copy").textContent = copy;
    const actions = $("#terminal-actions");
    actions.replaceChildren();
    actions.hidden = !actionLabel;
    if (actionLabel) {
      const link = document.createElement("a");
      link.className = "button button-primary";
      link.href = actionHref;
      link.textContent = actionLabel;
      actions.append(link);
    }
  }

  async function init() {
    $("#year").textContent = new Date().getFullYear();
    const themeButton = $("#theme-toggle");
    const themeIcon = $("#theme-icon");
    const syncTheme = () => {
      if (themeIcon) themeIcon.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾";
    };
    themeButton?.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark";
      if (dark) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = "dark";
      try { localStorage.setItem("lj-theme", dark ? "light" : "dark"); } catch (_) {}
      syncTheme();
    });
    syncTheme();

    if (!window.ljSupabaseConfigured || !window.ljSupabase) {
      status("Login belum siap", "Konfigurasi Supabase belum aktif. Terminal tetap terkunci.");
      $("#terminal-message").textContent = "Hubungi pengelola LightJurnal untuk memperbaiki konfigurasi.";
      return;
    }

    try {
      const { data: sessionData, error: sessionError } = await window.ljSupabase.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) {
        status("Masuk diperlukan", "Masuk ke akun LightJurnal terlebih dahulu. Setelah login, buka kembali halaman terminal.", "Masuk akun", "login.html?returnTo=%2Fterminal.html");
        return;
      }

      const email = String(user.email || "").trim().toLowerCase();
      const verifiedAllowedEmail = email === allowedEmail && Boolean(user.email_confirmed_at || user.confirmed_at);
      const { data: profile, error: profileError } = await window.ljSupabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      const isAdmin = !profileError && profile?.role === "admin";

      if (!isAdmin && !verifiedAllowedEmail) {
        status("Akses ditolak", "Akun ini bukan admin dan bukan akun email yang diizinkan.");
        $("#terminal-message").textContent = "Akun saat ini: " + (email || "tidak diketahui") + ". Keluar lalu masuk dengan akun yang memiliki izin.";
        const actions = $("#terminal-actions");
        actions.hidden = false;
        const signout = document.createElement("button");
        signout.className = "button button-dark";
        signout.type = "button";
        signout.textContent = "Keluar dari akun";
        signout.addEventListener("click", async () => {
          await window.ljSupabase.auth.signOut();
          window.location.reload();
        });
        actions.append(signout);
        return;
      }

      status("Akun diizinkan", "Terautentikasi sebagai " + email + (isAdmin ? " · peran admin" : " · email yang diizinkan") + ". Lanjutkan hanya jika layanan terminal di sisi server sudah dikunci dengan autentikasi.", "Buka terminal ↗", terminalUrl);
      $("#terminal-message").textContent = "Jika subdomain meminta kata sandi terminal terpisah, gunakan kredensial yang hanya diketahui oleh pemilik/admin. Jangan bagikan kredensial tersebut.";
    } catch (error) {
      status("Verifikasi gagal", "Akses terminal tidak diberikan karena sesi tidak dapat diverifikasi.");
      $("#terminal-message").textContent = error?.message || "Kesalahan verifikasi akun.";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
