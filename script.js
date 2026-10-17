const APPROVED_ARTICLES = [];
let activeCategory = "Semua";
let activeQuery = "";
let backendState = "loading";
let discussionUser = null;
let discussionProfile = null;
let activeJournalId = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function prettyDate(value) {
  if (!value) return "Tanpa tanggal";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric"
  }).format(date);
}

function dateTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function initials(value) {
  const words = String(value || "LightJurnal").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase("id") || "LJ";
}

function safeAvatar(value) {
  const url = String(value || "");
  return /^https:\/\//i.test(url) ? url : "";
}

function categoryClass(category) {
  return ({ Pendidikan: "education", Teknologi: "tech", Sosial: "social", Kesehatan: "health" })[category] || "other";
}

function articleCard(article, index) {
  const coverClass = "cover-" + categoryClass(article.category);
  const tags = (article.tags || []).slice(0, 3)
    .map((tag) => '<span class="tag">' + escapeHTML(tag) + "</span>").join("");
  const pdfActions = article.filePath
    ? '<span class="pdf-card-actions"><button type="button" class="pdf-action" data-read-pdf="' + escapeHTML(article.id) + '">Baca PDF ↗</button><button type="button" class="pdf-action pdf-action-secondary" data-download-pdf="' + escapeHTML(article.id) + '">Unduh ↓</button></span>'
    : '<span class="read-link">PDF belum tersedia</span>';
  const symbol = ({ Pendidikan: "✳", Teknologi: "⌘", Sosial: "◌", Kesehatan: "✚", Lainnya: "¶" })[article.category] || "¶";
  return '<article class="article-card">' +
    '<div class="card-cover ' + coverClass + '"><div class="cover-top">' +
    '<span class="cover-symbol">' + symbol + '</span><span class="cover-index">LJ. / ' +
    String(index + 1).padStart(2, "0") + '</span></div><div class="cover-title">' +
    escapeHTML(article.category || "Jurnal") + '</div></div>' +
    '<div class="card-body"><div class="card-meta"><span class="category-label">' +
    escapeHTML(article.category || "Lainnya") + '</span><span class="meta-dot"></span><span class="card-date">' +
    escapeHTML(prettyDate(article.date)) + '</span></div><h3 class="card-title">' +
    escapeHTML(article.title) + '</h3><p class="card-description">' +
    escapeHTML(article.description || "Belum ada ringkasan untuk jurnal ini.") +
    '</p><div class="tag-list">' + tags + '</div><div class="card-footer"><span class="author">' +
    escapeHTML(article.author || "Penulis") + '</span><span class="card-actions">' + pdfActions +
    '<button class="card-comment-link" type="button" data-journal-comments="' + escapeHTML(article.id) + '" aria-label="Buka komentar untuk ' + escapeHTML(article.title) + '">Komentar <span aria-hidden="true">↗</span></button></span></div></div></article>';
}

function emptyStateCopy() {
  if (activeQuery || activeCategory !== "Semua") {
    $("#empty-title").textContent = "Tidak ada hasil yang cocok";
    $("#empty-copy").textContent = "Coba kata kunci lain atau hapus filter pencarian.";
    return;
  }
  if (backendState === "unconfigured") {
    $("#empty-title").textContent = "Koleksi belum terhubung";
    $("#empty-copy").textContent = "Situs perlu disambungkan ke Supabase oleh pengelola. Lihat panduan konfigurasi di repository.";
  } else if (backendState === "error") {
    $("#empty-title").textContent = "Koleksi belum dapat dimuat";
    $("#empty-copy").textContent = "Periksa koneksi backend atau hubungi pengelola situs.";
  } else {
    $("#empty-title").textContent = "Belum ada jurnal yang dipublikasikan";
    $("#empty-copy").textContent = "Jurnal yang sudah disetujui admin akan muncul di sini.";
  }
}

function renderArticles() {
  const grid = $("#article-grid");
  if (!grid) return;
  let list = APPROVED_ARTICLES.filter((article) =>
    activeCategory === "Semua" || article.category === activeCategory
  );
  if (activeQuery) {
    const query = activeQuery.toLocaleLowerCase("id");
    list = list.filter((article) => [
      article.title, article.category, article.author, article.description, article.type,
      ...(article.tags || [])
    ].join(" ").toLocaleLowerCase("id").includes(query));
  }
  const sort = $("#sort-select")?.value || "newest";
  list.sort((a, b) => sort === "az"
    ? a.title.localeCompare(b.title, "id")
    : sort === "oldest"
      ? String(a.date || "").localeCompare(String(b.date || ""))
      : String(b.date || "").localeCompare(String(a.date || "")));

  grid.innerHTML = list.map(articleCard).join("");
  $("#result-count").textContent = list.length + " karya";
  $("#empty-state").hidden = list.length !== 0;
  grid.hidden = list.length === 0;
  $("#collection-footnote").textContent = activeQuery || activeCategory !== "Semua"
    ? "Hasil yang sesuai dengan filter kamu"
    : "Jurnal yang telah disetujui admin";
  if (!list.length) emptyStateCopy();
}

function setQuery(query) {
  activeQuery = query.trim();
  const input = $("#search-input");
  if (input) input.value = query;
  renderArticles();
}

async function loadApprovedArticles() {
  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    backendState = "unconfigured";
    renderArticles();
    return;
  }
  try {
    const { data, error } = await window.ljSupabase
      .from("journals")
      .select("id,title,author_name,category,description,tags,type,file_path,original_filename,created_at,status")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const mapped = (data || []).map((item) => ({
      id: item.id,
      title: item.title,
      author: item.author_name,
      category: item.category,
      description: item.description,
      tags: item.tags || [],
      type: item.type || "Jurnal",
      date: item.created_at,
      filePath: item.file_path,
      fileName: item.original_filename || "jurnal.pdf"
    }));
    APPROVED_ARTICLES.splice(0, APPROVED_ARTICLES.length, ...mapped);
    backendState = "ready";
  } catch (error) {
    console.error("LightJurnal: gagal memuat koleksi yang disetujui.", error);
    backendState = "error";
  }
  renderArticles();
}


function setPdfActionMessage(message) {
  const notice = $("#pdf-action-message");
  if (!notice) return;
  notice.textContent = message || "";
  notice.hidden = !message;
}

async function createArticlePdfUrl(article, download = false) {
  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    throw new Error("Layanan PDF belum terhubung.");
  }
  if (!article?.filePath) throw new Error("Berkas PDF tidak ditemukan.");
  const options = download ? { download: article.fileName || true } : undefined;
  const { data, error } = await window.ljSupabase.storage
    .from("journal-pdfs")
    .createSignedUrl(article.filePath, 300, options);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Tautan PDF tidak tersedia.");
  return data.signedUrl;
}

let pdfJsImportPromise = null;
let pdfViewerGeneration = 0;
let activePdfLoadTask = null;
let activePdfDocument = null;

async function loadPdfJs() {
  if (!pdfJsImportPromise) {
    pdfJsImportPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs")
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
        return pdfjsLib;
      })
      .catch((error) => {
        pdfJsImportPromise = null;
        throw error;
      });
  }
  return pdfJsImportPromise;
}

function disposeActivePdf() {
  if (activePdfLoadTask) {
    activePdfLoadTask.destroy().catch(() => {});
    activePdfLoadTask = null;
  }
  if (activePdfDocument) {
    activePdfDocument.destroy().catch(() => {});
    activePdfDocument = null;
  }
}

async function renderPdfPages(pdfDocument, generation, pages, status, dialog) {
  const totalPages = pdfDocument.numPages;
  pages.replaceChildren();
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    if (generation !== pdfViewerGeneration || !dialog.open) return;
    status.textContent = "Merender halaman " + pageNumber + " dari " + totalPages + "…";
    const page = await pdfDocument.getPage(pageNumber);
    if (generation !== pdfViewerGeneration || !dialog.open) {
      page.cleanup();
      return;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(1, pages.clientWidth - 24);
    const scale = Math.min(availableWidth / baseViewport.width, 1.75);
    const viewport = page.getViewport({ scale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 1.5);
    const pageShell = document.createElement("section");
    pageShell.className = "pdf-rendered-page";
    pageShell.setAttribute("aria-label", "Halaman " + pageNumber);
    const pageLabel = document.createElement("div");
    pageLabel.className = "pdf-rendered-page-label";
    pageLabel.textContent = "Halaman " + pageNumber;
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-rendered-canvas";
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = viewport.width + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    pageShell.append(pageLabel, canvas);
    pages.append(pageShell);

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Browser ini tidak dapat menampilkan kanvas PDF.");
    await page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
      background: "#ffffff"
    }).promise;
    page.cleanup();
  }
  if (generation === pdfViewerGeneration && dialog.open) {
    status.textContent = "PDF siap dibaca · " + totalPages + " halaman.";
  }
}

async function openArticlePdf(article) {
  const dialog = $("#pdf-viewer-dialog");
  const pages = $("#pdf-viewer-pages");
  const title = $("#pdf-viewer-title");
  const status = $("#pdf-viewer-status");
  const openLink = $("#pdf-open-new-tab");
  const downloadLink = $("#pdf-download-link");
  if (!dialog || !pages || !status || !openLink || !downloadLink) return;

  const generation = ++pdfViewerGeneration;
  disposeActivePdf();
  title.textContent = article.title || "Pratinjau PDF";
  status.textContent = "Menyiapkan isi PDF…";
  pages.replaceChildren();
  pages.scrollTop = 0;
  openLink.hidden = true;
  downloadLink.hidden = true;
  openLink.removeAttribute("href");
  downloadLink.removeAttribute("href");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");

  try {
    const [viewUrl, downloadUrl, pdfjsLib] = await Promise.all([
      createArticlePdfUrl(article),
      createArticlePdfUrl(article, true),
      loadPdfJs()
    ]);
    if (generation !== pdfViewerGeneration || !dialog.open) return;

    openLink.href = viewUrl;
    downloadLink.href = downloadUrl;
    downloadLink.download = article.fileName || "jurnal.pdf";
    openLink.hidden = false;
    downloadLink.hidden = false;
    status.textContent = "Mengambil isi dokumen…";

    const loadingTask = pdfjsLib.getDocument({
      url: viewUrl,
      disableRange: true,
      disableStream: true,
      useSystemFonts: true,
      isEvalSupported: false
    });
    activePdfLoadTask = loadingTask;
    const pdfDocument = await loadingTask.promise;
    if (generation !== pdfViewerGeneration || !dialog.open) {
      await pdfDocument.destroy();
      return;
    }
    activePdfLoadTask = null;
    activePdfDocument = pdfDocument;
    await renderPdfPages(pdfDocument, generation, pages, status, dialog);
  } catch (error) {
    if (generation !== pdfViewerGeneration || !dialog.open) return;
    console.error("LightJurnal: pratinjau PDF gagal dirender.", error);
    pages.replaceChildren();
    const help = document.createElement("p");
    help.className = "pdf-render-error";
    help.textContent = "PDF belum bisa ditampilkan langsung. Periksa koneksi lalu coba lagi, atau gunakan tombol Unduh PDF di bawah.";
    pages.append(help);
    status.textContent = "Pratinjau gagal dimuat.";
  }
}

async function downloadArticlePdf(article, button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Menyiapkan…";
  setPdfActionMessage("Menyiapkan unduhan PDF…");
  try {
    const url = await createArticlePdfUrl(article, true);
    setPdfActionMessage("");
    // The signed URL is created on demand and asks Storage to return the file as an attachment.
    window.location.assign(url);
  } catch (error) {
    setPdfActionMessage(error?.message || "PDF belum dapat diunduh. Periksa koneksi lalu coba lagi.");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function updateAccountLinks() {
  const accountLink = $("#account-link");
  const mobileAccountLink = $("#mobile-account-link");
  const name = discussionProfile?.display_name?.trim() || (discussionUser?.email || "").split("@")[0] || "";
  if (accountLink) {
    accountLink.href = discussionUser ? "dashboard.html#profil" : "login.html";
    accountLink.textContent = discussionUser ? (name ? "Akun · " + name : "Akun saya") : "Masuk akun";
    accountLink.title = discussionUser ? "Buka profil LightJurnal" : "Masuk ke akun LightJurnal";
  }
  if (mobileAccountLink) {
    mobileAccountLink.href = discussionUser ? "dashboard.html#profil" : "login.html";
    mobileAccountLink.textContent = discussionUser ? "Profil saya · " + (name || "Akun LightJurnal") : "Masuk akun";
  }
}

function showAuthState() {
  const isSignedIn = Boolean(discussionUser);
  const globalForm = $("#discussion-form");
  const globalAuth = $("#discussion-auth-required");
  if (globalForm) globalForm.hidden = !isSignedIn;
  if (globalAuth) globalAuth.hidden = isSignedIn;
  const journalForm = $("#journal-comment-form");
  const journalAuth = $("#journal-comments-auth");
  if (journalForm) journalForm.hidden = !isSignedIn;
  if (journalAuth) journalAuth.hidden = isSignedIn;
  updateAccountLinks();
}

function commentAvatar(comment) {
  const name = escapeHTML(comment.author_name || "Pengguna LightJurnal");
  const avatar = safeAvatar(comment.author_avatar);
  return avatar
    ? '<span class="discussion-avatar has-image"><img src="' + escapeHTML(avatar) + '" alt="" loading="lazy"></span>'
    : '<span class="discussion-avatar">' + escapeHTML(initials(name)) + '</span>';
}

function renderCommentList(comments, target) {
  if (!comments?.length) return '<div class="discussion-empty"><span>✳</span><strong>Jadilah yang pertama berdiskusi.</strong><p>Bagikan tanggapan yang membantu pembaca lain memahami karya ini.</p></div>';
  return comments.map((comment) => {
    const ownComment = discussionUser && comment.author_id === discussionUser.id;
    const deleteButton = ownComment
      ? '<button type="button" class="comment-delete" data-delete-comment="' + escapeHTML(comment.id) + '" data-comment-target="' + escapeHTML(target) + '">Hapus</button>'
      : "";
    return '<article class="discussion-comment">' + commentAvatar(comment) +
      '<div class="discussion-comment-main"><div class="discussion-comment-head"><strong>' + escapeHTML(comment.author_name || "Pengguna LightJurnal") +
      '</strong><time datetime="' + escapeHTML(comment.created_at || "") + '">' + escapeHTML(dateTimeLabel(comment.created_at)) +
      '</time></div><p>' + escapeHTML(comment.body) + '</p>' + (deleteButton ? '<div class="discussion-comment-actions">' + deleteButton + '</div>' : '') +
      '</div></article>';
  }).join("");
}

async function fetchComments(journalId = null) {
  let query = window.ljSupabase.from("comments")
    .select("id,journal_id,author_id,author_name,author_avatar,body,created_at")
    .order("created_at", { ascending: true }).limit(100);
  query = journalId ? query.eq("journal_id", journalId) : query.is("journal_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadGlobalDiscussion() {
  const feed = $("#discussion-feed");
  if (!feed) return;
  feed.innerHTML = '<div class="discussion-empty">Memuat obrolan pembaca…</div>';
  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    feed.innerHTML = '<div class="discussion-empty"><strong>Ruang obrolan belum tersambung.</strong><p>Pengelola perlu mengaktifkan backend Supabase.</p></div>';
    return;
  }
  try {
    feed.innerHTML = renderCommentList(await fetchComments(null), "global");
    feed.scrollTop = feed.scrollHeight;
  } catch (error) {
    console.error("LightJurnal: gagal memuat obrolan publik.", error);
    feed.innerHTML = '<div class="discussion-empty"><strong>Obrolan belum dapat dimuat.</strong><p>Pastikan pengelola sudah menjalankan migrasi komentar di Supabase.</p></div>';
  }
}

async function loadJournalDiscussion(journalId) {
  const feed = $("#journal-comment-feed");
  if (!feed) return;
  feed.innerHTML = '<div class="discussion-empty">Memuat komentar…</div>';
  try {
    feed.innerHTML = renderCommentList(await fetchComments(journalId), journalId);
    feed.scrollTop = feed.scrollHeight;
  } catch (error) {
    console.error("LightJurnal: gagal memuat komentar jurnal.", error);
    feed.innerHTML = '<div class="discussion-empty"><strong>Komentar belum dapat dimuat.</strong><p>Pengelola perlu mengaktifkan skema komentar Supabase.</p></div>';
  }
}

async function submitComment(event, journalId, textarea, message, submitButton) {
  event.preventDefault();
  const body = textarea.value.trim();
  if (!discussionUser) {
    showAuthState();
    return;
  }
  if (!body) {
    message.textContent = "Tulis tanggapan sebelum mengirim.";
    message.className = "portal-message error";
    return;
  }
  if (body.length > 2000) {
    message.textContent = "Komentar maksimal 2.000 karakter.";
    message.className = "portal-message error";
    return;
  }
  submitButton.disabled = true;
  message.textContent = "Mengirim tanggapan…";
  message.className = "portal-message";
  try {
    const { error } = await window.ljSupabase.from("comments").insert({
      journal_id: journalId || null,
      author_id: discussionUser.id,
      body
    });
    if (error) throw error;
    textarea.value = "";
    message.textContent = "Tanggapan berhasil dikirim.";
    message.className = "portal-message success";
    if (journalId) await loadJournalDiscussion(journalId);
    else await loadGlobalDiscussion();
    window.setTimeout(() => { if (message) message.textContent = ""; }, 2800);
  } catch (error) {
    message.textContent = /relation .*comments.* does not exist|schema cache/i.test(error?.message || "")
      ? "Fitur komentar belum aktif. Jalankan supabase-social-profile-migration.sql di Supabase SQL Editor."
      : (error?.message || "Komentar gagal dikirim. Periksa koneksi dan aturan akses Supabase.");
    message.className = "portal-message error";
  } finally {
    submitButton.disabled = false;
  }
}

function subscribeToLiveComments() {
  if (!window.ljSupabaseConfigured || !window.ljSupabase) return;
  window.ljSupabase
    .channel("lightjurnal-live-comments")
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, (payload) => {
      const changed = payload.new || payload.old || {};
      if (changed.journal_id == null) loadGlobalDiscussion();
      else if (activeJournalId && changed.journal_id === activeJournalId) loadJournalDiscussion(activeJournalId);
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("LightJurnal: pembaruan realtime komentar belum tersedia. Memuat komentar tetap dapat dilakukan manual.");
      }
    });
}

async function loadAccountContext() {
  if (!window.ljSupabaseConfigured || !window.ljSupabase) {
    showAuthState();
    return;
  }
  const { data: sessionData } = await window.ljSupabase.auth.getSession();
  discussionUser = sessionData.session?.user || null;
  discussionProfile = null;
  if (discussionUser) {
    const { data } = await window.ljSupabase.from("profiles")
      .select("display_name,avatar_url").eq("id", discussionUser.id).maybeSingle();
    discussionProfile = data || { display_name: discussionUser.user_metadata?.display_name || "" };
  }
  showAuthState();
  window.ljSupabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      discussionUser = session?.user || null;
      discussionProfile = null;
      showAuthState();
      // Keep data requests outside the Supabase auth callback to avoid lock contention.
      window.setTimeout(async () => {
        if (discussionUser) {
          const { data } = await window.ljSupabase.from("profiles")
            .select("display_name,avatar_url").eq("id", discussionUser.id).maybeSingle();
          discussionProfile = data || null;
        }
        showAuthState();
        await loadGlobalDiscussion();
      }, 0);
    }
  });
}

function openJournalComments(journalId) {
  const article = APPROVED_ARTICLES.find((item) => item.id === journalId);
  if (!article) return;
  activeJournalId = journalId;
  $("#journal-comments-title").textContent = "Komentar pembaca";
  $("#journal-comments-subtitle").textContent = article.title;
  $("#journal-comment-body").value = "";
  $("#journal-comment-message").textContent = "";
  showAuthState();
  const dialog = $("#journal-comments-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  loadJournalDiscussion(journalId);
}

function initTheme() {
  const button = $("#theme-toggle");
  const icon = $("#theme-icon");
  function sync() {
    const dark = document.documentElement.dataset.theme === "dark";
    if (icon) icon.textContent = dark ? "☀" : "☾";
    if (button) button.setAttribute("aria-label", dark ? "Aktifkan mode terang" : "Aktifkan mode gelap");
  }
  button?.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    if (dark) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = "dark";
    try { localStorage.setItem("lj-theme", dark ? "light" : "dark"); } catch (_) {}
    sync();
  });
  sync();
}

function init() {
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();
  initTheme();
  renderArticles();
  loadApprovedArticles();
  loadAccountContext().then(() => {
    loadGlobalDiscussion();
    subscribeToLiveComments();
  });

  $("#search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    setQuery($("#search-input").value);
    $("#artikel").scrollIntoView({ behavior: "smooth" });
  });
  $("#search-input")?.addEventListener("input", (event) => {
    activeQuery = event.target.value;
    renderArticles();
  });
  $$(".quick-tag").forEach((button) => button.addEventListener("click", () => {
    setQuery(button.dataset.query || "");
    $("#artikel").scrollIntoView({ behavior: "smooth" });
  }));
  $$(".filter-chip").forEach((button) => button.addEventListener("click", () => {
    activeCategory = button.dataset.category || "Semua";
    $$(".filter-chip").forEach((item) => item.classList.toggle("selected", item === button));
    renderArticles();
  }));
  $("#sort-select")?.addEventListener("change", renderArticles);
  $("#article-grid")?.addEventListener("click", (event) => {
    const readButton = event.target.closest("[data-read-pdf]");
    if (readButton) {
      const article = APPROVED_ARTICLES.find((item) => String(item.id) === readButton.dataset.readPdf);
      if (article) void openArticlePdf(article);
      return;
    }
    const downloadButton = event.target.closest("[data-download-pdf]");
    if (downloadButton) {
      const article = APPROVED_ARTICLES.find((item) => String(item.id) === downloadButton.dataset.downloadPdf);
      if (article) void downloadArticlePdf(article, downloadButton);
      return;
    }
    const commentButton = event.target.closest("[data-journal-comments]");
    if (commentButton) openJournalComments(commentButton.dataset.journalComments);
  });

  $("#discussion-form")?.addEventListener("submit", (event) =>
    submitComment(event, null, $("#discussion-body"), $("#discussion-message"), $("#discussion-submit")));
  $("#journal-comment-form")?.addEventListener("submit", (event) =>
    submitComment(event, activeJournalId, $("#journal-comment-body"), $("#journal-comment-message"), $("#journal-comment-submit")));
  $("#close-pdf-viewer")?.addEventListener("click", () => $("#pdf-viewer-dialog").close());
  $("#pdf-viewer-dialog")?.addEventListener("close", () => {
    pdfViewerGeneration += 1;
    disposeActivePdf();
    $("#pdf-viewer-pages")?.replaceChildren();
  });
  $("#pdf-viewer-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("#pdf-viewer-dialog")) $("#pdf-viewer-dialog").close();
  });
  $("#close-journal-comments")?.addEventListener("click", () => $("#journal-comments-dialog").close());
  $("#journal-comments-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("#journal-comments-dialog")) $("#journal-comments-dialog").close();
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-comment]");
    if (!button || !discussionUser || !window.ljSupabase) return;
    if (!window.confirm("Hapus komentar ini?")) return;
    button.disabled = true;
    try {
      const { error } = await window.ljSupabase.from("comments").delete()
        .eq("id", button.dataset.deleteComment).eq("author_id", discussionUser.id);
      if (error) throw error;
      if (button.dataset.commentTarget === "global") await loadGlobalDiscussion();
      else if (activeJournalId) await loadJournalDiscussion(activeJournalId);
    } catch (error) {
      window.alert(error?.message || "Komentar belum dapat dihapus.");
      button.disabled = false;
    }
  });

  const menu = $("#menu-toggle");
  const nav = $("#mobile-nav");
  menu?.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.hidden = !open;
    menu.textContent = open ? "✕" : "☰";
  });
  $$("#mobile-nav a").forEach((anchor) => anchor.addEventListener("click", () => {
    nav.hidden = true;
    menu?.setAttribute("aria-expanded", "false");
    if (menu) menu.textContent = "☰";
  }));
}

document.addEventListener("DOMContentLoaded", init);
