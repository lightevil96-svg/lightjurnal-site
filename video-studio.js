(function () {
  'use strict';
  const URL_KEY = 'lightjurnal.video.api-url.v1';
  const TOKEN_KEY = 'lightjurnal.video.api-token.session';
  let pollTimer = null;
  let videoUrl = null;

  const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const cfg = () => ({ url: (localStorage.getItem(URL_KEY) || '').trim().replace(/\/+$/, ''), token: sessionStorage.getItem(TOKEN_KEY) || '' });
  const status = (message, tone = 'neutral') => {
    const el = document.querySelector('#vs-status');
    if (el) { el.textContent = message; el.className = 'vs-status ' + tone; }
  };
  async function request(path, options = {}) {
    const c = cfg();
    if (!c.url) throw new Error('Masukkan URL API Alvareth-Bot.');
    const headers = Object.assign({}, options.headers || {});
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(c.url + '/api/video-studio' + path, Object.assign({}, options, { headers }));
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || 'Permintaan gagal (' + response.status + ').');
    return data;
  }
  const lines = () => (document.querySelector('#vs-scenes')?.value || '').split('\n').map(x => x.trim()).filter(Boolean);
  function timeline() {
    const target = document.querySelector('#vs-timeline');
    if (!target) return;
    const scenes = lines();
    target.innerHTML = scenes.length ? scenes.map((line, i) => '<div class="vs-track-scene"><small>SCENE ' + (i + 1) + '</small><strong>' + esc(line) + '</strong><span>4 sec</span></div>').join('') : '<div class="vs-track-empty">Tambahkan scene untuk melihat timeline.</div>';
    const duration = document.querySelector('#vs-duration');
    if (duration) duration.textContent = (scenes.length * 4) + ' detik · ' + scenes.length + ' scene';
  }
  function renderJobs(jobs) {
    const target = document.querySelector('#vs-jobs');
    if (!target) return;
    if (!jobs.length) { target.innerHTML = '<div class="vs-empty">Belum ada pekerjaan render.</div>'; return; }
    target.innerHTML = jobs.map(job => {
      const label = ({ queued: 'Menunggu', rendering: 'Merender', completed: 'Selesai', failed: 'Gagal' })[job.status] || job.status;
      return '<article class="vs-job"><div class="vs-job-main"><strong>' + esc(job.title) + '</strong><small>' + label + ' · ' + esc(job.mode) + ' · ' + esc(job.durationSeconds) + ' detik</small>' + (job.error ? '<p class="vs-error">' + esc(job.error) + '</p>' : '') + '<div class="vs-progress"><span style="width:' + Math.max(0, Math.min(100, Number(job.progress) || 0)) + '%"></span></div></div><div class="vs-job-side"><b>' + Number(job.progress || 0) + '%</b>' + (job.status === 'completed' ? '<button class="button button-secondary" data-vs-download="' + esc(job.id) + '">Unduh</button><button class="button button-secondary" data-vs-preview="' + esc(job.id) + '">Preview</button>' : '') + '</div></article>';
    }).join('');
  }
  async function refreshJobs() {
    try {
      const data = await request('/jobs');
      renderJobs(data.jobs || []);
      if (!(data.jobs || []).some(job => job.status === 'queued' || job.status === 'rendering') && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } catch (error) { if (pollTimer) clearInterval(pollTimer); pollTimer = null; status(error.message, 'error'); }
  }
  async function getVideo(id, preview) {
    try {
      const c = cfg();
      const response = await fetch(c.url + '/api/video-studio/jobs/' + encodeURIComponent(id) + '/download', { headers: { Authorization: 'Bearer ' + c.token } });
      if (!response.ok) { let msg = 'Unduhan gagal (' + response.status + ').'; try { msg = (await response.json()).error || msg; } catch {} throw new Error(msg); }
      const blob = await response.blob();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = URL.createObjectURL(blob);
      if (preview) {
        const wrap = document.querySelector('#vs-preview-wrap');
        const video = document.querySelector('#vs-video');
        const placeholder = document.querySelector('#vs-preview-placeholder');
        if (wrap && video) { wrap.hidden = false; video.src = videoUrl; video.load(); }
        if (placeholder) placeholder.hidden = true;
      } else {
        const a = document.createElement('a'); a.href = videoUrl; a.download = 'lightjurnal-' + id + '.mp4'; document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (error) { status(error.message, 'error'); }
  }
  async function connect() {
    const url = document.querySelector('#vs-api-url').value.trim().replace(/\/+$/, '');
    const token = document.querySelector('#vs-api-key').value.trim();
    if (!/^https:\/\//i.test(url) && !/^http:\/\/localhost(?::\d+)?$/i.test(url)) return status('Gunakan HTTPS (HTTP hanya untuk localhost).', 'error');
    localStorage.setItem(URL_KEY, url); sessionStorage.setItem(TOKEN_KEY, token);
    try {
      const response = await fetch(url + '/api/video-studio/health');
      const health = await response.json();
      if (!response.ok || health.status !== 'ok') throw new Error('API Alvareth-Bot tidak merespons.');
      if (!health.configured) throw new Error('VIDEO_STUDIO_API_KEY belum diatur di server bot.');
      await request('/limits');
      status('Terhubung ke Alvareth-Bot.', 'success');
      refreshJobs();
    } catch (error) { status(error.message, 'error'); }
  }
  async function submitRender() {
    const duration = document.querySelector('#vs-scene-duration') ? Number(document.querySelector('#vs-scene-duration').value) : 4;\n    const background = document.querySelector('#vs-scene-background')?.value || '#14243a';\n    const scenes = lines().map(text => ({ text, duration, background }));
    if (!scenes.length) return status('Masukkan minimal satu scene.', 'error');
    const project = {
      title: document.querySelector('#vs-title').value.trim() || 'Video LightJurnal',
      mode: document.querySelector('[name="vs-mode"]:checked')?.value || 'simple',
      ratio: document.querySelector('#vs-ratio').value,
      fps: Number(document.querySelector('#vs-fps').value),
      scenes
    };
    try {
      const data = await request('/jobs', { method: 'POST', body: JSON.stringify(project) });
      status('Pekerjaan masuk antrean: ' + data.job.id, 'success');
      await refreshJobs();
      if (!pollTimer) pollTimer = setInterval(refreshJobs, 2500);
    } catch (error) { status(error.message, 'error'); }
  }
  function render(root) {
    if (pollTimer) clearInterval(pollTimer);
    if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
    const c = cfg();
    root.innerHTML = `
      <section class="vs-hero"><div><span class="vs-overline">LIGHTJURNAL / CREATIVE STUDIO</span><h2>Video Studio</h2><p>Atur proyek di LightJurnal. Alvareth-Bot merender video di server Pterodactyl.</p></div><div class="vs-engine"><span class="vs-engine-dot"></span><div><b>ALVARETH RENDER ENGINE</b><small>Remotion · Remote rendering</small></div></div></section>
      <section class="vs-connection card"><div class="vs-section-heading"><div><h3>Koneksi mesin render</h3><p>API URL dan key disimpan lokal. Key hanya berada di session browser.</p></div><span id="vs-status" class="vs-status">Belum terhubung</span></div><div class="vs-connect-grid"><label>URL API Alvareth-Bot<input id="vs-api-url" type="url" value="${esc(c.url)}" placeholder="https://bot-api.domainkamu.com"></label><label>API key<input id="vs-api-key" type="password" autocomplete="off" placeholder="VIDEO_STUDIO_API_KEY"></label><button class="button button-primary" id="vs-connect">Hubungkan</button></div></section>
      <div class="vs-workspace"><section class="card vs-editor"><div class="vs-section-heading"><div><h3>Buat proyek video</h3><p>Pilih mode cepat atau mode penyusunan scene.</p></div><span class="vs-pill">REMOTION</span></div>
      <div class="vs-mode-picker"><label><input type="radio" name="vs-mode" value="simple" checked><span><b>Simple</b><small>Template cepat</small></span></label><label><input type="radio" name="vs-mode" value="professional"><span><b>Professional</b><small>Scene & timeline</small></span></label></div>
      <label class="vs-field">Nama proyek<input id="vs-title" maxlength="100" value="Video Baru"></label><div class="vs-fields-two"><label class="vs-field">Rasio<select id="vs-ratio"><option value="9:16">9:16 · Reels/TikTok</option><option value="16:9">16:9 · YouTube</option><option value="1:1">1:1 · Square</option></select></label><label class="vs-field">FPS<select id="vs-fps"><option value="30">30 FPS</option><option value="25">25 FPS</option><option value="24">24 FPS</option></select></label></div>
      <label class="vs-field">Teks scene <small>Satu baris menjadi satu scene.</small><textarea id="vs-scenes" rows="6">Mulai dengan ide terbaikmu
Bangun cerita melalui visual
Buat video langsung dari LightJurnal</textarea></label>
      <div id="vs-pro-options" class="vs-pro-options" hidden><label class="vs-field">Durasi setiap scene<select id="vs-scene-duration"><option value="3">3 detik</option><option value="4" selected>4 detik</option><option value="5">5 detik</option><option value="6">6 detik</option><option value="8">8 detik</option><option value="10">10 detik</option></select></label><label class="vs-field">Warna latar<input id="vs-scene-background" type="color" value="#14243a"></label><p>Pengaturan ini diterapkan ke setiap scene. Total durasi maksimum 90 detik.</p></div>
      <div class="vs-timeline-heading"><b>Timeline scene</b><span>Media upload dan drag-and-drop menyusul.</span></div><div id="vs-timeline" class="vs-timeline"></div><div class="vs-render-actions"><div><b>Estimasi durasi</b><small id="vs-duration">12 detik · 3 scene</small></div><button class="button button-primary" id="vs-render">▶ Render Video</button></div>
      <p class="vs-disclaimer">Rilis awal merender teks animasi. Foto/video, audio, keyframe, dan timeline drag-and-drop belum tersedia.</p></section>
      <aside class="vs-side-column"><section class="card vs-preview-card"><div class="vs-section-heading"><div><h3>Preview hasil</h3><p>Hasil render MP4 dari server bot.</p></div></div><div id="vs-preview-wrap" class="vs-preview-wrap" hidden><video id="vs-video" controls playsinline></video></div><div id="vs-preview-placeholder" class="vs-preview-placeholder"><span>▶</span><b>Belum ada video</b><small>Preview muncul setelah render selesai.</small></div></section>
      <section class="card vs-jobs-card"><div class="vs-section-heading"><div><h3>Render queue</h3><p>Progress pekerjaan video.</p></div><button class="button button-secondary" id="vs-refresh">↻</button></div><div id="vs-jobs" class="vs-jobs"><div class="vs-empty">Hubungkan mesin render terlebih dahulu.</div></div></section></aside></div>`;
    root.querySelector('#vs-scenes').addEventListener('input', timeline);
    const updateMode = () => {
      const professional = root.querySelector('[name="vs-mode"]:checked')?.value === 'professional';
      root.querySelector('#vs-pro-options').hidden = !professional;
      timeline();
    };
    root.querySelectorAll('[name="vs-mode"]').forEach(input => input.addEventListener('change', updateMode));
    root.querySelector('#vs-scene-duration').addEventListener('change', timeline);
    root.querySelector('#vs-connect').addEventListener('click', connect);
    root.querySelector('#vs-render').addEventListener('click', submitRender);
    root.querySelector('#vs-refresh').addEventListener('click', refreshJobs);
    root.querySelector('#vs-jobs').addEventListener('click', event => {
      const d = event.target.closest('[data-vs-download]'); const p = event.target.closest('[data-vs-preview]');
      if (d) getVideo(d.dataset.vsDownload, false);
      if (p) getVideo(p.dataset.vsPreview, true);
    });
    timeline();
    if (c.url && c.token) connect();
  }
  window.LightJurnalVideoStudio = { render };
})();
