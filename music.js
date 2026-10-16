/* LightJurnal Music: YouTube Data API + official IFrame Player API. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const KEY_STATE = "lj-music-state-v1";
  const KEY_CACHE = "lj-music-search-cache-v1";
  const PAGE_SIZE = 10;
  const SEARCH_DEBOUNCE_MS = 450;
  const CACHE_TTL = 5 * 60 * 1000;
  const config = window.LIGHTJURNAL_YOUTUBE_CONFIG || {};
  const apiKey = String(config.apiKey || "").trim();
  let nextPageToken = "";
  let lastQuery = "";
  let searchTimer = 0;
  let requestController = null;
  let searchGeneration = 0;
  let player = null;
  let playerReady = false;
  let currentVideo = null;
  let queue = [];
  let history = [];
  let playbackStatus = "Siap diputar";
  let progressTimer = 0;
  let isSeeking = false;
  let lastPlayerError = 0;
  let lastVolume = 70;

  const ui = {
    form: $("#music-search-form"), input: $("#music-search-input"), searchButton: $("#music-search-button"),
    feedback: $("#music-feedback"), results: $("#music-results"), resultsSubtitle: $("#music-results-subtitle"),
    count: $("#music-result-count"), loadMore: $("#music-load-more"), playerPlaceholder: $("#music-player-placeholder"),
    nowTitle: $("#music-now-title"), nowChannel: $("#music-now-channel"), nowThumb: $("#music-now-thumb"),
    status: $("#music-playback-state"), liveDot: $("#music-live-dot"), progress: $("#music-progress-range"),
    currentTime: $("#music-current-time"), duration: $("#music-duration"), volume: $("#music-volume-range"),
    volumeLabel: $("#music-volume-label"), playPause: $("#music-play-pause"), previous: $("#music-previous"),
    next: $("#music-next"), queue: $("#music-queue"), history: $("#music-history"),
    mini: $("#music-mini-player"), miniThumb: $("#music-mini-thumb"), miniTitle: $("#music-mini-title"),
    miniState: $("#music-mini-state"), miniPlay: $("#music-mini-play")
  };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function getThumb(video, size = "medium") {
    const thumbs = video?.snippet?.thumbnails || video?.thumbnails || {};
    return thumbs[size]?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url ||
      (video?.videoId ? "https://i.ytimg.com/vi/" + encodeURIComponent(video.videoId) + "/mqdefault.jpg" : "");
  }
  function videoId(video) { return video?.videoId || video?.id?.videoId || ""; }
  function normalizeVideo(item) {
    const id = videoId(item);
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return {
      videoId: id,
      title: String(item.title || item.snippet?.title || "Video YouTube"),
      channelTitle: String(item.channelTitle || item.snippet?.channelTitle || "Kanal YouTube"),
      description: String(item.description || item.snippet?.description || ""),
      publishedAt: item.publishedAt || item.snippet?.publishedAt || "",
      thumbnails: item.thumbnails || item.snippet?.thumbnails || {},
      url: "https://www.youtube.com/watch?v=" + encodeURIComponent(id)
    };
  }
  function thumbMarkup(video, size = "medium") {
    const src = getThumb(video, size);
    return src ? '<img src="' + escapeHTML(src) + '" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">' : '<span>♪</span>';
  }
  function setFeedback(message, type = "") {
    ui.feedback.textContent = message;
    ui.feedback.className = "music-feedback" + (type ? " " + type : "");
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = String(whole % 60).padStart(2, "0");
    return mins + ":" + secs;
  }
  function safeLoadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY_STATE) || "{}");
      queue = Array.isArray(parsed.queue) ? parsed.queue.map(normalizeVideo).filter(Boolean).slice(0, 100) : [];
      history = Array.isArray(parsed.history) ? parsed.history.map(normalizeVideo).filter(Boolean).slice(0, 30) : [];
      lastVolume = Number.isFinite(parsed.volume) ? Math.max(0, Math.min(100, parsed.volume)) : 70;
    } catch (_) { queue = []; history = []; lastVolume = 70; }
    ui.volume.value = String(lastVolume);
    ui.volumeLabel.textContent = lastVolume + "%";
    renderQueue();
    renderHistory();
  }
  function saveState() {
    try { localStorage.setItem(KEY_STATE, JSON.stringify({ queue, history: history.slice(0,30), volume: lastVolume })); }
    catch (_) { setFeedback("Penyimpanan lokal tidak tersedia. Musik tetap dapat digunakan, tetapi antrean mungkin tidak tersimpan.", "error"); }
  }
  function getCache(query) {
    try {
      const cache = JSON.parse(sessionStorage.getItem(KEY_CACHE) || "{}");
      const item = cache[query.toLowerCase()];
      if (item && Date.now() - item.savedAt < CACHE_TTL) return item;
    } catch (_) {}
    return null;
  }
  function setCache(query, item) {
    try {
      const cache = JSON.parse(sessionStorage.getItem(KEY_CACHE) || "{}");
      cache[query.toLowerCase()] = { ...item, savedAt: Date.now() };
      const keys = Object.keys(cache);
      keys.sort((a,b) => (cache[b].savedAt || 0) - (cache[a].savedAt || 0));
      for (const key of keys.slice(20)) delete cache[key];
      sessionStorage.setItem(KEY_CACHE, JSON.stringify(cache));
    } catch (_) {}
  }
  function setSearching(isSearching) {
    ui.searchButton.disabled = isSearching;
    ui.searchButton.textContent = isSearching ? "Mencari…" : "Cari musik ↗";
    ui.loadMore.disabled = isSearching;
  }
  async function searchVideos(query, pageToken = "", append = false) {
    const trimmed = query.trim();
    if (!trimmed) { setFeedback("Masukkan judul lagu, nama penyanyi, atau kata kunci musik."); return; }
    if (!apiKey || apiKey === "YOUR_YOUTUBE_DATA_API_KEY") {
      setFeedback("Pencarian belum aktif karena API key belum diisi. Buka youtube-config.js di GitHub, masukkan YouTube Data API key, lalu simpan perubahan.", "error");
      ui.results.replaceChildren();
      ui.count.textContent = "0 video";
      ui.loadMore.hidden = true;
      return;
    }
    if (!append) {
      lastQuery = trimmed;
      nextPageToken = "";
      ui.results.replaceChildren();
      ui.resultsSubtitle.textContent = 'Mencari "' + trimmed + '"…';
    }
    const generation = ++searchGeneration;
    if (requestController) requestController.abort();
    requestController = new AbortController();
    setSearching(true);
    setFeedback("Sedang mencari video musik…");
    try {
      const params = new URLSearchParams({
        key: apiKey, part: "snippet", type: "video", q: trimmed,
        maxResults: String(PAGE_SIZE), safeSearch: "moderate", videoEmbeddable: "true",
        videoSyndicated: "true", fields: "nextPageToken,items(id/videoId,snippet(title,description,channelTitle,publishedAt,thumbnails))"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const cacheKey = trimmed + (pageToken ? "|"+pageToken : "");
      const cached = !append ? getCache(cacheKey) : null;
      let payload;
      if (cached) payload = cached.payload;
      else {
        const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString(), { signal: requestController.signal });
        payload = await response.json();
        if (!response.ok || payload.error) {
          const apiError = payload.error || {};
          const reason = apiError.errors?.[0]?.reason || "";
          if (response.status === 403 && /quota|dailyLimit/i.test(reason + " " + (apiError.message || ""))) {
            throw new Error("Kuota pencarian YouTube untuk hari ini mungkin sudah habis. Coba lagi nanti atau periksa Google Cloud Console.");
          }
          if (response.status === 403) throw new Error("Akses API ditolak. Periksa apakah YouTube Data API v3 aktif dan API key dibatasi untuk domain yang benar.");
          if (response.status === 400) throw new Error("Permintaan pencarian tidak valid. Periksa konfigurasi API key.");
          throw new Error(apiError.message || "Pencarian gagal (HTTP " + response.status + ").");
        }
        setCache(cacheKey, { payload });
      }
      if (generation !== searchGeneration) return;
      const items = (payload.items || []).map(normalizeVideo).filter(Boolean);
      nextPageToken = payload.nextPageToken || "";
      const existingIds = new Set([...ui.results.querySelectorAll("[data-video-id]")].map(el => el.dataset.videoId));
      const fresh = items.filter(item => !existingIds.has(item.videoId));
      fresh.forEach(item => ui.results.insertAdjacentHTML("beforeend", resultCard(item)));
      const total = ui.results.querySelectorAll(".music-result-card").length;
      ui.count.textContent = total + (total === 1 ? " video" : " video");
      ui.resultsSubtitle.textContent = 'Hasil untuk "' + trimmed + '"';
      ui.loadMore.hidden = !nextPageToken;
      if (!total) setFeedback("Tidak ada video yang cocok. Coba judul, nama artis, atau kata kunci yang berbeda.");
      else setFeedback("Pilih Putar untuk memulai video, atau Tambah antrean untuk menyimpannya.", "success");
    } catch (error) {
      if (error.name === "AbortError") return;
      if (generation !== searchGeneration) return;
      console.error("LightJurnal Music search error:", error);
      setFeedback(error.message || "Koneksi bermasalah. Periksa internet lalu coba lagi.", "error");
    } finally {
      if (generation === searchGeneration) setSearching(false);
    }
  }
  function resultCard(video) {
    return '<article class="music-result-card" data-video-id="' + escapeHTML(video.videoId) + '">' +
      '<div class="music-result-thumb">' + thumbMarkup(video, "medium") + '<span>YouTube</span></div>' +
      '<div class="music-result-info"><h3>' + escapeHTML(video.title) + '</h3><p>' + escapeHTML(video.channelTitle) + '</p>' +
      '<div class="music-result-actions"><button type="button" class="music-result-play" data-play-video="' + escapeHTML(video.videoId) + '">▶ Putar</button>' +
      '<button type="button" data-queue-video="' + escapeHTML(video.videoId) + '">＋ Antrean</button><a class="music-result-external" href="' + escapeHTML(video.url) + '" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div></div></article>';
  }
  function videoFromResultId(id) {
    const card = [...ui.results.querySelectorAll(".music-result-card")].find(el => el.dataset.videoId === id);
    if (!card) return null;
    return { videoId: id, title: card.querySelector("h3")?.textContent || "Video YouTube",
      channelTitle: card.querySelector(".music-result-info p")?.textContent || "Kanal YouTube",
      thumbnails: { medium: { url: card.querySelector("img")?.src || "" } }, url: "https://www.youtube.com/watch?v=" + encodeURIComponent(id) };
  }
  function renderQueue() {
    if (!queue.length) {
      ui.queue.innerHTML = '<div class="music-list-empty">Lagu yang kamu tambahkan akan muncul di sini.</div>';
      ui.next.disabled = true;
      return;
    }
    ui.queue.innerHTML = queue.map((video, index) => queueCard(video, "queue", index)).join("");
    ui.next.disabled = !queue.length;
  }
  function renderHistory() {
    if (!history.length) {
      ui.history.innerHTML = '<div class="music-list-empty">Riwayat lagu akan tersimpan di perangkat ini.</div>';
      ui.previous.disabled = true;
      return;
    }
    ui.history.innerHTML = history.slice(0,8).map((video, index) => queueCard(video, "history", index)).join("");
    ui.previous.disabled = history.length < 2;
  }
  function queueCard(video, kind, index) {
    return '<div class="music-queue-item"><div class="music-queue-thumb">' + thumbMarkup(video, "default") + '</div>' +
      '<div class="music-queue-meta"><strong title="' + escapeHTML(video.title) + '">' + escapeHTML(video.title) + '</strong><span>' + escapeHTML(video.channelTitle) + '</span></div>' +
      (kind === "queue" ? '<button type="button" data-remove-queue="' + index + '" aria-label="Hapus dari antrean" title="Hapus">✕</button>' :
        '<button type="button" data-play-history="' + index + '" aria-label="Putar lagu dari riwayat" title="Putar">▶</button>') + '</div>';
  }
  function addQueue(video) {
    if (!video) return;
    if (queue.some(item => item.videoId === video.videoId)) {
      setFeedback("Video tersebut sudah ada di antrean.", "success");
      return;
    }
    queue.push(video);
    saveState();
    renderQueue();
    setFeedback("Ditambahkan ke antrean: " + video.title, "success");
  }
  function addHistory(video) {
    if (!video) return;
    history = [video, ...history.filter(item => item.videoId !== video.videoId)].slice(0,30);
    saveState();
    renderHistory();
  }
  function updateCurrentUI(video) {
    currentVideo = video;
    if (!video) return;
    const title = video.title || "Video YouTube";
    ui.nowTitle.textContent = title;
    ui.nowChannel.textContent = video.channelTitle || "YouTube";
    ui.nowThumb.innerHTML = thumbMarkup(video, "default");
    ui.miniThumb.innerHTML = thumbMarkup(video, "default");
    ui.miniTitle.textContent = title;
    ui.mini.hidden = false;
    ui.playerPlaceholder.hidden = true;
    ui.playPause.disabled = false;
    ui.miniPlay.disabled = false;
    ui.volume.disabled = !playerReady;
    ui.progress.disabled = !playerReady;
    ui.previous.disabled = history.length < 2;
    ui.next.disabled = queue.length === 0;
    ui.miniState.textContent = playbackStatus;
    ui.status.textContent = playbackStatus;
  }
  function setStatus(status, isPlaying = false) {
    playbackStatus = status;
    ui.status.textContent = status;
    ui.miniState.textContent = status;
    ui.liveDot.classList.toggle("is-playing", isPlaying);
    ui.playPause.textContent = isPlaying ? "Ⅱ" : "▶";
    ui.miniPlay.textContent = isPlaying ? "Ⅱ" : "▶";
    ui.playPause.setAttribute("aria-label", isPlaying ? "Jeda" : "Putar");
    ui.miniPlay.setAttribute("aria-label", isPlaying ? "Jeda" : "Putar");
  }
  function loadPlayerApi() {
    if (window.YT?.Player) { createPlayer(); return; }
    if (document.querySelector('script[data-lj-youtube-iframe-api]')) return;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.ljYoutubeIframeApi = "true";
    script.onerror = () => setFeedback("Pemutar YouTube gagal dimuat. Periksa koneksi atau pemblokiran jaringan.", "error");
    document.head.appendChild(script);
  }
  window.onYouTubeIframeAPIReady = function () { createPlayer(); };
  function createPlayer() {
    if (player || !window.YT?.Player) return;
    player = new window.YT.Player("youtube-player", {
      width: "100%", height: "100%", videoId: currentVideo?.videoId || "",
      playerVars: { playsinline: 1, controls: 1, rel: 0, origin: window.location.origin },
      events: {
        onReady: event => {
          playerReady = true;
          event.target.setVolume(lastVolume);
          ui.volume.disabled = false;
          ui.progress.disabled = false;
          if (currentVideo) {
            event.target.loadVideoById(currentVideo.videoId);
            updateCurrentUI(currentVideo);
          }
          setStatus("Siap diputar");
          startProgressTimer();
        },
        onStateChange: event => {
          const states = window.YT.PlayerState;
          if (event.data === states.PLAYING) {
            setStatus("Sedang diputar", true);
            try {
              const data = event.target.getVideoData();
              if (data?.video_id && currentVideo?.videoId === data.video_id) {
                if (data.title) currentVideo.title = data.title;
                if (data.author) currentVideo.channelTitle = data.author;
              }
            } catch (_) {}
            updateCurrentUI(currentVideo);
          } else if (event.data === states.PAUSED) setStatus("Dijeda");
          else if (event.data === states.BUFFERING) setStatus("Memuat video…");
          else if (event.data === states.ENDED) { setStatus("Selesai"); playNext(); }
          else if (event.data === states.CUED) setStatus("Siap diputar");
        },
        onError: event => {
          const messages = {
            2: "ID video tidak valid.", 5: "Video ini tidak dapat diputar di pemutar HTML5.",
            100: "Video tidak ditemukan, dihapus, atau bersifat privat.",
            101: "Pemilik video tidak mengizinkan pemutaran tertanam.",
            150: "Pemilik video tidak mengizinkan pemutaran tertanam.",
            153: "YouTube tidak menerima identitas referer. Coba buka situs dari domain HTTPS resminya."
          };
          const message = messages[event.data] || "Video tidak dapat diputar. Bisa jadi ada pembatasan wilayah atau kebijakan pemutaran.";
          setStatus("Pemutaran gagal");
          setFeedback(message, "error");
          if (Date.now() - lastPlayerError > 1500) {
            lastPlayerError = Date.now();
            if (currentVideo) {
              const card = [...ui.results.querySelectorAll(".music-result-card")].find(el => el.dataset.videoId === currentVideo.videoId);
              if (card) card.dataset.playerError = "true";
            }
          }
        }
      }
    });
  }
  function playVideo(video, { addToHistory = true } = {}) {
    if (!video) return;
    currentVideo = video;
    playbackStatus = "Memuat video…";
    updateCurrentUI(video);
    if (addToHistory) addHistory(video);
    ui.playerPlaceholder.hidden = true;
    setStatus("Memuat video…");
    if (!playerReady) {
      loadPlayerApi();
      setFeedback("Menyiapkan pemutar YouTube…", "success");
      return;
    }
    try {
      player.loadVideoById(video.videoId);
      player.setVolume(lastVolume);
      setStatus("Memuat video…");
      $("#music-player-frame").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      console.error("LightJurnal Music player error:", error);
      setFeedback("Pemutar belum siap. Coba tekan Putar sekali lagi.", "error");
    }
  }
  function playNext() {
    if (queue.length) {
      const nextVideo = queue.shift();
      saveState();
      renderQueue();
      playVideo(nextVideo);
    } else {
      setStatus("Antrean selesai");
      ui.playPause.disabled = false;
      ui.miniPlay.disabled = false;
    }
  }
  function playPrevious() {
    if (history.length < 2) return;
    const previousVideo = history[1];
    history = history.slice(0, 1).concat(history.slice(2));
    saveState();
    renderHistory();
    playVideo(previousVideo, { addToHistory: false });
  }
  function togglePlayPause() {
    if (!currentVideo) {
      setFeedback("Pilih lagu dari hasil pencarian terlebih dahulu.");
      return;
    }
    if (!playerReady || !player) { loadPlayerApi(); setFeedback("Menyiapkan pemutar YouTube…"); return; }
    const state = player.getPlayerState();
    if (state === window.YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }
  function startProgressTimer() {
    if (progressTimer) window.clearInterval(progressTimer);
    progressTimer = window.setInterval(() => {
      if (!playerReady || !player || isSeeking) return;
      try {
        const duration = player.getDuration() || 0;
        const current = player.getCurrentTime() || 0;
        ui.currentTime.textContent = formatTime(current);
        ui.duration.textContent = formatTime(duration);
        ui.progress.value = duration ? String(Math.round(current / duration * 1000)) : "0";
        ui.progress.disabled = !duration;
      } catch (_) {}
    }, 700);
  }
  function initTheme() {
    const button = $("#music-theme-toggle");
    const icon = $("#music-theme-icon");
    const sync = () => { if (icon) icon.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾"; };
    button.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark";
      if (dark) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = "dark";
      try { localStorage.setItem("lj-theme", dark ? "light" : "dark"); } catch (_) {}
      sync();
    });
    sync();
  }
  function initMenu() {
    const button = $("#music-menu-toggle");
    const nav = $("#music-mobile-nav");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      nav.hidden = !open;
      button.textContent = open ? "✕" : "☰";
    });
    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      nav.hidden = true; button.setAttribute("aria-expanded", "false"); button.textContent = "☰";
    }));
  }
  function init() {
    $("#music-year").textContent = String(new Date().getFullYear());
    initTheme();
    initMenu();
    safeLoadState();
    ui.form.addEventListener("submit", event => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      searchVideos(ui.input.value);
    });
    ui.input.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      const query = ui.input.value.trim();
      if (query.length < 2) return;
      searchTimer = window.setTimeout(() => searchVideos(query), SEARCH_DEBOUNCE_MS);
    });
    document.querySelectorAll("[data-music-query]").forEach(button => button.addEventListener("click", () => {
      ui.input.value = button.dataset.musicQuery || "";
      searchVideos(ui.input.value);
    }));
    ui.results.addEventListener("click", event => {
      const playButton = event.target.closest("[data-play-video]");
      const queueButton = event.target.closest("[data-queue-video]");
      if (playButton) {
        const video = videoFromResultId(playButton.dataset.playVideo);
        if (video) playVideo(video);
      } else if (queueButton) {
        const video = videoFromResultId(queueButton.dataset.queueVideo);
        if (video) addQueue(video);
      }
    });
    ui.loadMore.addEventListener("click", () => {
      if (lastQuery && nextPageToken) searchVideos(lastQuery, nextPageToken, true);
    });
    ui.queue.addEventListener("click", event => {
      const remove = event.target.closest("[data-remove-queue]");
      if (!remove) return;
      queue.splice(Number(remove.dataset.removeQueue), 1);
      saveState(); renderQueue();
    });
    ui.history.addEventListener("click", event => {
      const button = event.target.closest("[data-play-history]");
      if (!button) return;
      const video = history[Number(button.dataset.playHistory)];
      if (video) playVideo(video);
    });
    $("#music-clear-queue").addEventListener("click", () => { queue = []; saveState(); renderQueue(); });
    $("#music-clear-history").addEventListener("click", () => { history = []; saveState(); renderHistory(); });
    ui.playPause.addEventListener("click", togglePlayPause);
    ui.miniPlay.addEventListener("click", togglePlayPause);
    ui.next.addEventListener("click", playNext);
    ui.previous.addEventListener("click", playPrevious);
    $("#music-mini-open").addEventListener("click", () => $("#music-player-frame").scrollIntoView({ behavior: "smooth", block: "center" }));
    ui.volume.addEventListener("input", () => {
      lastVolume = Number(ui.volume.value);
      ui.volumeLabel.textContent = lastVolume + "%";
      if (playerReady && player) player.setVolume(lastVolume);
      saveState();
    });
    ui.progress.addEventListener("pointerdown", () => { isSeeking = true; });
    ui.progress.addEventListener("pointerup", () => { isSeeking = false; });
    ui.progress.addEventListener("change", () => {
      if (!playerReady || !player) return;
      const duration = player.getDuration() || 0;
      if (duration) player.seekTo(Number(ui.progress.value) / 1000 * duration, true);
      isSeeking = false;
    });
    window.addEventListener("pagehide", () => {
      if (progressTimer) window.clearInterval(progressTimer);
      if (requestController) requestController.abort();
    });
    if (!apiKey || apiKey === "YOUR_YOUTUBE_DATA_API_KEY") {
      setFeedback("Ruang musik siap digunakan setelah YouTube Data API key dikonfigurasi. Petunjuk ada di file youtube-config.js.", "error");
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
