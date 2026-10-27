(function () {
  "use strict";
  const KEY = "tradelog.mt5.imports.v1";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  let activeTab = "closed";
  let rows = load();
  function load() { try { const x = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(x) ? x : []; } catch (_) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(rows)); return true; } catch (_) { alert("Penyimpanan browser penuh. Ekspor data atau hapus impor lama."); return false; } }
  function money(n) { return Number.isFinite(n) ? n.toLocaleString("id-ID", {maximumFractionDigits:2}) : "—"; }
  function norm(s) { return String(s || "").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9/ ]/g," ").replace(/\s+/g," ").trim(); }
  function num(s) {
    if (s == null || String(s).trim() === "" || String(s).trim() === "—" || String(s).trim() === "-") return null;
    let v = String(s).replace(/[\u00a0\s]/g,"").replace(/[^0-9,.-]/g,"");
    if (v.includes(",") && v.includes(".")) { if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g,"").replace(",","."); else v = v.replace(/,/g,""); }
    else if (v.includes(",") && !v.includes(".")) v = v.replace(",",".");
    const n = Number(v); return Number.isFinite(n) ? n : null;
  }
  function dateText(s) { return String(s || "").trim().replace(/\s+/g," "); }
  function parseCSV(text) {
    const first = text.split(/\r?\n/,1)[0] || "";
    const delim = (first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length ? ";" : (first.match(/\t/g)||[]).length > (first.match(/,/g)||[]).length ? "\t" : ",";
    const out=[]; let row=[], cell="", quoted=false;
    for(let i=0;i<text.length;i++){ const c=text[i]; if(c === '"' && quoted && text[i+1] === '"'){cell+='"';i++;} else if(c === '"'){quoted=!quoted;} else if(c===delim && !quoted){row.push(cell.trim());cell="";} else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(Boolean))out.push(row);row=[];cell="";} else cell+=c; }
    row.push(cell.trim()); if(row.some(Boolean))out.push(row); return out;
  }
  function classify(section, headers) {
    const h = headers.join(" ");
    if (/working orders|order history|riwayat order|orders|pesanan/.test(section) || /state/.test(h) && /order/.test(h)) return "orders";
    if (/open positions|positions|posisi terbuka/.test(section)) return "open";
    if (/deals|closed|transactions|transaksi|trade history/.test(section) || /deal/.test(h) || /profit/.test(h) && /entry/.test(h)) return "closed";
    if (/entry/.test(h) && /profit/.test(h)) return "closed";
    if (/price current|current price|floating/.test(h)) return "open";
    return "unknown";
  }
  function mapHeaders(headers) {
    const find = (...patterns) => headers.findIndex(h => patterns.some(p => p.test(h)));
    return {
      ticket: find(/^ticket$/, /^deal$/, /^order$/, /^position$/, /ticket/),
      time: find(/^time$/, /open time/, /setup time/, /time/),
      type: find(/^type$/, /order type/, /operation/),
      direction: find(/^entry$/, /^direction$/, /entry type/),
      symbol: find(/^symbol$/, /^item$/, /instrument/),
      volume: find(/^volume$/, /^size$/, /lots/),
      price: find(/^price$/, /open price/, /price open/, /price at open/),
      current: find(/current price/, /price current/, /market price/),
      closeTime: find(/close time/, /time close/, /time closed/),
      closePrice: find(/close price/, /price close/, /price at close/),
      sl: find(/^s ?\/ ?l$/, /stop loss/),
      tp: find(/^t ?\/ ?p$/, /take profit/),
      commission: find(/commission/),
      swap: find(/^swap$/),
      profit: find(/^profit$/, /profit\/loss/, /p\/l/),
      balance: find(/^balance$/),
      state: find(/^state$/, /status/),
      comment: find(/^comment$/, /comments/)
    };
  }
  function rowFrom(cells, map, section, sourceName) {
    const get = k => map[k] >= 0 ? String(cells[map[k]] || "").trim() : "";
    const ticket=get("ticket"), symbol=get("symbol"), type=get("type");
    const profit=num(get("profit")), commission=num(get("commission")), swap=num(get("swap"));
    const entry=norm(get("direction"));
    const status=section === "open" ? "open" : section === "orders" ? "order" : "closed";
    return { id:"", section:status, ticket, time:dateText(get("time")), type, direction:get("direction"), symbol, volume:num(get("volume")), price:num(get("price")), current:num(get("current")), closeTime:dateText(get("closeTime")), closePrice:num(get("closePrice")), sl:num(get("sl")), tp:num(get("tp")), commission, swap, profit, net:(profit == null ? null : profit + (commission||0) + (swap||0)), balance:num(get("balance")), state:get("state"), comment:get("comment"), entryNorm:entry, source:sourceName };
  }
  function parseHTML(text, sourceName) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const tables = Array.from(doc.querySelectorAll("table"));
    const parsed=[]; let previousHeading="";
    const headings = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,caption,strong,b"));
    tables.forEach(table => {
      const prior = headings.filter(h => (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).slice(-1)[0];
      const sectionText = norm((table.caption && table.caption.textContent || "") + " " + (prior ? prior.textContent : "") + " " + (table.previousElementSibling ? table.previousElementSibling.textContent : ""));
      const trs=Array.from(table.querySelectorAll("tr"));
      if(trs.length<2) return;
      let headerIndex=-1, headers=[];
      for(let i=0;i<Math.min(trs.length,5);i++){
        const cells=Array.from(trs[i].querySelectorAll("th,td")).map(c=>norm(c.textContent));
        if(cells.length>=3 && cells.some(x=>/symbol|item|deal|ticket|volume|profit|price|time/.test(x))){headerIndex=i;headers=cells;break;}
      }
      if(headerIndex<0) return;
      let kind=classify(sectionText,headers);
      if(kind==="unknown") {
        const hm=headers.join(" ");
        if(/entry/.test(hm)&&/profit/.test(hm)) kind="closed";
        else if(/price current|floating/.test(hm)) kind="open";
        else if(/state/.test(hm)||/order/.test(hm)) kind="orders";
      }
      if(kind==="unknown") return;
      const map=mapHeaders(headers);
      trs.slice(headerIndex+1).forEach(tr=>{
        const cells=Array.from(tr.querySelectorAll("td,th")).map(c=>String(c.textContent||"").trim());
        if(cells.length<3 || cells.every(c=>!c)) return;
        const joined=norm(cells.join(" "));
        if(/total|balance:|credit:|profit:|deposit|withdrawal|closed p l|floating p l/.test(joined) && map.symbol<0) return;
        const r=rowFrom(cells,map,kind,sourceName);
        if(!r.symbol && !r.ticket && r.profit==null) return;
        if(kind==="closed" && r.entryNorm && !/out|close|exit/.test(r.entryNorm)) {
          // Entry-in deals open/add to positions; they are not closed results.
          r.section="deal-entry";
        }
        parsed.push(r);
      });
    });
    return parsed;
  }
  function parseCSVFile(text, name) {
    const grid=parseCSV(text.replace(/^\uFEFF/,""));
    if(grid.length<2) return [];
    let idx=-1, headers=[];
    for(let i=0;i<Math.min(grid.length,12);i++){
      const candidate=grid[i].map(norm);
      if(candidate.length>=3 && candidate.some(x=>/symbol|item/.test(x)) && candidate.some(x=>/profit|price|volume|ticket|deal/.test(x))){idx=i;headers=candidate;break;}
    }
    if(idx<0) throw new Error("Header CSV tidak dikenali. Gunakan laporan HTML MT5 atau CSV dengan kolom simbol dan transaksi.");
    let kind=classify("",headers);
    if(kind==="unknown") kind=/price current|floating/.test(headers.join(" "))?"open":/state|order/.test(headers.join(" "))?"orders":"closed";
    const map=mapHeaders(headers), out=[];
    grid.slice(idx+1).forEach(cells=>{if(cells.length<3)return;const r=rowFrom(cells,map,kind,name);if(!r.symbol&&!r.ticket&&r.profit==null)return;if(kind==="closed"&&r.entryNorm&&!/out|close|exit/.test(r.entryNorm))r.section="deal-entry";out.push(r);});
    return out;
  }
  function dedupeKey(r) { return [r.section,r.ticket,r.time,r.symbol,r.type,r.volume,r.price].join("|").toLowerCase(); }
  function importFile(file) {
    if(!file)return;
    if(file.size>15*1024*1024){alert("File terlalu besar. Maksimal 15 MB.");return;}
    const reader=new FileReader();
    reader.onload=()=>{
      try {
        const text=String(reader.result||"");
        let incoming=/\.csv$/i.test(file.name)?parseCSVFile(text,file.name):parseHTML(text,file.name);
        if(!incoming.length) throw new Error("Tidak ditemukan tabel transaksi yang dikenali. Pilih laporan History/Account Statement dari MT5 dalam HTML, atau CSV berheader.");
        const seen=new Set(rows.map(dedupeKey)); let added=0;
        incoming.forEach(r=>{const k=dedupeKey(r);if(seen.has(k))return;seen.add(k);r.id=(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random());rows.push(r);added++;});
        if(!save())return;
        render();
        alert("Impor selesai. "+added+" baris baru ditambahkan; "+(incoming.length-added)+" duplikat dilewati. Periksa tab dan total sebelum dipakai untuk evaluasi.");
      }catch(e){alert(e.message||"File tidak dapat dibaca.");}
      $("#mt5-journal-file").value="";
    };
    reader.onerror=()=>alert("Browser gagal membaca file ini.");
    reader.readAsText(file);
  }
  function filtered(tab) { return rows.filter(r=>tab==="closed"?r.section==="closed":tab==="open"?r.section==="open":r.section==="orders"); }
  function table(tab) {
    const list=filtered(tab).slice().reverse();
    if(!list.length)return '<div class="mt5j-empty">Belum ada data pada kategori ini. Impor laporan HTML dari MT5 untuk memulai.</div>';
    const cells=tab==="closed"
      ? '<th>Waktu</th><th>Ticket / Deal</th><th>Simbol</th><th>Jenis</th><th>Entry</th><th>Volume</th><th>Profit</th><th>Komisi</th><th>Swap</th><th>Net estimasi</th>'
      : tab==="open"
      ? '<th>Waktu</th><th>Ticket</th><th>Simbol</th><th>Jenis</th><th>Volume</th><th>Harga buka</th><th>Harga sekarang</th><th>SL</th><th>TP</th><th>Floating P/L</th>'
      : '<th>Waktu</th><th>Ticket / Order</th><th>Simbol</th><th>Jenis</th><th>Volume</th><th>Harga</th><th>Status</th><th>Komentar</th>';
    const body=list.map(r=>{
      const base='<td>'+esc(r.time||"—")+'</td><td>'+esc(r.ticket||"—")+'</td><td><strong>'+esc(r.symbol||"—")+'</strong></td><td>'+esc(r.type||"—")+'</td>';
      if(tab==="closed") return '<tr>'+base+'<td>'+esc(r.direction||"—")+'</td><td>'+esc(r.volume==null?"—":r.volume)+'</td><td>'+esc(r.profit==null?"—":money(r.profit))+'</td><td>'+esc(r.commission==null?"—":money(r.commission))+'</td><td>'+esc(r.swap==null?"—":money(r.swap))+'</td><td><strong>'+esc(r.net==null?"—":money(r.net))+'</strong></td></tr>';
      if(tab==="open") return '<tr>'+base+'<td>'+esc(r.volume==null?"—":r.volume)+'</td><td>'+esc(r.price==null?"—":money(r.price))+'</td><td>'+esc(r.current==null?"—":money(r.current))+'</td><td>'+esc(r.sl==null?"—":money(r.sl))+'</td><td>'+esc(r.tp==null?"—":money(r.tp))+'</td><td><strong>'+esc(r.profit==null?"—":money(r.profit))+'</strong></td></tr>';
      return '<tr>'+base+'<td>'+esc(r.volume==null?"—":r.volume)+'</td><td>'+esc(r.price==null?"—":money(r.price))+'</td><td>'+esc(r.state||"—")+'</td><td>'+esc(r.comment||"—")+'</td></tr>';
    }).join("");
    return '<div class="mt5j-table-wrap"><table class="mt5j-table"><thead><tr>'+cells+'</tr></thead><tbody>'+body+'</tbody></table></div><p class="mt5j-footnote">Menampilkan '+list.length+' baris · Sumber file: laporan yang kamu impor. Periksa laporan asli karena nama kolom dapat berbeda antarbroker.</p>';
  }
  function render() {
    const page=$("#page-content"); if(!page||!page.querySelector("#mt5-journal-root"))return;
    const closed=filtered("closed"), open=filtered("open"), orders=filtered("orders");
    const closedNet=closed.reduce((s,r)=>s+(r.net==null?0:r.net),0);
    $("#mt5j-summary").innerHTML='<div class="mt5j-metric"><span>Deal / transaksi tertutup</span><strong>'+closed.length+'</strong><small>Termasuk deal entry yang ditandai terpisah</small></div><div class="mt5j-metric"><span>Net tercatat (estimasi)</span><strong>'+money(closedNet)+'</strong><small>Profit + komisi + swap jika tersedia</small></div><div class="mt5j-metric"><span>Posisi terbuka</span><strong>'+open.length+'</strong><small>Dari bagian Positions laporan</small></div><div class="mt5j-metric"><span>Order</span><strong>'+orders.length+'</strong><small>Order historis / working orders</small></div>';
    $("#mt5j-tabs").innerHTML=[["closed","Deal / tertutup"],["open","Posisi terbuka"],["orders","Riwayat order"]].map(([k,label])=>'<button type="button" class="mt5j-tab '+(activeTab===k?"active":"")+'" data-mt5j-tab="'+k+'">'+label+' <span>'+filtered(k).length+'</span></button>').join("");
    $("#mt5j-table").innerHTML=table(activeTab);
    $("#mt5j-import-count").textContent=rows.length+" baris tersimpan di browser ini";
  }
  function showPage() {
    const page=$("#page-content"); if(!page)return;
    $("#page-title").textContent="Jurnal Transaksi MT5";
    document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("is-active",b.dataset.page==="mt5journal"));
    page.innerHTML='<div id="mt5-journal-root"><div class="page-intro"><div><h2>Jurnal transaksi MT5</h2><p>Impor laporan langsung dari MT5. Tidak perlu VPS, koneksi akun, atau password investor.</p></div><div class="mt5j-actions"><button type="button" class="button button-primary" id="mt5j-choose">↑ Impor laporan MT5</button><button type="button" class="button button-secondary" id="mt5j-export">↓ Ekspor data JSON</button></div></div><div class="mt5j-security"><strong>Privasi & keamanan</strong><p>File dibaca di browser perangkat ini dan data disimpan di localStorage. Tidak ada password MT5 yang diminta atau dikirim. Jangan mengunggah laporan yang ingin kamu rahasiakan ke perangkat bersama; laporan bisa memuat nomor akun/nama pemilik. Simpan backup di tempat aman.</p></div><div class="mt5j-how"><strong>Cara mengambil laporan di MT5 desktop</strong><ol><li>Buka <b>Toolbox → History</b> dan pilih rentang waktu yang dibutuhkan.</li><li>Klik kanan pada tabel → <b>Report</b> → pilih HTML, lalu simpan file.</li><li>Impor file HTML di sini. Untuk data terbaru posisi terbuka, buat laporan baru dan impor kembali.</li></ol><small>MT5 report dapat berisi bagian Orders, Deals, Positions, dan Working Orders. Hasil parser tetap perlu dibandingkan dengan laporan asli.</small></div><div id="mt5j-summary" class="mt5j-summary"></div><section class="card mt5j-card"><div class="mt5j-cardhead"><div><h3>Data impor</h3><p id="mt5j-import-count">0 baris tersimpan di browser ini</p></div><div class="mt5j-actions"><button type="button" class="button button-secondary" id="mt5j-clear">Hapus data impor</button></div></div><div id="mt5j-tabs" class="mt5j-tabs"></div><div id="mt5j-table"></div></section><div class="mt5j-bottom"><button type="button" class="button button-secondary" id="mt5j-choose-bottom">Pilih file laporan</button><span>Format yang didukung: HTML/HTM dan CSV. Maksimum 15 MB per file.</span></div></div>';
    const input=document.createElement("input"); input.type="file"; input.id="mt5-journal-file"; input.accept=".html,.htm,.csv,text/html,text/csv"; input.hidden=true; page.appendChild(input);
    render();
  }
  document.addEventListener("click",function(e){
    const tab=e.target.closest("[data-mt5j-tab]"); if(tab){activeTab=tab.dataset.mt5jTab;render();return;}
    if(e.target.closest("#mt5j-choose")||e.target.closest("#mt5j-choose-bottom")){$("#mt5-journal-file")?.click();return;}
    if(e.target.closest("#mt5j-export")){const blob=new Blob([JSON.stringify({format:"LightJurnal MT5 import v1",exportedAt:new Date().toISOString(),rows},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="lightjurnal-mt5-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(a.href);return;}
    if(e.target.closest("#mt5j-clear")){if(confirm("Hapus semua data impor MT5 dari browser ini? Tindakan ini tidak menghapus jurnal trade manual.")){rows=[];save();render();}return;}
    const nav=e.target.closest('[data-page="mt5journal"]'); if(nav){e.preventDefault();e.stopImmediatePropagation();showPage();document.body.classList.remove("sidebar-open");return;}
    if(e.target.closest('[data-page]') && !e.target.closest('[data-page="mt5journal"]')){const root=$("#mt5-journal-root");if(root){const b=e.target.closest("[data-page]");if(b&&b.dataset.page!=="mt5journal"){} }}
  },true);
  document.addEventListener("change",e=>{if(e.target.id==="mt5-journal-file")importFile(e.target.files&&e.target.files[0]);},true);
  // If another app page renders, keep the normal application in control.
  document.addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b&&b.dataset.page!=="mt5journal"){const title=$("#page-title");if(title&&title.textContent==="Jurnal Transaksi MT5"){setTimeout(()=>{const active=document.querySelector(".nav-item.is-active");if(active)$("#page-title").textContent=active.textContent.trim();},0);}}},false);
  const nav=$(".nav-list");
  if(nav&&!nav.querySelector('[data-page="mt5journal"]')){const btn=document.createElement("button");btn.type="button";btn.className="nav-item";btn.dataset.page="mt5journal";btn.innerHTML='<span class="nav-icon">⇅</span><span>Jurnal Transaksi MT5</span>';const mt5=nav.querySelector('[data-page="mt5"]');if(mt5)mt5.insertAdjacentElement("afterend",btn);else nav.appendChild(btn);}
})();