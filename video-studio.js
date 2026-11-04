(function () {
  'use strict';
  const URL_KEY = 'lightjurnal.video.api-url.v1';
  const TOKEN_KEY = 'lightjurnal.video.api-token.session';
  let pollTimer = null;
  let videoUrl = null;

  const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const cfg = () => ({ url: (localStorage.getItem(URL_KEY) || '').trim().replace(/\/+$/, ''), token: sessionStorage.getItem(TOKEN_KEY) || '' });

  function status(root, message, tone) {
    const el = root.querySelector('#vs-status');
    if (el) {
      el.textContent = message;
      el.className = 'vs-status ' + (tone || 'neutral');
    }
  }

  async function request(path, options) {
    const c = cfg();
    if (!c.url) throw new Error('Hubungkan mesin render terlebih dahulu.');
    const opts = Object.assign({}, options || {});
    const timeoutMs = Number(opts.timeoutMs) || 90000;
    delete opts.timeoutMs;
    const headers = Object.assign({}, opts.headers || {});
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(c.url + '/api/video-studio' + path, Object.assign({}, opts, { headers, signal: controller.signal }));
      const type = response.headers.get('content-type') || '';
      const data = type.includes('application/json') ? await response.json() : null;
      if (!response.ok) throw new Error(data?.error || 'Permintaan gagal (' + response.status + ').');
      return data;
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') throw new Error('Permintaan melewati batas waktu. Coba lagi.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderPlan(root, plan) {
    const target = root.querySelector('#vs-storyboard');
    if (!target || !plan) return;
    const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
    const duration = Number(plan.totalDurationSeconds) || scenes.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0);
    const brief = plan.creativeBrief?.coreMessage || 'Storyboard disusun berdasarkan prompt.';
    target.hidden = false;
    target.innerHTML =
      '<div class="vs-plan-head"><div><span class="vs-plan-kicker">AI STORYBOARD</span><h3>' + esc(plan.title || 'Video baru') + '</h3><p>' + esc(brief) + '</p></div>' +
      '<div class="vs-plan-meta"><strong>' + Math.round(duration) + ' detik</strong><span>' + scenes.length + ' scene · ' + esc(plan.ratio || '9:16') + '</span></div></div>' +
      '<div class="vs-scene-list">' + scenes.map((scene, index) =>
        '<article class="vs-scene-card"><div class="vs-scene-number">' + String(index + 1).padStart(2, '0') + '</div>' +
        '<div class="vs-scene-copy"><small>' + esc(scene.purpose || scene.layout || 'SCENE') + '</small><strong>' + esc(scene.text || 'Scene ' + (index + 1)) + '</strong>' +
        (scene.subtext ? '<span>' + esc(scene.subtext) + '</span>' : '') + '</div>' +
        '<div class="vs-scene-time">' + Number(scene.durationSeconds || 0).toFixed(1) + 's</div></article>'
      ).join('') + '</div><p class="vs-plan-note">Durasi, visual, warna, gerakan, transisi, dan audio dipilih otomatis oleh AI. Storyboard ini hanya pratinjau keputusan kreatif.</p>';
  }

  function renderJobs(root, jobs) {
    const target = root.querySelector('#vs-jobs');
    if (!target) return;
    if (!jobs.length) {
      target.innerHTML = '<div class="vs-empty">Belum ada pekerjaan render.</div>';
      return;
    }
    target.innerHTML = jobs.map(job => {
      const label = ({ queued: 'Menunggu', rendering: 'Merender', completed: 'Selesai', failed: 'Gagal' })[job.status] || job.status;
      const meta = label + ' · ' + esc(job.durationSeconds || 0) + ' detik · ' + esc(job.sceneCount || 0) + ' scene · ' + esc(job.ratio || '');
      return '<article class="vs-job"><div class="vs-job-main"><strong>' + esc(job.title) + '</strong><small>' + meta + '</small>' +
        (job.planSummary ? '<p class="vs-job-summary">' + esc(job.planSummary) + '</p>' : '') +
        (job.error ? '<p class="vs-error">' + esc(job.error) + '</p>' : '') +
        '<div class="vs-progress"><span style="width:' + Math.max(0, Math.min(100, Number(job.progress) || 0)) + '%"></span></div></div>' +
        '<div class="vs-job-side"><b>' + Number(job.progress || 0) + '%</b>' +
        (job.status === 'completed' ? '<button class="button button-secondary" data-vs-download="' + esc(job.id) + '">Unduh</button><button class="button button-secondary" data-vs-preview="' + esc(job.id) + '">Preview</button>' : '') +
        '</div></article>';
    }).join('');
  }

  async function refreshJobs(root) {
    try {
      const data = await request('/jobs');
      renderJobs(root, data.jobs || []);
      const hasActive = (data.jobs || []).some(job => job.status === 'queued' || job.status === 'rendering');
      if (!hasActive && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (hasActive && !pollTimer) pollTimer = setInterval(() => refreshJobs(root), 2500);
    } catch (error) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      status(root, error.message, 'error');
    }
  }

  async function getVideo(root, id, preview) {
    try {
      const c = cfg();
      const response = await fetch(c.url + '/api/video-studio/jobs/' + encodeURIComponent(id) + '/download', {
        headers: { Authorization: 'Bearer ' + c.token }
      });
      if (!response.ok) {
        let message = 'Unduhan gagal (' + response.status + ').';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = URL.createObjectURL(blob);
      if (preview) {
        const wrap = root.querySelector('#vs-preview-wrap');
        const video = root.querySelector('#vs-video');
        const placeholder = root.querySelector('#vs-preview-placeholder');
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
    } catch (error) {
      status(root, error.message, 'error');
    }
  }

  async function connect(root) {
    const url = root.querySelector('#vs-api-url').value.trim().replace(/\/+$/, '');
    const token = root.querySelector('#vs-api-key').value.trim() || cfg().token;
    if (!/^https:\/\//i.test(url) && !/^http:\/\/localhost(?::\d+)?$/i.test(url)) return status(root, 'Gunakan HTTPS (HTTP hanya untuk localhost).', 'error');
    if (token.length < 32) return status(root, 'API key belum valid. Periksa key dari server Alvareth-Bot.', 'error');
    localStorage.setItem(URL_KEY, url);
    sessionStorage.setItem(TOKEN_KEY, token);
    try {
      const response = await fetch(url + '/api/video-studio/health');
      const health = await response.json();
      if (!response.ok || health.status !== 'ok') throw new Error('API Alvareth-Bot tidak merespons.');
      if (!health.configured) throw new Error('VIDEO_STUDIO_API_KEY belum diatur di server bot.');
      await request('/limits');
      status(root, 'Mesin render terhubung', 'success');
      const panel = root.querySelector('#vs-connection');
      if (panel) panel.hidden = true;
      const toggle = root.querySelector('#vs-connection-toggle');
      if (toggle) toggle.hidden = false;
      await refreshJobs(root);
    } catch (error) {
      const panel = root.querySelector('#vs-connection');
      if (panel) panel.hidden = false;
      status(root, error.message, 'error');
    }
  }

  async function submitRender(root) {
    const prompt = root.querySelector('#vs-prompt').value.trim();
    if (prompt.length < 8) return status(root, 'Ceritakan video yang ingin dibuat dengan sedikit lebih lengkap.', 'error');
    const button = root.querySelector('#vs-render');
    button.disabled = true;
    button.textContent = 'Menyusun storyboard...';
    status(root, 'AI sedang memahami cerita dan merancang penyuntingan.', 'neutral');
    try {
      const planned = await request('/plan', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        timeoutMs: 120000
      });
      renderPlan(root, planned.plan);
      status(root, 'Storyboard siap. Menyiapkan render video...', 'neutral');
      button.textContent = 'Menyiapkan render...';
      const queued = await request('/jobs', {
        method: 'POST',
        body: JSON.stringify({ plan: planned.plan })
      });
      status(root, 'Video masuk antrean render.', 'success');
      await refreshJobs(root);
      if (!pollTimer) pollTimer = setInterval(() => refreshJobs(root), 2500);
    } catch (error) {
      status(root, error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Buat video';
    }
  }

  function render(root) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
    const c = cfg();
    root.innerHTML = [
      '<section class="vs-hero"><div><span class="vs-overline">LIGHTJURNAL / CREATIVE STUDIO</span><h2>Video Studio</h2><p>Ceritakan ide videomu. AI akan bertindak sebagai creative director, penulis naskah, motion designer, dan editor.</p></div>',
      '<div class="vs-hero-side"><div class="vs-engine"><span class="vs-engine-dot"></span><div><b>AI CREATIVE DIRECTOR</b><small>Remotion · Adaptive editing</small></div></div><span id="vs-status" class="vs-status">Memeriksa mesin render...</span></div></section>',
      '<div class="vs-connection-toolbar"><button class="button button-secondary" id="vs-connection-toggle" ' + (c.url && c.token ? '' : 'hidden') + '>Pengaturan koneksi</button></div>',
      '<section id="vs-connection" class="vs-connection card" ' + (c.url && c.token ? 'hidden' : '') + '><div class="vs-section-heading"><div><h3>Koneksi mesin render</h3><p>Pengaturan infrastruktur ini terpisah dari prompt kreatif. API key disimpan di sesi browser.</p></div></div>',
      '<div class="vs-connect-grid"><label>URL API Alvareth-Bot<input id="vs-api-url" type="url" value="' + esc(c.url) + '" placeholder="https://bot-api.domainkamu.com"></label>',
      '<label>API key<input id="vs-api-key" type="password" autocomplete="off" placeholder="VIDEO_STUDIO_API_KEY"></label><button class="button button-primary" id="vs-connect">Hubungkan</button></div></section>',
      '<section class="card vs-prompt-card"><div class="vs-section-heading"><div><span class="vs-plan-kicker">YOUR IDEA → FINISHED VIDEO</span><h3>Apa video yang ingin kamu buat?</h3><p>Cukup satu prompt. Tidak perlu menentukan warna, durasi scene, rasio, musik, atau gaya editing.</p></div><span class="vs-pill">PROMPT ONLY</span></div>',
      '<label class="vs-field">Ceritakan ide videomu<textarea id="vs-prompt" rows="7" maxlength="6000" placeholder="Contoh: Buat video edukasi yang menarik tentang pentingnya menjaga kualitas udara di dalam rumah. Mulai dengan hook yang kuat, jelaskan penyebab dan solusi secara visual, gunakan narasi bahasa Indonesia yang natural, dan akhiri dengan ajakan yang mudah dilakukan."></textarea></label>',
      '<div class="vs-prompt-footer"><div><b>AI mengurus seluruh proses kreatif</b><small>Storytelling · pacing · visual · motion · transisi · audio</small></div><button class="button button-primary" id="vs-render">Buat video</button></div></section>',
      '<section id="vs-storyboard" class="card vs-storyboard" hidden></section>',
      '<div class="vs-workspace"><section class="card vs-preview-card"><div class="vs-section-heading"><div><h3>Preview hasil</h3><p>Video MP4 hasil render Remotion.</p></div></div><div id="vs-preview-wrap" class="vs-preview-wrap" hidden><video id="vs-video" controls playsinline></video></div><div id="vs-preview-placeholder" class="vs-preview-placeholder"><span>▶</span><b>Belum ada video</b><small>Preview akan muncul setelah render selesai.</small></div></section>',
      '<aside class="card vs-jobs-card"><div class="vs-section-heading"><div><h3>Render queue</h3><p>Status dan hasil pekerjaan video.</p></div><button class="button button-secondary" id="vs-refresh">↻</button></div><div id="vs-jobs" class="vs-jobs"><div class="vs-empty">Hubungkan mesin render terlebih dahulu.</div></div></aside></div>',
      '<p class="vs-disclaimer">AI memilih keputusan editing berdasarkan isi prompt. Storyboard ditampilkan sebagai pratinjau, bukan sebagai pengaturan yang harus diisi.</p>'
    ].join('');

    root.querySelector('#vs-connect').addEventListener('click', () => connect(root));
    root.querySelector('#vs-connection-toggle').addEventListener('click', () => {
      const panel = root.querySelector('#vs-connection');
      panel.hidden = !panel.hidden;
    });
    root.querySelector('#vs-render').addEventListener('click', () => submitRender(root));
    root.querySelector('#vs-refresh').addEventListener('click', () => refreshJobs(root));
    root.querySelector('#vs-jobs').addEventListener('click', event => {
      const download = event.target.closest('[data-vs-download]');
      const preview = event.target.closest('[data-vs-preview]');
      if (download) getVideo(root, download.dataset.vsDownload, false);
      if (preview) getVideo(root, preview.dataset.vsPreview, true);
    });
    if (c.url && c.token) {
      root.querySelector('#vs-api-url').value = c.url;
      root.querySelector('#vs-api-key').value = c.token;
      connect(root);
    } else {
      status(root, 'Hubungkan mesin render untuk mulai membuat video.', 'neutral');
    }
  }

  window.LightJurnalVideoStudio = { render };
})();
