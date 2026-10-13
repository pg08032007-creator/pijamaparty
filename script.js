/* =========================================================
   PIJAMA PARTY — script.js
   Feed de fotos e vídeos com curtidas persistentes, chat com confirmação de entrega/leitura,
   digitando, anexos, bloqueio, grupos, notificações em tempo real, carteira com PIX,
   lives (WebRTC) e tema claro/escuro.
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* ================= SUPABASE ================= */
  const SUPABASE_URL = "https://sewzespbdntxnpcaauhl.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNld3plc3BiZG50eG5wY2FhdWhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNzE2MzcsImV4cCI6MjEwMTk0NzYzN30.KnI6x4pgpGcZbMHW9lo16XjPeQDK_58LUTHRTnCMhSg";

  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) || null;

  /* ================= ESTADO GLOBAL ================= */
  const state = {
    user: null,
    profile: null,
    session: null,
    visitor: false,
    currentPage: "pageHome",
    prevPage: "pageHome",
    lives: [],
    userLivesMap: {},
    livesFetchedAt: 0,
    posts: [],
    profilePosts: [],
    detailPost: null,
    detailPostId: null,
    myLikes: new Set(),
    messages: [],
    pendingMessages: [],
    activeLive: null,
    activeChatUser: null,
    activeOtherUser: null,
    selectedVisibility: "public",
    trendingLives: [],
    trendingSignature: "",
    commentCounts: {},
    selectedCoinPack: { amount: 100, price: 5 },
    activeMsgForAction: null,
    unreadChats: 0,
    unreadNotifications: 0,
    countsLoaded: false,
    onlineIds: new Set(),
    // chat: bloqueios, conversas removidas/apagadas, grupos e anexo pendente
    blockedIds: new Set(),
    chatSettings: {},
    followingIds: new Set(),
    socialLoaded: false,
    chatRows: new Map(),
    chatOptionsUser: null,
    activeGroup: null,
    infoGroup: null,
    groups: [],
    myGroupIds: new Set(),
    unreadGroups: 0,
    chatTab: "chats",
    pendingMedia: null
  };

  /* ================= HELPERS DOM & UTILS ================= */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function on(selector, event, handler, root = document) {
    const el = $(selector, root);
    if (el) el.addEventListener(event, handler);
    return el;
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function escapeHTML(str = "") {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function toast(message) {
    let element = $("#toast");
    if (!element) {
      element = document.createElement("div");
      element.id = "toast";
      element.className = "toast";
      document.body.appendChild(element);
    }
    element.textContent = String(message || "");
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
  }

  const ERROR_TRANSLATIONS = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
    [/user already registered/i, "Este e-mail já está cadastrado."],
    [/password should be at least/i, "A senha precisa ter pelo menos 6 caracteres."],
    [/new password should be different/i, "A nova senha precisa ser diferente da atual."],
    [/failed to fetch|networkerror/i, "Sem conexão com o servidor. Verifique sua internet."],
    [/row-level security/i, "Você não tem permissão para fazer isso."],
    [/blocked_user/i, "Não foi possível enviar mensagem para este usuário."],
    [/group_not_found/i, "Nenhum grupo encontrado com esse ID."],
    [/group_full/i, "Esse grupo já está lotado."],
    [/invalid_group_name/i, "Use um nome de 2 a 40 caracteres."],
    [/'avatar_url' column of 'groups'|groups\.avatar_url/i, "Para usar foto de grupo, rode o arquivo setup_grupo_foto.sql no Supabase."],
    [/exceeded the maximum allowed size|payload too large|entity too large/i, "O arquivo é grande demais para o servidor."],
    [/insufficient_funds/i, "Moedas insuficientes para esta compra."],
    [/already_owned/i, "Você já possui este item."],
    [/item_not_found/i, "Este item não está mais disponível."],
    [/banner_not_owned/i, "Você precisa comprar este banner na loja primeiro."],
    [/store_items|user_items|buy_store_item/i, "A loja precisa da atualização do banco. Rode o arquivo setup_loja.sql no Supabase."],
    [/could not find the table|relation .* does not exist|schema cache|could not find the .* column|column .* does not exist|function .* does not exist/i,
      "Este recurso precisa da atualização do banco. Rode o arquivo setup_banco_v3.sql no Supabase."]
  ];

  function formatError(error) {
    if (!error) return "Erro desconhecido.";
    const raw = typeof error === "string" ? error : (error.message || JSON.stringify(error));
    const known = ERROR_TRANSLATIONS.find(([pattern]) => pattern.test(raw));
    return known ? known[1] : raw;
  }

  function initials(name = "U") {
    const clean = String(name).trim();
    return clean ? clean.charAt(0).toUpperCase() : "U";
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return "agora";
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMins < 1) return "agora";
    if (diffMins < 60) return `${diffMins}min`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
  }

  function formatClock(dateString) {
    if (!dateString) return "";
    return new Date(dateString).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDateTime(dateString) {
    if (!dateString) return "";
    return new Date(dateString).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function dayLabel(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return "Hoje";
    if (date.toDateString() === yesterday.toDateString()) return "Ontem";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (modal) {
      modal.removeAttribute("inert");
      modal.classList.add("active");
    }
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (modal) {
      modal.setAttribute("inert", "");
      modal.classList.remove("active");
      modal.querySelectorAll("video").forEach(v => v.pause());
    }
  }

  function readJSON(key, fallback = {}) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch (e) { return fallback; }
  }

  /* ================= TEMA CLARO / ESCURO ================= */
  const THEME_KEY = "pp_theme";
  const PREFS_KEY = "pp_prefs";
  const prefs = Object.assign({ alerts: true, sound: false, showOnline: true, showTyping: true }, readJSON(PREFS_KEY));

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function syncThemeUI() {
    const active = currentTheme();
    $$("[data-theme-choice]").forEach(btn => {
      const isActive = btn.dataset.themeChoice === active;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });
  }

  function applyTheme(theme, persist = true) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    $('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f3f4f8" : "#0f0f12");
    if (persist) { try { localStorage.setItem(THEME_KEY, next); } catch (e) {} }
    syncThemeUI();
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  let audioCtx = null;
  function playPing() {
    if (!prefs.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch (e) {}
  }

  function notifyUser(message) {
    if (prefs.alerts) toast(message);
    playPing();
  }

  /* ================= DIÁLOGOS (substituem prompt/confirm do navegador) ================= */
  let confirmResolver = null;

  function askConfirm({ title = "Tem certeza?", message = "", confirmText = "Confirmar", danger = false } = {}) {
    return new Promise(resolve => {
      if (confirmResolver) confirmResolver(false);
      confirmResolver = resolve;
      setText("#confirmTitle", title);
      setText("#confirmMessage", message);
      const ok = $("#confirmOk");
      ok.textContent = confirmText;
      ok.classList.toggle("danger-solid", danger);
      ok.classList.toggle("primary", !danger);
      $("#confirmIcon")?.classList.toggle("danger", danger);
      openModal("confirmModal");
    });
  }

  function settleConfirm(value) {
    closeModal("confirmModal");
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(value);
  }

  on("#confirmOk", "click", () => settleConfirm(true));
  on("#confirmCancel", "click", () => settleConfirm(false));
  on("#confirmModal", "click", (e) => { if (e.target.id === "confirmModal") settleConfirm(false); });

  let textResolver = null;
  let textOptions = { allowEmpty: false };

  function updateTextCounter() {
    const input = $("#editTextInput");
    if (input) setText("#editTextCounter", `${input.value.length}/${input.maxLength}`);
  }

  function askText({ title, label, value = "", maxLength = 500, image = null, hint = "", confirmText = "Salvar alterações", allowEmpty = false, placeholder = "" } = {}) {
    return new Promise(resolve => {
      if (textResolver) textResolver(null);
      textResolver = resolve;
      textOptions = { allowEmpty };
      setText("#editTextTitle", title);
      setText("#editTextLabel", label);
      setText("#editTextHint", hint);
      const input = $("#editTextInput");
      input.maxLength = maxLength;
      input.value = value;
      input.placeholder = placeholder;
      const media = $("#editTextMedia");
      if (image) {
        $("#editTextImage").src = image;
        media.classList.remove("hidden");
      } else {
        $("#editTextImage").removeAttribute("src");
        media.classList.add("hidden");
      }
      setText("#saveEditText", confirmText);
      updateTextCounter();
      openModal("editTextModal");
      setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
    });
  }

  function settleText(value) {
    closeModal("editTextModal");
    const resolve = textResolver;
    textResolver = null;
    if (resolve) resolve(value);
  }

  on("#editTextInput", "input", updateTextCounter);
  on("#editTextForm", "submit", (e) => {
    e.preventDefault();
    const value = $("#editTextInput").value.trim();
    if (!value && !textOptions.allowEmpty) return toast("Escreva algo antes de salvar.");
    settleText(value);
  });
  on("#cancelEditText", "click", () => settleText(null));
  on("#closeEditText", "click", () => settleText(null));
  on("#editTextModal", "click", (e) => { if (e.target.id === "editTextModal") settleText(null); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("#confirmModal")?.classList.contains("active")) settleConfirm(false);
    else if ($("#editTextModal")?.classList.contains("active")) settleText(null);
    else if (!$("#mediaViewer")?.classList.contains("hidden")) closeMediaViewer();
    else {
      const open = $$(".modal.active").pop();
      if (!open) return;
      const closer = open.querySelector(".modal-header .icon-btn");
      if (closer) closer.click(); else closeModal(open.id);
    }
  });

  /* ================= SELOS, PERMISSÕES E CACHE DE PERFIS ================= */
  function getBadgesHTML(user) {
    if (!user) return "";
    let html = "";
    if (user.is_verified) html += `<i class="fa-solid fa-circle-check badge-verified" title="Verificado"></i>`;
    if (user.is_developer) html += `<i class="fa-solid fa-code badge-developer" title="Desenvolvedor"></i>`;
    return html ? `<span class="badges-container">${html}</span>` : "";
  }

  function isAdmin() { return !!state.profile?.is_admin; }

  const profileCache = {};
  async function getProfileLite(id) {
    if (!id || !db) return null;
    if (profileCache[id]) return profileCache[id];
    const { data } = await db.from("profiles")
      .select("id, username, display_name, avatar_url, is_verified, is_developer")
      .eq("id", id).maybeSingle();
    if (data) profileCache[id] = data;
    return data;
  }

  /* ================= PONTOS / CONTADORES DE ATIVIDADE ================= */
  function setBadge(host, count) {
    if (!host) return;
    let dot = host.querySelector(".notification-dot");
    if (count > 0) {
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "notification-dot";
        host.appendChild(dot);
      }
      dot.classList.remove("hidden");
      dot.classList.add("has-count");
      dot.textContent = count > 99 ? "99+" : String(count);
    } else if (dot) {
      dot.classList.add("hidden");
      dot.textContent = "";
    }
  }

  function updateActivityDots() {
    setBadge($("#btnNotifications"), state.unreadNotifications);
    setBadge($('[data-page="pageChats"]'), state.unreadChats + state.unreadGroups);
    const tabBadge = $("#groupsTabBadge");
    if (tabBadge) {
      tabBadge.textContent = state.unreadGroups > 99 ? "99+" : String(state.unreadGroups);
      tabBadge.classList.toggle("hidden", !(state.unreadGroups > 0));
    }
  }

  /* ================= IMAGENS (fallback quando o Storage falha) ================= */
  function fileToDataURL(file, maxSize = 1280, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => resolve(e.target.result);
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ================= MÍDIA (fotos e vídeos): validação, envio e HTML ================= */
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  const isVideoFile = (file) => !!file && String(file.type || "").startsWith("video/");
  const isImageFile = (file) => !!file && String(file.type || "").startsWith("image/");

  function validateMediaFile(file) {
    if (!file) return "Selecione um arquivo.";
    if (isImageFile(file)) return file.size > MAX_IMAGE_BYTES ? "A foto deve ter até 8 MB." : null;
    if (isVideoFile(file)) return file.size > MAX_VIDEO_BYTES ? "O vídeo deve ter até 50 MB." : null;
    return "Escolha uma foto ou um vídeo.";
  }

  function formatBytes(bytes = 0) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  }

  // Reduz fotos grandes (câmera do celular: 4–8 MB) antes de enviar: sobe e carrega muito mais rápido.
  async function compressImage(file, maxSide = 1600, quality = 0.82) {
    try {
      if (!isImageFile(file) || /gif|svg/i.test(file.type || "") || !window.createImageBitmap) return file;
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 350 * 1024) { bmp.close?.(); return file; }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";                       // PNG com fundo transparente não vira preto no JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch (e) {
      return file;
    }
  }

  // Envia para o Storage (bucket "avatars", o mesmo já usado por perfis e posts).
  // Foto: se o Storage falhar, cai para uma versão reduzida (DataURL). Vídeo: precisa do Storage.
  async function uploadMedia(originalFile, folder) {
    const type = isVideoFile(originalFile) ? "video" : "image";
    const file = type === "image" ? await compressImage(originalFile) : originalFile;
    if (db && state.user?.id) {
      const rawExt = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const ext = rawExt || (type === "video" ? "mp4" : "jpg");
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const userPath = `${state.user.id}/${folder}_${stamp}.${ext}`;
      const postsPath = `posts/${state.user.id}_${folder}_${stamp}.${ext}`;
      for (const path of (folder === "posts" ? [postsPath, userPath] : [userPath, postsPath])) {
        try {
          // nome único por envio → pode ficar 1 ano em cache no navegador/CDN
          const { error } = await db.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "31536000", contentType: file.type || undefined });
          if (!error) {
            const { data } = db.storage.from("avatars").getPublicUrl(path);
            if (data?.publicUrl) return { url: data.publicUrl, type };
          } else {
            console.warn("Upload para o Storage falhou:", error);
          }
        } catch (err) {
          console.warn("Upload para o Storage falhou:", err);
        }
      }
    }
    if (type === "image") return { url: await fileToDataURL(file), type };
    throw new Error("Não foi possível enviar o vídeo. Verifique o Storage do Supabase (tamanho máximo e permissões).");
  }

  async function shareLink({ title, text, url }) {
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`.trim());
      toast("Link copiado!");
    } catch (e) {
      toast("Não foi possível compartilhar neste navegador.");
    }
  }

  /* ================= CARTEIRA, SALDO E COMPRA DE MOEDAS (PIX) ================= */
  async function spendCoins(amount, toUser) {
    if (!db) return false;
    const { data, error } = await db.rpc("spend_coins", { p_amount: amount, p_to: toUser || null });
    if (error) { toast(formatError(error)); return false; }
    if (state.profile && data !== null && data !== undefined) state.profile.wallet_balance = data;
    updateProfileUI();
    return true;
  }

  function selectCoinPack(row) {
    $$(".coin-pack-row").forEach(r => r.classList.remove("selected"));
    row.classList.add("selected");
    state.selectedCoinPack = {
      amount: parseInt(row.dataset.amount, 10),
      price: parseFloat(row.dataset.price)
    };
  }

  function openBuyCoinsModal(amount) {
    if (state.visitor) return toast("Cadastre-se para comprar moedas.");
    const rows = $$(".coin-pack-row");
    const row = rows.find(r => parseInt(r.dataset.amount, 10) === amount) || rows[0];
    if (row) selectCoinPack(row);
    if ($("#pixUserMessage")) $("#pixUserMessage").value = "";
    openModal("buyCoinsModal");
  }

  on("#closeBuyCoinsModal", "click", () => closeModal("buyCoinsModal"));
  on("#cancelBuyCoins", "click", () => closeModal("buyCoinsModal"));
  $$(".coin-pack-row").forEach(row => row.addEventListener("click", () => selectCoinPack(row)));

  on("#confirmBuyCoins", "click", async () => {
    if (!db || !state.user) return toast("Entre na sua conta para comprar moedas.");
    const btn = $("#confirmBuyCoins");
    const userMsg = $("#pixUserMessage")?.value.trim() || "Sem observação.";
    if (btn) btn.disabled = true;

    const { error } = await db.from("pix_requests").insert({
      user_id: state.user.id,
      amount: state.selectedCoinPack.amount,
      price: state.selectedCoinPack.price,
      message: userMsg
    });

    if (btn) btn.disabled = false;
    if (error) return toast(`Não foi possível enviar o pedido: ${formatError(error)}`);

    closeModal("buyCoinsModal");
    toast("Pedido enviado! As moedas entram assim que o admin confirmar o PIX.");
  });

  /* ================= ANEL DE LIVE NOS AVATARES (clique delegado) ================= */
  // Captura o clique antes dos cards pai, para abrir a live em vez do perfil.
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-live-user-id]");
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    attemptOpenLive(el.dataset.liveUserId);
  }, true);

  function attachLiveAvatarListeners() { /* mantida por compatibilidade: o clique agora é delegado */ }

  /* ================= PRESENTES DA LIVE ================= */
  on("#btnOpenGifts", "click", () => {
    if (state.visitor) return toast("Cadastre-se para enviar presentes.");
    openModal("giftsModal");
  });
  on("#closeGiftsModal", "click", () => closeModal("giftsModal"));

  function triggerGiftAnimation(emoji) {
    const container = $("#liveAnimationContainer");
    if (!container) return;
    const animEl = document.createElement("div");
    animEl.className = "gift-anim";
    animEl.textContent = emoji;
    container.appendChild(animEl);
    setTimeout(() => animEl.remove(), 3000);
  }

  $$(".gift-item").forEach(item => {
    item.addEventListener("click", async () => {
      const cost = parseInt(item.dataset.cost, 10);
      const emoji = item.dataset.emoji;
      const live = state.activeLive;
      if (!live) return;

      if (parseInt(state.profile?.wallet_balance || 0, 10) < cost) {
        closeModal("giftsModal");
        return toast("Moedas insuficientes. Adicione moedas em sua carteira!");
      }

      // Só anima e avisa a sala depois que o servidor confirmar o pagamento.
      const paid = await spendCoins(cost, live.host_id);
      if (!paid) return;

      const name = state.profile?.display_name || state.profile?.username || "Alguém";
      closeModal("giftsModal");
      triggerGiftAnimation(emoji);
      addLiveMsg(name, `enviou ${emoji}`);
      sendSig("gift", { emoji, name });
      toast(`Você enviou um presente (${emoji}) de ${cost} moedas!`);
    });
  });

  /* ================= COMPONENTE DE AVATAR COM ANEL DE LIVE ================= */
  function renderAvatarHTML(user, sizeClass = "") {
    if (!user) return `<div class="avatar ${sizeClass}">U</div>`;
    
    const isLive = !!state.userLivesMap[user.id];
    const liveAttr = isLive ? `data-live-user-id="${user.id}"` : "";
    const liveClass = isLive ? "is-live" : "";

    const imgOrInitials = user.avatar_url
      ? `<img src="${escapeHTML(user.avatar_url)}" alt="Avatar">`
      : initials(user.display_name || user.username);

    return `
      <div class="avatar-live-wrapper ${liveClass}" data-uid="${escapeHTML(String(user.id ?? ""))}" ${liveAttr}>
        <div class="avatar ${sizeClass}">${imgOrInitials}</div>
      </div>
    `;
  }

  function attemptOpenLive(userId) {
    const live = state.userLivesMap[userId] || state.trendingLives.find(l => l.host_id === userId);
    if (!live) return;

    if (state.visitor) return toast("Cadastre-se para assistir a esta live.");

    openLiveRoom(live);
  }

  /* ================= MAPEAR LIVES ATIVAS ================= */
  function canSeeLive(l) {
    if (l && l.last_heartbeat && l.host_id !== state.user?.id && Date.now() - new Date(l.last_heartbeat).getTime() > 90000) return false;
    if (!l || l.visibility !== "followers") return true;
    return !!state.user && (l.host_id === state.user.id || state.followingIds.has(l.host_id) || isAdmin());
  }

  // Várias telas pedem as lives ao mesmo tempo (início, stories, anéis): todas dividem UMA consulta.
  let livesInflight = null;
  function fetchActiveLivesMap(force = false) {
    if (!db) return Promise.resolve();
    if (!force && Date.now() - state.livesFetchedAt < 5000) return Promise.resolve();
    if (livesInflight) return livesInflight;
    livesInflight = (async () => {
      try {
        const { data, error } = await db.from("lives")
          .select("*, profiles(id, display_name, username, avatar_url, is_verified, is_developer)")
          .eq("status", "live");
        if (error) return;                       // falhou: mantém o último estado conhecido em vez de apagar tudo
        state.livesFetchedAt = Date.now();
        await ensureSocialState();
        state.lives = (data || []).filter(canSeeLive);
        state.userLivesMap = {};
        state.lives.forEach(live => {
          if (live.host_id) state.userLivesMap[live.host_id] = live;
        });
      } catch (e) {
        console.warn("Falha ao buscar lives:", e);
      } finally {
        livesInflight = null;
      }
    })();
    return livesInflight;
  }

  // Atualiza o anel de "ao vivo" dos avatares que já estão na tela, sem refazer as listas.
  function refreshLiveRings() {
    $$(".avatar-live-wrapper[data-uid]").forEach(w => {
      const uid = w.dataset.uid;
      if (!uid) return;
      const isLive = !!state.userLivesMap[uid];
      w.classList.toggle("is-live", isLive);
      if (isLive) w.dataset.liveUserId = uid; else delete w.dataset.liveUserId;
    });
  }

  /* ================= NAVEGAÇÃO ENTRE PÁGINAS ================= */
  const PAGES_WITHOUT_NAVBAR = ["pageChatRoom", "pageLiveRoom", "pageUserProfile", "pageSettings", "pageStore"];

  async function navigateTo(pageId) {
    const targetPage = $(`#${pageId}`);
    if (!targetPage) return;

    if (state.currentPage === "pageChatRoom" && pageId !== "pageChatRoom") leaveChatRoomCleanup();

    if (pageId === "pageUserProfile" && state.currentPage !== "pageUserProfile") {
      state.prevPage = state.currentPage;
    }

    $$(".page").forEach(p => p.classList.remove("active"));
    targetPage.classList.add("active");
    state.currentPage = pageId;

    $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.page === pageId));
    $("#navbar")?.classList.toggle("hidden", PAGES_WITHOUT_NAVBAR.includes(pageId));
    window.scrollTo(0, 0);
    if (pageId === "pageChats") restoreChatTab();

    // Não trava a troca de página esperando a rede: o conteúdo já começa a carregar
    // e os anéis de "ao vivo" são atualizados assim que a consulta volta.
    fetchActiveLivesMap().then(refreshLiveRings);

    if (pageId === "pageHome") {
      loadStories();
      loadPosts({ soft: true });
    } else if (pageId === "pageTrending") {
      loadTrending();
    } else if (pageId === "pageChats") {
      loadChats();
      loadGroups();
    } else if (pageId === "pageChatRoom") {
      renderChatHeader();
      openTypingChannel();
      fetchAndRenderMessages();
    } else if (pageId === "pageProfile") {
      updateProfileUI();
      refreshProfile().then(loadProfileExtras);
    } else if (pageId === "pageStore") {
      updateProfileUI();
      loadStore();
    } else if (pageId === "pageAdmin") {
      loadAdmin();
    } else if (pageId === "pageNotifications") {
      loadNotifications();
    }
  }

  $$(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) navigateTo(page);
    });
  });

  on("#btnSearchFromHome", "click", () => navigateTo("pageSearch"));
  on("#btnSearchUsersHeader", "click", () => {
    navigateTo("pageSearch");
    const input = $("#searchInput");
    if (input) {
      input.value = "";
      input.focus();
    }
  });
  on("#btnNotifications", "click", () => navigateTo("pageNotifications"));
  on("#btnOpenStore", "click", () => navigateTo("pageStore"));
  on("#btnWalletChip", "click", () => navigateTo("pageStore"));
  on("#btnBackStore", "click", () => navigateTo("pageHome"));
  on("#btnSettings", "click", () => navigateTo("pageSettings"));
  on("#btnBackChats", "click", () => navigateTo("pageChats"));
  on("#btnBackUserProfile", "click", () => navigateTo(state.prevPage && state.prevPage !== "pageUserProfile" ? state.prevPage : "pageHome"));
  on("#btnBackSettings", "click", () => navigateTo("pageProfile"));

  /* ================= CONFIGURAÇÕES ================= */
  $$("[data-theme-choice]").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeChoice));
  });

  $$("#pageSettings .settings-list button").forEach(btn => {
    btn.addEventListener("click", () => {
      const setting = btn.dataset.setting;
      if (setting === "profile") {
        navigateTo("pageProfile");
        if (!state.visitor && state.profile) openEditProfileModal();
      } else if (setting === "security") {
        if (state.visitor) return toast("Crie uma conta para gerenciar a segurança.");
        $("#passwordForm")?.reset();
        openModal("passwordModal");
      } else if (setting === "notifications") {
        $("#prefAlerts").checked = !!prefs.alerts;
        $("#prefSound").checked = !!prefs.sound;
        openModal("notifSettingsModal");
      } else if (setting === "privacy") {
        openPrivacyModal();
      }
    });
  });

  on("#prefAlerts", "change", (e) => { prefs.alerts = e.target.checked; savePrefs(); });
  on("#prefSound", "change", (e) => { prefs.sound = e.target.checked; savePrefs(); if (prefs.sound) playPing(); });
  on("#closeNotifSettings", "click", () => closeModal("notifSettingsModal"));
  on("#closePasswordModal", "click", () => closeModal("passwordModal"));
  on("#cancelPassword", "click", () => closeModal("passwordModal"));

  on("#passwordForm", "submit", async (e) => {
    e.preventDefault();
    if (!db || !state.user) return;
    const next = $("#newPassword").value;
    const confirmation = $("#confirmPassword").value;
    if (next.length < 6) return toast("A nova senha precisa ter pelo menos 6 caracteres.");
    if (next !== confirmation) return toast("As senhas não conferem.");

    const btn = $("#savePassword");
    btn.disabled = true;
    const { error } = await db.auth.updateUser({ password: next });
    btn.disabled = false;
    if (error) return toast(`Não foi possível alterar a senha: ${formatError(error)}`);
    closeModal("passwordModal");
    toast("Senha alterada com sucesso!");
  });

  /* ================= TELA DE AUTENTICAÇÃO ================= */
  const authScreen = $("#authScreen");
  const appScreen = $("#appScreen");

  function enterApp() {
    authScreen?.classList.add("hidden");
    appScreen?.classList.remove("hidden");
    if (state.user) {
      startRealtime();
      startPolling();
      markDelivered();
      loadSocialState().then(refreshUnreadCounts);
    }
    navigateTo("pageHome");
  }

  function resetSessionState() {
    state.user = null;
    state.profile = null;
    state.session = null;
    state.visitor = true;
    state.posts = [];
    state.profilePosts = [];
    state.myLikes = new Set();
    state.messages = [];
    state.pendingMessages = [];
    state.activeChatUser = null;
    state.activeGroup = null;
    state.groups = [];
    state.myGroupIds = new Set();
    state.blockedIds = new Set();
    state.chatSettings = {};
    state.followingIds = new Set();
    state.socialLoaded = false;
    state.unreadChats = 0;
    state.unreadGroups = 0;
    state.unreadNotifications = 0;
    state.countsLoaded = false;
    updateActivityDots();
  }

  function leaveApp() {
    stopRealtime();
    appScreen?.classList.add("hidden");
    authScreen?.classList.remove("hidden");
  }

  async function rejectIfBanned() {
    if (!state.profile?.is_banned) return false;
    try { await db.auth.signOut(); } catch (e) {}
    resetSessionState();
    leaveApp();
    toast("Sua conta está suspensa. Fale com o administrador.");
    return true;
  }

  $$(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".auth-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const isLogin = tab.dataset.authTab === "login";
      $("#loginForm")?.classList.toggle("hidden", !isLogin);
      $("#registerForm")?.classList.toggle("hidden", isLogin);
    });
  });

  on("#loginForm", "submit", async (e) => {
    e.preventDefault();
    if (!db) return toast("Supabase não configurado.");
    const email = $("#loginEmail")?.value.trim();
    const password = $("#loginPassword")?.value;
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (btn) btn.disabled = false;
    if (error) return toast(`Erro no login: ${formatError(error)}`);

    state.session = data.session;
    state.user = data.user;
    state.visitor = false;

    await fetchProfile();
    if (await rejectIfBanned()) return;
    updateProfileUI();
    enterApp();
    toast("Login efetuado com sucesso!");
  });

  on("#registerForm", "submit", async (e) => {
    e.preventDefault();
    if (!db) return toast("Supabase não configurado.");

    const email = $("#registerEmail")?.value.trim();
    const password = $("#registerPassword")?.value;
    const username = $("#registerUsername")?.value.trim().toLowerCase();
    const gender = $("#registerGender")?.value;

    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      return toast("O usuário deve ter de 3 a 20 caracteres: letras, números, _ ou ponto.");
    }

    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const { data: taken } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) {
      if (btn) btn.disabled = false;
      return toast("Esse nome de usuário já está em uso.");
    }

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { username, gender } }
    });
    if (btn) btn.disabled = false;
    if (error) return toast(`Erro ao cadastrar: ${formatError(error)}`);
    if (!data.user) return toast("Não foi possível criar a conta. Tente novamente.");

    // Sem sessão = o projeto exige confirmação de e-mail antes do primeiro acesso.
    if (!data.session) {
      $('[data-auth-tab="login"]')?.click();
      return toast("Conta criada! Confirme seu e-mail para poder entrar.");
    }

    state.session = data.session;
    state.user = data.user;
    state.visitor = false;

    const { error: profileError } = await db.from("profiles").upsert({
      id: data.user.id,
      username,
      gender,
      display_name: username,
      bio: "Bem-vindo ao Pijama Party!",
      followers: 0,
      following: 0,
      is_verified: false,
      is_developer: false
    });
    if (profileError) console.warn("Falha ao criar perfil:", profileError);

    await fetchProfile();
    enterApp();
    toast("Conta criada com sucesso!");
  });

  on("#btnAnonymous", "click", () => {
    state.visitor = true;
    state.user = null;
    state.profile = null;
    enterApp();
    toast("Entrou como visitante.");
  });

  // Perfil bloqueado no modo anônimo: leva para a tela de entrar / criar conta
  function goToAuth(tab) {
    stopRealtime();
    resetSessionState();
    leaveApp();
    $(`[data-auth-tab="${tab}"]`)?.click();
  }
  on("#btnGateLogin", "click", () => goToAuth("login"));
  on("#btnGateRegister", "click", () => goToAuth("register"));

  on("#btnLogout", "click", async () => {
    stopRealtime();
    if (db && state.session) await db.auth.signOut();
    resetSessionState();
    leaveApp();
    toast("Você saiu da conta.");
  });

  /* ================= PERFIL DO USUÁRIO ================= */
  async function fetchProfile() {
    if (!db || !state.user?.id) return;

    let { data, error } = await db.from("profiles").select("*").eq("id", state.user.id).maybeSingle();

    if (!data && !error) {
      const fallbackUsername = state.user.email ? state.user.email.split("@")[0] : "usuario";
      const newProfile = {
        id: state.user.id,
        username: state.user.user_metadata?.username || fallbackUsername,
        gender: state.user.user_metadata?.gender || "Outro",
        display_name: state.user.user_metadata?.username || fallbackUsername,
        bio: "Bem-vindo ao Pijama Party!",
        avatar_url: null,
        banner_url: null,
        followers: 0,
        following: 0,
        is_verified: false,
        is_developer: false
      };
      await db.from("profiles").upsert(newProfile);
      data = newProfile;
    }

    if (data) {
      data.wallet_balance = data.wallet_balance ?? 0;
      state.profile = data;
      state.visitor = false;
    }
  }

  async function refreshProfile() {
    await fetchProfile();
    updateProfileUI();
  }

  function updateProfileUI() {
    $("#pageProfile")?.classList.toggle("is-guest", !!(state.visitor || !state.user));
    $("#btnAdminPanel")?.classList.toggle("hidden", !state.profile?.is_admin);
    const avatarWrapper = $("#profileAvatarWrapper");
    const avatar = $("#profileAvatar");
    const banner = $("#profileBanner");
    const feedUserAvatar = $("#feedUserAvatar");

    if (feedUserAvatar && state.profile) {
      feedUserAvatar.innerHTML = state.profile.avatar_url
        ? `<img src="${escapeHTML(state.profile.avatar_url)}" alt="">`
        : initials(state.profile.display_name);
    }

    if (state.visitor || !state.profile) {
      if (avatar) avatar.innerHTML = "V";
      setText("#profileName", "Visitante");
      setText("#profileUsername", "@visitante");
      setText("#profileBio", "Modo de navegação anônima.");
      setText("#followersCount", "0");
      setText("#followingCount", "0");
      setText("#likesCount", "0");
      setText("#profileWalletBalance", "0");
      setText("#storeWalletBalance", "0");
      applyBanner($("#profileBanner"), "");
      return;
    }

    const balanceText = Number(state.profile.wallet_balance || 0).toLocaleString("pt-BR");
    setText("#profileWalletBalance", balanceText);
    setText("#storeWalletBalance", balanceText);

    if (avatar) {
      if (state.profile.avatar_url) {
        avatar.innerHTML = `<img src="${escapeHTML(state.profile.avatar_url)}" alt="Avatar">`;
      } else {
        avatar.textContent = initials(state.profile.display_name || state.profile.username);
      }
    }

    if (avatarWrapper) {
      const isLive = !!state.userLivesMap[state.profile.id];
      avatarWrapper.classList.toggle("is-live", isLive);
      if (isLive) avatarWrapper.dataset.liveUserId = state.profile.id;
      else delete avatarWrapper.dataset.liveUserId;
    }

    if (banner) {
      applyBanner(banner, state.profile.banner_url);
    }

    const name = $("#profileName");
    if (name) {
      name.innerHTML = `<span class="name-text">${escapeHTML(state.profile.display_name || "Usuário")}</span>${getBadgesHTML(state.profile)}`;
    }
    setText("#profileUsername", `@${state.profile.username || "usuario"}`);
    setText("#profileBio", state.profile.bio || "Sem bio.");
  }

  async function loadProfileExtras() {
    if (state.visitor || !state.user) {
      const box = $("#profileContent");
      if (box) box.innerHTML = `<div class="empty-state"><i class="fa-regular fa-user"></i><p>Crie uma conta para publicar fotos e montar seu perfil.</p></div>`;
      return;
    }
    await loadUserProfileData(state.user.id, {
      followers: "#followersCount",
      following: "#followingCount",
      likes: "#likesCount",
      grid: "#profileContent",
      own: true,
      guard: () => state.currentPage === "pageProfile"
    });
  }

  on("#btnShareProfile", "click", () => {
    if (!state.profile) return toast("Crie uma conta para compartilhar seu perfil.");
    shareLink({
      title: "Pijama Party",
      text: `Siga @${state.profile.username} no Pijama Party!`,
      url: location.href.split("#")[0]
    });
  });

  /* ================= EDITAR PERFIL ================= */
  const BIO_MAX = 160;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  function setPreviewImage(selector, url) {
    const el = $(selector);
    if (!el) return;
    el.style.backgroundImage = url ? `url('${url}')` : "";
  }

  function updateBioCounter() {
    const input = $("#editBioInput");
    if (input) setText("#editBioCounter", `${input.value.length}/${BIO_MAX}`);
  }

  on("#editBioInput", "input", updateBioCounter);

  // Foto de perfil já enquadrada (quadrada) à espera de salvar
  let croppedAvatarFile = null;
  let croppedAvatarPreviewUrl = null;

  on("#editAvatarFile", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (isVideoFile(file)) { e.target.value = ""; return toast("Escolha uma foto."); }
    if (file.size > MAX_IMAGE_BYTES) { e.target.value = ""; return toast("A foto de perfil deve ter até 8 MB."); }
    openAvatarCropper(file);
  });

  /* ---------- Enquadrar foto de perfil (arrastar + zoom) ---------- */
  const crop = { img: null, url: null, w: 0, h: 0, view: 280, base: 1, zoom: 1, x: 0, y: 0, pointers: new Map(), pinch: 0 };

  function cropClamp() {
    const dw = crop.w * crop.base * crop.zoom, dh = crop.h * crop.base * crop.zoom;
    const mx = Math.max(0, (dw - crop.view) / 2), my = Math.max(0, (dh - crop.view) / 2);
    crop.x = Math.min(mx, Math.max(-mx, crop.x));
    crop.y = Math.min(my, Math.max(-my, crop.y));
  }

  function cropRender() {
    cropClamp();
    const el = $("#cropImage");
    if (!el) return;
    const sc = crop.base * crop.zoom;
    const left = crop.view / 2 - (crop.w * sc) / 2 + crop.x;
    const top = crop.view / 2 - (crop.h * sc) / 2 + crop.y;
    el.style.width = `${crop.w}px`;
    el.style.height = `${crop.h}px`;
    el.style.transform = `translate(${left}px, ${top}px) scale(${sc})`;
  }

  function cropSetZoom(z, fromSlider) {
    crop.zoom = Math.min(4, Math.max(1, z));
    if (!fromSlider && $("#cropZoom")) $("#cropZoom").value = crop.zoom;
    cropRender();
  }

  // Plano B: se o navegador não conseguir abrir a foto para enquadrar (ex.: HEIC),
  // usa a foto original, como antes.
  function useOriginalAvatar(file) {
    croppedAvatarFile = file;
    if (croppedAvatarPreviewUrl) URL.revokeObjectURL(croppedAvatarPreviewUrl);
    croppedAvatarPreviewUrl = URL.createObjectURL(file);
    setPreviewImage("#previewAvatar", croppedAvatarPreviewUrl);
    setText("#previewAvatarText", "");
    closeModal("cropAvatarModal");
    if ($("#editAvatarFile")) $("#editAvatarFile").value = "";
  }

  function openAvatarCropper(file) {
    if (crop.url) URL.revokeObjectURL(crop.url);
    crop.url = URL.createObjectURL(file);
    crop.file = file;
    const img = new Image();
    img.onerror = () => { useOriginalAvatar(file); toast("Não deu para ajustar essa foto; ela será usada como está."); };
    img.onload = () => {
      crop.img = img;
      crop.w = img.naturalWidth;
      crop.h = img.naturalHeight;
      openModal("cropAvatarModal");
      crop.view = $("#cropStage")?.clientWidth || 280;
      crop.base = crop.view / Math.min(crop.w, crop.h); // a foto sempre cobre o círculo
      crop.x = 0; crop.y = 0; crop.zoom = 1;
      if ($("#cropZoom")) $("#cropZoom").value = 1;
      $("#cropImage").src = crop.url;
      cropRender();
    };
    img.src = crop.url;
  }

  function closeCropper(clearInput) {
    closeModal("cropAvatarModal");
    if (clearInput && $("#editAvatarFile")) $("#editAvatarFile").value = "";
  }

  on("#closeCropAvatar", "click", () => closeCropper(true));
  on("#cancelCropAvatar", "click", () => closeCropper(true));
  on("#cropZoom", "input", (e) => cropSetZoom(parseFloat(e.target.value), true));

  const cropStage = $("#cropStage");
  if (cropStage) {
    cropStage.addEventListener("pointerdown", (e) => {
      cropStage.setPointerCapture?.(e.pointerId);
      crop.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cropStage.classList.add("dragging");
      if (crop.pointers.size === 2) {
        const [a, b] = [...crop.pointers.values()];
        crop.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    cropStage.addEventListener("pointermove", (e) => {
      const prev = crop.pointers.get(e.pointerId);
      if (!prev) return;
      crop.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (crop.pointers.size === 2) {
        const [a, b] = [...crop.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (crop.pinch) cropSetZoom(crop.zoom * (d / crop.pinch));
        crop.pinch = d;
      } else {
        crop.x += e.clientX - prev.x;
        crop.y += e.clientY - prev.y;
        cropRender();
      }
    });
    const endPointer = (e) => {
      crop.pointers.delete(e.pointerId);
      crop.pinch = 0;
      if (!crop.pointers.size) cropStage.classList.remove("dragging");
    };
    cropStage.addEventListener("pointerup", endPointer);
    cropStage.addEventListener("pointercancel", endPointer);
    cropStage.addEventListener("wheel", (e) => {
      e.preventDefault();
      cropSetZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 0.92));
    }, { passive: false });
  }

  on("#confirmCropAvatar", "click", () => {
    if (!crop.img) return;
    const OUT = 512;
    const sc = crop.base * crop.zoom;
    const srcSize = crop.view / sc;
    const sx = crop.w / 2 - srcSize / 2 - crop.x / sc;
    const sy = crop.h / 2 - srcSize / 2 - crop.y / sc;
    const canvas = document.createElement("canvas");
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(crop.img, sx, sy, srcSize, srcSize, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => {
      if (!blob) { useOriginalAvatar(crop.file); return toast("Não deu para ajustar essa foto; ela será usada como está."); }
      croppedAvatarFile = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      if (croppedAvatarPreviewUrl) URL.revokeObjectURL(croppedAvatarPreviewUrl);
      croppedAvatarPreviewUrl = URL.createObjectURL(blob);
      setPreviewImage("#previewAvatar", croppedAvatarPreviewUrl);
      setText("#previewAvatarText", "");
      closeCropper(false);
      if ($("#editAvatarFile")) $("#editAvatarFile").value = "";
    }, "image/jpeg", 0.9);
  });

  on("#editBannerFile", "change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { e.target.value = ""; return toast("A capa deve ter até 8 MB."); }
    if (await isAnimatedMedia(file)) {
      e.target.value = "";
      return toast("Banners animados são exclusivos da Loja. Escolha uma imagem estática.");
    }
    setPreviewImage("#previewBanner", URL.createObjectURL(file));
  });

  function openEditProfileModal() {
    if (state.visitor || !state.profile) return toast("Crie uma conta para editar o perfil.");

    if ($("#editDisplayNameInput")) $("#editDisplayNameInput").value = state.profile.display_name || "";
    if ($("#editBioInput")) $("#editBioInput").value = state.profile.bio || "";
    updateBioCounter();

    setPreviewImage("#previewBanner", state.profile.banner_url ? escapeHTML(state.profile.banner_url) : "");
    if (state.profile.avatar_url) {
      setPreviewImage("#previewAvatar", escapeHTML(state.profile.avatar_url));
      setText("#previewAvatarText", "");
    } else {
      setPreviewImage("#previewAvatar", "");
      setText("#previewAvatarText", initials(state.profile.display_name || state.profile.username || "U"));
    }

    if ($("#editAvatarFile")) $("#editAvatarFile").value = "";
    if ($("#editBannerFile")) $("#editBannerFile").value = "";
    croppedAvatarFile = null;
    openModal("editProfileModal");
  }

  on("#btnEditProfile", "click", openEditProfileModal);
  on("#closeEditProfileModal", "click", () => closeModal("editProfileModal"));
  on("#cancelEditProfile", "click", () => closeModal("editProfileModal"));

  async function uploadProfileImage(file, folder) {
    if (!file || !db) return null;
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `${state.user.id}/${folder}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await db.storage.from("avatars").upload(filePath, file, { upsert: true });
      if (!uploadError) {
        const { data } = db.storage.from("avatars").getPublicUrl(filePath);
        if (data?.publicUrl) return data.publicUrl;
      }
      console.warn("Upload para o Storage falhou, usando versão reduzida:", uploadError);
    } catch (err) {
      console.warn("Upload para o Storage falhou, usando versão reduzida:", err);
    }
    return fileToDataURL(file, folder === "banner" ? 1280 : 512);
  }

  on("#editProfileForm", "submit", async (e) => {
    e.preventDefault();
    if (!state.user?.id || !db) return;

    const newName = $("#editDisplayNameInput")?.value.trim();
    const newBio = $("#editBioInput")?.value.trim();
    if (!newName) return toast("O nome de exibição não pode ficar vazio.");

    const saveBtn = $("#saveProfileBtn");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando..."; }

    try {
      let avatarUrl = state.profile?.avatar_url || null;
      let bannerUrl = state.profile?.banner_url || null;

      const avatarFile = croppedAvatarFile;
      const bannerFile = $("#editBannerFile")?.files[0];
      if (avatarFile) avatarUrl = (await uploadProfileImage(avatarFile, "avatar")) || avatarUrl;
      if (bannerFile) bannerUrl = (await uploadProfileImage(bannerFile, "banner")) || bannerUrl;

      const { error } = await db.from("profiles").update({
        display_name: newName,
        bio: newBio,
        avatar_url: avatarUrl,
        banner_url: bannerUrl
      }).eq("id", state.user.id);
      if (error) throw error;

      delete profileCache[state.user.id];
      croppedAvatarFile = null;
      closeModal("editProfileModal");
      await refreshProfile();
      toast("Perfil atualizado com sucesso!");
    } catch (err) {
      toast(`Erro ao atualizar perfil: ${formatError(err)}`);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Salvar"; }
    }
  });

  /* ================= PUBLICAR FOTOS E VÍDEOS ================= */
  let postPreviewUrl = null;

  function resetPostPreview() {
    if (postPreviewUrl) { URL.revokeObjectURL(postPreviewUrl); postPreviewUrl = null; }
    const img = $("#postImagePreview");
    const video = $("#postVideoPreview");
    if (img) { img.removeAttribute("src"); img.classList.add("hidden"); }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); video.classList.add("hidden"); }
  }

  function openCreatePostModal() {
    if (state.visitor) return toast("Cadastre-se para criar publicações.");
    const modal = $("#createPostModal");
    if (!modal) return;

    if ($("#postCaptionInput")) $("#postCaptionInput").value = "";
    if ($("#postImageFile")) $("#postImageFile").value = "";
    resetPostPreview();
    if ($("#postUploadIcon")) $("#postUploadIcon").classList.remove("hidden");
    if ($("#postUploadText")) $("#postUploadText").classList.remove("hidden");

    openModal("createPostModal");
  }

  on("#createPostTrigger", "click", openCreatePostModal);
  on("#btnCreatePostHeader", "click", openCreatePostModal);
  on("#closeCreatePostModal", "click", () => closeModal("createPostModal"));
  on("#cancelCreatePost", "click", () => closeModal("createPostModal"));

  on("#postImageFile", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const problem = validateMediaFile(file);
    if (problem) {
      e.target.value = "";
      resetPostPreview();
      $("#postUploadIcon")?.classList.remove("hidden");
      $("#postUploadText")?.classList.remove("hidden");
      return toast(problem);
    }
    resetPostPreview();
    postPreviewUrl = URL.createObjectURL(file);
    if (isVideoFile(file)) {
      const video = $("#postVideoPreview");
      video.src = postPreviewUrl;
      video.classList.remove("hidden");
    } else {
      const img = $("#postImagePreview");
      img.src = postPreviewUrl;
      img.classList.remove("hidden");
    }
    $("#postUploadIcon")?.classList.add("hidden");
    $("#postUploadText")?.classList.add("hidden");
  });

  on("#createPostForm", "submit", async (e) => {
    e.preventDefault();
    if (state.visitor) return toast("Cadastre-se para publicar.");
    if (!state.user?.id || !db) return toast("Conecte-se ao serviço para publicar.");

    const file = $("#postImageFile")?.files[0];
    const caption = $("#postCaptionInput")?.value.trim();

    if (!file) return toast("Selecione uma foto ou um vídeo para publicar.");
    const fileProblem = validateMediaFile(file);
    if (fileProblem) return toast(fileProblem);

    const btn = $("#btnPublishPost");
    if (btn) { btn.disabled = true; btn.textContent = "Publicando..."; }

    try {
      const uploaded = await uploadMedia(file, "posts");

      const row = {
        user_id: state.user.id,
        image_url: uploaded.url,
        caption: caption,
        likes_count: 0
      };
      if (uploaded.type === "video") row.media_type = "video";
      const { error: insertError } = await db.from("posts").insert(row);

      if (insertError) throw insertError;

      toast(uploaded.type === "video" ? "Vídeo publicado com sucesso!" : "Foto publicada com sucesso!");
      closeModal("createPostModal");
      await loadPosts();
    } catch (err) {
      toast(`Erro ao publicar: ${formatError(err)}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Publicar"; }
    }
  });

  /* ================= PUBLICAÇÕES: HELPERS ================= */
  const POST_SELECT = "*, profiles(id, username, display_name, avatar_url, is_verified, is_developer)";
  const COMMENT_SELECT = "*, profiles(username, display_name, is_verified, is_developer)";

  function allPostCopies(postId) {
    const key = String(postId);
    const copies = [...state.posts, ...state.profilePosts];
    if (state.detailPost) copies.push(state.detailPost);
    return copies.filter(p => String(p.id) === key);
  }

  const findPost = (postId) => allPostCopies(postId)[0] || null;
  const canManagePost = (post) => !!state.user && (state.user.id === post.user_id || isAdmin());
  const likesLabel = (count) => `${count} ${count === 1 ? "curtida" : "curtidas"}`;

  const isVideoPost = (post) => post?.media_type === "video";

  function postMediaHTML(post, alt = "") {
    const url = escapeHTML(post.image_url);
    return isVideoPost(post)
      ? `<video class="post-video" src="${url}#t=0.1" controls playsinline preload="metadata"></video>`
      : `<img src="${url}" alt="${escapeHTML(alt)}" loading="lazy" decoding="async">`;
  }

  function gridMediaHTML(post) {
    const url = escapeHTML(post.image_url);
    return isVideoPost(post)
      ? `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video><span class="grid-play"><i class="fa-solid fa-play"></i></span>`
      : `<img src="${url}" alt="" loading="lazy" decoding="async">`;
  }

  // Vídeos: só um toca por vez e todos pausam ao sair da tela.
  const videoObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach(en => { if (!en.isIntersecting) en.target.pause(); }), { threshold: 0.2 })
    : null;
  const observeVideos = (root) => $$("video.post-video", root).forEach(v => videoObserver?.observe(v));

  document.addEventListener("play", (e) => {
    if (e.target?.tagName !== "VIDEO") return;
    $$("video").forEach(v => { if (v !== e.target && v.id !== "liveVideo") v.pause(); });
  }, true);

  function captionHTML(post) {
    const username = post.profiles?.username || "usuario";
    return `<strong>@${escapeHTML(username)}</strong> ${escapeHTML(post.caption || "")}`;
  }

  const SAMPLE_COMMENTS = 2;

  function viewAllHTML(postId, total) {
    return total > SAMPLE_COMMENTS
      ? `<button class="view-all-comments" type="button" data-post-id="${postId}">Ver todos os ${total} comentários</button>`
      : "";
  }

  function commentHTML(comment) {
    return `
      <div class="post-comment-item">
        <strong>@${escapeHTML(comment.profiles?.username || "usuario")} ${getBadgesHTML(comment.profiles)}:</strong> ${escapeHTML(comment.content)}
      </div>`;
  }

  function ownerButtonsHTML(postId) {
    return `
      <div class="post-owner-options">
        <button class="icon-btn ghost btn-edit-post" data-post-id="${postId}" title="Editar legenda" aria-label="Editar legenda"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn ghost btn-delete-post" data-post-id="${postId}" title="Excluir publicação" aria-label="Excluir publicação"><i class="fa-solid fa-trash"></i></button>
      </div>`;
  }

  function actionsHTML(post) {
    const liked = state.myLikes.has(String(post.id));
    return `
      <div class="post-actions">
        <button class="post-action-btn btn-like-post ${liked ? "liked" : ""}" data-post-id="${post.id}" aria-label="Curtir">
          <i class="${liked ? "fa-solid" : "fa-regular"} fa-heart"></i>
        </button>
        <button class="post-action-btn btn-comment-post" data-post-id="${post.id}" aria-label="Comentar">
          <i class="fa-regular fa-comment"></i>
        </button>
        <button class="post-action-btn btn-share-post" data-post-id="${post.id}" aria-label="Compartilhar">
          <i class="fa-regular fa-paper-plane"></i>
        </button>
      </div>
      <div class="post-likes">
        <span class="likes-count" data-likes-for="${post.id}">${likesLabel(post.likes_count || 0)}</span>
      </div>`;
  }

  /* ================= CURTIDAS (persistentes no banco) ================= */
  function syncLikeUI(postId) {
    const key = String(postId);
    const liked = state.myLikes.has(key);
    const count = findPost(postId)?.likes_count || 0;

    $$(`.btn-like-post[data-post-id="${key}"]`).forEach(btn => {
      btn.classList.toggle("liked", liked);
      const icon = btn.querySelector("i");
      if (icon) icon.className = `${liked ? "fa-solid" : "fa-regular"} fa-heart`;
    });
    $$(`[data-likes-for="${key}"]`).forEach(el => { el.textContent = likesLabel(count); });
    $$(`.grid-item[data-post-id="${key}"] .grid-likes-count`).forEach(el => { el.textContent = count; });
  }

  const likeBusy = new Set();

  async function toggleLike(postId) {
    if (state.visitor || !state.user) return toast("Apenas usuários cadastrados podem curtir.");
    const key = String(postId);
    if (likeBusy.has(key)) return;
    likeBusy.add(key);

    const wasLiked = state.myLikes.has(key);
    const before = findPost(postId)?.likes_count || 0;

    const apply = (liked, count) => {
      if (liked) state.myLikes.add(key); else state.myLikes.delete(key);
      allPostCopies(postId).forEach(p => { p.likes_count = Math.max(0, count); });
      syncLikeUI(key);
    };

    apply(!wasLiked, before + (wasLiked ? -1 : 1)); // resposta imediata na tela

    const { data, error } = await db.rpc("toggle_post_like", { p_post: postId });
    likeBusy.delete(key);

    if (error) {
      apply(wasLiked, before);
      return toast(`Não foi possível curtir: ${formatError(error)}`);
    }
    if (data && typeof data === "object") {
      apply(!!data.liked, Number.isFinite(data.likes_count) ? data.likes_count : before);
    }
  }

  /* ================= COMENTÁRIOS ================= */
  async function submitComment(postId, input) {
    if (state.visitor || !state.user) return toast("Apenas usuários cadastrados podem comentar.");
    const text = input.value.trim().slice(0, 300);
    if (!text) return;
    if (input.dataset.busy) return;                 // toque duplo não cria comentário repetido

    // readOnly (e não disabled): o teclado do celular não fecha enquanto envia
    input.dataset.busy = "1"; input.readOnly = true;
    let error = null;
    try {
      ({ error } = await db.from("comments").insert({ post_id: postId, user_id: state.user.id, content: text }));
    } catch (e) { error = e; }
    delete input.dataset.busy; input.readOnly = false;
    if (error) return toast(`Não foi possível comentar: ${formatError(error)}`);

    input.value = "";
    state.commentCounts[postId] = (state.commentCounts[postId] || 0) + 1;
    const html = commentHTML({ content: text, profiles: state.profile });
    $$(`[data-comments-for="${postId}"]`).forEach(list => {
      list.querySelector(".no-comments")?.remove();
      list.insertAdjacentHTML("beforeend", html);
      if (list.closest(".post-card")) {
        // no feed ficam só os 2 últimos; o resto aparece ao abrir a publicação
        const items = $$(".post-comment-item", list);
        items.slice(0, Math.max(0, items.length - SAMPLE_COMMENTS)).forEach(item => item.remove());
      }
      list.scrollTop = list.scrollHeight;
    });
    $$(`[data-viewall-for="${postId}"]`).forEach(slot => { slot.innerHTML = viewAllHTML(postId, state.commentCounts[postId]); });
    setText(`[data-comment-total-for="${postId}"]`, state.commentCounts[postId]);
    toast("Comentário adicionado!");
  }

  /* ================= EDITAR / EXCLUIR / COMPARTILHAR ================= */
  async function editPostCaption(postId) {
    const post = findPost(postId);
    if (!post || !canManagePost(post)) return;

    const newCaption = await askText({
      title: "Editar publicação",
      label: "Legenda",
      value: post.caption || "",
      maxLength: 500,
      image: isVideoPost(post) ? null : post.image_url,
      allowEmpty: true,
      placeholder: "Escreva algo sobre a publicação...",
      hint: "Só a legenda pode ser alterada."
    });
    if (newCaption === null || newCaption === (post.caption || "")) return;

    const { error } = await db.from("posts").update({ caption: newCaption }).eq("id", post.id);
    if (error) return toast(`Não foi possível salvar a legenda: ${formatError(error)}`);

    allPostCopies(postId).forEach(p => { p.caption = newCaption; });
    $$(`#caption-${postId}, #detailCaption`).forEach(el => {
      if (el.id === "detailCaption" && String(state.detailPostId) !== String(postId)) return;
      el.innerHTML = captionHTML(post);
    });
    toast("Legenda atualizada!");
  }

  async function deletePost(postId) {
    const post = findPost(postId);
    if (!post || !canManagePost(post)) return;

    const confirmed = await askConfirm({
      title: "Excluir publicação?",
      message: "A publicação, as curtidas e os comentários serão removidos. Essa ação não pode ser desfeita.",
      confirmText: "Excluir",
      danger: true
    });
    if (!confirmed) return;

    const { error } = await db.from("posts").delete().eq("id", postId);
    if (error) return toast(`Não foi possível excluir: ${formatError(error)}`);

    closeModal("postDetailModal");
    state.detailPostId = null;
    state.detailPost = null;
    state.posts = state.posts.filter(p => String(p.id) !== String(postId));
    feedPaging.offset = Math.max(0, feedPaging.offset - 1);
    state.profilePosts = state.profilePosts.filter(p => String(p.id) !== String(postId));
    $$(`.post-card[data-post-id="${postId}"]`).forEach(card => card.remove());
    $$(`.grid-item[data-post-id="${postId}"]`).forEach(item => item.remove());
    if (!state.posts.length) loadPosts();
    toast("Publicação excluída!");
  }

  function sharePost(postId) {
    const post = findPost(postId);
    shareLink({
      title: "Pijama Party",
      text: post?.caption ? `“${post.caption}” — @${post.profiles?.username || "usuario"} no Pijama Party` : "Veja essa publicação no Pijama Party!",
      url: location.href.split("#")[0]
    });
  }

  /* ================= FEED DE FOTOS ================= */
  function postCardHTML(post, comments) {
    const author = post.profiles || { username: "usuario", display_name: "Usuário" };
    state.commentCounts[post.id] = comments.length;
    const commentsHTML = comments.slice(-SAMPLE_COMMENTS).map(commentHTML).join("");
    return `
      <article class="post-card" data-post-id="${post.id}">
        <header class="post-header">
          <div class="post-author" data-author-id="${author.id || ""}">
            ${renderAvatarHTML(author, "small")}
            <div class="post-author-info">
              <strong><span class="name-text">${escapeHTML(author.display_name || author.username)}</span>${getBadgesHTML(author)}</strong>
              <small>@${escapeHTML(author.username)} • ${formatTimeAgo(post.created_at)}</small>
            </div>
          </div>
          ${canManagePost(post) ? ownerButtonsHTML(post.id) : ""}
        </header>

        <div class="post-image-container">
          ${postMediaHTML(post, `Post de ${author.username}`)}
        </div>

        ${actionsHTML(post)}

        <div class="post-caption" id="caption-${post.id}">${captionHTML(post)}</div>

        <div class="post-comments-section">
          <div class="view-all-slot" data-viewall-for="${post.id}">${viewAllHTML(post.id, comments.length)}</div>
          <div class="post-comments-list" data-comments-for="${post.id}">${commentsHTML}</div>
        </div>
      </article>`;
  }

  /* Feed com paginação: carrega poucas publicações primeiro (rápido) e busca mais ao rolar. */
  const FEED_PAGE_SIZE = 12;
  const feedPaging = { loading: false, done: false, loadedAt: 0, offset: 0, pendingReload: false };

  function feedSkeletonHTML() {
    const card = `<div class="skeleton-card"><div class="skeleton-line w40"></div><div class="skeleton-media"></div><div class="skeleton-line w70"></div></div>`;
    return `<div class="feed-skeleton" aria-hidden="true">${card}${card}</div>`;
  }

  async function loadPosts(opts = {}) {
    const { append = false, soft = false } = opts || {};
    const feed = $("#feedPosts");
    if (!feed) return;

    if (!db) {
      feed.innerHTML = `<div class="empty-state"><i class="fa-solid fa-images"></i><p>Conecte ao Supabase para ver as publicações.</p></div>`;
      return;
    }

    const hasCards = !!feed.querySelector(".post-card");
    // Voltar para o Início não refaz o feed à toa (mantém a rolagem e economiza dados).
    if (!append && soft && hasCards && Date.now() - feedPaging.loadedAt < 20000) return;
    if (append && (feedPaging.done || !hasCards)) return;
    if (feedPaging.loading) {
      if (!append && !soft) feedPaging.pendingReload = true;   // ex.: acabou de publicar: refaz quando terminar
      return;
    }

    feedPaging.loading = true;
    if (!append && !hasCards) feed.innerHTML = feedSkeletonHTML();

    try {
      const from = append ? feedPaging.offset : 0;
      const { data: fetched, error } = await db.from("posts").select(POST_SELECT)
        .order("created_at", { ascending: false }).range(from, from + FEED_PAGE_SIZE - 1);

      if (error) {
        if (append) return toast(`Não foi possível carregar mais: ${formatError(error)}`);
        feed.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Não foi possível carregar o feed.<br><small>${escapeHTML(formatError(error))}</small></p></div>`;
        return;
      }

      const rows = fetched || [];
      feedPaging.offset = from + rows.length;
      feedPaging.done = rows.length < FEED_PAGE_SIZE;

      let posts = rows;
      if (append) {
        const known = new Set(state.posts.map(p => String(p.id)));
        posts = rows.filter(p => !known.has(String(p.id)));   // posts novos deslocam a paginação: evita repetir
      }

      if (!append && !posts.length) {
        state.posts = [];
        feedPaging.loadedAt = Date.now();
        feed.innerHTML = `<div class="empty-state"><i class="fa-regular fa-image"></i><p>Nenhuma publicação ainda. Seja o primeiro a compartilhar!</p></div>`;
        return;
      }
      if (!posts.length) return;

      const ids = posts.map(p => p.id);
      const [commentsRes, likesRes] = await Promise.all([
        db.from("comments").select(COMMENT_SELECT).in("post_id", ids).order("created_at", { ascending: true }),
        state.user
          ? db.from("post_likes").select("post_id").eq("user_id", state.user.id).in("post_id", ids)
          : Promise.resolve({ data: [] })
      ]);

      const commentsByPost = {};
      (commentsRes.data || []).forEach(c => { (commentsByPost[c.post_id] = commentsByPost[c.post_id] || []).push(c); });

      ids.forEach(id => state.myLikes.delete(String(id)));
      (likesRes.data || []).forEach(l => state.myLikes.add(String(l.post_id)));

      state.posts = append ? state.posts.concat(posts) : posts;
      const html = posts.map(post => postCardHTML(post, commentsByPost[post.id] || [])).join("");
      if (append) feed.insertAdjacentHTML("beforeend", html);
      else feed.innerHTML = html;
      observeVideos(feed);
      feedPaging.loadedAt = Date.now();
    } finally {
      feedPaging.loading = false;
      if (feedPaging.pendingReload) { feedPaging.pendingReload = false; loadPosts(); }
      else if (append) feedPaging.recheck?.();
    }
  }

  // Rolagem infinita: quando o fim do feed chega perto da tela, busca a próxima página.
  (function setupFeedInfiniteScroll() {
    const feed = $("#feedPosts");
    if (!feed || !("IntersectionObserver" in window)) return;
    const sentinel = document.createElement("div");
    sentinel.id = "feedSentinel";
    sentinel.style.cssText = "height:1px;";
    feed.insertAdjacentElement("afterend", sentinel);
    const io = new IntersectionObserver((entries) => {
      if (entries.some(en => en.isIntersecting) && state.currentPage === "pageHome") loadPosts({ append: true });
    }, { rootMargin: "700px 0px" });
    io.observe(sentinel);
    feedPaging.recheck = () => { io.unobserve(sentinel); io.observe(sentinel); };   // re-testa se ainda está perto
  })();

  on("#feedPosts", "click", (e) => {
    const card = e.target.closest(".post-card");
    if (!card) return;
    const postId = card.dataset.postId;

    if (e.target.closest(".btn-like-post")) return toggleLike(postId);
    if (e.target.closest(".btn-comment-post")) {
      const post = findPost(postId);
      if (post) openPostDetailModal(post, { focusComment: true });
      return;
    }
    if (e.target.closest(".btn-share-post")) return sharePost(postId);
    if (e.target.closest(".btn-edit-post")) return editPostCaption(postId);
    if (e.target.closest(".btn-delete-post")) return deletePost(postId);
    if (e.target.closest("video")) return; // os controles do vídeo funcionam normalmente
    if (e.target.closest(".view-all-comments") || e.target.closest(".post-image-container")) {
      const post = findPost(postId);
      if (post) openPostDetailModal(post);
      return;
    }
    if (e.target.closest(".post-author")) {
      const post = findPost(postId);
      if (post?.profiles) openUserProfile(post.profiles);
    }
  });

  /* ================= DETALHES DA PUBLICAÇÃO ================= */
  async function openPostDetailModal(post, opts = {}) {
    const content = $("#postDetailContent");
    if (!content) return;

    state.detailPost = post;
    state.detailPostId = post.id;
    const author = post.profiles || { username: "usuario", display_name: "Usuário" };

    let comments = [];
    if (db) {
      const { data } = await db.from("comments").select(COMMENT_SELECT)
        .eq("post_id", post.id).order("created_at", { ascending: true });
      comments = data || [];
      state.commentCounts[post.id] = comments.length;
    }

    content.innerHTML = `
      <div class="detail-author">
        <div class="post-author" data-author-id="${author.id || ""}">
          ${renderAvatarHTML(author, "small")}
          <div class="post-author-info">
            <strong><span class="name-text">${escapeHTML(author.display_name || author.username)}</span>${getBadgesHTML(author)}</strong>
            <small>@${escapeHTML(author.username)} • ${formatTimeAgo(post.created_at)}</small>
          </div>
        </div>
        ${canManagePost(post) ? ownerButtonsHTML(post.id) : ""}
      </div>

      <div class="detail-image">${postMediaHTML(post, `Publicação de ${author.username}`)}</div>

      ${actionsHTML(post)}
      <div class="post-caption" id="detailCaption">${captionHTML(post)}</div>

      <div class="detail-comments">
        <h3>Comentários (<span data-comment-total-for="${post.id}">${comments.length}</span>)</h3>
        <div class="post-comments-list detail-list" data-comments-for="${post.id}">
          ${comments.map(commentHTML).join("") || '<p class="no-comments">Nenhum comentário ainda.</p>'}
        </div>
        <form class="detail-comment-form" data-post-id="${post.id}">
          <input type="text" placeholder="Adicione um comentário..." required autocomplete="off" maxlength="300">
          <button class="btn primary compact" type="submit">Enviar</button>
        </form>
      </div>`;

    openModal("postDetailModal");
    if (opts.focusComment) {
      setTimeout(() => {
        const input = $("#postDetailContent .detail-comment-form input");
        if (!input) return;
        input.scrollIntoView({ block: "center", behavior: "smooth" });
        input.focus({ preventScroll: true });
      }, 80);
    }
  }

  on("#closePostDetailModal", "click", () => {
    state.detailPostId = null;
    state.detailPost = null;
    closeModal("postDetailModal");
  });

  on("#postDetailContent", "click", (e) => {
    const id = state.detailPostId;
    if (id === null || id === undefined) return;
    if (e.target.closest(".btn-like-post")) return toggleLike(id);
    if (e.target.closest(".btn-comment-post")) return $("#postDetailContent .detail-comment-form input")?.focus();
    if (e.target.closest(".btn-share-post")) return sharePost(id);
    if (e.target.closest(".btn-edit-post")) return editPostCaption(id);
    if (e.target.closest(".btn-delete-post")) return deletePost(id);
    if (e.target.closest(".post-author")) {
      const post = findPost(id);
      if (post?.profiles) {
        closeModal("postDetailModal");
        openUserProfile(post.profiles);
      }
    }
  });

  on("#postDetailContent", "submit", (e) => {
    const form = e.target.closest(".detail-comment-form");
    if (!form) return;
    e.preventDefault();
    submitComment(form.dataset.postId, form.querySelector("input"));
  });

  /* ================= GRADE DE PUBLICAÇÕES NOS PERFIS ================= */
  function renderProfileGrid(selector, posts, own) {
    const box = $(selector);
    if (!box) return;
    if (!posts.length) {
      box.innerHTML = `<div class="empty-state"><i class="fa-regular fa-image"></i><p>${own ? "Você ainda não publicou nada." : "Nenhuma publicação ainda."}</p></div>`;
      return;
    }
    box.innerHTML = `<div class="profile-grid">${posts.map(p => `
      <div class="grid-item" role="button" tabindex="0" data-post-id="${p.id}" aria-label="Abrir publicação">
        ${gridMediaHTML(p)}
        <span class="grid-likes"><i class="fa-solid fa-heart"></i> <span class="grid-likes-count">${p.likes_count || 0}</span></span>
        ${own ? `<span class="grid-edit" data-edit-post="${p.id}" role="button" aria-label="Editar legenda" title="Editar legenda"><i class="fa-solid fa-pen"></i></span>` : ""}
      </div>`).join("")}</div>`;
  }

  ["#profileContent", "#otherProfileContent"].forEach(selector => {
    const handler = (e) => {
      const edit = e.target.closest("[data-edit-post]");
      if (edit) { e.stopPropagation(); return editPostCaption(edit.dataset.editPost); }
      const item = e.target.closest(".grid-item");
      if (!item) return;
      const post = state.profilePosts.find(p => String(p.id) === item.dataset.postId);
      if (post) openPostDetailModal(post);
    };
    on(selector, "click", handler);
    on(selector, "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(e); } });
  });

  // Seguidores, seguindo, curtidas recebidas e publicações vêm direto das tabelas.
  async function loadUserProfileData(userId, ui) {
    if (!db || !userId) return null;

    const [followersRes, followingRes, postsRes] = await Promise.all([
      db.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId),
      db.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId),
      db.from("posts").select(POST_SELECT).eq("user_id", userId).order("created_at", { ascending: false })
    ]);

    if (ui.guard && !ui.guard()) return null;

    const posts = postsRes.data || [];
    state.profilePosts = posts;
    const totalLikes = posts.reduce((sum, p) => sum + (p.likes_count || 0), 0);
    const stats = {
      followers: followersRes.error ? null : (followersRes.count ?? 0),
      following: followingRes.error ? null : (followingRes.count ?? 0),
      likes: totalLikes
    };

    if (stats.followers !== null) setText(ui.followers, stats.followers);
    if (stats.following !== null) setText(ui.following, stats.following);
    setText(ui.likes, stats.likes);

    if (state.user && posts.length) {
      const { data: liked } = await db.from("post_likes").select("post_id")
        .eq("user_id", state.user.id).in("post_id", posts.map(p => p.id));
      posts.forEach(p => state.myLikes.delete(String(p.id)));
      (liked || []).forEach(l => state.myLikes.add(String(l.post_id)));
    }

    if (ui.guard && !ui.guard()) return null;
    renderProfileGrid(ui.grid, posts, !!ui.own);
    return stats;
  }

  /* ================= PERFIL DE OUTRO USUÁRIO ================= */
  function setFollowButton(isFollowing) {
    const btn = $("#btnFollowUser");
    if (!btn) return;
    btn.classList.toggle("primary", !isFollowing);
    btn.classList.toggle("secondary", isFollowing);
    btn.textContent = isFollowing ? "Seguindo" : "Seguir";
  }

  async function openUserProfile(targetUser) {
    if (!targetUser) return;

    if (db && targetUser.id) {
      const { data: fullProfile } = await db.from("profiles").select("*").eq("id", targetUser.id).maybeSingle();
      if (fullProfile) targetUser = { ...targetUser, ...fullProfile };
    }

    state.activeOtherUser = targetUser;
    const isSelf = !!state.user && state.user.id === targetUser.id;

    const avatar = $("#otherAvatar");
    if (avatar) {
      if (targetUser.avatar_url) avatar.innerHTML = `<img src="${escapeHTML(targetUser.avatar_url)}" alt="Avatar">`;
      else avatar.textContent = initials(targetUser.display_name || targetUser.username);
    }

    const avatarWrapper = $("#otherAvatarWrapper");
    if (avatarWrapper) {
      const isLive = !!state.userLivesMap[targetUser.id];
      avatarWrapper.classList.toggle("is-live", isLive);
      if (isLive) avatarWrapper.dataset.liveUserId = targetUser.id;
      else delete avatarWrapper.dataset.liveUserId;
    }

    const banner = $("#otherBanner");
    if (banner) {
      applyBanner(banner, targetUser.banner_url);
    }

    const name = $("#otherName");
    if (name) {
      name.innerHTML = `<span class="name-text">${escapeHTML(targetUser.display_name || targetUser.username)}</span>${getBadgesHTML(targetUser)}`;
    }
    setText("#otherUsername", `@${targetUser.username || "usuario"}`);
    setText("#otherBio", targetUser.bio || "Sem apresentação.");
    setText("#otherFollowers", targetUser.followers || 0);
    setText("#otherFollowing", targetUser.following || 0);
    setText("#otherLikes", "0");
    const grid = $("#otherProfileContent");
    if (grid) grid.innerHTML = "";

    $("#btnFollowUser")?.classList.toggle("hidden", isSelf);
    $("#btnMessageUser")?.classList.toggle("hidden", isSelf);
    setFollowButton(false);

    if (state.user && db && targetUser.id && !isSelf) {
      const { data } = await db.from("follows").select("follower_id")
        .eq("follower_id", state.user.id).eq("following_id", targetUser.id).maybeSingle();
      if (state.activeOtherUser?.id === targetUser.id) setFollowButton(!!data);
    }

    const btnVerified = $("#btnToggleVerified");
    const btnDeveloper = $("#btnToggleDeveloper");
    btnVerified?.classList.toggle("hidden", !isAdmin());
    btnDeveloper?.classList.toggle("hidden", !isAdmin());
    if (isAdmin()) {
      if (btnVerified) btnVerified.innerHTML = targetUser.is_verified
        ? `<i class="fa-solid fa-circle-xmark"></i> Remover Verificado`
        : `<i class="fa-solid fa-circle-check"></i> Dar Verificado`;
      if (btnDeveloper) btnDeveloper.innerHTML = targetUser.is_developer
        ? `<i class="fa-solid fa-code"></i> Remover Developer`
        : `<i class="fa-solid fa-code"></i> Dar Developer`;
    }

    navigateTo("pageUserProfile");
    refreshOtherProfileData();
  }

  async function refreshOtherProfileData() {
    const target = state.activeOtherUser;
    if (!target?.id) return;
    const stats = await loadUserProfileData(target.id, {
      followers: "#otherFollowers",
      following: "#otherFollowing",
      likes: "#otherLikes",
      grid: "#otherProfileContent",
      own: false,
      guard: () => state.activeOtherUser?.id === target.id && state.currentPage === "pageUserProfile"
    });
    if (stats && stats.followers !== null) target.followers = stats.followers;
  }

  on("#btnFollowUser", "click", async () => {
    if (state.visitor || !state.user) return toast("Cadastre-se para seguir usuários.");
    const target = state.activeOtherUser;
    if (!target || target.id === state.user.id) return;

    const btn = $("#btnFollowUser");
    if (btn.disabled) return;
    const wasFollowing = btn.classList.contains("secondary");
    btn.disabled = true;

    let error;
    if (wasFollowing) {
      ({ error } = await db.from("follows").delete().eq("follower_id", state.user.id).eq("following_id", target.id));
    } else {
      ({ error } = await db.from("follows").insert({ follower_id: state.user.id, following_id: target.id }));
      if (error?.code === "23505") error = null; // já seguia: tudo certo
    }
    btn.disabled = false;

    if (error) return toast(`Não foi possível ${wasFollowing ? "deixar de seguir" : "seguir"}: ${formatError(error)}`);
    if (wasFollowing) state.followingIds.delete(target.id); else state.followingIds.add(target.id);
    setFollowButton(!wasFollowing);
    toast(wasFollowing ? "Você deixou de seguir este usuário." : "Você agora está seguindo este usuário!");
    refreshOtherProfileData();
  });

  on("#btnMessageUser", "click", () => {
    if (state.visitor) return toast("Cadastre-se para enviar mensagens.");
    if (state.activeOtherUser) openChatWithUser(state.activeOtherUser);
  });

  async function toggleProfileFlag(flag, labels) {
    if (!isAdmin()) return toast("Apenas administradores podem alterar cargos.");
    const user = state.activeOtherUser;
    if (!user) return;
    const next = !user[flag];
    const { error } = await db.from("profiles").update({ [flag]: next }).eq("id", user.id);
    if (error) return toast(`Não foi possível alterar: ${formatError(error)}`);
    user[flag] = next;
    delete profileCache[user.id];
    toast(`${next ? labels.on : labels.off} @${user.username}`);
    openUserProfile(user);
  }

  on("#btnToggleVerified", "click", () => toggleProfileFlag("is_verified", {
    on: "Selo de Verificado concedido a", off: "Selo de Verificado removido de"
  }));
  on("#btnToggleDeveloper", "click", () => toggleProfileFlag("is_developer", {
    on: "Selo de Developer concedido a", off: "Selo de Developer removido de"
  }));

  /* ================= PESQUISA DE USUÁRIOS ================= */
  let searchSeq = 0;
  on("#searchInput", "input", async (e) => {
    const seq = ++searchSeq;
    const query = e.target.value.trim().toLowerCase().replace(/[%,()*\\]/g, "");
    const container = $("#searchResults");
    if (!container) return;

    if (!query) {
      container.innerHTML = "";
      return;
    }

    if (!db) {
      container.innerHTML = `<div class="empty-state"><p>Conexão com o banco indisponível.</p></div>`;
      return;
    }

    const { data: users, error } = await db
      .from("profiles")
      .select("*")
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(20);
    if (seq !== searchSeq) return; // o texto mudou enquanto a busca rodava

    if (error || !users || users.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>Nenhum usuário encontrado para "${escapeHTML(query)}".</p></div>`;
      return;
    }

    container.innerHTML = users.map(user => {
      const avatarHTML = renderAvatarHTML(user, "small");
      return `
        <div class="result-card" data-user-id="${user.id}">
          ${avatarHTML}
          <div class="grow">
            <strong><span class="name-text">${escapeHTML(user.display_name || user.username)}</span>${getBadgesHTML(user)}</strong>
            <p style="margin:2px 0 0; color:var(--muted); font-size:0.78rem;">@${escapeHTML(user.username)}</p>
          </div>
          <button class="btn secondary compact">Ver perfil</button>
        </div>
      `;
    }).join("");

    attachLiveAvatarListeners(container);

    $$(".result-card", container).forEach(card => {
      card.addEventListener("click", () => {
        const found = users.find(u => u.id === card.dataset.userId);
        if (found) openUserProfile(found);
      });
    });
  });

  /* ================= STORIES ================= */
  async function loadStories() {
    const container = $("#stories");
    if (!container) return;

    if (!db) {
      container.innerHTML = "";
      return;
    }

    await fetchActiveLivesMap();
    const lives = state.lives;
    
    let html = "";
    
    if (lives && lives.length > 0) {
      lives.forEach(live => {
        const host = live.profiles || { username: "criador", display_name: "Ao Vivo" };
        const avatarHTML = renderAvatarHTML(host);

        html += `
          <button class="story-item" data-live-id="${live.id}">
            ${avatarHTML}
            <span class="story-name">${escapeHTML(host.display_name || host.username)} ${getBadgesHTML(host)}</span>

            <span class="story-time-tag">AO VIVO</span>
          </button>
        `;
      });
    }

    if (!html) {
      html = `
        <div style="padding: 10px; text-align: center; color: var(--muted); font-size: 0.8rem; width: 100%;">
          Nenhum story ou transmissão ao vivo disponível.
        </div>
      `;
    }

    container.innerHTML = html;
    attachLiveAvatarListeners(container);

    $$(".story-item[data-live-id]", container).forEach(item => {
      item.addEventListener("click", () => {
        const live = lives.find(l => l.id === item.dataset.liveId);
        if (live) attemptOpenLive(live.host_id);
      });
    });
  }

  /* ================= FEED EM ALTA (LIVES ESTILO TIKTOK) ================= */
  function trendingCardHTML(live, index, total) {
    const host = live.profiles || { username: "criador", display_name: "Criador" };
    const cover = (host.banner_url && !isVideoUrl(host.banner_url)) ? host.banner_url : (host.avatar_url || "");
    return `
      <article class="tiktok-card" data-live-id="${live.id}">
        <div class="tiktok-bg-placeholder">
          ${cover ? `<div class="tiktok-cover" style="background-image:url('${escapeHTML(cover)}')"></div>` : ""}
          <i class="fa-solid fa-video"></i>
        </div>

        <div class="tiktok-overlay">
          <div class="tiktok-top">
            <span class="tiktok-live-tag"><i class="fa-solid fa-circle" style="font-size:0.5rem;"></i> AO VIVO</span>
            <span class="tiktok-viewers"><i class="fa-solid fa-eye"></i> ${live.viewers_count || 0}</span>
          </div>

          <div class="tiktok-bottom">
            <div class="tiktok-info">
              <div class="tiktok-user" data-host-id="${host.id}">
                ${renderAvatarHTML(host, "small")}
                <strong><span class="name-text">${escapeHTML(host.display_name || host.username)}</span>${getBadgesHTML(host)}</strong>
              </div>
              <h3 class="tiktok-title">${escapeHTML(live.title || "Transmissão ao vivo")}</h3>
              <p class="tiktok-category">${escapeHTML(live.category || "Geral")}</p>
            </div>

            <div class="tiktok-actions">
              <button class="tiktok-btn btn-enter-tiktok-live" data-live-id="${live.id}" title="Assistir" aria-label="Assistir à live">
                <i class="fa-solid fa-play"></i>
              </button>
              <span class="tiktok-counter">${index + 1}/${total}</span>
            </div>
          </div>
          ${index < total - 1 ? `<div class="tiktok-swipe-hint"><i class="fa-solid fa-chevron-up"></i> Deslize para ver mais lives</div>` : ""}
        </div>
      </article>`;
  }

  async function loadTrending() {
    const container = $("#trendingList");
    if (!container) return;

    if (!db) {
      container.innerHTML = `<div class="empty-state"><p>Conecte ao Supabase para ver as transmissões em alta.</p></div>`;
      return;
    }

    const { data: lives, error } = await db.from("lives")
      .select("*, profiles(*)")
      .eq("status", "live")
      .order("created_at", { ascending: false });

    if (error) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Não foi possível carregar as lives.<br><small>${escapeHTML(formatError(error))}</small></p></div>`;
      return;
    }

    await ensureSocialState();
    state.trendingLives = (lives || []).filter(canSeeLive);
    if (!state.trendingLives.length) {
      state.trendingSignature = "";
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-video-slash"></i>
          <p>Nenhuma transmissão ao vivo no momento. Seja o primeiro a transmitir!</p>
        </div>`;
      return;
    }

    // Não refaz a lista (e não perde a posição da rolagem) se nada mudou.
    const signature = state.trendingLives.map(l => `${l.id}:${l.viewers_count || 0}`).join("|");
    if (signature === state.trendingSignature && container.querySelector(".tiktok-card")) return;
    state.trendingSignature = signature;

    const previousScroll = container.scrollTop;
    const total = state.trendingLives.length;
    container.innerHTML = state.trendingLives.map((live, i) => trendingCardHTML(live, i, total)).join("");
    container.scrollTop = previousScroll;
  }

  on("#trendingList", "click", (e) => {
    const card = e.target.closest(".tiktok-card");
    if (!card) return;
    if (e.target.closest("[data-live-user-id]")) return; // anel de live já abre a transmissão
    const live = state.trendingLives.find(l => String(l.id) === card.dataset.liveId);
    if (!live) return;
    const hostEl = e.target.closest(".tiktok-user");
    if (hostEl && live.profiles) return openUserProfile(live.profiles);
    if (state.visitor) return toast("Cadastre-se para assistir a esta live.");
    openLiveRoom(live); // abre exatamente a live do card (um criador pode ter mais de uma)
  });

  /* ================= HELPERS DE BANNER (imagem, GIF/WebP animado e vídeo) ================= */
  function isVideoUrl(u = "") { return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u)); }

  function applyBanner(el, url) {
    if (!el) return;
    const oldVideo = el.querySelector(":scope > video.banner-video");
    if (url && isVideoUrl(url)) {
      el.style.backgroundImage = "";
      let v = oldVideo;
      if (!v) {
        v = document.createElement("video");
        v.className = "banner-video";
        v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
        v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
        el.prepend(v);
      }
      if (v.getAttribute("src") !== url) v.src = url;
      v.play().catch(() => {});
    } else {
      oldVideo?.remove();
      el.style.backgroundImage = url ? `url("${String(url).replace(/["\\\n]/g, encodeURIComponent)}")` : "";
    }
  }

  // Detecta GIF, APNG, WebP animado e vídeo (banners animados são exclusivos da loja).
  async function isAnimatedMedia(file) {
    if (!file) return false;
    if (file.type === "image/gif" || (file.type || "").startsWith("video/")) return true;
    try {
      const buf = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      const txt = new TextDecoder("latin1").decode(buf);
      if (txt.includes("acTL")) return true;                              // APNG
      if (txt.startsWith("RIFF") && txt.includes("WEBP") && txt.includes("ANIM")) return true; // WebP animado
    } catch (e) {}
    return false;
  }

  /* ================= LOJA ================= */
  const COIN_PACKS = [
    { amount: 100,  price: 5,  name: "Iniciante" },
    { amount: 500,  price: 20, name: "Popular 🔥" },
    { amount: 1000, price: 35, name: "Pro 👑" }
  ];
  const store = { items: [], owned: new Set(), tab: "coins" };

  function setStoreTab(tab) {
    store.tab = tab;
    $$("#storeTabs button").forEach(b => b.classList.toggle("active", b.dataset.storeTab === tab));
    $$("[data-store-pane]").forEach(p => p.classList.toggle("hidden", p.dataset.storePane !== tab));
  }
  on("#storeTabs", "click", (e) => {
    const b = e.target.closest("button[data-store-tab]");
    if (b) setStoreTab(b.dataset.storeTab);
  });

  function renderCoinPacks() {
    const box = $("#storeCoins");
    if (!box) return;
    box.innerHTML = COIN_PACKS.map(p => `
      <div class="store-card">
        <div class="store-coin-art"><i class="fa-solid fa-coins"></i></div>
        <div class="store-body">
          <h3>${escapeHTML(p.name)}</h3>
          <span class="store-price"><i class="fa-solid fa-coins"></i> ${p.amount.toLocaleString("pt-BR")}</span>
          <p>R$ ${p.price.toFixed(2).replace(".", ",")} via PIX</p>
          <button class="btn primary compact" data-buy-coins="${p.amount}">Comprar</button>
        </div>
      </div>`).join("");
  }
  on("#storeCoins", "click", (e) => {
    const b = e.target.closest("[data-buy-coins]");
    if (b) openBuyCoinsModal(parseInt(b.dataset.buyCoins, 10));
  });

  function bannerCardHTML(item) {
    const owned = store.owned.has(item.id);
    const equipped = state.profile?.banner_url === item.media_url;
    const media = (item.media_type === "video" || isVideoUrl(item.media_url))
      ? `<video src="${escapeHTML(item.media_url)}" muted loop autoplay playsinline preload="metadata"></video>`
      : `<img src="${escapeHTML(item.media_url)}" alt="${escapeHTML(item.name)}" loading="lazy">`;
    const action = equipped
      ? `<button class="btn secondary compact" disabled><i class="fa-solid fa-check"></i> Em uso</button>`
      : owned
        ? `<button class="btn primary compact" data-equip="${item.id}">Usar no perfil</button>`
        : `<button class="btn primary compact" data-buy-item="${item.id}">Comprar • <i class="fa-solid fa-coins"></i> ${Number(item.price).toLocaleString("pt-BR")}</button>`;
    return `
      <div class="store-card">
        <div class="store-preview"><span class="store-tag">ANIMADO</span>${media}</div>
        <div class="store-body">
          <h3>${escapeHTML(item.name)}</h3>
          ${item.description ? `<p>${escapeHTML(item.description)}</p>` : ""}
          ${action}
        </div>
      </div>`;
  }

  function renderBanners() {
    const box = $("#storeBanners");
    if (!box) return;
    box.innerHTML = store.items.length
      ? store.items.map(bannerCardHTML).join("")
      : `<div class="empty-state" style="grid-column:1/-1"><i class="fa-regular fa-image"></i><p>Nenhum banner disponível ainda.</p></div>`;
  }

  async function loadStore() {
    renderCoinPacks();
    setStoreTab(store.tab);
    const box = $("#storeBanners");
    if (!db) return;
    if (box && !store.items.length) box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Carregando...</p></div>`;
    const { data, error } = await db.from("store_items").select("*").eq("is_active", true)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (error) {
      if (box) box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>${escapeHTML(formatError(error))}</p></div>`;
      return;
    }
    store.items = (data || []).filter(i => i.category === "banner" && i.media_url);
    if (state.user && !state.visitor) {
      const { data: owned } = await db.from("user_items").select("item_id").eq("user_id", state.user.id);
      store.owned = new Set((owned || []).map(r => r.item_id));
    } else {
      store.owned = new Set();
    }
    renderBanners();
  }

  on("#storeBanners", "click", async (e) => {
    const buy = e.target.closest("[data-buy-item]");
    const equip = e.target.closest("[data-equip]");
    if (!buy && !equip) return;
    if (state.visitor || !state.user) return toast("Cadastre-se para usar a loja.");
    const id = (buy || equip).dataset.buyItem || (buy || equip).dataset.equip;
    const item = store.items.find(i => i.id === id);
    if (!item) return;

    if (buy) {
      if (parseInt(state.profile?.wallet_balance || 0, 10) < item.price) {
        return toast("Moedas insuficientes. Compre mais moedas na aba Moedas!");
      }
      const ok = await askConfirm({ title: "Comprar banner?", message: `"${item.name}" por ${item.price} moedas.`, confirmText: "Comprar" });
      if (!ok) return;
      buy.disabled = true;
      const { data, error } = await db.rpc("buy_store_item", { p_item_id: item.id });
      if (error) { buy.disabled = false; return toast(formatError(error)); }
      store.owned.add(item.id);
      if (data !== null && data !== undefined) state.profile.wallet_balance = data;
      updateProfileUI();
      renderBanners();
      toast("Banner comprado! Toque em “Usar no perfil”.");
    } else {
      equip.disabled = true;
      const { error } = await db.from("profiles").update({ banner_url: item.media_url }).eq("id", state.user.id);
      if (error) { equip.disabled = false; return toast(formatError(error)); }
      state.profile.banner_url = item.media_url;
      delete profileCache[state.user.id];
      updateProfileUI();
      renderBanners();
      toast("Banner aplicado ao seu perfil!");
    }
  });

  /* ----- Admin: publicar banner na loja ----- */
  let storeItemFile = null;
  function resetStoreItemForm() {
    storeItemFile = null;
    $("#storeItemForm")?.reset();
    const img = $("#storeItemImg"), vid = $("#storeItemVideo");
    img?.classList.add("hidden"); img?.removeAttribute("src");
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.classList.add("hidden"); }
    $("#storeItemIcon")?.classList.remove("hidden");
    $("#storeItemText")?.classList.remove("hidden");
  }
  function openStoreItemModal() { resetStoreItemForm(); openModal("storeItemModal"); }
  on("#closeStoreItemModal", "click", () => closeModal("storeItemModal"));
  on("#cancelStoreItem", "click", () => closeModal("storeItemModal"));
  on("#storeItemFile", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { e.target.value = ""; return toast("O arquivo deve ter até 50 MB."); }
    storeItemFile = file;
    const url = URL.createObjectURL(file);
    const isVid = (file.type || "").startsWith("video/");
    const img = $("#storeItemImg"), vid = $("#storeItemVideo");
    img.classList.toggle("hidden", isVid); vid.classList.toggle("hidden", !isVid);
    if (isVid) { vid.src = url; vid.play().catch(() => {}); } else { img.src = url; }
    $("#storeItemIcon").classList.add("hidden"); $("#storeItemText").classList.add("hidden");
  });
  on("#storeItemForm", "submit", async (e) => {
    e.preventDefault();
    if (!isAdmin() || !db) return;
    if (!storeItemFile) return toast("Escolha o arquivo do banner.");
    const name = $("#storeItemName").value.trim();
    const price = parseInt($("#storeItemPrice").value, 10);
    if (!name || isNaN(price) || price < 0) return toast("Preencha nome e preço.");
    const btn = $("#saveStoreItem");
    btn.disabled = true; btn.textContent = "Enviando...";
    try {
      const file = storeItemFile;
      const type = (file.type || "").startsWith("video/") ? "video" : "image";
      const ext = ((file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "")) || (type === "video" ? "mp4" : "gif");
      const path = `${state.user.id}/store_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const up = await db.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (up.error) throw up.error;
      const { data: pub } = db.storage.from("avatars").getPublicUrl(path);
      const { error } = await db.from("store_items").insert({
        category: "banner", name, description: $("#storeItemDesc").value.trim() || null,
        price, media_url: pub.publicUrl, media_type: type
      });
      if (error) throw error;
      closeModal("storeItemModal");
      toast("Banner publicado na loja!");
      if (adminTab === "store") loadAdmin("store");
    } catch (err) {
      toast(`Erro ao publicar: ${formatError(err)}`);
    } finally {
      btn.disabled = false; btn.textContent = "Publicar na loja";
    }
  });

  /* ================= LIVES (TRANSMISSÃO AO VIVO & CÂMERA) ================= */
  const liveSetupModal = $("#liveSetupModal");

  on("#startLiveButton", "click", () => {
    if (state.visitor) return toast("Cadastre-se para transmitir ao vivo.");
    openModal("liveSetupModal");
  });

  on("#closeLiveModal", "click", () => closeModal("liveSetupModal"));
  on("#cancelLive", "click", () => closeModal("liveSetupModal"));

  $$("#liveSetupModal .choice").forEach(choice => {
    choice.addEventListener("click", () => {
      $$("#liveSetupModal .choice").forEach(c => c.classList.remove("active"));
      choice.classList.add("active");
      state.selectedVisibility = choice.dataset.visibility || "public";
    });
  });

  let liveStarting = false;
  on("#liveSetupForm", "submit", async (e) => {
    e.preventDefault();
    if (liveStarting) return;                       // clique duplo não cria duas lives
    if (!state.user?.id || !db) return toast("Não conectado ao banco de dados.");

    const title = $("#liveTitle")?.value.trim();
    const category = "Geral";
    if (!title) return toast("Preencha o título da live.");

    liveStarting = true;
    const submitBtn = $("#liveSetupForm button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;
    let stream = null, phase = "camera";
    try {
      // 1º a câmera e o microfone. Só depois a live é criada no banco: se o usuário negar a permissão,
      // não sobra uma live "fantasma" aparecendo para os outros em Em Alta.
      stream = await getHostStream();
      phase = "banco";

      await db.from("lives").update({ status: "ended" }).eq("host_id", state.user.id).eq("status", "live");
      const livePayload = {
        host_id: state.user.id,
        title: title,
        category: category,
        status: "live",
        visibility: state.selectedVisibility === "followers" ? "followers" : "public"
      };
      let { data, error } = await db.from("lives").insert(livePayload).select().single();
      if (error && /visibility/i.test(error.message || "")) {
        // banco ainda sem a coluna "visibility": inicia como pública
        console.warn("Coluna lives.visibility ausente; live iniciada como pública.");
        delete livePayload.visibility;
        ({ data, error } = await db.from("lives").insert(livePayload).select().single());
      }
      if (error) throw error;

      // Vincula o perfil local do criador da live manualmente para a tela
      data.profiles = state.profile;

      closeModal("liveSetupModal");
      const input = $("#liveTitle"); if (input) input.value = "";
      const mine = stream; stream = null;           // a sala assume o controle da câmera
      toast("Transmissão iniciada!");
      await openLiveRoom(data, mine);
    } catch (err) {
      stream?.getTracks().forEach(t => t.stop());
      toast(phase === "camera" ? mediaErrorMessage(err) : `Erro ao iniciar live: ${formatError(err)}`);
    } finally {
      liveStarting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  /* ================= CHAT: RECIBOS DE ENTREGA E LEITURA ================= */
  // Estados de uma mensagem enviada por mim:
  //   relógio   = enviando        ✓ = salva no servidor
  //   ✓✓ cinza  = entregue        ✓✓ azul = lida   (em grupos: só ✓)
  function receiptHTML(m, group = false) {
    if (m._failed) return `<i class="fa-solid fa-circle-exclamation receipt failed" title="Não enviada"></i>`;
    if (m._pending) return `<i class="fa-regular fa-clock receipt" title="Enviando"></i>`;
    if (group) return `<i class="fa-solid fa-check receipt" title="Enviada"></i>`;
    if (m.read_at) return `<i class="fa-solid fa-check-double receipt read" title="Lida"></i>`;
    if (m.delivered_at) return `<i class="fa-solid fa-check-double receipt" title="Entregue"></i>`;
    return `<i class="fa-solid fa-check receipt" title="Enviada"></i>`;
  }

  const isAfter = (a, b) => new Date(a).getTime() > new Date(b).getTime();

  function messagePreviewHTML(m) {
    if (!m) return "";
    if (m.is_deleted) return "Mensagem excluída";
    const icon = m.media_url ? (m.media_type === "video" ? `<i class="fa-solid fa-video"></i> ` : `<i class="fa-solid fa-image"></i> `) : "";
    if (m.media_url && !m.content) return `${icon}${m.media_type === "video" ? "Vídeo" : "Foto"}`;
    return `${icon}${escapeHTML(m.content || "")}`;
  }

  let deliveredBusy = false;
  async function markDelivered() {
    if (deliveredBusy || !db || !state.user) return;
    deliveredBusy = true;
    try { await db.rpc("mark_messages_delivered"); } catch (e) {}
    deliveredBusy = false;
  }

  async function markRead(senderId) {
    if (!db || !state.user) return false;
    const { error } = await db.rpc("mark_messages_read", { p_sender: senderId });
    if (error) return false;
    const now = new Date().toISOString();
    state.messages.forEach(m => {
      if (m.sender_id === senderId && m.receiver_id === state.user.id && !m.read_at) {
        m.read_at = now;
        m.delivered_at = m.delivered_at || now;
      }
    });
    refreshUnreadCounts();
    return true;
  }

  /* ================= BLOQUEIOS, CONVERSAS REMOVIDAS/APAGADAS E QUEM EU SIGO ================= */
  async function loadSocialState() {
    if (!db || !state.user) return;
    const me = state.user.id;
    const [settingsRes, blockedRes, followRes] = await Promise.all([
      db.from("chat_settings").select("partner_id, hidden_at, cleared_at").eq("user_id", me),
      db.from("blocked_users").select("blocked_id").eq("blocker_id", me),
      db.from("follows").select("following_id").eq("follower_id", me)
    ]);
    if (!settingsRes.error) {
      state.chatSettings = {};
      (settingsRes.data || []).forEach(r => { state.chatSettings[r.partner_id] = r; });
    }
    if (!blockedRes.error) state.blockedIds = new Set((blockedRes.data || []).map(r => r.blocked_id));
    if (!followRes.error) state.followingIds = new Set((followRes.data || []).map(r => r.following_id));
    state.socialLoaded = true;
  }

  async function ensureSocialState() {
    if (state.user && !state.socialLoaded) await loadSocialState();
  }

  async function setChatSetting(partnerId, patch) {
    const row = { user_id: state.user.id, partner_id: partnerId, ...patch };
    const { error } = await db.from("chat_settings").upsert(row, { onConflict: "user_id,partner_id" });
    if (error) { toast(formatError(error)); return false; }
    state.chatSettings[partnerId] = { ...(state.chatSettings[partnerId] || {}), ...patch };
    return true;
  }

  async function blockUser(userId) {
    const { error } = await db.from("blocked_users").insert({ blocker_id: state.user.id, blocked_id: userId });
    if (error && error.code !== "23505") { toast(`Não foi possível bloquear: ${formatError(error)}`); return false; }
    state.blockedIds.add(userId);
    return true;
  }

  async function unblockUser(userId) {
    const { error } = await db.from("blocked_users").delete().eq("blocker_id", state.user.id).eq("blocked_id", userId);
    if (error) { toast(`Não foi possível desbloquear: ${formatError(error)}`); return false; }
    state.blockedIds.delete(userId);
    return true;
  }

  async function latestMessageAt(partnerId) {
    const me = state.user.id;
    const { data } = await db.from("messages").select("created_at")
      .or(`and(sender_id.eq.${me},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${me})`)
      .order("created_at", { ascending: false }).limit(1);
    return data?.[0]?.created_at || null;
  }

  async function afterBlockChange() {
    await Promise.all([loadChats(), refreshUnreadCounts()]);
    updateRoomChrome();
    if (state.currentPage === "pageChatRoom") renderMessages();
  }

  /* ================= LISTA DE CONVERSAS ================= */
  async function loadChats() {
    const container = $("#chatList");
    if (!container) return;

    if (state.visitor) {
      container.innerHTML = `<div class="empty-state"><i class="fa-regular fa-comments"></i><p>Cadastre-se para conversar.</p></div>`;
      return;
    }
    if (!db || !state.user?.id) return;

    await ensureSocialState();
    const me = state.user.id;
    const { data: msgs, error } = await db.from("messages").select("*")
      .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
      .order("created_at", { ascending: false }).limit(400);

    if (error) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Não foi possível carregar suas conversas.<br><small>${escapeHTML(formatError(error))}</small></p></div>`;
      return;
    }

    // última mensagem e quantidade de não lidas por contato
    const threads = new Map();
    (msgs || []).forEach(m => {
      const partnerId = m.sender_id === me ? m.receiver_id : m.sender_id;
      const clearedAt = state.chatSettings[partnerId]?.cleared_at;
      if (clearedAt && !isAfter(m.created_at, clearedAt)) return; // apagada só para mim
      const blocked = state.blockedIds.has(partnerId);
      if (!threads.has(partnerId)) threads.set(partnerId, { last: m, unread: 0, blocked });
      if (!blocked && m.receiver_id === me && "read_at" in m && !m.read_at && !m.is_deleted) threads.get(partnerId).unread++;
    });

    // "Remover da lista": a conversa some até chegar uma mensagem nova
    threads.forEach((thread, partnerId) => {
      const hiddenAt = state.chatSettings[partnerId]?.hidden_at;
      if (hiddenAt && !isAfter(thread.last.created_at, hiddenAt)) threads.delete(partnerId);
    });

    if (threads.size === 0) {
      state.chatRows = new Map();
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-regular fa-comments"></i>
          <p>Você ainda não possui conversas iniciadas.</p>
          <button class="btn primary compact" id="btnFindPeople" style="margin-top:12px;">Procurar pessoas</button>
        </div>`;
      $("#btnFindPeople")?.addEventListener("click", () => $("#btnSearchUsersHeader")?.click());
      state.unreadChats = 0;
      updateActivityDots();
      return;
    }

    const { data: partners } = await db.from("profiles").select("*").in("id", [...threads.keys()]);
    const rows = (partners || [])
      .map(u => ({ user: u, ...threads.get(u.id) }))
      .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));

    state.chatRows = new Map(rows.map(r => [r.user.id, r.user]));
    state.unreadChats = rows.reduce((sum, r) => sum + r.unread, 0);
    updateActivityDots();

    container.innerHTML = rows.map(({ user: u, last, unread, blocked }) => {
      const mine = last.sender_id === me;
      return `
        <div class="chat-card" data-user-id="${u.id}">
          ${renderAvatarHTML(u, "small")}
          <div class="grow">
            <strong><span class="name-text">${escapeHTML(u.display_name || u.username)}</span>${getBadgesHTML(u)}${blocked ? `<span class="chat-tag">BLOQUEADO</span>` : ""}</strong>
            <p class="chat-preview ${unread ? "unread" : ""}">${blocked ? "Usuário bloqueado" : `${mine ? receiptHTML(last) + " Você: " : ""}${messagePreviewHTML(last)}`}</p>
          </div>
          <div class="chat-meta">
            <small>${formatTimeAgo(last.created_at)}</small>
            ${unread ? `<span class="unread-badge">${unread}</span>` : ""}
          </div>
        </div>`;
    }).join("");

    $$(".chat-card", container).forEach(card => {
      card.addEventListener("click", () => {
        const found = rows.find(r => r.user.id === card.dataset.userId);
        if (found) openChatWithUser(found.user);
      });
    });
  }

  /* ----- Segurar (ou botão direito) em uma conversa abre as opções ----- */
  function attachLongPress(container, selector, handler, ms = 500) {
    if (!container) return;
    let timer = null, startX = 0, startY = 0, fired = false;
    const release = () => {
      clearTimeout(timer);
      timer = null;
      $$(".pressing", container).forEach(c => c.classList.remove("pressing"));
    };

    container.addEventListener("pointerdown", (e) => {
      const card = e.target.closest(selector);
      if (!card || (e.pointerType === "mouse" && e.button !== 0)) return;
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
      card.classList.add("pressing");
      timer = setTimeout(() => {
        fired = true;
        release();
        if (navigator.vibrate) navigator.vibrate(15);
        handler(card);
      }, ms);
    });
    container.addEventListener("pointermove", (e) => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) release();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(type => container.addEventListener(type, release));

    container.addEventListener("contextmenu", (e) => {
      const card = e.target.closest(selector);
      if (!card) return;
      e.preventDefault();
      if (!fired) { release(); fired = true; handler(card); }
    });
    // depois de um toque longo, o "click" que sobra não deve abrir a conversa
    container.addEventListener("click", (e) => {
      if (!fired) return;
      fired = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  function openChatOptions(card) {
    const user = state.chatRows.get(card.dataset.userId);
    if (!user || state.visitor) return;
    state.chatOptionsUser = user;
    setText("#chatOptionsTitle", user.display_name || user.username || "Conversa");
    setText("#chatBlockLabel", state.blockedIds.has(user.id) ? "Desbloquear usuário" : "Bloquear usuário");
    openModal("chatOptionsModal");
  }

  attachLongPress($("#chatList"), ".chat-card[data-user-id]", openChatOptions);
  on("#closeChatOptions", "click", () => closeModal("chatOptionsModal"));

  on("#btnChatClear", "click", async () => {
    const user = state.chatOptionsUser;
    closeModal("chatOptionsModal");
    if (!user || !db) return;
    const confirmed = await askConfirm({
      title: "Apagar mensagens?",
      message: `As mensagens com ${user.display_name || user.username} serão apagadas só para você. A outra pessoa continua vendo a conversa.`,
      confirmText: "Apagar",
      danger: true
    });
    if (!confirmed) return;
    const latest = await latestMessageAt(user.id);
    if (!latest) return toast("Não há mensagens para apagar.");
    await db.rpc("mark_messages_read", { p_sender: user.id });
    if (!(await setChatSetting(user.id, { cleared_at: latest }))) return;
    if (state.activeChatUser?.id === user.id) state.messages = [];
    await Promise.all([loadChats(), refreshUnreadCounts()]);
    toast("Mensagens apagadas.");
  });

  on("#btnChatBlock", "click", async () => {
    const user = state.chatOptionsUser;
    closeModal("chatOptionsModal");
    if (!user || !db) return;
    const name = user.display_name || user.username;

    if (state.blockedIds.has(user.id)) {
      if (await unblockUser(user.id)) { toast(`${name} foi desbloqueado.`); afterBlockChange(); }
      return;
    }
    const confirmed = await askConfirm({
      title: "Bloquear usuário?",
      message: `${name} não poderá mais enviar mensagens para você, e você também não conseguirá enviar para essa pessoa.`,
      confirmText: "Bloquear",
      danger: true
    });
    if (!confirmed) return;
    if (await blockUser(user.id)) { toast(`${name} foi bloqueado.`); afterBlockChange(); }
  });

  on("#btnChatRemove", "click", async () => {
    const user = state.chatOptionsUser;
    closeModal("chatOptionsModal");
    if (!user || !db) return;
    const latest = await latestMessageAt(user.id);
    if (!latest) return;
    await db.rpc("mark_messages_read", { p_sender: user.id });
    if (!(await setChatSetting(user.id, { hidden_at: latest }))) return;
    await Promise.all([loadChats(), refreshUnreadCounts()]);
    toast("Conversa removida da lista. Ela volta se chegar uma mensagem nova.");
  });

  on("#btnUnblockInRoom", "click", async () => {
    const user = state.activeChatUser;
    if (!user || !(await unblockUser(user.id))) return;
    toast("Usuário desbloqueado.");
    afterBlockChange();
  });

  /* ================= DIGITANDO… (broadcast em tempo real, sem gravar no banco) ================= */
  const typingState = { ch: null, ready: false, who: new Map(), lastSent: 0, stopTimer: null };

  function typingChannelName() {
    if (!state.user) return null;
    if (state.activeGroup) return `typing-g-${state.activeGroup.id}`;
    if (state.activeChatUser) return `typing-d-${[state.user.id, state.activeChatUser.id].sort().join("-")}`;
    return null;
  }

  function closeTypingChannel() {
    clearTimeout(typingState.stopTimer);
    typingState.who.forEach(t => clearTimeout(t.timer));
    typingState.who.clear();
    if (typingState.ch && db) { try { db.removeChannel(typingState.ch); } catch (e) {} }
    typingState.ch = null;
    typingState.ready = false;
    typingState.lastSent = 0;
  }

  function openTypingChannel() {
    closeTypingChannel();
    const name = typingChannelName();
    if (!name || !db) return;
    const ch = db.channel(name, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => onTypingSignal(payload))
      .subscribe((status) => { if (status === "SUBSCRIBED" && typingState.ch === ch) typingState.ready = true; });
    typingState.ch = ch;
  }

  function sendTyping(isTyping) {
    if (!typingState.ch || !typingState.ready || !prefs.showTyping || !state.user) return;
    typingState.ch.send({
      type: "broadcast",
      event: "typing",
      payload: { from: state.user.id, name: state.profile?.display_name || state.profile?.username || "Alguém", typing: isTyping }
    });
  }

  function stopTyping() {
    clearTimeout(typingState.stopTimer);
    if (typingState.lastSent) sendTyping(false);
    typingState.lastSent = 0;
  }

  function onTypingSignal(payload) {
    if (!payload || payload.from === state.user?.id) return;
    const previous = typingState.who.get(payload.from);
    if (previous) clearTimeout(previous.timer);
    if (payload.typing) {
      const timer = setTimeout(() => { typingState.who.delete(payload.from); refreshChatStatus(); }, 4000);
      typingState.who.set(payload.from, { name: payload.name, timer });
    } else {
      typingState.who.delete(payload.from);
    }
    refreshChatStatus();
  }

  on("#messageInput", "input", () => {
    if (!typingState.ready || !prefs.showTyping) return;
    if (!$("#messageInput").value.trim()) return stopTyping();
    const now = Date.now();
    if (now - typingState.lastSent > 2500) { sendTyping(true); typingState.lastSent = now; }
    clearTimeout(typingState.stopTimer);
    typingState.stopTimer = setTimeout(stopTyping, 3000);
  });

  function leaveChatRoomCleanup() {
    stopTyping();
    closeTypingChannel();
    clearPendingMedia();
    const group = state.activeGroup;
    const last = state.messages[state.messages.length - 1];
    if (group && last?.created_at) touchGroupRead(group.id, last.created_at);
  }

  /* ================= SALA DE CONVERSA (direta ou de grupo) ================= */
  const GROUP_MSG_SELECT = "*, sender:profiles!sender_id(id, username, display_name, avatar_url, is_verified, is_developer)";

  function renderChatHeader() {
    const name = $("#chatRoomName");
    const group = state.activeGroup;
    const user = state.activeChatUser;
    if (!name || (!group && !user)) return;

    if (group) {
      const badge = group.avatar_url
        ? `<img class="chat-header-group-photo" src="${escapeHTML(group.avatar_url)}" alt="">`
        : `<i class="fa-solid fa-users" style="color:var(--primary);font-size:.8rem;"></i>`;
      name.innerHTML = `${badge}<span class="name-text">${escapeHTML(group.name)}</span>`;
    }
    else name.innerHTML = `<span class="name-text">${escapeHTML(user.display_name || user.username)}</span>${getBadgesHTML(user)}`;

    const icon = $("#chatOptionsIcon");
    if (icon) icon.className = group ? "fa-solid fa-circle-info" : "fa-solid fa-user";
    const btn = $("#btnChatOptions");
    if (btn) {
      btn.setAttribute("aria-label", group ? "Informações do grupo" : "Ver perfil");
      btn.title = group ? "Informações do grupo" : "Ver perfil";
    }
    updateRoomChrome();
    refreshChatStatus();
  }

  function setStatus(el, text, mode) {
    el.classList.toggle("offline", mode === "offline");
    el.classList.toggle("typing", mode === "typing");
    if (mode === "typing") el.innerHTML = `${escapeHTML(text)}<span class="typing-dots"><i></i><i></i><i></i></span>`;
    else el.textContent = text;
  }

  function refreshChatStatus() {
    const el = $("#chatRoomStatus");
    if (!el) return;
    const typers = [...typingState.who.values()].map(t => t.name);

    if (state.activeGroup) {
      if (typers.length) return setStatus(el, typers.length === 1 ? `${typers[0]} está digitando` : `${typers.length} pessoas digitando`, "typing");
      const count = state.activeGroup.member_count;
      return setStatus(el, count ? `${count} ${count === 1 ? "membro" : "membros"}` : "grupo", "offline");
    }

    const user = state.activeChatUser;
    if (!user) return;
    if (typers.length) return setStatus(el, "digitando", "typing");
    const online = state.onlineIds.has(user.id);
    setStatus(el, online ? "online" : "offline", online ? "online" : "offline");
  }

  // Mostra o aviso de bloqueio no lugar do campo de mensagem.
  function updateRoomChrome() {
    const blocked = !state.activeGroup && !!state.activeChatUser && state.blockedIds.has(state.activeChatUser.id);
    $("#chatBlockedBanner")?.classList.toggle("hidden", !blocked);
    $("#messageForm")?.classList.toggle("hidden", blocked);
    if (blocked) $("#chatMediaPreview")?.classList.add("hidden");
    else $("#chatMediaPreview")?.classList.toggle("hidden", !state.pendingMedia);
  }

  function resetRoomView() {
    lastRenderSig = "";
    const box = $("#messages");
    if (box) box.innerHTML = "";
  }

  function openChatWithUser(user) {
    state.activeGroup = null;
    state.activeChatUser = user;
    state.messages = [];
    state.pendingMessages = [];
    clearPendingMedia();
    resetRoomView();
    navigateTo("pageChatRoom");
  }

  function openGroupRoom(group) {
    state.activeChatUser = null;
    state.activeGroup = group;
    state.messages = [];
    state.pendingMessages = [];
    clearPendingMedia();
    resetRoomView();
    navigateTo("pageChatRoom");
  }

  const openRoomInfo = () => {
    if (state.activeGroup) openGroupInfo(state.activeGroup);
    else if (state.activeChatUser) openUserProfile(state.activeChatUser);
  };
  on("#chatHeaderInfo", "click", openRoomInfo);
  on("#btnChatOptions", "click", openRoomInfo);

  function allChatMessages() {
    const confirmed = new Set(state.messages.map(m => String(m.id)));
    const pending = state.pendingMessages.filter(p => !p._confirmedId || !confirmed.has(String(p._confirmedId)));
    let list = [...state.messages, ...pending];
    if (state.activeGroup) list = list.filter(m => !state.blockedIds.has(m.sender_id));
    return list;
  }

  function mediaBubbleHTML(url, type, withMenu = true) {
    const safe = escapeHTML(url);
    const element = type === "video"
      ? `<video class="msg-media" data-media-type="video" src="${safe}#t=0.1" controls preload="metadata" playsinline></video>`
      : `<img class="msg-media" data-media-type="image" src="${safe}" alt="Imagem enviada" loading="lazy">`;
    const more = withMenu ? `<button type="button" class="msg-more" aria-label="Opções da mensagem"><i class="fa-solid fa-ellipsis-vertical"></i></button>` : "";
    return `<div class="msg-media-wrap">${element}${more}</div>`;
  }

  // Só redesenha quando algo mudou: a atualização automática não interrompe um vídeo tocando.
  let lastRenderSig = "";
  let stickBottomUntil = 0;
  const msgSignature = (m) => [m.id, m.content, m.is_deleted ? 1 : 0, m.is_edited ? 1 : 0, m.read_at || "", m.delivered_at || "", m._pending ? 1 : 0, m._failed ? 1 : 0, m.media_url || ""].join("~");

  function renderMessages(forceScroll = false) {
    const box = $("#messages");
    const group = state.activeGroup;
    const user = state.activeChatUser;
    if (!box || !state.user || (!group && !user)) return;

    const list = allChatMessages();
    const sig = `${group ? `g:${group.id}` : `d:${user.id}`}|${list.map(msgSignature).join("|")}`;
    if (sig === lastRenderSig) {
      if (forceScroll) box.scrollTop = box.scrollHeight;
      return;
    }
    lastRenderSig = sig;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;

    if (!list.length) {
      box.innerHTML = `<div class="message system-msg"><p style="margin:0;">${group ? `Início do grupo ${escapeHTML(group.name)}` : `Início da conversa com @${escapeHTML(user.username)}`}</p></div>`;
      return;
    }

    let lastDay = "";
    box.innerHTML = list.map(m => {
      const mine = m.sender_id === state.user.id;
      const day = new Date(m.created_at).toDateString();
      const separator = day !== lastDay ? `<div class="date-sep">${dayLabel(m.created_at)}</div>` : "";
      lastDay = day;

      const mediaUrl = m.media_url || m._localUrl;
      const mediaType = m.media_type || m._localType;
      const hasMedia = !!mediaUrl && !m.is_deleted;

      let body = m.content ? escapeHTML(m.content) : "";
      const classes = ["message"];
      if (mine) classes.push("mine");
      if (m._failed) classes.push("failed");
      if (hasMedia) classes.push("has-media");
      if (hasMedia && m._pending) classes.push("pending-media");
      if (m.is_deleted) {
        body = `<em class="deleted-msg">essa mensagem foi excluida</em>`;
        classes.push("deleted");
      } else if (m.is_edited && body) {
        body += ` <small class="edited-tag">(editada)</small>`;
      }

      const senderName = group && !mine ? (m.sender?.display_name || m.sender?.username || "Usuário") : "";
      return `${separator}
        <div class="${classes.join(" ")}" data-msg-id="${m.id}">
          ${senderName ? `<span class="msg-sender">${escapeHTML(senderName)}</span>` : ""}
          ${hasMedia ? mediaBubbleHTML(mediaUrl, mediaType, !m._pending && !m._failed) : ""}
          ${body ? `<div class="msg-content">${body}</div>` : ""}
          <small>${formatClock(m.created_at)}${mine && !m.is_deleted ? receiptHTML(m, !!group) : ""}</small>
          ${m._failed ? `<span class="failed-tag">Não enviada. Toque para tentar de novo.</span>` : ""}
        </div>`;
    }).join("");

    if (forceScroll || nearBottom) {
      box.scrollTop = box.scrollHeight;
      stickBottomUntil = Date.now() + 1500; // fotos/vídeos carregam depois e empurram o fim da conversa
    }
  }

  $("#messages")?.addEventListener("load", (e) => {
    if (Date.now() < stickBottomUntil && e.target.classList?.contains("msg-media")) {
      const box = $("#messages");
      box.scrollTop = box.scrollHeight;
    }
  }, true);
  $("#messages")?.addEventListener("loadedmetadata", (e) => {
    if (Date.now() < stickBottomUntil && e.target.classList?.contains("msg-media")) {
      const box = $("#messages");
      box.scrollTop = box.scrollHeight;
    }
  }, true);

  async function fetchAndRenderMessages(opts = {}) {
    if (state.activeGroup) return fetchGroupMessages(opts);

    const user = state.activeChatUser;
    if (!user || !db || !state.user?.id) return;
    const me = state.user.id;
    await ensureSocialState();

    // As 500 mais recentes (e só as posteriores a "apagar mensagens", se houve).
    let query = db.from("messages").select("*")
      .or(`and(sender_id.eq.${me},receiver_id.eq.${user.id}),and(sender_id.eq.${user.id},receiver_id.eq.${me})`)
      .order("created_at", { ascending: false }).limit(500);
    const clearedAt = state.chatSettings[user.id]?.cleared_at;
    if (clearedAt) query = query.gt("created_at", clearedAt);
    const { data, error } = await query;

    if (error) {
      if (!opts.silent) toast(`Não foi possível carregar a conversa: ${formatError(error)}`);
      return;
    }
    if (state.activeGroup || state.activeChatUser?.id !== user.id) return; // trocou de conversa durante a busca

    state.messages = (data || []).slice().reverse();
    renderMessages(!opts.silent);

    const hasUnread = state.messages.some(m => m.receiver_id === me && "read_at" in m && !m.read_at);
    if (hasUnread && state.currentPage === "pageChatRoom" && !document.hidden) {
      if (await markRead(user.id)) renderMessages();
    }
  }

  async function fetchGroupMessages(opts = {}) {
    const group = state.activeGroup;
    if (!group || !db || !state.user?.id) return;
    await ensureSocialState();

    const { data, error } = await db.from("group_messages").select(GROUP_MSG_SELECT)
      .eq("group_id", group.id).order("created_at", { ascending: false }).limit(300);
    if (error) {
      if (!opts.silent) toast(`Não foi possível carregar o grupo: ${formatError(error)}`);
      return;
    }
    if (state.activeGroup?.id !== group.id) return;

    state.messages = (data || []).slice().reverse();
    renderMessages(!opts.silent);
    const last = state.messages[state.messages.length - 1];
    if (last && state.currentPage === "pageChatRoom" && !document.hidden) touchGroupRead(group.id, last.created_at);
  }

  function upsertMessage(m) {
    const index = state.messages.findIndex(x => String(x.id) === String(m.id));
    if (index >= 0) state.messages[index] = { ...state.messages[index], ...m };
    else state.messages.push(m);
  }

  async function deliverMessage(temp) {
    temp._pending = true;
    temp._failed = false;
    renderMessages();

    const isGroup = !!temp.group_id;
    const fail = (message) => {
      temp._pending = false;
      temp._failed = true;
      renderMessages();
      toast(message);
    };

    if (temp._file && !temp.media_url) {
      try {
        const uploaded = await uploadMedia(temp._file, "chat");
        temp.media_url = uploaded.url;
        temp.media_type = uploaded.type;
      } catch (err) {
        return fail(`Anexo não enviado: ${formatError(err)}`);
      }
    }

    const payload = isGroup
      ? { group_id: temp.group_id, sender_id: temp.sender_id, content: temp.content, is_edited: false, is_deleted: false }
      : { sender_id: temp.sender_id, receiver_id: temp.receiver_id, content: temp.content, is_edited: false, is_deleted: false };
    if (temp.media_url) {
      payload.media_url = temp.media_url;
      payload.media_type = temp.media_type;
    }

    const { data, error } = await db.from(isGroup ? "group_messages" : "messages")
      .insert(payload).select(isGroup ? GROUP_MSG_SELECT : "*").single();

    if (error || !data) return fail(`Mensagem não enviada: ${formatError(error)}`);

    temp._confirmedId = data.id;
    state.pendingMessages = state.pendingMessages.filter(p => p !== temp);
    if (temp._localUrl) URL.revokeObjectURL(temp._localUrl);

    // só mexe na tela se o usuário ainda estiver nesta mesma conversa
    const sameRoom = isGroup
      ? state.activeGroup?.id === temp.group_id
      : !state.activeGroup && state.activeChatUser?.id === temp.receiver_id;
    if (sameRoom) {
      upsertMessage(data);
      renderMessages(true);
    }
  }

  /* ----- Anexar foto/vídeo ----- */
  function clearPendingMedia(revoke = true) {
    const media = state.pendingMedia;
    if (media && revoke) URL.revokeObjectURL(media.url);
    state.pendingMedia = null;
    const input = $("#chatMediaFile");
    if (input) input.value = "";
    $("#chatMediaPreview")?.classList.add("hidden");
    const thumb = $("#chatMediaThumb");
    if (thumb) thumb.innerHTML = "";
  }

  on("#btnAttach", "click", () => {
    if (state.visitor || !state.user) return toast("Cadastre-se para enviar anexos.");
    $("#chatMediaFile")?.click();
  });

  on("#chatMediaFile", "change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const problem = validateMediaFile(file);
    if (problem) { e.target.value = ""; return toast(problem); }

    clearPendingMedia();
    const type = isVideoFile(file) ? "video" : "image";
    const url = URL.createObjectURL(file);
    state.pendingMedia = { file, url, type };
    $("#chatMediaThumb").innerHTML = type === "video"
      ? `<video src="${url}#t=0.1" muted playsinline preload="metadata"></video><span class="thumb-play"><i class="fa-solid fa-play"></i></span>`
      : `<img src="${url}" alt="">`;
    setText("#chatMediaName", file.name);
    setText("#chatMediaMeta", `${type === "video" ? "Vídeo" : "Foto"} • ${formatBytes(file.size)}`);
    $("#chatMediaPreview").classList.remove("hidden");
    $("#messageInput")?.focus();
  });

  on("#chatMediaRemove", "click", () => clearPendingMedia());

  on("#messageForm", "submit", (e) => {
    e.preventDefault();
    if (state.visitor || !state.user) return toast("Cadastre-se para conversar.");
    const group = state.activeGroup;
    const user = state.activeChatUser;
    const input = $("#messageInput");
    const text = input?.value.trim();
    const media = state.pendingMedia;
    if ((!group && !user) || (!text && !media)) return;
    if (!group && state.blockedIds.has(user.id)) return toast("Desbloqueie este usuário para enviar mensagens.");

    input.value = "";
    stopTyping();
    clearPendingMedia(false); // a prévia local continua na bolha até o envio terminar

    const temp = {
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sender_id: state.user.id,
      content: text || "",
      created_at: new Date().toISOString(),
      is_edited: false,
      is_deleted: false
    };
    if (group) temp.group_id = group.id; else temp.receiver_id = user.id;
    if (media) {
      temp._file = media.file;
      temp._localUrl = media.url;
      temp._localType = media.type;
    }
    state.pendingMessages.push(temp);
    renderMessages(true);
    deliverMessage(temp);
  });

  /* ----- Visualizador de fotos e vídeos do chat ----- */
  function openMediaViewer(url, type) {
    const body = $("#mediaViewerBody");
    if (!body) return;
    body.innerHTML = type === "video"
      ? `<video src="${escapeHTML(url)}" controls autoplay playsinline></video>`
      : `<img src="${escapeHTML(url)}" alt="Imagem">`;
    $("#mediaViewer").classList.remove("hidden");
  }

  function closeMediaViewer() {
    $("#mediaViewer")?.classList.add("hidden");
    const body = $("#mediaViewerBody");
    if (body) body.innerHTML = "";
  }

  on("#closeMediaViewer", "click", closeMediaViewer);
  on("#mediaViewer", "click", (e) => { if (e.target.id === "mediaViewer" || e.target.id === "mediaViewerBody") closeMediaViewer(); });

  /* ================= MENU DE AÇÕES DA MENSAGEM ================= */
  on("#messages", "click", (e) => {
    const image = e.target.closest("img.msg-media");
    if (image) return openMediaViewer(image.getAttribute("src"), "image");
    if (e.target.closest("video")) return; // controles do vídeo

    const el = e.target.closest(".message[data-msg-id]");
    if (!el) return;
    const msg = allChatMessages().find(m => String(m.id) === el.dataset.msgId);
    if (!msg || msg.is_deleted) return;
    state.activeMsgForAction = msg;
    openMessageMenu(msg);
  });

  const messageTable = () => (state.activeGroup ? "group_messages" : "messages");

  function openMessageMenu(msg) {
    const mine = msg.sender_id === state.user?.id;
    const local = !!(msg._pending || msg._failed);

    const info = [];
    if (msg._failed) info.push("Não enviada.");
    else if (msg._pending) info.push("Enviando...");
    else {
      info.push(`Enviada em ${formatDateTime(msg.created_at)}`);
      if (mine && "delivered_at" in msg) {
        info.push(msg.delivered_at ? `Entregue em ${formatDateTime(msg.delivered_at)}` : "Ainda não entregue");
        info.push(msg.read_at ? `Lida em ${formatDateTime(msg.read_at)}` : "Ainda não lida");
      }
    }
    $("#msgInfo").innerHTML = info.map(line => `<div>${escapeHTML(line)}</div>`).join("");

    $("#btnCopyMsg").classList.toggle("hidden", !!msg._failed || !msg.content);
    $("#btnEditMsg").classList.toggle("hidden", !mine || local || !!msg.media_url);
    $("#btnDeleteMsg").classList.toggle("hidden", !mine || local);
    $("#btnResendMsg").classList.toggle("hidden", !msg._failed);
    $("#btnDiscardMsg").classList.toggle("hidden", !msg._failed);
    openModal("msgActionModal");
  }

  on("#closeMsgModalBtn", "click", () => closeModal("msgActionModal"));

  on("#btnCopyMsg", "click", async () => {
    const msg = state.activeMsgForAction;
    closeModal("msgActionModal");
    if (!msg?.content) return;
    try {
      await navigator.clipboard.writeText(msg.content);
      toast("Mensagem copiada!");
    } catch (e) {
      toast("Não foi possível copiar neste navegador.");
    }
  });

  on("#btnResendMsg", "click", () => {
    const msg = state.activeMsgForAction;
    closeModal("msgActionModal");
    if (msg?._failed) deliverMessage(msg);
  });

  on("#btnDiscardMsg", "click", () => {
    const msg = state.activeMsgForAction;
    closeModal("msgActionModal");
    state.pendingMessages = state.pendingMessages.filter(p => p !== msg);
    if (msg?._localUrl) URL.revokeObjectURL(msg._localUrl);
    renderMessages();
  });

  on("#btnEditMsg", "click", async () => {
    const msg = state.activeMsgForAction;
    closeModal("msgActionModal");
    if (!msg) return;

    const value = await askText({
      title: "Editar mensagem",
      label: "Mensagem",
      value: msg.content,
      maxLength: 500,
      placeholder: "Escreva a mensagem..."
    });
    if (value === null || value === msg.content) return;

    const { error } = await db.from(messageTable()).update({ content: value, is_edited: true }).eq("id", msg.id);
    if (error) return toast(`Não foi possível editar: ${formatError(error)}`);
    msg.content = value;
    msg.is_edited = true;
    renderMessages();
    toast("Mensagem editada!");
  });

  on("#btnDeleteMsg", "click", async () => {
    const msg = state.activeMsgForAction;
    closeModal("msgActionModal");
    if (!msg) return;

    const confirmed = await askConfirm({
      title: "Excluir mensagem?",
      message: state.activeGroup
        ? "A mensagem será substituída por “essa mensagem foi excluida” para todo o grupo."
        : "A mensagem será substituída por “essa mensagem foi excluida” para os dois lados.",
      confirmText: "Excluir",
      danger: true
    });
    if (!confirmed) return;

    const patch = { content: "essa mensagem foi excluida", is_deleted: true };
    if (msg.media_url) { patch.media_url = null; patch.media_type = null; }
    const { error } = await db.from(messageTable()).update(patch).eq("id", msg.id);
    if (error) return toast(`Não foi possível excluir: ${formatError(error)}`);
    Object.assign(msg, patch);
    renderMessages();
    toast("Mensagem excluída!");
  });

  /* ================= GRUPOS ================= */
  const normalizeGroupCode = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const formatGroupCode = (id = "") => (id.length > 4 ? `${id.slice(0, 4)}-${id.slice(4)}` : id);
  function groupAvatarHTML(group, sizeClass = "small") {
    const inner = group?.avatar_url
      ? `<img src="${escapeHTML(group.avatar_url)}" alt="Foto do grupo">`
      : `<i class="fa-solid fa-users"></i>`;
    return `<div class="avatar ${sizeClass} group-avatar">${inner}</div>`;
  }
  const groupFromRPC = (data) => {
    const group = Array.isArray(data) ? data[0] : data;
    return group && typeof group === "object" ? group : null;
  };

  /* ----- Abas Chats / Grupos: arraste para o lado ou toque ----- */
  const chatSwiper = $("#chatSwiper");

  function syncChatTabs(tab) {
    state.chatTab = tab;
    $$("#chatTabs [data-chat-tab]").forEach(btn => {
      const active = btn.dataset.chatTab === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
  }

  function setChatTab(tab, smooth = true) {
    if (!chatSwiper) return;
    syncChatTabs(tab);
    chatSwiper.scrollTo({ left: tab === "groups" ? chatSwiper.clientWidth : 0, behavior: smooth ? "smooth" : "auto" });
    if (tab === "groups") loadGroups();
  }

  function restoreChatTab() {
    if (!chatSwiper) return;
    chatSwiper.scrollLeft = state.chatTab === "groups" ? chatSwiper.clientWidth : 0;
    syncChatTabs(state.chatTab);
  }

  $$("#chatTabs [data-chat-tab]").forEach(btn => btn.addEventListener("click", () => setChatTab(btn.dataset.chatTab)));

  let swipeTimer = null;
  chatSwiper?.addEventListener("scroll", () => {
    clearTimeout(swipeTimer);
    swipeTimer = setTimeout(() => {
      if (!chatSwiper.clientWidth) return; // página escondida
      const tab = chatSwiper.scrollLeft > chatSwiper.clientWidth / 2 ? "groups" : "chats";
      if (tab !== state.chatTab) {
        syncChatTabs(tab);
        if (tab === "groups") loadGroups();
      }
    }, 90);
  }, { passive: true });

  /* ----- Lista de grupos ----- */
  async function loadGroups() {
    const container = $("#groupList");
    if (!container) return;

    if (state.visitor) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><p>Cadastre-se para participar de grupos.</p></div>`;
      return;
    }
    if (!db || !state.user?.id) return;

    await ensureSocialState();
    const me = state.user.id;
    const { data: memberships, error } = await db.from("group_members")
      .select("group_id, last_read_at, groups(*)")
      .eq("user_id", me);

    if (error) {
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Não foi possível carregar seus grupos.<br><small>${escapeHTML(formatError(error))}</small></p></div>`;
      return;
    }

    const mine = (memberships || []).filter(m => m.groups);
    state.myGroupIds = new Set(mine.map(m => m.group_id));

    if (!mine.length) {
      state.groups = [];
      state.unreadGroups = 0;
      updateActivityDots();
      container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><p>Você ainda não está em nenhum grupo.<br><small>Crie um grupo ou entre usando o ID.</small></p></div>`;
      return;
    }

    const ids = [...state.myGroupIds];
    const [msgRes, countRes] = await Promise.all([
      db.from("group_messages").select(GROUP_MSG_SELECT).in("group_id", ids).order("created_at", { ascending: false }).limit(300),
      db.from("group_members").select("group_id").in("group_id", ids)
    ]);

    const counts = {}, lastByGroup = {}, unreadByGroup = {};
    const readAt = Object.fromEntries(mine.map(m => [m.group_id, m.last_read_at]));
    (countRes.data || []).forEach(r => { counts[r.group_id] = (counts[r.group_id] || 0) + 1; });
    (msgRes.data || []).forEach(m => {
      if (!lastByGroup[m.group_id]) lastByGroup[m.group_id] = m; // a primeira é a mais recente
      const unread = m.sender_id !== me && !m.is_deleted && !state.blockedIds.has(m.sender_id)
        && (!readAt[m.group_id] || isAfter(m.created_at, readAt[m.group_id]));
      if (unread) unreadByGroup[m.group_id] = (unreadByGroup[m.group_id] || 0) + 1;
    });

    state.groups = mine.map(m => ({
      ...m.groups,
      member_count: counts[m.group_id] || 1,
      last: lastByGroup[m.group_id] || null,
      unread: unreadByGroup[m.group_id] || 0
    })).sort((a, b) => new Date(b.last?.created_at || b.created_at) - new Date(a.last?.created_at || a.created_at));

    state.unreadGroups = state.groups.reduce((sum, g) => sum + g.unread, 0);
    updateActivityDots();

    container.innerHTML = state.groups.map(g => {
      let preview = "Nenhuma mensagem ainda";
      if (g.last) {
        const who = g.last.sender_id === me ? "Você" : (g.last.sender?.display_name || g.last.sender?.username || "Alguém");
        preview = `${escapeHTML(who)}: ${messagePreviewHTML(g.last)}`;
      }
      return `
        <div class="chat-card" data-group-id="${escapeHTML(g.id)}">
          ${groupAvatarHTML(g)}
          <div class="grow">
            <strong><span class="name-text">${escapeHTML(g.name)}</span></strong>
            <p class="chat-preview ${g.unread ? "unread" : ""}">${preview}</p>
          </div>
          <div class="chat-meta">
            <small>${formatTimeAgo(g.last?.created_at || g.created_at)}</small>
            ${g.unread ? `<span class="unread-badge">${g.unread}</span>` : ""}
          </div>
        </div>`;
    }).join("");

    $$(".chat-card", container).forEach(card => {
      card.addEventListener("click", () => {
        const found = state.groups.find(g => g.id === card.dataset.groupId);
        if (found) openGroupRoom(found);
      });
    });
  }

  // Leve (usada no ciclo automático): só conta o que ainda não foi lido.
  async function refreshGroupUnread() {
    if (!db || !state.user) return;
    const me = state.user.id;
    const { data: mem, error } = await db.from("group_members").select("group_id, last_read_at").eq("user_id", me);
    if (error) return;
    state.myGroupIds = new Set((mem || []).map(m => m.group_id));
    if (!mem?.length) { state.unreadGroups = 0; return; }

    const readAt = Object.fromEntries(mem.map(m => [m.group_id, m.last_read_at]));
    const oldest = mem.reduce((min, m) => (!min || isAfter(min, m.last_read_at) ? m.last_read_at : min), null);
    const { data: msgs, error: msgError } = await db.from("group_messages").select("group_id, sender_id, created_at")
      .in("group_id", [...state.myGroupIds]).neq("sender_id", me).eq("is_deleted", false).gt("created_at", oldest).limit(500);
    if (msgError) return;

    let total = 0;
    (msgs || []).forEach(m => {
      if (state.blockedIds.has(m.sender_id)) return;
      if (state.currentPage === "pageChatRoom" && state.activeGroup?.id === m.group_id) return;
      if (isAfter(m.created_at, readAt[m.group_id])) total++;
    });
    if (state.countsLoaded && total > state.unreadGroups) notifyUser("Você tem novas mensagens em grupos");
    state.unreadGroups = total;
  }

  const groupReadMark = {};
  async function touchGroupRead(groupId, latestAt) {
    if (!db || !state.user || !latestAt || groupReadMark[groupId] === latestAt) return;
    groupReadMark[groupId] = latestAt;
    const { error } = await db.from("group_members").update({ last_read_at: latestAt }).eq("group_id", groupId).eq("user_id", state.user.id);
    if (error) { delete groupReadMark[groupId]; return; }
    const group = state.groups.find(g => g.id === groupId);
    if (group && group.unread) {
      state.unreadGroups = Math.max(0, state.unreadGroups - group.unread);
      group.unread = 0;
      updateActivityDots();
    }
  }

  /* ----- Criar grupo e entrar com ID ----- */
  on("#btnCreateGroup", "click", () => {
    if (state.visitor || !state.user) return toast("Cadastre-se para criar grupos.");
    $("#groupNameInput").value = "";
    openModal("groupCreateModal");
    setTimeout(() => $("#groupNameInput")?.focus(), 60);
  });
  on("#closeGroupCreate", "click", () => closeModal("groupCreateModal"));
  on("#cancelGroupCreate", "click", () => closeModal("groupCreateModal"));

  on("#groupCreateForm", "submit", async (e) => {
    e.preventDefault();
    if (!db || !state.user) return;
    const name = $("#groupNameInput").value.trim();
    if (name.length < 2) return toast("Dê um nome com pelo menos 2 letras.");

    const btn = $("#saveGroupCreate");
    btn.disabled = true;
    const { data, error } = await db.rpc("create_group", { p_name: name });
    btn.disabled = false;
    if (error) return toast(`Não foi possível criar o grupo: ${formatError(error)}`);

    const group = groupFromRPC(data);
    closeModal("groupCreateModal");
    toast("Grupo criado! Compartilhe o ID para convidar pessoas.");
    await loadGroups();
    if (group) openGroupInfo(state.groups.find(g => g.id === group.id) || { ...group, member_count: 1 });
  });

  on("#joinGroupForm", "submit", async (e) => {
    e.preventDefault();
    if (state.visitor || !state.user || !db) return toast("Cadastre-se para entrar em grupos.");
    const code = normalizeGroupCode($("#joinGroupInput").value);
    if (code.length < 4) return toast("Digite o ID do grupo.");

    const { data, error } = await db.rpc("join_group", { p_id: code });
    if (error) return toast(formatError(error));

    const group = groupFromRPC(data);
    if (!group) return toast("Não foi possível entrar no grupo.");
    $("#joinGroupInput").value = "";
    toast(`Você entrou em “${group.name}”!`);
    await loadGroups();
    openGroupRoom(state.groups.find(g => g.id === group.id) || group);
  });

  /* ----- Informações do grupo: ID, membros, sair ----- */
  async function openGroupInfo(group) {
    if (!group || !db) return;
    state.infoGroup = group;
    const isOwner = group.owner_id === state.user?.id;
    setText("#groupInfoName", group.name);
    setText("#groupInfoId", formatGroupCode(group.id));
    $("#btnRenameGroup").classList.toggle("hidden", !isOwner);
    renderGroupPhoto(group, isOwner);
    $("#groupMembers").innerHTML = `<p class="member-empty">Carregando...</p>`;
    openModal("groupInfoModal");

    const { data, error } = await db.from("group_members")
      .select("user_id, joined_at, profiles(id, username, display_name, avatar_url, is_verified, is_developer)")
      .eq("group_id", group.id).order("joined_at", { ascending: true });
    if (state.infoGroup?.id !== group.id) return;
    if (error) { $("#groupMembers").innerHTML = `<p class="member-empty">${escapeHTML(formatError(error))}</p>`; return; }

    const members = (data || []).filter(m => m.profiles);
    group.member_count = members.length;
    if (state.activeGroup?.id === group.id) { state.activeGroup.member_count = members.length; refreshChatStatus(); }
    setText("#groupMembersTitle", `MEMBROS (${members.length})`);

    $("#groupMembers").innerHTML = members.map(({ profiles: p, user_id }) => `
      <div class="member-row" data-user-id="${p.id}">
        ${renderAvatarHTML(p, "small")}
        <div class="grow">
          <strong><span class="name-text">${escapeHTML(p.display_name || p.username)}</span>${getBadgesHTML(p)}</strong>
          <small>@${escapeHTML(p.username || "")}</small>
        </div>
        ${user_id === group.owner_id ? `<span class="member-role">CRIADOR</span>` : ""}
      </div>`).join("");
    $("#groupMembers")._members = Object.fromEntries(members.map(m => [m.profiles.id, m.profiles]));
  }

  function renderGroupPhoto(group, isOwner = group?.owner_id === state.user?.id) {
    const box = $("#groupPhotoPreview");
    if (!box) return;
    box.innerHTML = group.avatar_url
      ? `<img src="${escapeHTML(group.avatar_url)}" alt="Foto do grupo">`
      : `<i class="fa-solid fa-users"></i>`;
    box.classList.toggle("editable", isOwner);
    $("#groupPhotoOverlay")?.classList.toggle("hidden", !isOwner);
    const btn = $("#btnChangeGroupPhoto");
    if (btn) {
      btn.classList.toggle("hidden", !isOwner);
      btn.innerHTML = `<i class="fa-solid fa-camera"></i> ${group.avatar_url ? "Trocar foto do grupo" : "Adicionar foto do grupo"}`;
    }
  }

  on("#closeGroupInfo", "click", () => { state.infoGroup = null; closeModal("groupInfoModal"); });

  on("#groupMembers", "click", (e) => {
    const row = e.target.closest(".member-row");
    if (!row) return;
    const profile = $("#groupMembers")._members?.[row.dataset.userId];
    if (!profile) return;
    state.infoGroup = null;
    closeModal("groupInfoModal");
    openUserProfile(profile);
  });

  on("#btnCopyGroupId", "click", async () => {
    const group = state.infoGroup;
    if (!group) return;
    try {
      await navigator.clipboard.writeText(formatGroupCode(group.id));
      toast("ID copiado!");
    } catch (e) {
      toast(`ID do grupo: ${formatGroupCode(group.id)}`);
    }
  });

  on("#btnShareGroupId", "click", () => {
    const group = state.infoGroup;
    if (!group) return;
    shareLink({
      title: "Pijama Party",
      text: `Entre no grupo “${group.name}” no Pijama Party! ID: ${formatGroupCode(group.id)}`,
      url: location.href.split("#")[0]
    });
  });

  const pickGroupPhoto = () => {
    const group = state.infoGroup;
    if (!group || group.owner_id !== state.user?.id) return;
    $("#groupPhotoFile")?.click();
  };
  on("#groupPhotoPreview", "click", pickGroupPhoto);
  on("#btnChangeGroupPhoto", "click", pickGroupPhoto);

  on("#groupPhotoFile", "change", async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    const group = state.infoGroup;
    if (!file || !group || !db || group.owner_id !== state.user?.id) return;
    if (!file.type.startsWith("image/")) return toast("Escolha uma imagem para a foto do grupo.");

    const btn = $("#btnChangeGroupPhoto");
    const wrap = $("#groupPhotoPreview");
    if (btn) btn.disabled = true;
    wrap?.classList.add("loading");

    try {
      const url = await uploadProfileImage(file, "group");
      if (!url) throw new Error("Não foi possível enviar a imagem.");

      const { error } = await db.from("groups").update({ avatar_url: url }).eq("id", group.id);
      if (error) throw error;

      group.avatar_url = url;
      const found = state.groups.find(g => g.id === group.id);
      if (found) found.avatar_url = url;
      if (state.activeGroup?.id === group.id) { state.activeGroup.avatar_url = url; renderChatHeader(); }
      renderGroupPhoto(group, true);
      loadGroups();
      toast("Foto do grupo atualizada!");
    } catch (err) {
      toast(`Não foi possível salvar a foto: ${formatError(err)}`);
    } finally {
      if (btn) btn.disabled = false;
      wrap?.classList.remove("loading");
    }
  });

  on("#btnRenameGroup", "click", async () => {
    const group = state.infoGroup;
    if (!group || group.owner_id !== state.user?.id) return;
    const name = await askText({ title: "Editar nome do grupo", label: "Nome", value: group.name, maxLength: 40, confirmText: "Salvar" });
    if (name === null || name === group.name) return;
    if (name.length < 2) return toast("Use pelo menos 2 letras.");

    const { error } = await db.from("groups").update({ name }).eq("id", group.id);
    if (error) return toast(`Não foi possível renomear: ${formatError(error)}`);
    group.name = name;
    setText("#groupInfoName", name);
    if (state.activeGroup?.id === group.id) { state.activeGroup.name = name; renderChatHeader(); }
    loadGroups();
    toast("Nome do grupo atualizado!");
  });

  on("#btnLeaveGroup", "click", async () => {
    const group = state.infoGroup;
    if (!group || !db) return;
    const confirmed = await askConfirm({
      title: "Sair do grupo?",
      message: `Você deixará de receber as mensagens de “${group.name}”. Para voltar, será preciso entrar de novo com o ID.`,
      confirmText: "Sair",
      danger: true
    });
    if (!confirmed) return;

    const { error } = await db.rpc("leave_group", { p_id: group.id });
    if (error) return toast(`Não foi possível sair: ${formatError(error)}`);

    state.infoGroup = null;
    closeModal("groupInfoModal");
    toast("Você saiu do grupo.");
    if (state.activeGroup?.id === group.id) {
      state.activeGroup = null;
      state.chatTab = "groups";
      navigateTo("pageChats");
    } else {
      loadGroups();
    }
  });

  /* ================= PRIVACIDADE: online, digitando e bloqueados ================= */
  async function renderBlockedList() {
    const box = $("#blockedList");
    if (!box) return;
    await ensureSocialState();
    const ids = [...state.blockedIds];
    if (!ids.length) { box.innerHTML = `<p class="member-empty">Você não bloqueou ninguém.</p>`; return; }

    const { data } = await db.from("profiles").select("id, username, display_name, avatar_url, is_verified, is_developer").in("id", ids);
    box.innerHTML = (data || []).map(u => `
      <div class="member-row" style="cursor:default;">
        ${renderAvatarHTML(u, "small")}
        <div class="grow">
          <strong><span class="name-text">${escapeHTML(u.display_name || u.username)}</span>${getBadgesHTML(u)}</strong>
          <small>@${escapeHTML(u.username || "")}</small>
        </div>
        <button class="btn secondary compact" type="button" data-unblock="${u.id}">Desbloquear</button>
      </div>`).join("") || `<p class="member-empty">Você não bloqueou ninguém.</p>`;
  }

  async function openPrivacyModal() {
    if (state.visitor || !state.user) return toast("Crie uma conta para ajustar a privacidade.");
    $("#prefShowOnline").checked = !!prefs.showOnline;
    $("#prefShowTyping").checked = !!prefs.showTyping;
    openModal("privacyModal");
    await renderBlockedList();
  }

  on("#closePrivacyModal", "click", () => closeModal("privacyModal"));

  on("#prefShowOnline", "change", (e) => {
    prefs.showOnline = e.target.checked;
    savePrefs();
    applyPresencePref();
  });
  on("#prefShowTyping", "change", (e) => {
    prefs.showTyping = e.target.checked;
    savePrefs();
    if (!prefs.showTyping) stopTyping();
  });

  on("#blockedList", "click", async (e) => {
    const btn = e.target.closest("[data-unblock]");
    if (!btn) return;
    btn.disabled = true;
    if (await unblockUser(btn.dataset.unblock)) {
      toast("Usuário desbloqueado.");
      await renderBlockedList();
      afterBlockChange();
    } else {
      btn.disabled = false;
    }
  });

  /* ================= NOTIFICAÇÕES ================= */
  const NOTIF_TABLE = "app_notifications";
  const NOTIFICATION_ICONS = {
    like: ["fa-solid fa-heart", "like"],
    comment: ["fa-solid fa-comment", "comment"],
    follow: ["fa-solid fa-user-plus", "follow"],
    pix_request: ["fa-solid fa-coins", "coins"],
    pix_approved: ["fa-solid fa-coins", "coins"],
    pix_rejected: ["fa-solid fa-circle-xmark", "rejected"]
  };

  function notificationText(n) {
    switch (n.type) {
      case "like": return "curtiu sua publicação.";
      case "comment": return `comentou: “${escapeHTML(n.content || "")}”`;
      case "follow": return "começou a seguir você.";
      case "pix_request": return `pediu ${escapeHTML(n.content || "moedas")} via PIX.`;
      case "pix_approved": return "Seu pagamento PIX foi confirmado. As moedas já estão na sua carteira!";
      case "pix_rejected": return "Seu pedido de moedas via PIX foi recusado.";
      default: return escapeHTML(n.content || "Nova atividade.");
    }
  }

  function notificationToast(n, actor) {
    const who = actor ? `@${actor.username}` : "";
    switch (n.type) {
      case "like": return `${who} curtiu sua publicação`;
      case "comment": return `${who} comentou na sua publicação`;
      case "follow": return `${who} começou a seguir você`;
      case "pix_request": return `${who} fez um pedido de moedas via PIX`;
      case "pix_approved": return "Pagamento PIX confirmado! Moedas liberadas.";
      case "pix_rejected": return "Seu pedido PIX foi recusado.";
      default: return "Você tem uma nova notificação";
    }
  }

  function pixCardHTML(request, admin) {
    const statusLabel = { pending: "Em análise", approved: "Confirmado", rejected: "Recusado" }[request.status] || request.status;
    const owner = request.profiles?.display_name || request.profiles?.username || "Usuário";
    return `
      <div class="admin-notification-card ${request.status === "pending" ? "pending-pix" : ""}">
        <div class="admin-notification-header">
          <strong>${admin ? `${escapeHTML(owner)} — ` : ""}${request.amount} moedas (R$ ${Number(request.price).toFixed(2)})</strong>
          <span class="badge-status ${request.status}">${statusLabel}</span>
        </div>
        <div class="admin-notification-body">
          <p><small style="color:var(--muted)">${new Date(request.created_at).toLocaleString("pt-BR")}</small></p>
          ${admin ? `<p>“${escapeHTML(request.message || "")}”</p>` : ""}
        </div>
        ${admin && request.status === "pending" ? `
          <div class="admin-notification-actions">
            <button class="btn primary compact" data-pix="${request.id}" data-ok="1"><i class="fa-solid fa-check"></i> Confirmar</button>
            <button class="btn danger compact" data-pix="${request.id}" data-ok="0"><i class="fa-solid fa-xmark"></i> Recusar</button>
          </div>` : ""}
      </div>`;
  }

  async function loadNotifications() {
    const box = $("#notificationsList");
    if (!box) return;

    if (state.visitor || !db || !state.user) {
      box.innerHTML = `<div class="empty-state"><i class="fa-regular fa-bell"></i><p>Cadastre-se para receber notificações.</p></div>`;
      return;
    }

    let pixQuery = db.from("pix_requests").select("*, profiles(username, display_name)")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(30);
    if (!isAdmin()) pixQuery = pixQuery.eq("user_id", state.user.id);

    const [feedRes, pixRes] = await Promise.all([
      db.from(NOTIF_TABLE)
        .select("*, actor:profiles!actor_id(id, username, display_name, avatar_url, is_verified, is_developer)")
        .eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(60),
      pixQuery
    ]);

    if (state.currentPage !== "pageNotifications") return;

    const feed = feedRes.data || [];
    const pix = pixRes.data || [];
    let html = "";

    if (pix.length) {
      html += `<div class="notif-section-title"><span class="eyebrow">${isAdmin() ? "PEDIDOS PIX PENDENTES" : "SEUS PEDIDOS PIX"}</span></div>`;
      html += pix.map(r => pixCardHTML(r, isAdmin())).join("");
    }

    if (feed.length) {
      html += `<div class="notif-section-title"><span class="eyebrow">ATIVIDADE</span></div>`;
      html += feed.map(n => {
        const [iconClass, tone] = NOTIFICATION_ICONS[n.type] || ["fa-solid fa-bell", "coins"];
        const leading = n.actor
          ? renderAvatarHTML(n.actor, "small")
          : `<div class="notif-type ${tone}"><i class="${iconClass}"></i></div>`;
        const who = n.actor
          ? `<strong>${escapeHTML(n.actor.display_name || n.actor.username)}${getBadgesHTML(n.actor)}</strong> `
          : "";
        return `
          <div class="notif-item ${n.read_at ? "" : "unread"}" data-type="${n.type}" data-post-id="${n.post_id || ""}" data-actor-id="${n.actor_id || ""}">
            ${leading}
            <div class="grow">
              <p>${who}${notificationText(n)}</p>
              <small>${formatTimeAgo(n.created_at)}</small>
            </div>
            ${n.actor ? `<span class="notif-type ${tone}"><i class="${iconClass}"></i></span>` : ""}
          </div>`;
      }).join("");
    }

    box.innerHTML = html || `<div class="empty-state"><i class="fa-regular fa-bell"></i><p>Nenhuma notificação no momento.</p></div>`;
    box._actors = Object.fromEntries(feed.filter(n => n.actor).map(n => [n.actor_id, n.actor]));

    // tudo que apareceu na tela passa a contar como lido
    if (feed.some(n => !n.read_at)) {
      db.rpc("mark_notifications_read").then(({ error }) => {
        if (error) return;
        state.unreadNotifications = 0;
        updateActivityDots();
      });
    } else {
      state.unreadNotifications = 0;
      updateActivityDots();
    }
  }

  on("#notificationsList", "click", async (e) => {
    const pixBtn = e.target.closest("[data-pix]");
    if (pixBtn) {
      pixBtn.disabled = true;
      const approve = pixBtn.dataset.ok === "1";
      const { error } = await db.rpc("resolve_pix", { p_id: pixBtn.dataset.pix, p_ok: approve });
      toast(error ? formatError(error) : (approve ? "Moedas liberadas ao usuário." : "Pedido recusado."));
      loadNotifications();
      return;
    }

    const item = e.target.closest(".notif-item");
    if (!item) return;
    const { type, postId, actorId } = item.dataset;

    if ((type === "like" || type === "comment") && postId) {
      const { data } = await db.from("posts").select(POST_SELECT).eq("id", postId).maybeSingle();
      if (data) openPostDetailModal(data);
      else toast("Essa publicação não existe mais.");
    } else if (type === "follow" && actorId) {
      const actor = $("#notificationsList")._actors?.[actorId];
      if (actor) openUserProfile(actor);
    }
  });

  async function refreshUnreadCounts() {
    if (!db || !state.user) return;
    const me = state.user.id;
    let chatQuery = db.from("messages").select("id", { count: "exact", head: true }).eq("receiver_id", me).is("read_at", null).eq("is_deleted", false);
    if (state.blockedIds.size) chatQuery = chatQuery.not("sender_id", "in", `(${[...state.blockedIds].join(",")})`);
    const [notifRes, chatRes] = await Promise.all([
      db.from(NOTIF_TABLE).select("id", { count: "exact", head: true }).eq("user_id", me).is("read_at", null),
      chatQuery
    ]);

    // Se a contagem subiu sem o tempo real avisar (conexão caiu), avisamos aqui.
    if (!notifRes.error && notifRes.count !== null) {
      if (state.countsLoaded && notifRes.count > state.unreadNotifications) notifyUser("Você tem novas notificações");
      state.unreadNotifications = notifRes.count;
    }
    if (!chatRes.error && chatRes.count !== null) {
      if (state.countsLoaded && chatRes.count > state.unreadChats) notifyUser("Você tem novas mensagens");
      state.unreadChats = chatRes.count;
    }
    await refreshGroupUnread();
    state.countsLoaded = true;
    updateActivityDots();
  }

  /* ================= TEMPO REAL: MENSAGENS, NOTIFICAÇÕES E PRESENÇA ================= */
  let realtimeChannel = null;
  let presenceChannel = null;
  let groupChannel = null;
  let pollTimer = null;

  // "Mostrar quando estou online" (Privacidade): para de aparecer sem deixar de ver os outros.
  function applyPresencePref() {
    if (!presenceChannel) return;
    try {
      if (prefs.showOnline) presenceChannel.track({ at: Date.now() });
      else presenceChannel.untrack();
    } catch (e) {}
  }

  async function onIncomingMessage(m) {
    if (!state.user || m.receiver_id !== state.user.id) return;
    if (state.blockedIds.has(m.sender_id)) return; // bloqueado: não aparece nem notifica
    const inThisChat = !state.activeGroup && state.currentPage === "pageChatRoom" && state.activeChatUser?.id === m.sender_id;
    if (inThisChat && typingState.who.delete(m.sender_id)) refreshChatStatus(); // a mensagem chegou: some o "digitando"

    markDelivered();

    if (inThisChat) {
      upsertMessage(m);
      renderMessages(true);
      if (!document.hidden) markRead(m.sender_id).then(() => renderMessages());
      else { state.unreadChats++; updateActivityDots(); }
      return;
    }

    state.unreadChats++;
    updateActivityDots();
    if (state.currentPage === "pageChats") loadChats();
    const sender = await getProfileLite(m.sender_id);
    notifyUser(`Nova mensagem de ${sender?.display_name || sender?.username || "alguém"}`);
  }

  async function onIncomingGroupMessage(m) {
    if (!state.user || m.sender_id === state.user.id || state.blockedIds.has(m.sender_id)) return;
    const inRoom = state.currentPage === "pageChatRoom" && state.activeGroup?.id === m.group_id;
    const sender = await getProfileLite(m.sender_id);
    m.sender = sender;

    if (inRoom) {
      typingState.who.delete(m.sender_id);
      refreshChatStatus();
      upsertMessage(m);
      renderMessages(true);
      if (!document.hidden) touchGroupRead(m.group_id, m.created_at);
      else { state.unreadGroups++; updateActivityDots(); }
      return;
    }

    state.myGroupIds.add(m.group_id);
    state.unreadGroups++;
    updateActivityDots();
    if (state.currentPage === "pageChats") loadGroups();
    const group = state.groups.find(g => g.id === m.group_id);
    notifyUser(`Nova mensagem em ${group ? `“${group.name}”` : "um grupo"}`);
  }

  function onGroupMessageUpdated(m) {
    if (state.currentPage !== "pageChatRoom" || state.activeGroup?.id !== m.group_id) return;
    const index = state.messages.findIndex(x => String(x.id) === String(m.id));
    if (index < 0) return;
    state.messages[index] = { ...state.messages[index], ...m, sender: state.messages[index].sender };
    renderMessages();
  }

  function onMessageUpdated(m) {
    const index = state.messages.findIndex(x => String(x.id) === String(m.id));
    if (index < 0) return;
    state.messages[index] = { ...state.messages[index], ...m };
    if (state.currentPage === "pageChatRoom") renderMessages();
  }

  async function onIncomingNotification(n) {
    if (!state.user || n.user_id !== state.user.id) return;
    state.unreadNotifications++;
    updateActivityDots();
    const actor = n.actor_id ? await getProfileLite(n.actor_id) : null;
    notifyUser(notificationToast(n, actor));
    if (n.type === "pix_approved") refreshProfile();
    if (state.currentPage === "pageNotifications") loadNotifications();
  }

  function startRealtime() {
    if (realtimeChannel || !db || !state.user) return;
    const me = state.user.id;

    realtimeChannel = db.channel(`rt-${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${me}` }, p => onIncomingMessage(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${me}` }, p => onMessageUpdated(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `receiver_id=eq.${me}` }, p => onMessageUpdated(p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: NOTIF_TABLE, filter: `user_id=eq.${me}` }, p => onIncomingNotification(p.new))
      .subscribe();

    presenceChannel = db.channel("online-users", { config: { presence: { key: me } } });
    presenceChannel
      .on("presence", { event: "sync" }, () => {
        state.onlineIds = new Set(Object.keys(presenceChannel.presenceState()));
        refreshChatStatus();
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && prefs.showOnline) await presenceChannel.track({ at: Date.now() });
      });

    // Canal separado: se a tabela de grupos ainda não existir, mensagens e notificações seguem funcionando.
    groupChannel = db.channel(`rt-groups-${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, p => onIncomingGroupMessage(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "group_messages" }, p => onGroupMessageUpdated(p.new))
      .subscribe();
  }

  function stopRealtime() {
    stopPolling();
    closeTypingChannel();
    [realtimeChannel, presenceChannel, groupChannel].forEach(channel => {
      if (channel) { try { db.removeChannel(channel); } catch (e) {} }
    });
    realtimeChannel = null;
    presenceChannel = null;
    groupChannel = null;
    state.onlineIds = new Set();
  }

  // Rede de segurança: se o tempo real não estiver ativo no Supabase, a tela ainda atualiza.
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (document.hidden || !state.user) return;
      refreshUnreadCounts();
      markDelivered();
      if (state.currentPage === "pageChatRoom") fetchAndRenderMessages({ silent: true });
      if (state.currentPage === "pageTrending") loadTrending();
    }, 10000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.user) return;
    refreshUnreadCounts();
    markDelivered();
    if (state.currentPage === "pageChatRoom") fetchAndRenderMessages({ silent: true });
  });

  /* ================= INICIALIZAÇÃO DA APLICAÇÃO ================= */
  async function initApp() {
    syncThemeUI();
    if (!db) {
      console.warn("Supabase não configurado.");
      return;
    }

    const { data } = await db.auth.getSession();
    if (data?.session) {
      state.session = data.session;
      state.user = data.session.user;
      state.visitor = false;
      await fetchProfile();
      if (await rejectIfBanned()) return;
      enterApp();
    } else {
      state.visitor = true;
    }
  }

  /* ================= V2: LIVE REAL (WebRTC + Supabase Realtime) ================= */
  // Para o vídeo chegar em redes 4G/5G e Wi-Fi corporativo é NECESSÁRIO um servidor TURN.
  // Preencha abaixo (ex.: Metered, Cloudflare, Twilio, coturn próprio):
  //   { urls: "turn:SEU_SERVIDOR:443?transport=tcp", username: "USUARIO", credential: "SENHA" }
  const TURN_SERVERS = [];
  const RTC_CFG = {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, ...TURN_SERVERS],
    iceCandidatePoolSize: 4
  };
  // Cada espectador recebe um fluxo direto do criador (malha P2P): o limite protege a internet de quem transmite.
  const LIVE_MAX_VIEWERS = 8;
  const LIVE_UPLINK_BUDGET = 4000000;   // bits/s totais de upload
  const LIVE_MAX_BITRATE = 2500000;     // por espectador
  const LIVE_MIN_BITRATE = 350000;

  const live = {
    ch: null, stream: null, pcs: {}, session: 0, connected: false,
    joinTimer: null, negTimer: null, hostGoneTimer: null, discTimer: null,
    heartbeatTimer: null, viewersTimer: null, wakeLock: null, viewers: 0,
    lastChatAt: 0, hbOk: true, vcOk: true, token: null
  };

  function addLiveMsg(name, text, isHostMsg = false) {
    const box = $("#liveChat");
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const d = document.createElement("div");
    d.className = "message" + (isHostMsg ? " host" : "");
    d.innerHTML = `<strong>${escapeHTML(name)}:</strong> ${escapeHTML(text)}`;
    box.appendChild(d);
    while (box.children.length > 100) box.firstElementChild.remove();
    if (nearBottom || isHostMsg) box.scrollTop = box.scrollHeight;
  }

  function sendSig(event, payload) {
    try { return live.ch?.send({ type: "broadcast", event, payload }); } catch (e) { return null; }
  }

  // Os candidatos ICE saem em LOTE (1 mensagem a cada ~120 ms, em vez de 1 por candidato).
  // Enviar dezenas de mensagens de uma vez estoura o limite do Realtime e a conexão nunca fecha.
  function flushIceOut(pc, peerId) {
    clearTimeout(pc._iceT); pc._iceT = null;
    const cs = pc._iceOut || [];
    pc._iceOut = [];
    if (cs.length && live.pcs[peerId] === pc) sendSig("ice", { from: state.user.id, to: peerId, cs });
  }
  const iceList = (payload) => Array.isArray(payload?.cs) ? payload.cs : (payload?.c ? [payload.c] : []);

  function newPC(peerId) {
    const pc = new RTCPeerConnection(RTC_CFG);
    live.pcs[peerId] = pc;
    pc._iceOut = [];
    pc.onicecandidate = (e) => {
      if (!e.candidate) return flushIceOut(pc, peerId);
      pc._iceOut.push(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
      if (!pc._iceT) pc._iceT = setTimeout(() => flushIceOut(pc, peerId), 120);
    };
    return pc;
  }

  async function addIce(pc, c) {
    if (pc.remoteDescription) { try { await pc.addIceCandidate(c); } catch (e) {} }
    else (pc._q = pc._q || []).push(c);
  }
  async function flushIce(pc) { for (const c of pc._q || []) { try { await pc.addIceCandidate(c); } catch (e) {} } pc._q = []; }

  // Qualidade: divide o upload entre os espectadores conectados.
  function applyBitrate(pc, bitrate) {
    pc.getSenders().forEach(sender => {
      if (!sender.track || sender.track.kind !== "video") return;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        params.encodings[0].maxFramerate = 30;
        sender.setParameters(params).catch(() => {});
      } catch (e) {}
    });
  }
  function rebalanceBitrate() {
    const peers = Object.values(live.pcs);
    if (!peers.length) return;
    const each = Math.max(LIVE_MIN_BITRATE, Math.min(LIVE_MAX_BITRATE, Math.floor(LIVE_UPLINK_BUDGET / peers.length)));
    peers.forEach(pc => applyBitrate(pc, each));
  }

  async function acquireWake() {
    try { if ("wakeLock" in navigator && !live.wakeLock) live.wakeLock = await navigator.wakeLock.request("screen"); } catch (e) {}
  }
  function releaseWake() { try { live.wakeLock?.release(); } catch (e) {} live.wakeLock = null; }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.activeLive) { live.wakeLock = null; acquireWake(); $("#liveVideo")?.play?.().catch(() => {}); }
  });

  function updateSoundBtn() {
    const btn = $("#btnLiveSound"), vid = $("#liveVideo");
    if (!btn || !vid) return;
    const isViewer = state.activeLive && state.user?.id !== state.activeLive.host_id;
    const show = isViewer && !vid.classList.contains("hidden") && vid.muted;
    btn.classList.toggle("hidden", !show);
  }
  on("#btnLiveSound", "click", () => {
    const vid = $("#liveVideo");
    if (!vid) return;
    vid.muted = false;
    vid.play().catch(() => { vid.muted = true; });
    updateSoundBtn();
  });

  function fitVideo(vid) {
    const landscape = vid.videoWidth > vid.videoHeight && window.innerHeight > window.innerWidth;
    vid.classList.toggle("fit-contain", landscape);
  }

  async function teardownLive() {
    live.session++;
    clearInterval(live.joinTimer); clearTimeout(live.negTimer); clearTimeout(live.hostGoneTimer);
    clearTimeout(live.discTimer); clearInterval(live.heartbeatTimer); clearTimeout(live.viewersTimer);
    live.joinTimer = live.negTimer = live.hostGoneTimer = live.discTimer = live.heartbeatTimer = live.viewersTimer = null;
    live.connected = false; live.hbOk = true; live.vcOk = true;
    Object.values(live.pcs).forEach(pc => { try { clearTimeout(pc._iceT); pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.close(); } catch (e) {} });
    live.pcs = {};
    live.token = null;
    live.stream?.getTracks().forEach(t => t.stop());
    live.stream = null;
    releaseWake();
    if (live.ch) { try { await db.removeChannel(live.ch); } catch (e) {} live.ch = null; }
    const v = $("#liveVideo");
    if (v) { v.srcObject = null; v.classList.add("hidden"); v.classList.remove("fit-contain", "mirror"); v.muted = true; }
    $("#liveCameraPlaceholder")?.classList.remove("hidden");
    updateSoundBtn();
  }

  async function getHostStream() {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) throw new Error("NO_MEDIA");
    try {
      return await md.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      if (!e || (e.name !== "OverconstrainedError" && e.name !== "NotFoundError")) throw e;
    }
    try {
      return await md.getUserMedia({ video: true, audio: true });
    } catch (e) {
      if (e && e.name === "NotFoundError") {
        // Sem microfone: transmite só o vídeo e AVISA (antes a live falhava ou ia sem som sem ninguém saber).
        const onlyVideo = await md.getUserMedia({ video: true });
        setTimeout(() => toast("Microfone não encontrado: você está transmitindo sem áudio."), 600);
        return onlyVideo;
      }
      throw e;
    }
  }

  function mediaErrorMessage(e) {
    if (e?.message === "NO_MEDIA") return "Seu navegador não liberou a câmera. Abra o site em HTTPS e use um navegador atualizado.";
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") return "Permita o acesso à câmera e ao microfone para transmitir.";
    if (e?.name === "NotFoundError") return "Nenhuma câmera ou microfone encontrado.";
    if (e?.name === "NotReadableError") return "A câmera está sendo usada por outro aplicativo.";
    return "Não foi possível iniciar a câmera.";
  }

  async function openLiveRoom(l, preStream) {
    const pre = (typeof MediaStream !== "undefined" && preStream instanceof MediaStream) ? preStream : null;
    if (!l || !db || !state.user) { pre?.getTracks().forEach(t => t.stop()); return; }
    await teardownLive();
    const session = live.session;
    const alive = () => session === live.session;
    state.activeLive = l;
    const me = state.user.id;
    const isHost = me === l.host_id;
    const vid = $("#liveVideo"), ph = $("#liveCameraPlaceholder");
    const phText = ph.querySelector("p");

    $("#pageLiveRoom").classList.add("active");
    $("#liveRoomTitle").textContent = l.title || "Transmissão ao vivo";
    $("#liveRoomCategory").textContent = l.category || "Geral";
    $("#liveViewerCount").textContent = "0 espectadores";
    $("#liveChat").innerHTML = "";
    phText.textContent = isHost ? "Iniciando câmera..." : "Conectando à transmissão...";
    showLiveSwipeHint(isHost);
    $("#btnEndLive").classList.toggle("hidden", !isHost);
    const hostName = l.profiles?.display_name || l.profiles?.username || "Criador";
    $("#liveHostButton").innerHTML = `${escapeHTML(hostName)}${getBadgesHTML(l.profiles)}`;
    acquireWake();

    const ch = db.channel(`live:${l.id}`, { config: { presence: { key: me }, broadcast: { self: false } } });
    live.ch = ch;

    ch.on("broadcast", { event: "chat" }, ({ payload }) => {
      if (!payload || !alive()) return;
      if (payload.uid && state.blockedIds.has(payload.uid)) return;   // usuário que eu bloqueei não aparece
      addLiveMsg(String(payload.name || "Alguém").slice(0, 40), String(payload.text || "").slice(0, 200), payload.uid === l.host_id);
    });
    ch.on("broadcast", { event: "gift" }, ({ payload }) => {
      if (!payload || !alive()) return;
      triggerGiftAnimation(String(payload.emoji || "🎁").slice(0, 4));
      addLiveMsg(String(payload.name || "Alguém").slice(0, 40), `enviou ${String(payload.emoji || "🎁").slice(0, 4)}`);
    });

    ch.on("presence", { event: "sync" }, () => {
      if (!alive()) return;
      const keys = Object.keys(ch.presenceState());
      const viewers = keys.filter(k => k !== l.host_id).length;
      $("#liveViewerCount").textContent = `${viewers} ${viewers === 1 ? "espectador" : "espectadores"}`;
      if (isHost) {
        live.viewers = viewers;
        if (!live.viewersTimer) live.viewersTimer = setTimeout(async () => {
          live.viewersTimer = null;
          if (live.vcOk && alive()) { const { error } = await db.from("lives").update({ viewers_count: live.viewers }).eq("id", l.id); if (error) live.vcOk = false; }
        }, 4000);
      } else if (!keys.includes(l.host_id)) {
        // o criador sumiu (fechou o app/perdeu a conexão): espera um pouco e encerra a sala
        if (!live.hostGoneTimer) live.hostGoneTimer = setTimeout(() => { if (alive()) { toast("A transmissão foi encerrada."); leaveLiveRoom(); } }, 20000);
      } else if (live.hostGoneTimer) {
        clearTimeout(live.hostGoneTimer); live.hostGoneTimer = null;
      }
    });

    if (isHost) {
      try {
        const stream = pre || await getHostStream();
        if (!alive()) { stream.getTracks().forEach(t => t.stop()); return; }
        live.stream = stream;
        stream.getVideoTracks().forEach(t => { try { t.contentHint = "motion"; } catch (e) {} });
        // Câmera desligada/desconectada = os espectadores ficariam com a imagem congelada: encerra com aviso.
        stream.getTracks().forEach(t => {
          t.onended = () => {
            if (!alive() || live.stream !== stream) return;
            if (t.kind === "audio") return toast("O microfone foi desconectado. Sua live continua sem áudio.");
            toast("A câmera foi desconectada. Transmissão encerrada.");
            endActiveLive();
          };
        });
        vid.srcObject = stream; vid.muted = true;           // mudo no criador: evita eco
        vid.classList.remove("hidden"); vid.classList.add("mirror"); ph.classList.add("hidden");
        vid.onloadedmetadata = () => fitVideo(vid);
        vid.play().catch(() => {});
      } catch (e) {
        if (!alive()) return;
        const msg = mediaErrorMessage(e);
        await endActiveLive();
        toast(msg);
        return;
      }

      // batimento: some da lista "Em alta" se o criador cair sem encerrar
      const beat = async () => {
        if (!live.hbOk || !alive()) return;
        const { error } = await db.from("lives").update({ last_heartbeat: new Date().toISOString() }).eq("id", l.id);
        if (error) live.hbOk = false;
      };
      const refreshToken = async () => {
        try { const { data } = await db.auth.getSession(); live.token = data?.session?.access_token || live.token; } catch (e) {}
      };
      refreshToken();
      beat();
      live.heartbeatTimer = setInterval(() => { refreshToken(); beat(); }, 20000);

      ch.on("broadcast", { event: "join" }, async ({ payload }) => {
        if (!live.stream || !alive()) return;
        const v = payload?.viewer;
        if (!v || v === me) return;
        if (!live.pcs[v] && Object.keys(live.pcs).length >= LIVE_MAX_VIEWERS) { sendSig("full", { to: v }); return; }
        try { live.pcs[v]?.close(); } catch (e) {}
        const pc = newPC(v);
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            if (live.pcs[v] === pc) { delete live.pcs[v]; rebalanceBitrate(); }
            try { pc.close(); } catch (e) {}
          }
        };
        live.stream.getTracks().forEach(t => pc.addTrack(t, live.stream));
        try {
          await pc.setLocalDescription(await pc.createOffer());
          sendSig("offer", { from: me, to: v, sdp: pc.localDescription });
          rebalanceBitrate();
        } catch (e) { console.warn("Falha ao criar oferta:", e); }
      });
      ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
        const pc = live.pcs[payload?.from];
        if (payload?.to === me && pc) {
          try { await pc.setRemoteDescription(payload.sdp); await flushIce(pc); rebalanceBitrate(); } catch (e) { console.warn("Falha na resposta:", e); }
        }
      });
      ch.on("broadcast", { event: "ice" }, ({ payload }) => {
        const pc = live.pcs[payload?.from];
        if (payload?.to === me && pc) iceList(payload).forEach(c => addIce(pc, c));
      });
    } else {
      const requestJoin = () => { if (alive() && !live.connected) sendSig("join", { viewer: me }); };
      const startJoinRetry = () => {
        clearInterval(live.joinTimer);
        let tries = 0;
        requestJoin();
        live.joinTimer = setInterval(() => {
          if (!alive() || live.connected) { clearInterval(live.joinTimer); return; }
          tries++;
          if (tries === 4) phText.textContent = "Ainda conectando... se não carregar, o criador pode estar com a conexão instável.";
          if (tries >= 12) { phText.textContent = "Não foi possível conectar. Sua rede pode bloquear a transmissão."; clearInterval(live.joinTimer); return; }
          requestJoin();
        }, 4000);
      };
      const reconnect = () => {
        if (!alive()) return;
        live.connected = false;
        try { live.pcs[l.host_id]?.close(); } catch (e) {}
        delete live.pcs[l.host_id];
        phText.textContent = "Reconectando...";
        ph.classList.remove("hidden"); vid.classList.add("hidden");
        updateSoundBtn();
        startJoinRetry();
      };

      ch.on("broadcast", { event: "full" }, ({ payload }) => {
        if (payload?.to !== me || !alive()) return;
        clearInterval(live.joinTimer);
        toast("Esta live está lotada no momento. Tente novamente em instantes.");
        leaveLiveRoom();
      });
      ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload?.to !== me || !alive()) return;
        clearInterval(live.joinTimer);
        clearTimeout(live.negTimer);
        live.negTimer = setTimeout(() => { if (alive() && !live.connected) reconnect(); }, 15000);
        try { live.pcs[l.host_id]?.close(); } catch (e) {}
        const pc = newPC(l.host_id);
        let playStarted = false;
        pc.ontrack = (e) => {
          const stream = e.streams[0] || (pc._ms = pc._ms || new MediaStream());
          if (!e.streams[0]) pc._ms.addTrack(e.track);
          if (vid.srcObject !== stream) vid.srcObject = stream;
          vid.classList.remove("hidden"); vid.classList.remove("mirror"); ph.classList.add("hidden");
          vid.onloadedmetadata = () => fitVideo(vid);
          // Áudio e vídeo chegam em eventos separados. Antes cada um refazia mute/play e um cancelava o outro
          // (som que "some" ou botão de ativar som que aparecia sem motivo): agora só o 1º decide o mudo.
          if (playStarted) { vid.play().catch(() => {}); return; }
          playStarted = true;
          vid.muted = false;
          vid.play().then(updateSoundBtn).catch(() => { vid.muted = true; vid.play().catch(() => {}); updateSoundBtn(); });
        };
        pc.onconnectionstatechange = () => {
          if (live.pcs[l.host_id] !== pc || !alive()) return;
          const st = pc.connectionState;
          if (st === "connected") { live.connected = true; clearTimeout(live.negTimer); clearTimeout(live.discTimer); }
          else if (st === "failed") reconnect();
          else if (st === "disconnected") { clearTimeout(live.discTimer); live.discTimer = setTimeout(() => { if (alive() && pc.connectionState !== "connected") reconnect(); }, 6000); }
        };
        try {
          await pc.setRemoteDescription(payload.sdp); await flushIce(pc);
          await pc.setLocalDescription(await pc.createAnswer());
          sendSig("answer", { from: me, to: l.host_id, sdp: pc.localDescription });
        } catch (e) { console.warn("Falha ao responder oferta:", e); reconnect(); }
      });
      ch.on("broadcast", { event: "ice" }, ({ payload }) => {
        const pc = live.pcs[payload?.from];
        if (payload?.to === me && pc) iceList(payload).forEach(c => addIce(pc, c));
      });
      ch.on("broadcast", { event: "ended" }, () => { if (alive()) { toast("A transmissão foi encerrada."); leaveLiveRoom(); } });

      live.startJoinRetry = startJoinRetry;
    }

    ch.subscribe(async (status) => {
      if (!alive()) return;
      if (status === "SUBSCRIBED") {
        await ch.track({ u: me });
        if (!isHost && !live.connected) live.startJoinRetry?.();   // se o vídeo já está conectado, não reinicia
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        toast("Conexão instável. Tentando reconectar...");
      }
    });
  }

  // teclado virtual: mantém o campo de comentário visível
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const adjust = () => {
      const room = $("#pageLiveRoom");
      if (!room || !room.classList.contains("active")) return;
      room.style.setProperty("--kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    };
    vv.addEventListener("resize", adjust);
    vv.addEventListener("scroll", adjust);
  }

  /* ----- Deslizar para a próxima / anterior live ----- */
  let liveSwitching = false;

  async function switchLive(direction) {
    const current = state.activeLive;
    if (!current || liveSwitching || !state.user || state.user.id === current.host_id) return;
    liveSwitching = true;
    try {
      await fetchActiveLivesMap(true);
      const list = state.lives
        .filter(l => l.host_id !== state.user.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const index = list.findIndex(l => l.id === current.id);
      const target = list[index + direction];
      if (!target) {
        toast(direction > 0 ? "Você já está na última live." : "Você já está na primeira live.");
        return;
      }
      await openLiveRoom(target);
    } finally {
      liveSwitching = false;
    }
  }

  function showLiveSwipeHint(isHost) {
    const room = $("#pageLiveRoom");
    if (!room) return;
    let hint = $("#liveSwipeHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "liveSwipeHint";
      hint.className = "live-swipe-hint";
      hint.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Deslize para ver outras lives`;
      room.appendChild(hint);
    }
    hint.classList.remove("show");
    if (isHost) return;
    const others = state.lives.filter(l => l.host_id !== state.user?.id && l.id !== state.activeLive?.id);
    if (!others.length) return;
    void hint.offsetWidth; // reinicia a animação
    hint.classList.add("show");
    clearTimeout(showLiveSwipeHint.timer);
    showLiveSwipeHint.timer = setTimeout(() => hint.classList.remove("show"), 3500);
  }

  (function setupLiveSwipe() {
    const room = $("#pageLiveRoom");
    if (!room) return;
    const IGNORE = "#liveChat, #liveMessageForm, button, input, textarea, .modal";
    let startX = 0, startY = 0, tracking = false;

    room.addEventListener("touchstart", (e) => {
      tracking = !e.target.closest(IGNORE) && e.touches.length === 1;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    room.addEventListener("touchend", (e) => {
      if (!tracking) return;
      tracking = false;
      const dy = startY - e.changedTouches[0].clientY;
      const dx = Math.abs(startX - e.changedTouches[0].clientX);
      if (Math.abs(dy) > 90 && dx < 70) switchLive(dy > 0 ? 1 : -1);
    }, { passive: true });

    let wheelLock = false;
    room.addEventListener("wheel", (e) => {
      if (wheelLock || e.target.closest(IGNORE) || Math.abs(e.deltaY) < 40) return;
      wheelLock = true;
      setTimeout(() => { wheelLock = false; }, 900);
      switchLive(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener("keydown", (e) => {
      if (!room.classList.contains("active") || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
      if (e.key === "ArrowDown") switchLive(1);
      if (e.key === "ArrowUp") switchLive(-1);
    });
  })();

  // Criador fechou a aba/app sem encerrar: avisa o banco na hora (a live some da lista em vez de esperar o timeout).
  window.addEventListener("pagehide", () => {
    const l = state.activeLive;
    if (!l || !state.user || l.host_id !== state.user.id || !live.token) return;
    try {
      fetch(`${SUPABASE_URL}/rest/v1/lives?id=eq.${encodeURIComponent(l.id)}`, {
        method: "PATCH", keepalive: true,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${live.token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status: "ended" })
      }).catch(() => {});
    } catch (e) {}
  });

  async function leaveLiveRoom() {
    await teardownLive();
    state.activeLive = null;
    const room = $("#pageLiveRoom");
    room?.classList.remove("active");
    room?.style.removeProperty("--kb");
    navigateTo(state.currentPage === "pageLiveRoom" ? "pageHome" : state.currentPage);
  }

  async function endActiveLive() {
    const l = state.activeLive;
    if (l && state.user?.id === l.host_id) {
      try { await sendSig("ended", {}); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));   // dá tempo da mensagem chegar antes de fechar o canal
      try { await db.from("lives").update({ status: "ended" }).eq("id", l.id); } catch (e) {}
    }
    await leaveLiveRoom();
    toast("Transmissão encerrada.");
    loadTrending(); loadStories();
  }

  async function confirmEndLive() {
    return askConfirm({
      title: "Encerrar a live?",
      message: "A transmissão será encerrada para todos que estão assistindo.",
      confirmText: "Encerrar",
      danger: true
    });
  }
  on("#btnLeaveLive", "click", async () => {
    const l = state.activeLive;
    if (l && state.user?.id === l.host_id) { if (await confirmEndLive()) endActiveLive(); }
    else leaveLiveRoom();
  });
  on("#btnEndLive", "click", async () => { if (await confirmEndLive()) endActiveLive(); });

  on("#liveMessageForm", "submit", (e) => {
    e.preventDefault();
    if (state.visitor || !state.activeLive) return;
    const input = $("#liveMessageInput");
    const text = input.value.trim().slice(0, 200);
    if (!text) return;
    if (Date.now() - live.lastChatAt < 700) return toast("Calma! Envie mais devagar.");
    live.lastChatAt = Date.now();
    const name = state.profile?.display_name || state.profile?.username || "Você";
    const isHostMsg = state.user?.id === state.activeLive.host_id;
    addLiveMsg(name, text, isHostMsg);
    Promise.resolve(sendSig("chat", { name, text, uid: state.user.id }))
      .then(r => { if (r && r !== "ok") toast("Seu comentário pode não ter chegado. Verifique a conexão."); })
      .catch(() => toast("Seu comentário pode não ter chegado. Verifique a conexão."));
    input.value = "";
  });

  /* ================= V2: PAINEL ADMINISTRATIVO ================= */
  const ADMIN_TABS = {
    users: {
      q: () => db.from("profiles").select("*").order("created_at", { ascending: false }).limit(200),
      row: u => `${escapeHTML(u.display_name || u.username)}${getBadgesHTML(u)} <small>@${escapeHTML(u.username || "")}${u.is_admin ? " • ADMIN" : ""}${u.is_banned ? " • BANIDO" : ""} • 🪙 ${u.wallet_balance || 0}</small>`,
      acts: u => [["verified", u.is_verified ? "Tirar ✔" : "Dar ✔"], ["dev", u.is_developer ? "Tirar Dev" : "Dar Dev"], ["admin", u.is_admin ? "Tirar Admin" : "Dar Admin"], ["coins", "Moedas"], ["ban", u.is_banned ? "Desbanir" : "Banir"], ["edit", "Editar"], ["deluser", "Excluir"]]
    },
    posts: {
      q: () => db.from("posts").select("*, profiles(username)").order("created_at", { ascending: false }).limit(100),
      row: p => `${p.media_type === "video" ? `<video src="${escapeHTML(p.image_url)}#t=0.1" muted preload="metadata" style="width:42px;height:42px;object-fit:cover;border-radius:8px;vertical-align:middle"></video>` : `<img src="${escapeHTML(p.image_url)}" style="width:42px;height:42px;object-fit:cover;border-radius:8px;vertical-align:middle">`} @${escapeHTML(p.profiles?.username || "?")}: ${escapeHTML((p.caption || "").slice(0, 60))}`,
      acts: () => [["editpost", "Editar"], ["delpost", "Excluir"]]
    },
    comments: {
      q: () => db.from("comments").select("*, profiles(username)").order("created_at", { ascending: false }).limit(100),
      row: c => `@${escapeHTML(c.profiles?.username || "?")}: ${escapeHTML(c.content || "")}`,
      acts: () => [["delcomment", "Excluir"]]
    },
    lives: {
      q: () => db.from("lives").select("*, profiles(username)").order("created_at", { ascending: false }).limit(100),
      row: l => `${escapeHTML(l.title || "Live")} — @${escapeHTML(l.profiles?.username || "?")} <small>(${l.status})</small>`,
      acts: l => [...(l.status === "live" ? [["endlive", "Encerrar"]] : []), ["dellive", "Excluir"]]
    },
    store: {
      q: () => db.from("store_items").select("*").order("created_at", { ascending: false }).limit(100),
      row: i => `${i.media_type === "video" ? `<video src="${escapeHTML(i.media_url)}" muted loop autoplay playsinline style="width:64px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle"></video>` : `<img src="${escapeHTML(i.media_url || "")}" style="width:64px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle">`} ${escapeHTML(i.name)} <small>🪙 ${i.price} • ${i.is_active ? "visível" : "oculto"}</small>`,
      acts: i => [["toggleitem", i.is_active ? "Ocultar" : "Mostrar"], ["priceitem", "Preço"], ["delitem", "Excluir"]]
    },
    pix: {
      q: () => db.from("pix_requests").select("*, profiles(username)").order("created_at", { ascending: false }).limit(100),
      row: r => `@${escapeHTML(r.profiles?.username || "?")}: ${r.amount} moedas — R$ ${Number(r.price).toFixed(2)} <small>(${r.status})</small>`,
      acts: r => r.status === "pending" ? [["pixok", "Confirmar"], ["pixno", "Recusar"]] : [["delpix", "Apagar"]]
    }
  };
  let adminTab = "users", adminRows = [];

  async function loadAdmin(tab = adminTab) {
    if (!isAdmin()) return toast("Acesso restrito ao administrador.");
    adminTab = tab;
    $$("#adminTabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    const box = $("#adminContent");
    box.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
    const cfg = ADMIN_TABS[tab];
    const { data, error } = await cfg.q();
    if (error) { box.innerHTML = `<div class="empty-state"><p>${escapeHTML(formatError(error))}</p></div>`; return; }
    adminRows = data || [];
    box.innerHTML = adminRows.map(r => `<div class="result-card" style="flex-wrap:wrap;gap:8px" data-id="${r.id}">
      <div class="grow">${cfg.row(r)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${cfg.acts(r).map(([a, t]) => `<button class="btn secondary compact" data-act="${a}">${t}</button>`).join("")}</div></div>`).join("")
      || `<div class="empty-state"><p>Nada por aqui.</p></div>`;
    if (tab === "store") box.insertAdjacentHTML("afterbegin", `<button class="btn primary full" id="btnAddStoreItem" type="button"><i class="fa-solid fa-plus"></i> Adicionar banner animado</button>`);
  }
  on("#adminContent", "click", (e) => { if (e.target.closest("#btnAddStoreItem")) openStoreItemModal(); });

  on("#btnAdminPanel", "click", () => navigateTo("pageAdmin"));
  on("#btnBackAdmin", "click", () => navigateTo("pageProfile"));
  on("#adminTabs", "click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) loadAdmin(b.dataset.tab); });

  on("#adminContent", "click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || !isAdmin()) return;
    const id = btn.closest("[data-id]").dataset.id;
    const row = adminRows.find(r => String(r.id) === id);
    const act = btn.dataset.act;
    const tableOf = { delpost: "posts", delcomment: "comments", dellive: "lives", delpix: "pix_requests", delitem: "store_items" };
    let res = { error: null };

    if (act === "verified") res = await db.from("profiles").update({ is_verified: !row.is_verified }).eq("id", id);
    else if (act === "dev") res = await db.from("profiles").update({ is_developer: !row.is_developer }).eq("id", id);
    else if (act === "admin") {
      if (id === state.user.id) return toast("Você não pode remover seu próprio admin.");
      res = await db.from("profiles").update({ is_admin: !row.is_admin }).eq("id", id);
    }
    else if (act === "ban") {
      if (id === state.user.id) return toast("Você não pode banir a si mesmo.");
      res = await db.from("profiles").update({ is_banned: !row.is_banned }).eq("id", id);
    }
    else if (act === "coins") {
      const v = await askText({ title: "Saldo de moedas", label: "Novo saldo", value: String(row.wallet_balance || 0), maxLength: 9, confirmText: "Salvar" });
      if (v === null || isNaN(parseInt(v, 10))) return;
      res = await db.from("profiles").update({ wallet_balance: parseInt(v, 10) }).eq("id", id);
    }
    else if (act === "edit") {
      const n = await askText({ title: "Editar perfil", label: "Nome de exibição", value: row.display_name || "", maxLength: 30, confirmText: "Próximo" });
      if (n === null) return;
      const b = await askText({ title: "Editar perfil", label: "Bio", value: row.bio || "", maxLength: 160, allowEmpty: true, confirmText: "Salvar" });
      if (b === null) return;
      res = await db.from("profiles").update({ display_name: n.trim(), bio: b.trim() }).eq("id", id);
    }
    else if (act === "deluser") {
      if (id === state.user.id) return toast("Você não pode excluir a si mesmo.");
      const ok = await askConfirm({ title: "Excluir usuário?", message: "O usuário e TODO o conteúdo dele serão removidos. Não dá para desfazer.", confirmText: "Excluir", danger: true });
      if (!ok) return;
      res = await db.rpc("admin_delete_user", { p_id: id });
    }
    else if (act === "editpost") {
      const c = await askText({ title: "Editar publicação", label: "Legenda", value: row.caption || "", maxLength: 500, allowEmpty: true, confirmText: "Salvar" });
      if (c === null) return;
      res = await db.from("posts").update({ caption: c }).eq("id", id);
    }
    else if (act === "toggleitem") res = await db.from("store_items").update({ is_active: !row.is_active }).eq("id", id);
    else if (act === "priceitem") {
      const v = await askText({ title: "Preço do item", label: "Preço em moedas", value: String(row.price || 0), maxLength: 7, confirmText: "Salvar" });
      if (v === null || isNaN(parseInt(v, 10)) || parseInt(v, 10) < 0) return;
      res = await db.from("store_items").update({ price: parseInt(v, 10) }).eq("id", id);
    }
    else if (tableOf[act]) {
      const ok = await askConfirm({ title: "Excluir definitivamente?", message: "Essa ação não pode ser desfeita.", confirmText: "Excluir", danger: true });
      if (!ok) return;
      res = await db.from(tableOf[act]).delete().eq("id", id);
    }
    else if (act === "endlive") res = await db.from("lives").update({ status: "ended" }).eq("id", id);
    else if (act === "pixok" || act === "pixno") res = await db.rpc("resolve_pix", { p_id: id, p_ok: act === "pixok" });

    toast(res.error ? formatError(res.error) : "Feito!");
    loadAdmin();
  });

  initApp();
});
