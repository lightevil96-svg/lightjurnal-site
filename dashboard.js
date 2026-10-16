const $ = (selector, root = document) => root.querySelector(selector);
const MAX_PDF_BYTES = 25_000_000;
let currentUser = null;
let profileName = "";

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

function statusLabel(status) {
  return ({ pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" })[status] || status;
}

function dateLabel(value) {
  if (!value) return "Tanggal belum tersedia";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium", timeStyle: "short"
  }).format(date);
}

async function loadMyJournals() {
  const container = $("#my-journals");
  container.innerHTML = '<div class="portal-empty">Memuat kiriman…</div>';
  const { data, error } = await window.ljSupabase
    .from("journals")
    .select("id,title,author_name,category,description,tags,file_path,original_filename,status,admin_note,created_at,reviewed_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    container.innerHTML = '<div class="portal-empty">Tidak dapat memuat kiriman. Periksa aturan RLS dan konfigurasi Supabase.</div>';
    showMessage($("#list-message"), error.message, "error");
    return;
  }

  const journals = data || [];
  $("#count-total").textContent = String(journals.length);
  $("#count-pending").textContent = String(journals.filter((item) => item.status === "pending").length);
  $("#count-approved").textContent = String(journals.filter((item) => item.status === "approved").length);

  if (!journals.length) {
    container.innerHTML = '<div class="portal-empty">Belum ada jurnal yang kamu kirim. Gunakan formulir di atas untuk mengirim karya pertama.</div>';
    showMessage($("#list-message"), "");
    return;
  }

  const cards = await Promise.all(journals.map(async (item) => {
    let signedUrl = "";
    const { data: signed } = await window.ljSupabase.storage
      .from("journal-pdfs")
      .createSignedUrl(item.file_path, 3600);
    if (signed?.signedUrl) signedUrl = signed.signedUrl;

    const note = item.admin_note
      ? '<p><strong>Catatan admin:</strong> ' + escapeHTML(item.admin_note) + '</p>'
      : "";
    const fileLink = signedUrl
      ? '<a class="portal-small-button" href="' + escapeHTML(signedUrl) + '" target="_blank" rel="noopener noreferrer">Buka PDF ↗</a>'
      : "";
    const tagLine = Array.isArray(item.tags) && item.tags.length
      ? '<p>Tag: ' + escapeHTML(item.tags.join(", ")) + '</p>'
      : "";
    return '<article class="portal-item">' +
      '<div class="portal-item-head"><div><h3>' + escapeHTML(item.title) + '</h3>' +
      '<div class="portal-item-meta">' + escapeHTML(item.category) + ' · Dikirim ' + escapeHTML(dateLabel(item.created_at)) +
      '<br>Penulis: ' + escapeHTML(item.author_name) + '</div></div>' +
      '<span class="portal-status ' + escapeHTML(item.status) + '">' + escapeHTML(statusLabel(item.status)) + '</span></div>' +
      '<p class="portal-article-desc">' + escapeHTML(item.description) + '</p>' + tagLine + note +
      '<div class="portal-item-actions">' + fileLink + '</div></article>';
  }));
  container.innerHTML = cards.join("");
  showMessage($("#list-message"), "");
}

async function initDashboard() {
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
    $("#upload-submit").disabled = true;
    $("#my-journals").innerHTML = '<div class="portal-empty">Backend belum aktif. Selesaikan konfigurasi Supabase terlebih dahulu.</div>';
    return;
  }

  const { data: sessionData } = await window.ljSupabase.auth.getSession();
  currentUser = sessionData.session?.user || null;
  if (!currentUser) {
    window.location.replace("login.html");
    return;
  }

  $("#user-email").textContent = currentUser.email || "Akun LightJurnal";
  const { data: profile } = await window.ljSupabase
    .from("profiles").select("display_name").eq("id", currentUser.id).maybeSingle();
  profileName = (profile?.display_name || "").trim();
  $("#author-name").value = profileName || (currentUser.email || "").split("@")[0];

  window.ljSupabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") window.location.replace("login.html");
  });

  $("#signout-button")?.addEventListener("click", async () => {
    $("#signout-button").disabled = true;
    const { error } = await window.ljSupabase.auth.signOut();
    if (error) {
      $("#signout-button").disabled = false;
      showMessage($("#list-message"), error.message, "error");
    } else {
      window.location.replace("login.html");
    }
  });

  $("#refresh-list")?.addEventListener("click", () => loadMyJournals());
  $("#upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#upload-submit");
    const message = $("#upload-message");
    const file = $("#pdf").files?.[0];
    if (!file) {
      showMessage(message, "Pilih satu berkas PDF terlebih dahulu.", "error");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
      showMessage(message, "Berkas harus berupa PDF.", "error");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      showMessage(message, "Ukuran PDF melebihi batas 25 MB.", "error");
      return;
    }

    const title = $("#title").value.trim();
    const authorName = $("#author-name").value.trim();
    const description = $("#description").value.trim();
    if (title.length < 3 || authorName.length < 2 || description.length < 10) {
      showMessage(message, "Lengkapi judul, nama penulis, dan ringkasan sesuai batas karakter.", "error");
      return;
    }

    const category = $("#category").value;
    const tags = $("#tags").value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8).map((tag) => tag.slice(0, 40));
    const fileId = window.crypto?.randomUUID ? window.crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2);
    const filePath = currentUser.id + "/" + fileId + ".pdf";
    button.disabled = true;
    showMessage(message, "Mengunggah PDF dan mengirim metadata…");

    try {
      const { error: uploadError } = await window.ljSupabase.storage
        .from("journal-pdfs")
        .upload(filePath, file, { contentType: "application/pdf", cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await window.ljSupabase.from("journals").insert({
        user_id: currentUser.id,
        title,
        author_name: authorName,
        category,
        description,
        tags,
        type: "Jurnal",
        file_path: filePath,
        original_filename: file.name,
        status: "pending",
        admin_note: null,
        reviewed_at: null
      });
      if (insertError) {
        await window.ljSupabase.storage.from("journal-pdfs").remove([filePath]);
        throw insertError;
      }

      $("#upload-form").reset();
      $("#author-name").value = profileName || (currentUser.email || "").split("@")[0];
      showMessage(message, "Jurnal berhasil dikirim dan sekarang menunggu peninjauan admin.", "success");
      await loadMyJournals();
    } catch (error) {
      showMessage(message, error?.message || "Unggahan gagal. Coba lagi setelah memeriksa koneksi dan kebijakan Storage.", "error");
    } finally {
      button.disabled = false;
    }
  });

  await loadMyJournals();
}

document.addEventListener("DOMContentLoaded", initDashboard);