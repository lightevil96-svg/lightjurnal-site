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
    if (!c.url) throw new Error('Hubungkan URL API Alvareth-Bot terlebih dahulu.');
    const headers = Object.assign({}, options.headers || {});
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(c.url + '/api/video-studio' + path, Object.assign({}, options, { headers }));
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data && data.error || 'Permintaan gagal (' + response.status + ').');
    return data;
  }
  function renderJobs(jobs) {
    const target = document.querySelector('#vs-jobs');
    if (!target) return;
    if (!jobs.length) { target.innerHTML = '<div class="vs-empty">Belum ada pekerjaan render.</div>'; return; }
    target.innerHTML = jobs.map(job => {
      const label = ({ queued: 'Menunggu', rendering: 'Merender', completed: 'Selesai', failed: 'Gagal' })[job.status] || job.status;
      const metadata = [label, job.sceneCount ? job.sceneCount + ' scene' : '', job.durationSeconds ? job.durationSeconds + ' detik' : '', job.ratio || ''].filter(Boolean).join(' · ');
      return '<article class="vs-job"><div class="vs-job-main"><strong>' + esc(job.title) + '</strong><small>' + esc(metadata) + '</small>' +
        (job.planSummary ? '<p class="vs-job-summary">' + esc(job.planSummary) + '</p>' : '') +
        (job.error ? '<p class="vs-error">' + esc(job.error) + '</p>' : '') +
        '<div class="vs-progress"><span style="width:' + Math.max(0, Math.min(100, Number(job.progress) || 0)) + '%"></span></div></div>' +
        '<div class="vs-job-side"><b>' + Number(job.progress || 0) + '%</b>' +
        (job.status === 'completed' ? '<button class="button button-secondary" data-vs-download="' + esc(job.id) + '">Unduh</button><button class="button button-secondary" data-vs-preview="' + esc(job.id) + '">Preview</button>' : '') +
        '</div></article>';
    }).join('');
  }
  async function refreshJobs() {
    try {
      const data = await request('/jobs');
      renderJobs(data.jobs || []);
      const hasActive = (data.jobs || []).some(job => job.status === 'queued' || job.status === 'rendering');
      if (!hasActive && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (hasActive && !pollTimer) pollTimer = setInterval(refreshJobs, 2500);
    } catch (error) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      status(error.message, 'error');
    }
  }
  async function getVideo(id, preview) {
    try {
      const c = cfg();
      const response = await fetch(c.url + '/api/video-studio/jobs/' + encodeURIComponent(id) + '/download', { headers: { Authorization: 'Bearer ' + c.token } });
      if (!response.ok) {
        let message = 'Unduhan gagal (' + response.status + ').';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
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
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = 'lightjurnal-' + id + '.mp4';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (error) { status(error.message, 'error'); }
  }
  async function connect() {
    const url = document.querySelector('#vs-api-url').value.trim().replace(/\/+$/, '');
    const token = document.querySelector('#vs-api-key').value.trim() || cfg().token;
    if (!/^https:\/\//i.test(url) && !/^http:\/\/localhost(?::\d+)?$/i.test(url)) return status('Gunakan HTTPS (HTTP hanya untuk localhost).', 'error');
    if (!token) return status('Masukkan API key Alvareth-Bot.', 'error');
    localStorage.setItem(URL_KEY, url);
    sessionStorage.setItem(TOKEN_KEY, token);
    try {
      const response = await fetch(url + '/api/video-studio/health');
      const health = await response.json();
      if (!response.ok || health.status !== 'ok') throw new Error('API Alvareth-Bot tidak merespons.');
      if (!health.configured) throw new Error('VIDEO_STUDIO_API_KEY belum diatur di server bot.');
      await request('/limits');
      status('Terhubung ke Alvareth-Bot. AI Creative Director siap.', 'success');
      const panel = document.querySelector('#vs-connection');
      if (panel) panel.hidden = true;
      const toggle = document.querySelector('#vs-connection-toggle');
      if (toggle) toggle.hidden = false;
      refreshJobs();
    } catch (error) {
      const panel = document.querySelector('#vs-connection');
      if (panel) panel.hidden = false;
      status(error.message, 'error');
    }
  }
  function showStoryboard(plan) {
    const panel = document.querySelector('#vs-storyboard');
    if (!panel) return;
    const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
    const duration = Number(plan.totalDurationSeconds) || scenes.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0);
    const brief = plan.creativeBrief || {};
    const cards = scenes.map((scene, index) => {
      const narration = String(scene.narration || '').trim();
      return '<article class="vs-scene-card"><div class="vs-scene-meta"><span>SCENE ' + String(index + 1).padStart(2, '0') + '</span><span>' + esc(scene.durationSeconds || '—') + ' dtk</span></div>' +
        (scene.kicker ? '<small class="vs-scene-kicker">' + esc(scene.kicker) + '</small>' : '') +
        '<strong>' + esc(scene.text) + '</strong>' +
        (scene.subtext ? '<p>' + esc(scene.subtext) + '</p>' : '') +
        (narration ? '<div class="vs-narration"><span>NARASI</span>' + esc(narration) + '</div>' : '') +
        '</article>';
    }).join('');
    panel.innerHTML = '<div class="vs-section-heading"><div><h3>Storyboard otomatis</h3><p>AI memilih struktur cerita, komposisi, warna, gerak, dan tempo berdasarkan prompt.</p></div><span class="vs-pill">AI DIRECTED</span></div>' +
      '<div class="vs-story-summary"><div><small>JUDUL VIDEO</small><b>' + esc(plan.title || 'Video baru') + '</b></div>' +
      '<div><small>DURASI</small><b>' + esc(duration.toFixed(1)) + ' detik</b></div>' +
      '<div><small>FORMAT</small><b>' + esc(plan.ratio || 'otomatis') + '</b></div>' +
      '<div><small>SCENE</small><b>' + scenes.length + '</b></div></div>' +
      (brief.coreMessage ? '<p class="vs-core-message">' + esc(brief.coreMessage) + '</p>' : '') +
      '<div class="vs-storyboard-grid">' + cards + '</div>';
    panel.hidden = false;
  }
  async function submitRender() {
    const promptEl = document.querySelector('#vs-prompt');
    const button = document.querySelector('#vs-render');
    const prompt = promptEl ? promptEl.value.trim() : '';
    if (prompt.length < 8) return status('Ceritakan video yang ingin dibuat dengan sedikit lebih lengkap.', 'error');
    if (prompt.length > 6000) return status('Prompt maksimal 6.000 karakter.', 'error');
    if (button) { button.disabled = true; button.textContent = 'Menyusun video…'; }
    status('AI sedang memahami brief dan menyusun storyboard…');
    try {
      const planned = await request('/plan', { method: 'POST', body: JSON.stringify({ prompt }) });
      if (!planned || !planned.plan || !Array.isArray(planned.plan.scenes)) throw new Error('AI belum menghasilkan storyboard yang valid.');
      showStoryboard(planned.plan);
      status('Storyboard siap. Mengirim proyek ke mesin Remotion…');
      const data = await request('/jobs', { method: 'POST', body: JSON.stringify({ plan: planned.plan }) });
      status('Video masuk antrean render: ' + data.job.id, 'success');
      await refreshJobs();
      if (!pollTimer) pollTimer = setInterval(refreshJobs, 2500);
    } catch (error) {
      status(error.message, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = '✦ Buat video otomatis'; }
    }
  }
  function render(root) {
    if (pollTimer) clearInterval(pollTimer);
    if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
    const c = cfg();
    root.innerHTML = [
      '<section class="vs-hero"><div><span class="vs-overline">LIGHTJURNAL / CREATIVE STUDIO</span><h2>AI Video Studio</h2><p>Satu prompt. AI mengarahkan cerita, tempo, visual, warna, gerak, dan transisi. Remotion mengerjakan render.</p></div><div class="vs-hero-side"><div class="vs-engine"><span class="vs-engine-dot"></span><div><b>AI CREATIVE DIRECTOR</b><small>Remotion 4.0 · Remote rendering</small></div></div><div class="vs-hero-controls"><span id="vs-status" class="vs-status">Belum terhubung</span><button class="button button-secondary vs-connection-toggle" id="vs-connection-toggle" ' + (c.url && c.token ? '' : 'hidden') + '>Koneksi</button></div></div></section>',
      '<section class="vs-connection card" ' + (c.url && c.token ? 'hidden' : '') + '><div class="vs-section-heading"><div><h3>Koneksi mesin render</h3><p>Pengaturan koneksi teknis. API key hanya disimpan di sesi browser.</p></div></div><div class="vs-connect-grid"><label>URL API Alvareth-Bot<input id="vs-api-url" type="url" value="' + esc(c.url) + '" placeholder="https://bot-api.domainkamu.com"></label><label>API key<input id="vs-api-key" type="password" autocomplete="off" placeholder="VIDEO_STUDIO_API_KEY"></label><button class="button button-primary" id="vs-connect">Hubungkan</button></div></section>',
      '<div class="vs-workspace"><section class="card vs-editor"><div class="vs-section-heading"><div><h3>Ceritakan video yang kamu inginkan</h3><p>Tulis ide secara natural. Tidak perlu menentukan scene, warna, durasi per scene, FPS, rasio, musik, atau transisi.</p></div><span class="vs-pill">PROMPT ONLY</span></div>',
      '<label class="vs-field">Prompt kreatif<textarea id="vs-prompt" rows="8" maxlength="6000" placeholder="Contoh: Buat video edukasi yang menarik tentang kebiasaan kecil yang membuat seseorang lebih produktif. Buka dengan hook yang kuat, gunakan visual yang dinamis, narasi yang natural, dan akhiri dengan pesan yang mudah diingat."></textarea></label>',
      '<div class="vs-prompt-footer"><small>AI akan menentukan pendekatan visual dan durasi yang paling sesuai dengan isi cerita.</small><span id="vs-char-count">0 / 6.000</span></div>',
      '<div class="vs-render-actions"><div><b>AI Creative Director</b><small>Storyboard otomatis → Remotion render</small></div><button class="button button-primary" id="vs-render">✦ Buat video otomatis</button></div>',
      '<section id="vs-storyboard" class="vs-storyboard" hidden></section>',
      '<p class="vs-disclaimer">Sistem saat ini menghasilkan motion graphics dan tipografi animasi dari storyboard AI. Footage nyata, aset gambar eksternal, dan voice-over TTS hanya akan digunakan jika integrasinya tersedia dan sudah dikonfigurasi.</p></section>',
      '<aside class="vs-side-column"><section class="card vs-preview-card"><div class="vs-section-heading"><div><h3>Preview hasil</h3><p>Video MP4 dari mesin Remotion.</p></div></div><div id="vs-preview-wrap" class="vs-preview-wrap" hidden><video id="vs-video" controls playsinline></video></div><div id="vs-preview-placeholder" class="vs-preview-placeholder"><span>▶</span><b>Belum ada video</b><small>Preview muncul setelah render selesai.</small></div></section>',
      '<section class="card vs-jobs-card"><div class="vs-section-heading"><div><h3>Render queue</h3><p>Status dan progress pekerjaan video.</p></div><button class="button button-secondary" id="vs-refresh">↻</button></div><div id="vs-jobs" class="vs-jobs"><div class="vs-empty">Hubungkan mesin render terlebih dahulu.</div></div></section></aside></div>'
    ].join('');
    root.querySelector('#vs-render').addEventListener('click', submitRender);
    root.querySelector('#vs-prompt').addEventListener('input', event => {
      const counter = root.querySelector('#vs-char-count');
      if (counter) counter.textContent = event.target.value.length.toLocaleString('id-ID') + ' / 6.000';
    });
    root.querySelector('#vs-connect').addEventListener('click', connect);
    root.querySelector('#vs-connection-toggle').addEventListener('click', () => {
      const panel = root.querySelector('#vs-connection');
      if (panel) panel.hidden = !panel.hidden;
    });
    root.querySelector('#vs-refresh').addEventListener('click', refreshJobs);
    root.querySelector('#vs-jobs').addEventListener('click', event => {
      const download = event.target.closest('[data-vs-download]');
      const preview = event.target.closest('[data-vs-preview]');
      if (download) getVideo(download.dataset.vsDownload, false);
      if (preview) getVideo(preview.dataset.vsPreview, true);
    });
    if (c.url && c.token) connect();
  }
  window.LightJurnalVideoStudio = { render };
})();