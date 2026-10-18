(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COLORS = [
    { name: "Merah", main: "#e94b4b", light: "#ffe3e3", start: 0, base: [9, 0], homeSlots: [[10, 1], [10, 3], [12, 1], [12, 3]], lane: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]] },
    { name: "Biru", main: "#3777e8", light: "#dceaff", start: 13, base: [0, 0], homeSlots: [[1, 1], [1, 3], [3, 1], [3, 3]], lane: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]] },
    { name: "Kuning", main: "#e6ae21", light: "#fff0bd", start: 26, base: [0, 9], homeSlots: [[1, 10], [1, 12], [3, 10], [3, 12]], lane: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]] },
    { name: "Hijau", main: "#25a66a", light: "#d9f8e7", start: 39, base: [9, 9], homeSlots: [[10, 10], [10, 12], [12, 10], [12, 12]], lane: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]] }
  ];
  const TRACK = [
    [13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
    [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6]
  ];
  const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const OFFSETS = [[-7,-7],[7,-7],[-7,7],[7,7]];
  const state = {
    user: null, profileName: "Pemain", room: null, players: [], requests: [],
    roomsChannel: null, userRequestChannel: null, roomChannel: null,
    roomPollTimer: null, requestPollTimer: null, refreshBusy: false,
    refreshPending: false, actionBusy: false, requestBusy: false, openingRoom: false
  };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function showNotice(message, type = "") {
    const node = $("#ludo-notice");
    if (!node) return;
    node.textContent = message || "";
    node.className = "ludo-alert" + (type ? " ludo-alert-" + type : "");
    node.hidden = !message;
  }

  function showGameMessage(message) {
    const node = $("#ludo-game-message");
    if (node) node.textContent = message || "";
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = busyText || "Memproses…";
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  function statusLabel(status) {
    return ({
      waiting: "Menunggu pemain", playing: "Sedang bermain",
      finished: "Selesai", closed: "Ditutup",
      pending: "Menunggu persetujuan", approved: "Disetujui", rejected: "Ditolak"
    })[status] || status || "Status tidak diketahui";
  }

  function showAuth() {
    $("#ludo-auth-required").hidden = false;
    $("#ludo-app").hidden = true;
    const returnTo = "ludo.html" + window.location.search;
    $("#ludo-login-link").href = "login.html?returnTo=" + encodeURIComponent(returnTo);
  }

  async function rpc(name, args) {
    if (!window.ljSupabaseConfigured || !window.ljSupabase) throw new Error("Supabase LightJurnal belum aktif.");
    const { data, error } = await window.ljSupabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function friendlyLudoDatabaseError(error, fallback) {
    const message = String(error?.message || "").trim();
    if (/schema cache/i.test(message) && /ludo_/i.test(message)) {
      return "Fungsi Ludo belum dikenali oleh Supabase. Jalankan seluruh file supabase-ludo-migration.sql di Supabase Dashboard → SQL Editor, tunggu hingga selesai tanpa error, lalu muat ulang halaman.";
    }
    if (/relation .*ludo_.* does not exist/i.test(message)) {
      return "Tabel Ludo belum tersedia. Jalankan seluruh file supabase-ludo-migration.sql di Supabase Dashboard → SQL Editor, tunggu hingga selesai tanpa error, lalu muat ulang halaman.";
    }
    return message || fallback;
  }

  async function copyText(text) {
    if (!text) throw new Error("Tidak ada teks untuk disalin.");
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    holder.style.pointerEvents = "none";
    document.body.append(holder);
    holder.select();
    const copied = document.execCommand("copy");
    holder.remove();
    if (!copied) throw new Error("Salin otomatis tidak tersedia. Pilih teks lalu salin secara manual.");
  }

  async function copyWithFeedback(text, successMessage) {
    try {
      await copyText(text);
      showNotice(successMessage || "Berhasil disalin.", "success");
    } catch (error) {
      window.prompt("Salin teks berikut:", text);
      showNotice(error.message || "Salin manual melalui kotak teks.", "error");
    }
  }

  function renderRooms(rooms) {
    const container = $("#ludo-my-rooms");
    if (!container) return;
    if (!rooms?.length) {
      container.innerHTML = '<div class="ludo-empty">Belum ada room. Buat room baru atau masukkan kode dari teman.</div>';
      return;
    }
    container.innerHTML = rooms.map((room) => {
      return '<article class="ludo-room-card"><div class="ludo-room-avatar" aria-hidden="true">♟</div><div class="ludo-room-card-copy"><strong>' + escapeHTML(room.title) + '</strong><small>Kode ' + escapeHTML(room.code) + ' · ' + escapeHTML(statusLabel(room.status)) + '<br>Maks. ' + escapeHTML(room.max_players) + ' pemain</small></div><button class="ludo-small-button" type="button" data-open-room="' + escapeHTML(room.id) + '" data-room-status="' + escapeHTML(room.status) + '">Buka ↗</button></article>';
    }).join("");
  }

  async function loadMyRooms() {
    const container = $("#ludo-my-rooms");
    if (container) container.innerHTML = '<div class="ludo-empty">Memuat daftar room…</div>';
    const { data, error } = await window.ljSupabase
      .from("ludo_rooms")
      .select("id,code,title,status,max_players,owner_id,created_at")
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      if (container) {
        const message = friendlyLudoDatabaseError(error, "Room belum bisa dimuat. Pastikan migrasi Ludo di Supabase sudah dijalankan.");
        container.innerHTML = '<div class="ludo-empty">' + escapeHTML(message) + '</div>';
      }
      return;
    }
    renderRooms(data || []);
  }

  async function loadMyRequests() {
    const panel = $("#ludo-my-requests-panel");
    const container = $("#ludo-my-requests");
    const { data, error } = await window.ljSupabase
      .from("ludo_join_requests")
      .select("id,room_id,room_code,status,created_at,updated_at")
      .eq("user_id", state.user.id)
      .order("updated_at", { ascending: false })
      .limit(12);
    if (error || !data?.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    container.innerHTML = data.map((request) =>
      '<div class="ludo-request-tracker-item"><div><strong>Room ' + escapeHTML(request.room_code) + '</strong><small>Diperbarui ' + escapeHTML(new Date(request.updated_at).toLocaleString("id-ID")) + '</small></div><span class="ludo-request-state">' + escapeHTML(statusLabel(request.status)) + '</span></div>'
    ).join("");
    state.myRequests = data;
  }

  function subscribeToUserRequests() {
    if (state.userRequestChannel) window.ljSupabase.removeChannel(state.userRequestChannel);
    state.userRequestChannel = window.ljSupabase.channel("ludo-user-requests-" + state.user.id)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ludo_join_requests",
        filter: "user_id=eq." + state.user.id
      }, async (payload) => {
        await loadMyRequests();
        const row = payload.new || {};
        if (row.status === "approved" && row.room_id) {
          showNotice("Permintaanmu disetujui! Kamu sudah masuk room.", "success");
          await loadMyRooms();
          if (state.room?.id !== row.room_id) await openRoom(row.room_id);
        } else if (row.status === "rejected") {
          showNotice("Pemilik room belum menyetujui permintaanmu.", "error");
        }
      })
      .subscribe();
  }

  function stopRoomLiveUpdates() {
    if (state.roomChannel && window.ljSupabase) window.ljSupabase.removeChannel(state.roomChannel);
    state.roomChannel = null;
    if (state.roomPollTimer) window.clearInterval(state.roomPollTimer);
    state.roomPollTimer = null;
  }

  function subscribeToRoom(roomId) {
    stopRoomLiveUpdates();
    state.roomChannel = window.ljSupabase.channel("ludo-room-" + roomId)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ludo_rooms", filter: "id=eq." + roomId
      }, () => void refreshRoom())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ludo_players", filter: "room_id=eq." + roomId
      }, () => void refreshRoom())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "ludo_join_requests", filter: "room_id=eq." + roomId
      }, () => {
        if (state.room?.owner_id === state.user.id) void loadRoomRequests();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          showGameMessage("Koneksi realtime terganggu. Situs akan mencoba menyegarkan room otomatis.");
        }
      });
    // Polling is a fallback for browsers where Realtime is blocked or disconnected.
    state.roomPollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRoom();
    }, 7000);
  }

  async function loadRoomRequests() {
    if (!state.room || state.room.owner_id !== state.user.id) {
      $("#ludo-pending-requests").hidden = true;
      return;
    }
    const { data, error } = await window.ljSupabase
      .from("ludo_join_requests")
      .select("id,user_id,display_name,status,created_at")
      .eq("room_id", state.room.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) {
      showNotice("Permintaan bergabung belum dapat dimuat. Periksa migrasi Supabase.", "error");
      return;
    }
    state.requests = data || [];
    renderJoinRequests();
  }

  function renderJoinRequests() {
    const panel = $("#ludo-pending-requests");
    const list = $("#ludo-pending-list");
    $("#ludo-pending-count").textContent = String(state.requests.length);
    panel.hidden = !state.requests.length || state.room?.status !== "waiting";
    if (!state.requests.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = state.requests.map((request) =>
      '<div class="ludo-request-item"><div><strong>' + escapeHTML(request.display_name) + '</strong><small>Meminta masuk ke room ini</small></div><div class="ludo-request-actions"><button type="button" class="approve" data-review-request="' + escapeHTML(request.id) + '" data-approve="true">Terima</button><button type="button" class="reject" data-review-request="' + escapeHTML(request.id) + '" data-approve="false">Tolak</button></div></div>'
    ).join("");
  }

  function seatForPlayer(userId) {
    return state.players.find((player) => player.user_id === userId)?.seat ?? 0;
  }

  function gameState() {
    return state.room?.game_state && typeof state.room.game_state === "object" ? state.room.game_state : {};
  }

  function playerById(userId) {
    return state.players.find((player) => player.user_id === userId)
      || (gameState().players || []).find((player) => player.user_id === userId)
      || null;
  }

  function playerName(userId) {
    const player = playerById(userId);
    return player?.display_name || (userId === state.user?.id ? state.profileName : "Pemain");
  }

  function renderRoster() {
    $("#ludo-player-count").textContent = state.players.length + "/" + (state.room?.max_players || 4);
    $("#ludo-player-list").innerHTML = state.players.slice().sort((a,b) => a.seat-b.seat).map((player) => {
      const color = COLORS[player.seat] || COLORS[0];
      return '<div class="ludo-player-chip" style="--player-color:' + color.main + '"><span class="ludo-player-dot"></span><div><strong>' + escapeHTML(player.display_name) + '</strong><small>' + (player.user_id === state.user.id ? "Kamu" : player.user_id === state.room.owner_id ? "Pemilik room" : color.name) + '</small></div></div>';
    }).join("");
    if (state.players.length < (state.room?.max_players || 4)) {
      const remaining = state.room.max_players - state.players.length;
      for (let i=0;i<remaining;i++) {
        const chip = document.createElement("div");
        chip.className = "ludo-player-chip ludo-player-empty";
        chip.innerHTML = '<span class="ludo-player-dot" style="--player-color:var(--line)"></span><div><strong>Slot kosong</strong><small>Undang atau setujui pemain</small></div>';
        $("#ludo-player-list").append(chip);
      }
    }
  }

  function updateRoomControls() {
    const room = state.room;
    const isOwner = room.owner_id === state.user.id;
    const waiting = room.status === "waiting";
    const finished = room.status === "finished";
    $("#ludo-owner-controls").hidden = !isOwner || (!waiting && !finished);
    $("#ludo-guest-waiting").hidden = isOwner || !waiting;
    $("#ludo-create-invite").hidden = !waiting;
    $("#ludo-pending-requests").hidden = !waiting || !isOwner || !state.requests.length;
    $("#ludo-start-game").hidden = !waiting;
    $("#ludo-start-game").disabled = state.players.length < 2 || state.players.length > room.max_players;
    $("#ludo-close-room").hidden = !isOwner || (!waiting && !finished);
    $("#ludo-start-game").textContent = "Mulai permainan";
  }

  function svgElement(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,String(value)));
    return node;
  }

  function addSvg(parent, name, attrs = {}, text = null) {
    const node = svgElement(name, attrs);
    if (text !== null) node.textContent = text;
    parent.append(node);
    return node;
  }

  function cellCenter(pos) {
    return { x: pos[1] * 40 + 20, y: pos[0] * 40 + 20 };
  }

  function appendHomeBases(svg) {
    const bases = [
      { x:0,y:360, seat:0 }, { x:0,y:0,seat:1 }, { x:360,y:0,seat:2 }, { x:360,y:360,seat:3 }
    ];
    bases.forEach(({x,y,seat}) => {
      const color = COLORS[seat];
      addSvg(svg,"rect",{x,y,width:240,height:240,fill:color.light,stroke:color.main,"stroke-width":2});
      addSvg(svg,"rect",{x:x+40,y:y+40,width:160,height:160,rx:15,fill:"#ffffff",stroke:color.main,"stroke-width":2});
      color.homeSlots.forEach((pos) => {
        const center = cellCenter(pos);
        addSvg(svg,"circle",{cx:center.x,cy:center.y,r:16,fill:color.light,stroke:color.main,"stroke-width":2,opacity:.9});
      });
    });
  }

  function appendTrack(svg) {
    TRACK.forEach((pos,index) => {
      const x=pos[1]*40,y=pos[0]*40;
      let fill="#ffffff";
      if (SAFE_CELLS.has(index)) {
        const color=COLORS.find((c)=>c.start===index);
        fill=color ? color.light : "#e8edf5";
      }
      addSvg(svg,"rect",{x:x+1,y:y+1,width:38,height:38,rx:4,fill,stroke:"#c8d1df","stroke-width":1.2});
      if (SAFE_CELLS.has(index)) addSvg(svg,"text",{x:x+20,y:y+26,"text-anchor":"middle","font-size":18,fill:"#68758a","font-weight":800},"★");
    });
    COLORS.forEach((color) => color.lane.forEach((pos) => {
      addSvg(svg,"rect",{x:pos[1]*40+1,y:pos[0]*40+1,width:38,height:38,rx:4,fill:color.light,stroke:color.main,"stroke-width":1.3});
    }));
    // Four-colour finish hub.
    addSvg(svg,"polygon",{points:"240,240 360,240 300,300",fill:COLORS[1].main});
    addSvg(svg,"polygon",{points:"360,240 360,360 300,300",fill:COLORS[2].main});
    addSvg(svg,"polygon",{points:"360,360 240,360 300,300",fill:COLORS[3].main});
    addSvg(svg,"polygon",{points:"240,360 240,240 300,300",fill:COLORS[0].main});
    addSvg(svg,"circle",{cx:300,cy:300,r:7,fill:"#ffffff",stroke:"#ffffff","stroke-width":2});
  }

  function currentTokens() {
    const gs=gameState();
    const tokenMap=gs.tokens || {};
    return state.players.slice().sort((a,b)=>a.seat-b.seat).flatMap((player) => {
      const values=tokenMap[player.user_id];
      const progress=Array.isArray(values)&&values.length===4 ? values : [-1,-1,-1,-1];
      return progress.map((value,index)=>({userId:player.user_id,seat:player.seat,index,progress:Number(value)}));
    });
  }

  function coordinateForToken(token) {
    const color=COLORS[token.seat]||COLORS[0];
    if (token.progress===-1) return cellCenter(color.homeSlots[token.index]);
    if (token.progress===57) {
      const shift=[[-8,8],[8,-8],[8,8],[-8,-8]][token.seat] || [0,0];
      const tokenShift=OFFSETS[token.index];
      return {x:300+shift[0]+tokenShift[0]*.34,y:300+shift[1]+tokenShift[1]*.34};
    }
    if (token.progress>=52 && token.progress<=56) return cellCenter(color.lane[token.progress-52]);
    const trackPosition=TRACK[(color.start+token.progress)%52];
    return cellCenter(trackPosition);
  }

  function legalMove(token) {
    const gs=gameState();
    const roll=Number(gs.pending_roll);
    if (!Number.isInteger(roll)||roll<1||roll>6||gs.current_player_id!==state.user.id||token.userId!==state.user.id) return false;
    if (token.progress===-1) return roll===6;
    return token.progress>=0&&token.progress<57&&token.progress+roll<=57;
  }

  async function moveToken(userId,tokenIndex,buttonNode) {
    if (state.actionBusy || !state.room || !state.user) return;
    if (userId!==state.user.id) return;
    state.actionBusy=true;
    showGameMessage("Memindahkan pion…");
    renderGame();
    try {
      // The RPC returns the authoritative game state. Apply it immediately so
      // a concurrent Realtime refresh cannot leave the board showing old pieces.
      const nextGameState=await rpc("ludo_move_token",{p_room_id:state.room.id,p_token_index:tokenIndex});
      if(nextGameState&&typeof nextGameState==="object") {
        state.room.game_state=nextGameState;
        if(nextGameState.winner_id)state.room.status="finished";
        renderGame();
      }
      await refreshRoom();
    } catch (error) {
      // renderGame() recalculates the turn message, so keep RPC errors in the
      // persistent room notice instead of letting a refresh hide the failure.
      showNotice(error?.message||"Pion belum dapat dipindahkan. Coba muat ulang room.","error");
      await refreshRoom();
    } finally {
      state.actionBusy=false;
      renderGame();
    }
  }

  function renderBoard() {
    const container=$("#ludo-board");
    container.replaceChildren();
    const svg=svgElement("svg",{viewBox:"0 0 600 600",role:"group","aria-label":"Papan Ludo. Ketuk pion yang menyala ketika giliranmu."});
    addSvg(svg,"title",{},"Papan Ludo LightJurnal");
    addSvg(svg,"rect",{x:0,y:0,width:600,height:600,fill:"#f6f7fb"});
    appendHomeBases(svg);
    appendTrack(svg);
    const tokens=currentTokens();
    const gs=gameState();
    const tokenGroups=new Map();
    tokens.forEach((token) => {
      const point=coordinateForToken(token);
      const key=Math.round(point.x)+":"+Math.round(point.y);
      if(!tokenGroups.has(key))tokenGroups.set(key,[]);
      tokenGroups.get(key).push({...token,point});
    });
    tokenGroups.forEach((group) => group.forEach((token,index) => {
      const color=COLORS[token.seat]||COLORS[0];
      const nudge=group.length>1?OFFSETS[index%OFFSETS.length]:[0,0];
      const x=token.point.x+nudge[0],y=token.point.y+nudge[1];
      const canMove=legalMove(token);
      const groupEl=addSvg(svg,"g",{
        class:"ludo-token"+(canMove?" can-move":""),
        "data-token-user":token.userId,
        "data-token-index":token.index,
        role:canMove?"button":"img",
        tabindex:canMove?"0":"-1",
        "aria-label":color.name+", pion "+(token.index+1)+(token.progress===57?", sudah finis":token.progress===-1?", di rumah":"")
      });
      addSvg(groupEl,"circle",{cx:x,cy:y,r:14,fill:"#ffffff",stroke:canMove?"#111827":"#ffffff","stroke-width":canMove?3:2});
      addSvg(groupEl,"circle",{cx:x,cy:y,r:10.5,fill:color.main,stroke:color.main,"stroke-width":1});
      addSvg(groupEl,"text",{x,y:y+3.8,"text-anchor":"middle","font-size":10,"font-weight":900,fill:"#ffffff","pointer-events":"none"},String(token.index+1));
      if(canMove)addSvg(groupEl,"circle",{cx:x,cy:y,r:18,fill:"none",stroke:"#ffffff","stroke-width":2,"stroke-dasharray":"3 3","pointer-events":"none"});
      // Larger transparent hit target improves tapping on small phone screens.
      if(canMove)addSvg(groupEl,"circle",{cx:x,cy:y,r:25,fill:"#ffffff","fill-opacity":".001",stroke:"none","pointer-events":"all","aria-hidden":"true"});
    }));
    container.append(svg);
    container.onclick=(event) => {
      const target=event.target instanceof Element?event.target.closest("[data-token-user]"):null;
      if(!target)return;
      const userId=target.getAttribute("data-token-user");
      const index=Number(target.getAttribute("data-token-index"));
      const token=tokens.find((item)=>item.userId===userId&&item.index===index);
      if(token&&legalMove(token))void moveToken(userId,index,target);
    };
    container.onkeydown=(event)=>{
      if(event.key!=="Enter"&&event.key!==" ")return;
      const target=event.target instanceof Element?event.target.closest("[data-token-user]"):null;
      if(!target)return;
      event.preventDefault();
      const userId=target.getAttribute("data-token-user");
      const index=Number(target.getAttribute("data-token-index"));
      const token=tokens.find((item)=>item.userId===userId&&item.index===index);
      if(token&&legalMove(token))void moveToken(userId,index,target);
    };
  }

  function hasLegalMove() {
    const gs=gameState();
    if(gs.pending_roll===null||gs.pending_roll===undefined||gs.current_player_id!==state.user.id)return false;
    const roll=Number(gs.pending_roll);
    if(!Number.isInteger(roll)||roll<1||roll>6)return false;
    const tokenList=currentTokens().filter((t)=>t.userId===state.user.id);
    return tokenList.some((t)=>t.progress===-1?roll===6:(t.progress>=0&&t.progress<57&&t.progress+roll<=57));
  }

  function renderScoreList() {
    const gs=gameState();
    const tokens=gs.tokens||{};
    const source=Array.isArray(gs.players)&&gs.players.length?gs.players:state.players;
    $("#ludo-score-list").innerHTML=source.slice().sort((a,b)=>a.seat-b.seat).map((player) => {
      const color=COLORS[player.seat]||COLORS[0];
      const progress=tokens[player.user_id]||[-1,-1,-1,-1];
      const count=progress.filter((p)=>Number(p)===57).length;
      const isTurn=gs.current_player_id===player.user_id&&state.room.status==="playing";
      const suffix=count===4?"Pemenang":count+"/4 finis"+(isTurn?" · Giliran":"");
      return '<div class="ludo-score-item" style="--player-color:'+color.main+'"><span></span><strong>'+escapeHTML(player.display_name)+(player.user_id===state.user.id?" (Kamu)":"")+'</strong><small>'+escapeHTML(suffix)+'</small></div>';
    }).join("");
  }

  function renderGame() {
    const gs=gameState();
    const isPlaying=state.room.status==="playing"||state.room.status==="finished";
    $("#ludo-game-panel").hidden=!isPlaying;
    if(!isPlaying)return;
    const currentId=gs.current_player_id;
    const currentName=playerName(currentId);
    const isMyTurn=currentId===state.user.id&&state.room.status==="playing";
    const pending=gs.pending_roll===null||gs.pending_roll===undefined?null:Number(gs.pending_roll);
    $("#ludo-turn-heading").textContent=state.room.status==="finished"?"Permainan selesai":(isMyTurn?"Giliranmu!":"Giliran "+currentName);
    $("#ludo-dice-result").textContent=gs.last_roll===null||gs.last_roll===undefined?"—":String(gs.last_roll);
    $("#ludo-last-action").textContent=gs.last_action||"Lempar dadu untuk mulai.";
    const canMove=hasLegalMove();
    const rollButton=$("#ludo-roll-dice");
    rollButton.disabled=!isMyTurn||pending!==null||state.actionBusy;
    rollButton.textContent=!isMyTurn?"Giliran "+currentName:pending!==null?"Pilih pion yang menyala":"🎲 Lempar dadu";
    $("#ludo-skip-turn").hidden=!(isMyTurn&&pending!==null&&!canMove);
    $("#ludo-skip-turn").disabled=state.actionBusy;
    if(state.room.status==="finished"){
      showGameMessage("🏆 "+playerName(gs.winner_id)+" menang! Room selesai.");
    }else if(!isMyTurn){
      showGameMessage("Tunggu giliran "+currentName+". Papan akan diperbarui untuk semua pemain.");
    }else if(pending!==null&&canMove){
      showGameMessage("Kamu mendapat "+pending+". Ketuk pion milikmu yang menyala untuk bergerak.");
    }else if(pending!==null&&!canMove){
      showGameMessage("Tidak ada langkah yang valid. Lewati giliran untuk melanjutkan.");
    }else{
      showGameMessage("Giliranmu. Lempar dadu untuk bermain.");
    }
    renderBoard();
    renderScoreList();
  }

  function renderRoom() {
    const room=state.room;
    if(!room)return;
    $("#ludo-room-view").hidden=false;
    $("#ludo-lobby").hidden=true;
    $("#ludo-my-rooms-panel").hidden=true;
    $("#ludo-my-requests-panel").hidden=true;
    $("#ludo-room-name").textContent=room.title;
    $("#ludo-room-code").textContent=room.code;
    $("#ludo-room-subtitle").textContent="Kode "+room.code+" · "+state.players.length+" dari "+room.max_players+" pemain";
    $("#ludo-room-status").textContent=statusLabel(room.status);
    renderRoster();
    updateRoomControls();
    renderRoomRequestsFallback();
    renderGame();
  }

  function renderRoomRequestsFallback() {
    const owner=state.room?.owner_id===state.user.id;
    $("#ludo-pending-requests").hidden=!owner||state.room.status!=="waiting"||!state.requests.length;
  }

  async function refreshRoom() {
    if(!state.room)return;
    // Do not drop a refresh requested by a Realtime event or a game action.
    // Queue it and run once the in-flight read has completed.
    if(state.refreshBusy) {
      state.refreshPending=true;
      return;
    }
    state.refreshBusy=true;
    try {
      const roomId=state.room.id;
      const [{data:room,error:roomError},{data:players,error:playersError}]=await Promise.all([
        window.ljSupabase.from("ludo_rooms").select("id,code,title,status,max_players,owner_id,game_state,created_at,updated_at").eq("id",roomId).single(),
        window.ljSupabase.from("ludo_players").select("room_id,user_id,display_name,seat,joined_at").eq("room_id",roomId).order("seat")
      ]);
      if(roomError)throw roomError;
      if(playersError)throw playersError;
      if(state.room?.id!==roomId)return;
      state.room=room;
      state.players=players||[];
      renderRoom();
      if(room.owner_id===state.user.id&&room.status==="waiting")await loadRoomRequests();
    }catch(error){
      showGameMessage(error?.message||"Room belum bisa diperbarui. Periksa koneksi.");
    }finally{
      state.refreshBusy=false;
      if(state.refreshPending){state.refreshPending=false;void refreshRoom();}
    }
  }

  async function openRoom(roomId) {
    if(!roomId||state.openingRoom)return;
    state.openingRoom=true;
    stopRoomLiveUpdates();
    showNotice("");
    try {
      const [{data:room,error:roomError},{data:players,error:playersError}]=await Promise.all([
        window.ljSupabase.from("ludo_rooms").select("id,code,title,status,max_players,owner_id,game_state,created_at,updated_at").eq("id",roomId).single(),
        window.ljSupabase.from("ludo_players").select("room_id,user_id,display_name,seat,joined_at").eq("room_id",roomId).order("seat")
      ]);
      if(roomError)throw roomError;
      if(playersError)throw playersError;
      state.room=room;
      state.players=players||[];
      state.requests=[];
      $("#ludo-invite-result").hidden=true;
      $("#ludo-room-view").hidden=false;
      $("#ludo-lobby").hidden=true;
      $("#ludo-my-rooms-panel").hidden=true;
      $("#ludo-my-requests-panel").hidden=true;
      const nextUrl=new URL(window.location.href);
      nextUrl.search="";
      nextUrl.searchParams.set("room",room.id);
      window.history.replaceState({}, "", nextUrl);
      renderRoom();
      subscribeToRoom(roomId);
      await loadRoomRequests();
    } catch(error) {
      state.room=null;
      state.players=[];
      $("#ludo-room-view").hidden=true;
      $("#ludo-lobby").hidden=false;
      $("#ludo-my-rooms-panel").hidden=false;
      showNotice(error?.message||"Room tidak ditemukan atau akunmu belum menjadi anggotanya.", "error");
      await loadMyRooms();
    } finally {
      state.openingRoom=false;
    }
  }

  function returnToLobby() {
    stopRoomLiveUpdates();
    state.room=null;
    state.players=[];
    state.requests=[];
    $("#ludo-room-view").hidden=true;
    $("#ludo-lobby").hidden=false;
    $("#ludo-my-rooms-panel").hidden=false;
    const nextUrl=new URL("ludo.html",window.location.href);
    window.history.replaceState({}, "", nextUrl);
    void loadMyRooms();
    void loadMyRequests();
    showNotice("");
  }

  async function createRoom(event) {
    event.preventDefault();
    const button=$("#ludo-create-submit");
    if(state.actionBusy)return;
    const title=$("#ludo-room-title").value.trim();
    const maxPlayers=Number($("#ludo-player-limit").value);
    if(title.length<2||title.length>50){showNotice("Nama room harus 2–50 karakter.","error");return;}
    state.actionBusy=true;
    setButtonBusy(button,true,"Membuat room…");
    try {
      const result=await rpc("ludo_create_room",{p_title:title,p_max_players:maxPlayers});
      await loadMyRooms();
      await openRoom(result.room_id);
      showNotice("Room berhasil dibuat. Buat tautan undangan untuk mengajak teman.","success");
    } catch(error) {
      showNotice(friendlyLudoDatabaseError(error, "Room belum bisa dibuat. Pastikan migrasi Ludo di Supabase sudah dijalankan."), "error");
    } finally {
      state.actionBusy=false;setButtonBusy(button,false);
    }
  }

  async function requestJoin(event) {
    event.preventDefault();
    const button=$("#ludo-request-submit");
    if(state.requestBusy)return;
    const code=$("#ludo-room-code-input").value.trim().toUpperCase();
    if(!/^[A-F0-9]{6}$/.test(code)){showNotice("Masukkan kode room 6 karakter yang valid.","error");return;}
    state.requestBusy=true;setButtonBusy(button,true,"Mengirim…");
    try {
      const result=await rpc("ludo_request_join",{p_code:code});
      if(result.status==="member"){
        await openRoom(result.room_id);
        showNotice("Kamu sudah menjadi anggota room ini.","success");
      }else{
        showNotice("Permintaan bergabung terkirim. Kamu baru bisa masuk setelah pemilik menyetujuinya.","success");
        $("#ludo-room-code-input").value="";
        await loadMyRequests();
      }
    }catch(error){
      showNotice(error.message||"Permintaan belum bisa dikirim.","error");
    }finally{state.requestBusy=false;setButtonBusy(button,false);}
  }

  async function createInvite() {
    if(!state.room||state.room.owner_id!==state.user.id)return;
    const button=$("#ludo-create-invite");
    setButtonBusy(button,true,"Membuat tautan…");
    try{
      const token=await rpc("ludo_create_invite",{p_room_id:state.room.id});
      const inviteUrl=new URL("ludo.html",window.location.href);
      inviteUrl.searchParams.set("invite",token);
      $("#ludo-invite-url").value=inviteUrl.href;
      $("#ludo-invite-result").hidden=false;
      await copyWithFeedback(inviteUrl.href,"Tautan undangan dibuat dan disalin. Kirim secara pribadi kepada teman yang kamu undang.");
    }catch(error){showNotice(error.message||"Tautan undangan belum bisa dibuat.","error");}
    finally{setButtonBusy(button,false);}
  }

  async function reviewRequest(requestId,approve,button) {
    if(state.actionBusy)return;
    state.actionBusy=true;setButtonBusy(button,true,approve?"Menerima…":"Menolak…");
    try{
      await rpc("ludo_review_join_request",{p_request_id:requestId,p_approve:approve});
      showNotice(approve?"Permintaan disetujui. Pemain ditambahkan ke room.":"Permintaan ditolak.","success");
      await refreshRoom();
      await loadRoomRequests();
      await loadMyRooms();
    }catch(error){showNotice(error.message||"Permintaan belum dapat diproses.","error");}
    finally{state.actionBusy=false;setButtonBusy(button,false);}
  }

  async function startGame() {
    if(state.actionBusy)return;
    const button=$("#ludo-start-game");
    state.actionBusy=true;setButtonBusy(button,true,"Menyiapkan papan…");
    try{
      await rpc("ludo_start_game",{p_room_id:state.room.id});
      await refreshRoom();
      showNotice("Permainan dimulai! Selamat mabar.","success");
    }catch(error){showNotice(error.message||"Permainan belum dapat dimulai.","error");}
    finally{state.actionBusy=false;setButtonBusy(button,false);}
  }

  async function rollDice() {
    if(state.actionBusy||!state.room)return;
    const button=$("#ludo-roll-dice");
    state.actionBusy=true;setButtonBusy(button,true,"Melempar…");
    try{
      await rpc("ludo_roll_dice",{p_room_id:state.room.id});
      await refreshRoom();
    }catch(error){showGameMessage(error.message||"Dadu belum bisa dilempar.");await refreshRoom();}
    finally{state.actionBusy=false;setButtonBusy(button,false);renderGame();}
  }

  async function skipTurn() {
    if(state.actionBusy||!state.room)return;
    const button=$("#ludo-skip-turn");
    state.actionBusy=true;setButtonBusy(button,true,"Melanjutkan…");
    try{await rpc("ludo_skip_turn",{p_room_id:state.room.id});await refreshRoom();}
    catch(error){showGameMessage(error.message||"Giliran belum bisa dilewati.");await refreshRoom();}
    finally{state.actionBusy=false;setButtonBusy(button,false);renderGame();}
  }

  async function leaveRoom() {
    if (state.actionBusy || !state.room) return;
    if (!window.confirm("Keluar dari room ini? Kamu bisa meminta bergabung lagi jika room masih menunggu.")) return;
    const button=$("#ludo-leave-room");
    state.actionBusy=true;
    setButtonBusy(button,true,"Keluar…");
    try{
      await rpc("ludo_leave_room",{p_room_id:state.room.id});
      stopRoomLiveUpdates();
      state.room=null;state.players=[];state.requests=[];
      $("#ludo-room-view").hidden=true;
      $("#ludo-lobby").hidden=false;
      $("#ludo-my-rooms-panel").hidden=false;
      window.history.replaceState({}, "", "ludo.html");
      await loadMyRooms();
      await loadMyRequests();
      showNotice("Kamu sudah keluar dari room.","success");
    }catch(error){showNotice(error.message||"Belum bisa keluar dari room.","error");}
    finally{state.actionBusy=false;setButtonBusy(button,false);}
  }

  async function closeRoom() {
    if(state.actionBusy||!state.room)return;
    if(!window.confirm("Tutup room ini? Pemain tidak bisa melanjutkan atau memakai undangan lama."))return;
    const button=$("#ludo-close-room");
    state.actionBusy=true;setButtonBusy(button,true,"Menutup…");
    try{
      await rpc("ludo_close_room",{p_room_id:state.room.id});
      stopRoomLiveUpdates();
      state.room=null;state.players=[];state.requests=[];
      $("#ludo-room-view").hidden=true;
      $("#ludo-lobby").hidden=false;
      $("#ludo-my-rooms-panel").hidden=false;
      window.history.replaceState({}, "", "ludo.html");
      await loadMyRooms();
      showNotice("Room ditutup.","success");
    }catch(error){showNotice(error.message||"Room belum bisa ditutup.","error");}
    finally{state.actionBusy=false;setButtonBusy(button,false);}
  }

  async function handleInviteFromUrl() {
    const params=new URLSearchParams(window.location.search);
    const token=params.get("invite");
    if(!token)return false;
    showNotice("Memeriksa tautan undangan…");
    try{
      const result=await rpc("ludo_join_invite",{p_token:token});
      await loadMyRooms();
      await openRoom(result.room_id);
      showNotice("Kamu berhasil masuk melalui tautan undangan.","success");
    }catch(error){
      showNotice(error.message||"Undangan tidak dapat digunakan.","error");
    }
    return true;
  }

  function initTheme() {
    const themeButton=$("#theme-toggle"),themeIcon=$("#theme-icon");
    const sync=()=>{
      const dark=document.documentElement.dataset.theme==="dark";
      if(themeIcon)themeIcon.textContent=dark?"☀":"☾";
      if(themeButton)themeButton.setAttribute("aria-label",dark?"Aktifkan mode terang":"Aktifkan mode gelap");
    };
    themeButton?.addEventListener("click",()=>{
      const dark=document.documentElement.dataset.theme==="dark";
      if(dark)delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme="dark";
      try{localStorage.setItem("lj-theme",dark?"light":"dark");}catch(_){}
      sync();
    });
    sync();
  }

  function bindControls() {
    $("#ludo-create-form").addEventListener("submit",createRoom);
    $("#ludo-request-form").addEventListener("submit",requestJoin);
    $("#ludo-refresh-rooms").addEventListener("click",()=>{void loadMyRooms();});
    $("#ludo-refresh-requests").addEventListener("click",()=>{void loadMyRequests();});
    $("#ludo-back-lobby").addEventListener("click",returnToLobby);
    $("#ludo-create-invite").addEventListener("click",()=>void createInvite());
    $("#ludo-copy-invite").addEventListener("click",()=>void copyWithFeedback($("#ludo-invite-url").value,"Tautan undangan disalin."));
    $("#ludo-copy-code").addEventListener("click",()=>void copyWithFeedback($("#ludo-room-code").textContent,"Kode room disalin. Bagikan kode ini agar teman bisa meminta bergabung."));
    $("#ludo-start-game").addEventListener("click",()=>void startGame());
    $("#ludo-roll-dice").addEventListener("click",()=>void rollDice());
    $("#ludo-skip-turn").addEventListener("click",()=>void skipTurn());
    $("#ludo-close-room").addEventListener("click",()=>void closeRoom());
    $("#ludo-leave-room").addEventListener("click",()=>void leaveRoom());
    $("#ludo-room-code").addEventListener("click",()=>void copyWithFeedback($("#ludo-room-code").textContent,"Kode room disalin."));
    $("#ludo-my-rooms").addEventListener("click",(event)=>{
      const button=event.target.closest("[data-open-room]");
      if(button)void openRoom(button.dataset.openRoom);
    });
    $("#ludo-pending-list").addEventListener("click",(event)=>{
      const button=event.target.closest("[data-review-request]");
      if(button)void reviewRequest(button.dataset.reviewRequest,button.dataset.approve==="true",button);
    });
    $("#ludo-room-code").closest(".ludo-code-box").addEventListener("dblclick",()=>void copyWithFeedback($("#ludo-room-code").textContent,"Kode room disalin."));
  }

  async function init() {
    $("#ludo-year").textContent=String(new Date().getFullYear());
    initTheme();
    if(!window.ljSupabaseConfigured||!window.ljSupabase){
      $("#ludo-config-warning").hidden=false;
      $("#ludo-app").hidden=true;
      return;
    }
    const {data:sessionData,error:sessionError}=await window.ljSupabase.auth.getSession();
    if(sessionError||!sessionData.session?.user){showAuth();return;}
    state.user=sessionData.session.user;
    const {data:profile}=await window.ljSupabase.from("profiles").select("display_name").eq("id",state.user.id).maybeSingle();
    state.profileName=profile?.display_name?.trim()||(state.user.email||"").split("@")[0]||"Pemain";
    $("#ludo-auth-required").hidden=true;
    $("#ludo-app").hidden=false;
    bindControls();
    subscribeToUserRequests();
    await Promise.all([loadMyRooms(),loadMyRequests()]);
    const params=new URLSearchParams(window.location.search);
    if(params.get("invite")){
      await handleInviteFromUrl();
    }else if(params.get("room")){
      await openRoom(params.get("room"));
    }
    state.requestPollTimer=window.setInterval(()=>{
      if(document.visibilityState==="visible"){
        void loadMyRequests();
        void loadMyRooms();
      }
    },12000);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    init().catch((error)=>{
      console.error("LightJurnal Ludo initialization failed:",error);
      showNotice(error?.message||"Game belum bisa dimulai. Muat ulang halaman.", "error");
    });
  });
})();