const $ = (selector, root = document) => root.querySelector(selector);
let allJournals = [];
let activeFilter = "pending";

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function showMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = "portal-message" + (type ? " " + type : "");
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium", timeStyle: "short"
  }).format(date);
}

function statusLabel(status) {
  return ({ pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" })[status] || status;
}

function setAdminView(view) {
  $("#admin-login-view").hidden = view !== "login";
  $("#admin-dashboard-view").hidden = view !== "dashboard";
  $("#admin-denied-view").hidden = view !== "denied";
}

async function showAdminDashboard(user) {
  const { data: profile, error } = await window.ljSupabase
    .from("profiles").select("role,display_name").eq("id", user.id).maybeSingle();
  if (error || profile?.role !== "admin") {
    setAdminView("denied");
    $("#denied-email").textContent = user.email || "";
    return false;
  }
  setAdminView("dashboard");
  $("#admin-email").textContent = user.email || "Admin LightJurnal";
  await loadJournals();
  return true;
}

function renderJournals() {
  const container = $("#moderation-list");
  const filtered = activeFilter === "all" ? allJournals : allJournals.filter((item) => item.status === activeFilter);
  $("#stat-total").textContent = String(allJournals.length);
  $("#stat-pending").textContent = String(allJournals.filter((item) => item.status === "pending").length);
  $("#stat-approved").textContent = String(allJournals.filter((item) => item.status === "approved").length);
  $("#stat-rejected").textContent = String(allJournals.filter((item) => item.status === "rejected").length);

  if (!filtered.length) {
    container.innerHTML = '<div class="portal-empty">Tidak ada jurnal pada filter ini.</div>';
    return;
  }

  container.innerHTML = filtered.map((item) => {
    const signedLink = item.signedUrl
      ? '<a class="portal-small-button" href="' + escapeHTML(item.signedUrl) + '" target="_blank" rel="noopener noreferrer">Periksa PDF ↗</a>'
      : "";
    const note = item.admin_note ? '<p><strong>Catatan admin:</strong> ' + escapeHTML(item.admin_note) + '</p>' : "";
    let actions = "";
    if (item.status === "pending") {
      actions = '<button type="button" class="portal-small-button primary" data-action="approve" data-id="' + escapeHTML(item.id) + '">Setujui</button>' +
        '<button type="button" class="portal-small-button danger" data-action="reject" data-id="' + escapeHTML(item.id) + '">Tolak</button>';
    } else if (item.status === "rejected") {
      actions = '<button type="button" class="portal-small-button primary" data-action="approve" data-id="' + escapeHTML(item.id) + '">Setujui sekarang</button>';
    } else {
      actions = '<button type="button" class="portal-small-button" data-action="reject" data-id="' + escapeHTML(item.id) + '">Tarik publikasi</button>';
    }
    actions += '<button type="button" class="portal-small-button danger" data-action="delete" data-id="' + escapeHTML(item.id) + '">Hapus permanen</button>';

    return '<article class="portal-item">' +
      '<div class="portal-item-head"><div><h3>' + escapeHTML(item.title) + '</h3>' +
      '<div class="portal-item-meta">Pengirim: ' + escapeHTML(item.submitterEmail || "Akun pengguna") +
      '<br>Penulis: ' + escapeHTML(item.author_name) + ' · ' + escapeHTML(item.category) +
      '<br>Dikirim: ' + escapeHTML(dateLabel(item.created_at)) +
      (item.reviewed_at ? '<br>Ditinjau: ' + escapeHTML(dateLabel(item.reviewed_at)) : "") + '</div></div>' +
      '<span class="portal-status ' + escapeHTML(item.status) + '">' + escapeHTML(statusLabel(item.status)) + '</span></div>' +
      '<p class="portal-article-desc">' + escapeHTML(item.description) + '</p>' +
      (Array.isArray(item.tags) && item.tags.length ? '<p>Tag: ' + escapeHTML(item.tags.join(", ")) + '</p>' : "") +
      note + '<div class="portal-item-actions">' + signedLink + actions + '</div></article>';
  }).join("");
}

async function loadJournals() {
  $("#moderation-list").innerHTML = '<div class="portal-empty">Memuat jurnal…</div>';
  const { data, error } = await window.ljSupabase
    .from("journals")
    .select("id,user_id,title,author_name,category,description,tags,file_path,original_filename,status,admin_note,created_at,reviewed_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    showMessage($("#admin-message"), "Tidak dapat memuat data. Periksa SQL/RLS Supabase: " + error.message, "error");
    $("#moderation-list").innerHTML = '<div class="portal-empty">Data tidak dapat dimuat.</div>';
    return;
  }
  allJournals = await Promise.all((data || []).map(async (item) => {
    const [{ data: signed }, { data: profile }] = await Promise.all([
      window.ljSupabase.storage.from("journal-pdfs").createSignedUrl(item.file_path, 3600),
      window.ljSupabase.from("profiles").select("email").eq("id", item.user_id).maybeSingle()
    ]);
    return { ...item, signedUrl: signed?.signedUrl || "", submitterEmail: profile?.email || "" };
  }));
  renderJournals();
  showMessage($("#admin-message"), "");
}

async function reviewJournal(id, status, note = null) {
  const { error } = await window.ljSupabase.from("journals").update({
    status,
    admin_note: note,
    reviewed_at: new Date().toISOString()
  }).eq("id", id);
  if (error) throw error;
  await loadJournals();
}

async function initAdmin() {
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

  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    $("#config-warning").hidden = false;
    $("#admin-login-submit").disabled = true;
    return;
  }

  const { data: sessionData } = await window.ljSupabase.auth.getSession();
  if (sessionData.session?.user) await showAdminDashboard(sessionData.session.user);

  $("#admin-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#admin-login-submit");
    button.disabled = true;
    showMessage($("#admin-login-message"), "Memeriksa akses admin…");
    try {
      const { data, error } = await window.ljSupabase.auth.signInWithPassword({
        email: $("#admin-email-input").value.trim().toLowerCase(),
        password: $("#admin-password-input").value
      });
      if (error) throw error;
      const allowed = await showAdminDashboard(data.user);
      if (!allowed) showMessage($("#admin-login-message"), "Akun ini tidak memiliki peran admin. Gunakan akun admin yang sudah ditetapkan di Supabase.", "error");
    } catch (error) {
      showMessage($("#admin-login-message"), error?.message || "Login gagal.", "error");
    } finally {
      button.disabled = false;
    }
  });

  async function signOut() {
    const { error } = await window.ljSupabase.auth.signOut();
    if (error) showMessage($("#admin-message"), error.message, "error");
    else window.location.replace("admin.html");
  }
  $("#admin-logout")?.addEventListener("click", signOut);
  $("#denied-signout")?.addEventListener("click", signOut);

  $("#reload-journals")?.addEventListener("click", loadJournals);
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "pending";
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
      renderJournals();
    });
  });
  document.querySelector('[data-filter="pending"]')?.classList.add("active");

  $("#moderation-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    const item = allJournals.find((journal) => journal.id === id);
    if (!item) return;

    try {
      button.disabled = true;
      if (action === "approve") {
        if (!window.confirm('Setujui "' + item.title + '" dan tampilkan di halaman publik?')) return;
        await reviewJournal(id, "approved", null);
        showMessage($("#admin-message"), "Jurnal disetujui dan dapat dibaca publik.", "success");
      } else if (action === "reject") {
        const reason = window.prompt("Tuliskan catatan untuk penulis (wajib):", item.admin_note || "");
        if (reason === null) return;
        if (!reason.trim()) {
          showMessage($("#admin-message"), "Penolakan harus disertai catatan untuk penulis.", "warn");
          return;
        }
        await reviewJournal(id, "rejected", reason.trim().slice(0, 1500));
        showMessage($("#admin-message"), "Status jurnal diperbarui.", "success");
      } else if (action === "delete") {
        if (!window.confirm('Hapus permanen "' + item.title + '" beserta PDF-nya? Tindakan ini tidak dapat dibatalkan.')) return;
        const { error: storageError } = await window.ljSupabase.storage.from("journal-pdfs").remove([item.file_path]);
        if (storageError) throw storageError;
        const { error: deleteError } = await window.ljSupabase.from("journals").delete().eq("id", id);
        if (deleteError) throw deleteError;
        await loadJournals();
        showMessage($("#admin-message"), "Jurnal dan PDF dihapus.", "success");
      }
    } catch (error) {
      showMessage($("#admin-message"), error?.message || "Perubahan gagal disimpan.", "error");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", initAdmin);