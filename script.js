const APPROVED_ARTICLES = [];
let activeCategory = "Semua";
let activeQuery = "";
let backendState = "loading";
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

function categoryClass(category) {
  return ({ Pendidikan: "education", Teknologi: "tech", Sosial: "social", Kesehatan: "health" })[category] || "other";
}

function articleCard(article, index) {
  const coverClass = "cover-" + categoryClass(article.category);
  const tags = (article.tags || []).slice(0, 3)
    .map((tag) => '<span class="tag">' + escapeHTML(tag) + "</span>").join("");
  const link = article.url
    ? '<a class="read-link" href="' + escapeHTML(article.url) + '" target="_blank" rel="noopener noreferrer">Baca jurnal ↗</a>'
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
    escapeHTML(article.author || "Penulis") + '</span>' + link + '</div></div></article>';
}

function emptyStateCopy(list) {
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
  if (!list.length) emptyStateCopy(list);
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
      .select("id,title,author_name,category,description,tags,type,file_path,created_at,status")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const mapped = await Promise.all((data || []).map(async (item) => {
      const { data: signed } = await window.ljSupabase.storage
        .from("journal-pdfs").createSignedUrl(item.file_path, 86400);
      return {
        id: item.id,
        title: item.title,
        author: item.author_name,
        category: item.category,
        description: item.description,
        tags: item.tags || [],
        type: item.type || "Jurnal",
        date: item.created_at,
        url: signed?.signedUrl || ""
      };
    }));
    APPROVED_ARTICLES.splice(0, APPROVED_ARTICLES.length, ...mapped);
    backendState = "ready";
  } catch (error) {
    console.error("LightJurnal: gagal memuat koleksi yang disetujui.", error);
    backendState = "error";
  }
  renderArticles();
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