document.addEventListener('DOMContentLoaded', () => {
  // ================= CONFIGURAÇÃO =================
  const HOST_ID = 'liveemalta-v1-main';     // id fixo: garante "uma live por vez"
  const MAX_VIEWERS = 50;                   // limite configurado para até 50 espectadores (validar capacidade do plano LiveKit)
  const TOTAL_UPLOAD_BPS = 4e6;             // banda total que o host usa, dividida entre viewers
  const RTC_CONFIG = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN público gratuito (instável). Para produção, troque pelo seu próprio TURN.
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject', credential: 'openrelayproject' }
  ] };
  // =================================================

  const $ = (id) => document.getElementById(id);
  const screens = { splash: $('splash-screen'), login: $('login-screen'), main: $('main-app'), live: $('live-screen') };
  const video = $('liveVideo');
  let user = null, phase = 'idle'; // idle | joining | watching | hosting | admin
  let peer = null, probeTimer = null, lastInfo = null;
  // host
  let hostPeer = null, stream = null, viewers = new Map(), adminPeers = new Map(), bannedViewers = new Set(), bannedViewerIds = new Set(), livePass = '', liveLocked = false, thumb = null, thumbTimer = null, wakeLock = null;
  const chatHistory = [];
  const MAX_CHAT_MESSAGES = 80;
  let activePoll = null; let pollVotes = new Map(); let viewerHasVoted = false; const reactionCooldowns = new Map(); let lastViewerReactionAt = 0;
  // viewer
  let conn = null, call = null, joinPass = '', adminToken = '', adminMode = false, adminSpectators = [], adminMediaState = { audio: true, video: true }, retryTimer = null, fails = 0, joinTimeout = null;
  let livekitRoom = null, livekitHostSecret = '', livekitServerUrl = '';
  let livekitLocalTracks = [];
  async function apiPost(path, payload) {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Falha na API (${response.status})`);
    return data;
  }
  async function connectLiveKitHost() {
    if (!window.LivekitClient) throw new Error('SDK do LiveKit não carregou. Verifique sua conexão.');
    const data = await apiPost('/api/live/create', {
      password: livePass,
      identity: `host-${stableViewerId.slice(0, 24)}`
    });
    livekitHostSecret = data.host_secret;
    livekitServerUrl = data.server_url;
    livekitRoom = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    await livekitRoom.connect(data.server_url, data.token);
    for (const track of stream.getTracks()) {
      await livekitRoom.localParticipant.publishTrack(track, {
        name: track.kind,
        source: track.kind === 'video' ? LivekitClient.Track.Source.Camera : LivekitClient.Track.Source.Microphone
      });
      livekitLocalTracks.push(track);
    }
  }
  // Identidade exclusiva desta aba: o LiveKit desconecta o participante anterior
  // quando duas conexões entram na mesma sala com a mesma identity.
  const livekitSessionId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function connectLiveKitViewer() {
    if (!window.LivekitClient) throw new Error('SDK do LiveKit não carregou. Atualize a página.');
    const data = await apiPost('/api/live/join', {
      password: joinPass,
      admin_token: adminToken,
      identity: `${adminMode ? 'admin' : 'viewer'}-${livekitSessionId.slice(0, 32)}`
    });
    livekitServerUrl = data.server_url;
    if (livekitRoom) { try { await livekitRoom.disconnect(); } catch (_) {} }
    livekitRoom = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
    livekitRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Video || track.kind === LivekitClient.Track.Kind.Audio) {
        track.attach(video);
        if (track.kind === LivekitClient.Track.Kind.Video) video.play().catch(() => {});
        else {
          const el = track.attach();
          el.autoplay = true;
          el.style.display = 'none';
          document.body.appendChild(el);
        }
      }
    });
    livekitRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => track.detach());
    livekitRoom.on(LivekitClient.RoomEvent.Disconnected, () => {
      if (phase === 'watching' || phase === 'admin') showNet('Conexão com a transmissão perdida.');
    });
    await livekitRoom.connect(data.server_url, data.token);
  }
  async function disconnectLiveKit() {
    if (livekitRoom) {
      try { await livekitRoom.disconnect(); } catch (_) {}
      livekitRoom = null;
    }
    livekitLocalTracks = [];
    if (phase !== 'hosting') video.srcObject = null;
  }


  // ---------- utilidades ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
  function show(name, delay = 0) {
    Object.entries(screens).forEach(([k, el]) => { if (k !== name) el.classList.remove('active'); });
    setTimeout(() => screens[name].classList.add('active'), delay);
  }
  function setErr(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
  function getStableViewerId() {
    const key = 'partylives_viewer_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }
  const stableViewerId = getStableViewerId();

  function newPeer(id) {
    if (!window.Peer) { toast('Não foi possível carregar o serviço de transmissão. Verifique a internet.'); return null; }
    return new Peer(id, { config: RTC_CONFIG, debug: 0 });
  }
  function keepAlive(p, isAlive) { // reconecta ao servidor de sinalização sem derrubar chamadas ativas
    p.on('disconnected', () => {
      const t = setInterval(() => {
        if (p.destroyed || !isAlive()) return clearInterval(t);
        if (!p.disconnected) return clearInterval(t);
        try { p.reconnect(); } catch (_) {}
      }, 2000);
    });
  }
  function watchIce(pc, onFail) {
    if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'disconnected') setTimeout(() => { if (pc.iceConnectionState === 'disconnected') try { pc.restartIce(); } catch (_) {} }, 2500);
      if (pc.iceConnectionState === 'failed') { try { pc.restartIce(); } catch (_) {} onFail && onFail(); }
    });
  }
  document.querySelectorAll('[data-logo]').forEach((img) => img.addEventListener('error', () => {
    const f = document.createElement('div'); f.className = img.className + ' logo-fallback';
    f.innerHTML = '<i class="fa-solid fa-fire"></i>'; img.replaceWith(f);
  }));

  // ---------- splash + login ----------
  usernameInitial();
  function usernameInitial() { const s = localStorage.getItem('livesEmAltaUser'); if (s) $('username').value = s; }
  setTimeout(() => { screens.splash.classList.remove('active'); show('login', 100); }, 2800);

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('username').value.trim();
    if (!name) return toast('Digite um nome de usuário.');
    if (!$('terms').checked) {
      $('terms-error').hidden = false;
      $('terms').focus();
      return;
    }
    $('terms-error').hidden = true;
    user = name; localStorage.setItem('livesEmAltaUser', name);
    $('userNameDisplay').textContent = name;
    show('main', 400); renderLive(null); startProbing();
  });
  $('terms').addEventListener('change', () => {
    if ($('terms').checked) $('terms-error').hidden = true;
  });

  // ---------- home: descobrir se há live ----------
  function renderLive(info) {
    lastInfo = info;
    $('emptyState').hidden = !!info; $('liveCard').hidden = !info;
    if (!info) return;
    $('liveHostName').textContent = info.host;
    $('liveViewersCard').textContent = info.count || 0;
    $('liveThumb').style.backgroundImage = info.thumb ? `url(${info.thumb})` : 'linear-gradient(135deg,#ff9d00,#ff5100,#7a00ff)';
    const locked = !!info.locked;
    $('liveCard').classList.toggle('is-locked', locked);
    $('liveCard').querySelector('.locked-icon').hidden = !locked;
    $('liveCard').querySelector('.lock-msg').hidden = !locked;
  }
  function startProbing() {
    stopProbing();
    peer = newPeer(); if (!peer) return;
    peer.on('open', () => { probe(); probeTimer = setInterval(probe, 5000); });
    peer.on('error', onViewerPeerError);
    peer.on('call', onIncomingCall);
    keepAlive(peer, () => phase !== 'hosting');
  }
  function stopProbing() {
    clearInterval(probeTimer);
    if (peer) { try { peer.destroy(); } catch (_) {} peer = null; }
  }
  function probe() {
    if (phase !== 'idle' || !peer || peer.disconnected || peer.destroyed) return;
    const c = peer.connect(HOST_ID, { reliable: true, serialization: 'json' });
    const t = setTimeout(() => c.close(), 5000);
    c.on('open', () => c.send({ t: 'info' }));
    c.on('data', (d) => { if (d.t === 'info') { clearTimeout(t); if (phase === 'idle') renderLive(d); c.close(); } });
  }
  function onViewerPeerError(e) {
    if (e.type === 'peer-unavailable') {
      if (phase === 'idle') renderLive(null);
      else if (phase === 'joining' || phase === 'watching') onJoinFail('Live indisponível.');
    } else if (phase === 'joining') onJoinFail('Falha de conexão. Tente novamente.');
  }

  // ---------- host: iniciar live ----------
  $('liveBtn').addEventListener('click', () => {
    if (lastInfo) return toast('Já existe uma live em andamento. Aguarde ela terminar.');
    $('livePasswordInput').value = ''; setErr($('startError'), ''); $('startLiveModal').classList.add('open');
  });
  $('cancelStartLive').addEventListener('click', () => $('startLiveModal').classList.remove('open'));
  $('confirmStartLive').addEventListener('click', startLive);

  async function startLive() {
    const pass = $('livePasswordInput').value.trim();
    if (!pass) return setErr($('startError'), 'Defina uma senha para a live.');
    if (!navigator.mediaDevices?.getUserMedia) return setErr($('startError'), 'Câmera indisponível. Abra o site via HTTPS.');
    const btn = $('confirmStartLive'); btn.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (_) { btn.disabled = false; return setErr($('startError'), 'Permita o acesso à câmera e ao microfone.'); }

    stopProbing(); phase = 'hosting'; livePass = pass; liveLocked = false;
    try {
      await connectLiveKitHost();
      // PeerJS remains temporarily for chat, polls, reactions and host controls only.
      hostPeer = newPeer(HOST_ID);
      if (!hostPeer) throw new Error('Não foi possível iniciar a comunicação de controle.');
      hostPeer.on('connection', onViewerConn);
      keepAlive(hostPeer, () => phase === 'hosting');
      hostPeer.on('error', (e) => {
        if (phase !== 'hosting') return;
        if (e.type === 'unavailable-id') toast('Já existe uma live com o canal de controle ativo.');
        else if (e.type !== 'peer-unavailable') toast('Instabilidade na comunicação de controle.');
      });
      await new Promise((ok, no) => { hostPeer.once('open', ok); hostPeer.once('error', no); });
    } catch (error) {
      await disconnectLiveKit();
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      phase = 'idle'; btn.disabled = false;
      if (!peer) startProbing();
      return setErr($('startError'), error.message || 'Não foi possível iniciar a transmissão.');
    }

    btn.disabled = false; $('startLiveModal').classList.remove('open');
    stream.getVideoTracks()[0].onended = () => { toast('A câmera foi desconectada.'); endLive(); };
    video.srcObject = stream; video.muted = true; video.play().catch(() => {});
    $('videoPlaceholder').hidden = true; $('btnUnmute').hidden = true;
    $('live-screen').classList.remove('chat-collapsed'); $('chatToggle').innerHTML = '<i class="fa-solid fa-chevron-down"></i>'; $('liveRoleTag').textContent = ''; $('liveRoleTag').hidden = false; $('liveRoleTag').classList.add('host');
    $('btnEndLiveInside').hidden = true; $('liveTools').hidden = false; $('viewerControls').hidden = true; $('viewerPip').hidden = true; $('footerMsg').textContent = '';
    setMediaButtonState('toggleMicrophone', true); setMediaButtonState('toggleCamera', true);
    updateLiveLockButton();
    $('closeLiveView').innerHTML = '<i class="fa-solid fa-stop"></i> Encerrar'; $('closeLiveView').classList.add('host-end-button');
    $('viewerCount').textContent = 0;
    clearChat(); activePoll = null; pollVotes.clear(); $('livePollCard').hidden = true;
    show('live', 200);
    thumbTimer = setInterval(captureThumb, 8000); setTimeout(captureThumb, 1200);
    requestWake();
  }

  function onViewerConn(c) {
    c.on('data', async (d) => {
      if (d.t === 'info') return c.send({ t: 'info', host: user, thumb, count: viewers.size, locked: liveLocked });
      if (d.t === 'chat') {
        const isAdmin = adminPeers.has(c.peer);
        const message = normalizeChatMessage(d.text, isAdmin ? 'kakau' : (viewers.get(c.peer)?.name || 'Espectador'));
        if (message && (isAdmin || viewers.has(c.peer))) broadcastChat(message);
        return;
      }
      if (d.t === 'reaction') { if (viewers.has(c.peer)) { const now = Date.now(); const last = reactionCooldowns.get(c.peer) || 0; if (now - last >= 1000) { reactionCooldowns.set(c.peer, now); broadcastReaction(d.emoji); } } return; }
      if (d.t === 'poll-vote') { if (viewers.has(c.peer)) registerPollVote(c.peer, d.option); return; }
      if (typeof d.t === 'string' && d.t.startsWith('admin-') && adminPeers.has(c.peer)) {
        if (d.t === 'admin-ban') { banViewerById(String(d.viewerPeer || '')); return; }
        if (d.t === 'admin-roulette-create') {
          const items = Array.isArray(d.items) ? d.items.slice(0, 30).filter(x => x && String(x.name || '').trim()) : [];
          if (items.length < 2) return c.send({ t: 'admin-error', message: 'A roleta precisa de pelo menos duas opções.' });
          rouletteItems = items; $('spinRoulette').hidden = false;
          broadcastToViewers({ t: 'roulette-ready', items: rouletteItems }); toast('Roleta criada pelo administrador.');
          return;
        }
        if (d.t === 'admin-roulette-spin') { spinRouletteHost(); return; }
        if (d.t === 'admin-poll-create') {
          const question = String(d.question || '').trim().slice(0, 100);
          const options = Array.isArray(d.options) ? d.options.map(x => String(x).trim().slice(0, 50)).filter(Boolean).slice(0, 4) : [];
          if (!question || options.length < 2) return c.send({ t: 'admin-error', message: 'Informe uma pergunta e pelo menos duas opções.' });
          activePoll = { id: `${Date.now()}`, question, options, closed: false }; pollVotes.clear();
          renderPoll(activePoll, getPollCounts(), false);
          broadcastToViewers({ t: 'poll-state', poll: activePoll, counts: getPollCounts(), voted: false });
          toast('Enquete publicada pelo administrador.'); return;
        }
        if (d.t === 'admin-media-toggle') {
          const kind = d.kind === 'audio' ? 'audio' : 'video';
          const tracks = kind === 'audio' ? stream?.getAudioTracks() : stream?.getVideoTracks();
          if (!tracks?.length) return c.send({ t: 'admin-error', message: kind === 'audio' ? 'Microfone indisponível.' : 'Câmera indisponível.' });
          const enabled = !!d.enabled;
          tracks.forEach(track => { track.enabled = enabled; });
          if (kind === 'video') {
            setMediaButtonState('toggleCamera', enabled);
            $('videoPlaceholder').hidden = enabled;
            $('placeholderMsg').textContent = 'Câmera desligada';
            broadcastToViewers({ t: 'camera-state', enabled });
          } else setMediaButtonState('toggleMicrophone', enabled);
          adminPeers.forEach(admin => { try { admin.conn.send({ t: 'admin-media-state', audio: !!stream?.getAudioTracks().some(t => t.enabled), video: !!stream?.getVideoTracks().some(t => t.enabled) }); } catch (_) {} });
          return;
        }
        return;
      }
      if (d.t !== 'join') return;
      const viewerId = String(d.viewerId || '').slice(0, 120);
      if (bannedViewers.has(c.peer) || (viewerId && bannedViewerIds.has(viewerId))) {
        try { c.send({ t: 'banned' }); } catch (_) {}
        setTimeout(() => { try { c.close(); } catch (_) {} }, 100);
        return;
      }
      // A senha mestre e as sessões administrativas são validadas exclusivamente no Flask.
      if (d.admin_token) {
        try {
          await apiPost('/api/live/admin-verify', { admin_token: String(d.admin_token) });
          adminPeers.set(c.peer, { conn: c, name: String(d.name || 'Administrador').slice(0, 30) });
          c.send({ t: 'admin-granted', admin_token: d.admin_token });
          sendAdminState(c);
          if (chatHistory.length) c.send({ t: 'chat-history', messages: chatHistory });
          if (rouletteItems.length) c.send({ t: 'roulette-ready', items: rouletteItems });
          if (activePoll) c.send({ t: 'poll-state', poll: activePoll, counts: getPollCounts(), voted: false });
          return;
        } catch (_) {}
      }
      if (liveLocked) {
        // Primeiro tenta autenticar como administrador. Se falhar, devolve o
        // motivo real do Flask para facilitar o diagnóstico, sem revelar segredos.
        try {
          const auth = await apiPost('/api/live/admin-auth', { password: String(d.pw || '') });
          adminPeers.set(c.peer, { conn: c, name: String(d.name || 'Administrador').slice(0, 30) });
          c.send({ t: 'admin-granted', admin_token: auth.admin_token });
          sendAdminState(c);
          if (chatHistory.length) c.send({ t: 'chat-history', messages: chatHistory });
          if (rouletteItems.length) c.send({ t: 'roulette-ready', items: rouletteItems });
          if (activePoll) c.send({ t: 'poll-state', poll: activePoll, counts: getPollCounts(), voted: false });
          return;
        } catch (error) {
          // A senha mestre pode falhar normalmente quando a pessoa está usando
          // a senha comum da transmissão. Nesse caso, continua o fluxo de viewer.
          // Só rejeita quando a senha não corresponde à senha normal da live.
          if (d.pw !== livePass) {
            return c.send({ t: 'denied', r: 'Senha incorreta. Verifique a senha da transmissão ou a senha administrativa.' });
          }
          // Senha normal correta: não promove a admin; deixa seguir como espectador.
        }
      }
      if (!viewers.has(c.peer) && viewers.size >= MAX_VIEWERS) return c.send({ t: 'denied', r: 'Live lotada.' });
      const old = viewers.get(c.peer); if (old) { try { old.call?.close(); } catch (_) {} }
      viewers.set(c.peer, { conn: c, call: null, viewerId, name: String(d.name || 'Espectador').slice(0, 30) });
      renderSpectators();
      c.send({ t: 'granted' });
      if (chatHistory.length) c.send({ t: 'chat-history', messages: chatHistory });
      c.send({ t: 'camera-state', enabled: !!stream?.getVideoTracks().some(track => track.enabled) });
      if (rouletteItems.length) c.send({ t: 'roulette-ready', items: rouletteItems });
      if (activePoll) c.send({ t: 'poll-state', poll: activePoll, counts: getPollCounts(), voted: false });
      pushCount(); setTimeout(applyBitrate, 1500);
    });
    c.on('close', () => { adminPeers.delete(c.peer); dropViewer(c.peer, c); });
  }
  function sendAdminState(admin) {
    const payload = { t: 'admin-state', spectators: [...viewers.entries()].map(([peerId, v]) => ({ peerId, name: v.name || 'Espectador' })), audio: !!stream?.getAudioTracks().some(t => t.enabled), video: !!stream?.getVideoTracks().some(t => t.enabled) };
    try { admin.send(payload); } catch (_) {}
  }
  function syncAdminState() { adminPeers.forEach(a => sendAdminState(a.conn)); }
  function banViewerById(id) {
    const v = viewers.get(id); if (!v) return;
    bannedViewers.add(id); if (v.viewerId) bannedViewerIds.add(v.viewerId);
    try { v.conn.send({ t: 'banned' }); } catch (_) {}
    try { v.conn.close(); } catch (_) {}
    viewers.delete(id); reactionCooldowns.delete(id); pushCount(); renderSpectators();
    toast('Espectador banido desta live.');
  }
  function normalizeChatMessage(raw, sender) {
    const text = String(raw || '').trim().slice(0, 300);
    if (!text) return null;
    return { t: 'chat', id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, sender: String(sender || 'Espectador').slice(0, 30), text, at: Date.now() };
  }
  function renderChatMessage(message) {
    const list = $('chatMessages'); if (!list) return;
    const row = document.createElement('div'); row.className = 'chat-message';
    const name = document.createElement('strong'); name.textContent = message.sender || 'Espectador';
    const body = document.createElement('span'); body.textContent = message.text || '';
    row.append(name, body); list.appendChild(row);
    while (list.children.length > MAX_CHAT_MESSAGES) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }
  function clearChat() { if ($('chatMessages')) $('chatMessages').replaceChildren(); chatHistory.length = 0; }
  function receiveChatMessage(message) {
    if (!message || !message.text) return;
    if (message.id && chatHistory.some(item => item.id === message.id)) return;
    chatHistory.push(message); if (chatHistory.length > MAX_CHAT_MESSAGES) chatHistory.shift();
    renderChatMessage(message);
  }
  function broadcastChat(message) {
    receiveChatMessage(message);
    viewers.forEach(v => { try { v.conn.send(message); } catch (_) {} });
    adminPeers.forEach(a => { try { a.conn.send(message); } catch (_) {} });
  }
  function sendChatMessage(raw) {
    const message = normalizeChatMessage(raw, phase === 'hosting' ? (user || 'Anfitriã') : (user || localStorage.getItem('livesEmAltaUser') || 'Espectador'));
    if (!message) return;
    if (phase === 'hosting') broadcastChat(message);
    else if ((phase === 'watching' || phase === 'admin') && conn?.open) conn.send({ t: 'chat', text: message.text });
    else return toast('Entre em uma live para enviar mensagens.');
    $('chatInput').value = '';
  }
  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault(); sendChatMessage($('chatInput').value);
  });

  function dropViewer(id, c) {
    const v = viewers.get(id);
    if (!v || (c && v.conn !== c)) return;
    try { v.call.close(); } catch (_) {}
    viewers.delete(id); reactionCooldowns.delete(id); pushCount(); applyBitrate(); renderSpectators(); syncAdminState();
  }
  function pushCount() {
    $('viewerCount').textContent = viewers.size;
    viewers.forEach((v) => { try { v.conn.send({ t: 'count', n: viewers.size }); } catch (_) {} });
    syncAdminState();
  }
  function applyBitrate() { // PeerJS não transporta mais mídia; LiveKit gerencia a adaptação de banda.
    // Mantido como função vazia para compatibilidade com os pontos antigos que a chamam.
  }
  function captureThumb() {
    if (!video.videoWidth) return;
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 135;
    cv.getContext('2d').drawImage(video, 0, 0, 240, 135);
    thumb = cv.toDataURL('image/jpeg', 0.5);
  }
  async function requestWake() {
    try { if ('wakeLock' in navigator && phase === 'hosting') wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && phase === 'hosting') requestWake(); });
  window.addEventListener('beforeunload', (e) => { if (phase === 'hosting') { e.preventDefault(); e.returnValue = ''; } });

  // ---------- trancar/destrancar acesso à live ----------
  function closeLockConfirmModal() { $('lockConfirmModal').classList.remove('open'); }
  async function applyLiveLockToggle() {
    const nextLocked = !liveLocked;
    try {
      await apiPost('/api/live/lock', { host_secret: livekitHostSecret, locked: nextLocked });
    } catch (error) {
      toast(error.message || 'Não foi possível alterar o bloqueio no servidor.');
      return;
    }
    liveLocked = nextLocked;
    if (liveLocked) {
      // Avisa os espectadores antes de encerrar os fluxos de vídeo.
      viewers.forEach((v) => {
        try { v.conn.send({ t: 'locked' }); } catch (_) {}
        try { v.call.close(); } catch (_) {}
      });
      viewers.clear();
      pushCount(); renderSpectators();
      toast('Live trancada. Os espectadores precisarão da senha.');
    } else {
      toast('Live destrancada. Todos podem assistir novamente.');
    }
    updateLiveLockButton();
  }
  $('toggleLiveLock').addEventListener('click', () => {
    if (phase !== 'hosting') return;
    if (!liveLocked) {
      $('lockConfirmModal').classList.add('open');
      return;
    }
    applyLiveLockToggle();
  });
  $('cancelLockLive').addEventListener('click', closeLockConfirmModal);
  $('confirmLockLive').addEventListener('click', () => {
    closeLockConfirmModal();
    if (phase === 'hosting' && !liveLocked) applyLiveLockToggle();
  });
  $('lockConfirmModal').addEventListener('click', (event) => {
    if (event.target === $('lockConfirmModal')) closeLockConfirmModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('lockConfirmModal').classList.contains('open')) closeLockConfirmModal();
  });
  function updateLiveLockButton() {
    const button = $('toggleLiveLock');
    if (!button) return;
    button.classList.toggle('is-locked', liveLocked);
    button.innerHTML = liveLocked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>';
    button.title = liveLocked ? 'Destrancar live' : 'Trancar live';
    button.setAttribute('aria-label', button.title);
  }

  async function endLive() {
    if (phase !== 'hosting') return;
    viewers.forEach((v) => { try { v.conn.send({ t: 'ended' }); } catch (_) {} });
    adminPeers.forEach((a) => { try { a.conn.send({ t: 'ended' }); } catch (_) {} });
    try {
      if (livekitHostSecret) await apiPost('/api/live/end', { host_secret: livekitHostSecret });
    } catch (error) { toast(error.message || 'Aviso: não foi possível registrar o encerramento no servidor.'); }
    livekitHostSecret = '';
    await disconnectLiveKit();
    const p = hostPeer; hostPeer = null;
    setTimeout(() => { try { p?.destroy(); } catch (_) {} }, 400);
    cleanupHost(); exitLiveView();
  }
  function openEndLiveModal() {
    if (phase !== 'hosting') return;
    $('endLiveModal').classList.add('open');
    $('confirmEndLive').focus();
  }
  function closeEndLiveModal() { $('endLiveModal').classList.remove('open'); }
  $('cancelEndLive').addEventListener('click', closeEndLiveModal);
  $('confirmEndLive').addEventListener('click', () => {
    closeEndLiveModal();
    endLive();
  });
  $('endLiveModal').addEventListener('click', (event) => {
    if (event.target === $('endLiveModal')) closeEndLiveModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('endLiveModal').classList.contains('open')) closeEndLiveModal();
  });

  function cleanupHost() {
    phase = 'idle'; liveLocked = false; clearInterval(thumbTimer); thumb = null; viewers.clear(); bannedViewers.clear(); bannedViewerIds.clear(); chatHistory.length = 0; clearChat();
    $('liveTools').hidden = true; $('viewerControls').hidden = true; $('spinRoulette').hidden = true; $('rouletteStage').hidden = true; $('livePollCard').hidden = true; activePoll = null; pollVotes.clear();
    setMediaButtonState('toggleMicrophone', true); setMediaButtonState('toggleCamera', true);
    if (document.fullscreenElement === $('live-screen')) document.exitFullscreen?.().catch(() => {});
    if (stream) stream.getTracks().forEach((t) => { t.onended = null; t.stop(); }); stream = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (hostPeer) { try { hostPeer.destroy(); } catch (_) {} hostPeer = null; }
    if (livekitRoom) { try { livekitRoom.disconnect(); } catch (_) {} livekitRoom = null; }
    livekitHostSecret = ''; livekitLocalTracks = []; adminPeers.clear();
    video.srcObject = null; $('liveRoleTag').classList.remove('host'); $('btnEndLiveInside').hidden = true;
    $('closeLiveView').innerHTML = '<i class="fa-solid fa-xmark"></i>'; $('closeLiveView').classList.remove('host-end-button');
    updateLiveLockButton();
  }
  $('btnEndLiveInside').addEventListener('click', openEndLiveModal);

  // ---------- controles de mídia e tela cheia ----------
  function setMediaButtonState(id, enabled) {
    const button = $(id);
    if (!button) return;
    button.classList.toggle('is-off', !enabled);
    if (id === 'toggleMicrophone') {
      button.innerHTML = enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
      button.title = enabled ? 'Silenciar microfone' : 'Ativar microfone';
      button.setAttribute('aria-label', button.title);
    } else {
      button.innerHTML = enabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
      button.title = enabled ? 'Desligar câmera' : 'Ligar câmera';
      button.setAttribute('aria-label', button.title);
    }
  }
  $('toggleMicrophone').addEventListener('click', () => {
    if (phase === 'admin' && conn?.open) { conn.send({ t: 'admin-media-toggle', kind: 'audio', enabled: !adminMediaState.audio }); return; }
    if (phase !== 'hosting' || !stream) return;
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return toast('Nenhum microfone disponível.');
    const enabled = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = enabled; });
    setMediaButtonState('toggleMicrophone', enabled); syncAdminState();
  });
  $('toggleCamera').addEventListener('click', () => {
    if (phase === 'admin' && conn?.open) { conn.send({ t: 'admin-media-toggle', kind: 'video', enabled: !adminMediaState.video }); return; }
    if (phase !== 'hosting' || !stream) return;
    const tracks = stream.getVideoTracks();
    if (!tracks.length) return toast('Nenhuma câmera disponível.');
    const enabled = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = enabled; });
    setMediaButtonState('toggleCamera', enabled);
    $('videoPlaceholder').hidden = enabled;
    $('placeholderMsg').textContent = 'Câmera desligada';
    broadcastToViewers({ t: 'camera-state', enabled }); syncAdminState();
  });

  const fullscreenButton = $('toggleFullscreen');
  async function toggleLiveFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('live-screen').requestFullscreen) await $('live-screen').requestFullscreen();
      else toast('Tela cheia não é compatível com este navegador.');
    } catch (_) { toast('Não foi possível alterar o modo de tela cheia.'); }
  }
  fullscreenButton.addEventListener('click', toggleLiveFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === $('live-screen');
    fullscreenButton.innerHTML = active ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
    fullscreenButton.title = active ? 'Restaurar controles' : 'Tela cheia';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    $('live-screen').classList.toggle('is-fullscreen', active);

    // Em qualquer dispositivo, esconder roleta e enquete durante a tela cheia.
    $('live-screen').classList.toggle('is-clean-fullscreen', active);
  });

  function broadcastToViewers(payload) { viewers.forEach(v => { try { v.conn.send(payload); } catch (_) {} }); adminPeers.forEach(a => { try { a.conn.send(payload); } catch (_) {} }); }
  function setRemoteCameraState(enabled) {
    $('videoPlaceholder').hidden = !!enabled;
    $('placeholderMsg').textContent = enabled ? 'Conectando à câmera...' : 'A criadora desligou a câmera';
  }
  const allowedReactions = ['❤️','😂','🔥','🫦','😍'];
  function showFloatingReaction(emoji) {
    if (!allowedReactions.includes(emoji) || !$('reactionFloats')) return;
    const node = document.createElement('span'); node.className = 'floating-reaction'; node.textContent = emoji;
    node.style.left = `${38 + Math.random() * 24}%`;
    node.style.setProperty('--drift', `${Math.round(Math.random() * 44 - 22)}px`);
    $('reactionFloats').appendChild(node);
    setTimeout(() => node.remove(), 1650);
  }
  function broadcastReaction(emoji) {
    if (!allowedReactions.includes(emoji)) return;
    showFloatingReaction(emoji);
    broadcastToViewers({ t: 'reaction', emoji });
  }
  document.querySelectorAll('[data-reaction]').forEach(button => button.addEventListener('click', () => {
    if (phase !== 'watching' || !conn?.open) return;
    const now = Date.now();
    if (now - lastViewerReactionAt < 1000) return;
    lastViewerReactionAt = now;
    conn.send({ t: 'reaction', emoji: button.dataset.reaction });
  }));
  $('chatToggle').addEventListener('click', () => {
    const collapsed = $('live-screen').classList.toggle('chat-collapsed');
    $('chatToggle').innerHTML = collapsed ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
    $('chatToggle').title = collapsed ? 'Expandir chat' : 'Recolher chat';
    $('chatToggle').setAttribute('aria-label', $('chatToggle').title);
  });
  const viewerVideo = $('liveVideo');
  const viewerVolume = $('viewerVolume');
  const viewerMute = $('viewerMute');
  let lastViewerVolume = Number(viewerVolume.value) || 0.8;
  function syncViewerMuteButton() {
    const muted = viewerVideo.muted || viewerVideo.volume === 0;
    // A barra representa o volume efetivamente audível, não o último valor salvo.
    const displayedVolume = muted ? 0 : viewerVideo.volume;
    viewerVolume.value = String(displayedVolume);
    viewerVolume.style.setProperty('--volume-progress', `${displayedVolume * 100}%`);
    viewerMute.innerHTML = muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
    viewerMute.title = muted ? 'Ativar som' : 'Silenciar áudio';
    viewerMute.setAttribute('aria-label', viewerMute.title);
  }
  viewerVolume.addEventListener('input', e => {
    const value = Math.max(0, Math.min(1, Number(e.target.value) || 0));
    viewerVideo.volume = value;
    viewerVideo.muted = value === 0;
    if (value > 0) lastViewerVolume = value;
    syncViewerMuteButton();
  });
  viewerMute.addEventListener('click', () => {
    if (viewerVideo.muted || viewerVideo.volume === 0) {
      const restored = lastViewerVolume > 0 ? lastViewerVolume : 0.8;
      viewerVideo.volume = restored;
      viewerVideo.muted = false;
    } else {
      lastViewerVolume = viewerVideo.volume;
      viewerVideo.muted = true;
    }
    syncViewerMuteButton();
  });
  syncViewerMuteButton();
  $('viewerPip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && $('liveVideo').requestPictureInPicture) await $('liveVideo').requestPictureInPicture();
      else toast('O miniplayer não é compatível com este navegador.');
    } catch (_) { toast('Não foi possível abrir o miniplayer.'); }
  });

  // ---------- viewer: assistir ----------
  $('btnWatch').addEventListener('click', () => {
    if (!lastInfo) return toast('A live foi encerrada.');
    $('unlockPasswordInput').value = ''; setErr($('unlockError'), '');
    joinPass = ''; phase = 'joining'; fails = 0; viewerHasVoted = false; clearChat();
    join(true);
  });
  $('cancelUnlock').addEventListener('click', () => { $('unlockModal').classList.remove('open'); leaveWatching(); });
  $('confirmUnlock').addEventListener('click', tryUnlock);
  $('unlockPasswordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

  function tryUnlock() {
    const pw = $('unlockPasswordInput').value.trim();
    if (!pw) return setErr($('unlockError'), 'Digite a senha.');
    if (!peer || peer.disconnected) return setErr($('unlockError'), 'Sem conexão com o servidor. Aguarde e tente de novo.');
    phase = 'joining'; joinPass = pw; fails = 0; viewerHasVoted = false; clearChat(); setErr($('unlockError'), '');
    join(true);
  }
  function join(first) {
    cleanupConn();
    conn = peer.connect(HOST_ID, { reliable: true, serialization: 'json' });
    const c = conn;
    joinTimeout = setTimeout(() => { if (conn === c) onJoinFail('Tempo esgotado ao conectar.'); }, 10000);
    c.on('open', () => c.send({ t: 'join', pw: joinPass, admin_token: adminToken, name: user || localStorage.getItem('livesEmAltaUser') || 'Espectador', viewerId: stableViewerId }));
    c.on('data', (d) => {
      if (conn !== c) return;
      if (d.t === 'admin-granted') {
        clearTimeout(joinTimeout); fails = 0; adminMode = true; adminToken = d.admin_token || ''; phase = 'admin';
        $('unlockModal').classList.remove('open'); enterAdminView();
        connectLiveKitViewer().catch(error => { toast(error.message || 'Não foi possível conectar ao vídeo.'); leaveWatching(); });
      } else if (d.t === 'admin-state') {
        adminSpectators = Array.isArray(d.spectators) ? d.spectators : [];
        adminMediaState = { audio: !!d.audio, video: !!d.video };
        $('viewerCount').textContent = adminSpectators.length;
        setMediaButtonState('toggleMicrophone', adminMediaState.audio); setMediaButtonState('toggleCamera', adminMediaState.video);
        renderSpectators();
      } else if (d.t === 'admin-media-state') {
        adminMediaState = { audio: !!d.audio, video: !!d.video };
        setMediaButtonState('toggleMicrophone', adminMediaState.audio); setMediaButtonState('toggleCamera', adminMediaState.video);
      } else if (d.t === 'admin-error') toast(d.message || 'Não foi possível executar a ação administrativa.');
      else if (d.t === 'granted') {
        clearTimeout(joinTimeout); fails = 0;
        if (first) {
          phase = 'watching'; $('unlockModal').classList.remove('open'); enterViewerView();
          connectLiveKitViewer().catch((error) => {
            toast(error.message || 'Não foi possível conectar ao vídeo.');
            leaveWatching();
          });
        }
        $('netStatus').hidden = true;
      } else if (d.t === 'denied') {
        clearTimeout(joinTimeout);
        if (first) { phase = 'locked'; setErr($('unlockError'), d.r); $('unlockPasswordInput').value = ''; $('unlockModal').classList.add('open'); cleanupConn(); }
        else { toast(d.r); leaveWatching(); }
      } else if (d.t === 'count') $('viewerCount').textContent = d.n;
      else if (d.t === 'chat') receiveChatMessage(d);
      else if (d.t === 'chat-history' && Array.isArray(d.messages)) d.messages.forEach(receiveChatMessage);
      else if (d.t === 'reaction') showFloatingReaction(d.emoji);
      else if (d.t === 'camera-state') setRemoteCameraState(d.enabled);
      else if (d.t === 'roulette-ready') { rouletteItems = Array.isArray(d.items) ? d.items : []; if (adminMode && rouletteItems.length) $('spinRoulette').hidden = false; }
      else if (d.t === 'roulette-spin') playRemoteRoulette(d);
      else if (d.t === 'poll-state') { activePoll = d.poll; viewerHasVoted = !!d.voted; renderPoll(activePoll, d.counts || [], viewerHasVoted); }
      else if (d.t === 'poll-results') updatePollResults(d.counts || [], !!d.closed);
      else if (d.t === 'banned') { toast('Você foi removido desta live pelo anfitrião.'); phase = 'idle'; disconnectLiveKit(); cleanupConn(); if (call) { try { call.close(); } catch (_) {} call = null; } video.srcObject = null; show('main', 200); startProbing(); }
      else if (d.t === 'locked') {
        disconnectLiveKit(); phase = 'locked'; clearTimeout(retryTimer); retryTimer = null;
        if (call) { try { call.close(); } catch (_) {} call = null; }
        video.srcObject = null; $('videoPlaceholder').hidden = false; $('placeholderMsg').textContent = 'Esta live foi trancada. Digite a senha para continuar assistindo.';
        $('unlockPasswordInput').value = ''; setErr($('unlockError'), ''); $('unlockModal').classList.add('open');
        setTimeout(() => $('unlockPasswordInput').focus(), 100);
      }
      else if (d.t === 'ended') { toast('A live foi encerrada pelo host.'); leaveWatching(); }
    });
    c.on('close', () => { if (conn === c && (phase === 'watching' || phase === 'admin')) scheduleRejoin(); });
  }
  function onJoinFail(msg) {
    if (phase === 'joining') { phase = 'idle'; setErr($('unlockError'), msg); cleanupConn(); }
    else if (phase === 'watching' || phase === 'admin') scheduleRejoin();
  }
  function scheduleRejoin() { // reconexão automática com tolerância de ~40s
    if ((phase !== 'watching' && phase !== 'admin') || retryTimer) return;
    if (++fails > 20) { toast('Não foi possível reconectar à live.'); return leaveWatching(); }
    showNet('Reconectando...');
    retryTimer = setTimeout(() => { retryTimer = null; if ((phase === 'watching' || phase === 'admin') && peer && !peer.disconnected) join(false); else scheduleRejoin(); }, 2000);
  }
  function onIncomingCall(cl) {
    // O transporte de mídia foi migrado para LiveKit. Rejeita chamadas PeerJS antigas.
    try { cl.close(); } catch (_) {}
  }
  function playVideo() {
    video.muted = false;
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); $('btnUnmute').hidden = false; });
  }
  $('btnUnmute').addEventListener('click', () => { video.muted = false; video.play().catch(() => {}); $('btnUnmute').hidden = true; });
  video.addEventListener('playing', () => { $('videoPlaceholder').hidden = true; $('netStatus').hidden = true; });
  video.addEventListener('waiting', () => { if (phase === 'watching' || phase === 'admin') showNet('Carregando...'); });
  function showNet(msg) { $('netStatus').textContent = msg; $('netStatus').hidden = false; }

  function enterViewerView() {
    $('live-screen').classList.remove('chat-collapsed'); $('chatToggle').innerHTML = '<i class="fa-solid fa-chevron-down"></i>'; $('viewerPip').hidden = false; $('chatToggle').hidden = false;
    $('liveRoleTag').textContent = ''; $('liveRoleTag').hidden = true; $('liveRoleTag').classList.remove('host'); $('liveTools').hidden = true; $('viewerControls').hidden = false; $('footerMsg').textContent = 'Transmissão ao vivo de ' + (lastInfo?.host || 'host');
    $('videoPlaceholder').hidden = false; $('placeholderMsg').textContent = 'Conectando à transmissão...';
    $('liveVideo').muted = false; $('liveVideo').volume = Number($('viewerVolume').value || 0.8);
    $('viewerCount').textContent = lastInfo?.count || 1; show('live', 200);
  }
  function enterAdminView() {
    $('live-screen').classList.remove('chat-collapsed'); $('chatToggle').hidden = false; $('viewerPip').hidden = false;
    $('liveRoleTag').textContent = 'ADMINISTRADOR'; $('liveRoleTag').hidden = false; $('liveRoleTag').classList.remove('host');
    $('liveTools').hidden = false; $('viewerControls').hidden = true; $('toggleLiveLock').hidden = true;
    $('btnEndLiveInside').hidden = true; $('closeLiveView').innerHTML = '<i class="fa-solid fa-xmark"></i>'; $('closeLiveView').classList.remove('host-end-button');
    $('footerMsg').textContent = 'Modo administrador';
    $('videoPlaceholder').hidden = false; $('placeholderMsg').textContent = 'Conectando à transmissão...';
    $('liveVideo').muted = false; $('liveVideo').volume = Number($('viewerVolume').value || 0.8);
    show('live', 200);
  }
  function cleanupConn() {
    clearTimeout(joinTimeout); clearTimeout(retryTimer); retryTimer = null;
    if (conn) { const c = conn; conn = null; try { c.close(); } catch (_) {} }
  }
  function leaveWatching() {
    phase = 'idle'; adminMode = false; adminToken = ''; adminSpectators = []; $('toggleLiveLock').hidden = false; cleanupConn();
    disconnectLiveKit();
    if (call) { try { call.close(); } catch (_) {} call = null; }
    video.srcObject = null; exitLiveView();
  }

  // ---------- saída da tela da live ----------
  $('closeLiveView').addEventListener('click', () => {
    if (phase === 'hosting') openEndLiveModal();
    else leaveWatching();
  });
  function exitLiveView() {
    $('netStatus').hidden = true; renderLive(null); show('main', 200);
    if (!peer || peer.destroyed) startProbing(); else probe();
  }

  // ---------- arrastar roleta e enquete ----------
  // Usa o offsetParent real e movimento no document para permitir arrasto em X e Y,
  // inclusive quando o ponteiro sai da pequena área do título.
  function enablePanelDrag(panel, handle) {
    if (!panel || !handle) return;

    let drag = null;
    handle.style.cursor = 'grab';
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest('button, input, textarea, select, a')) return;
      if (panel.hidden) return;

      const parent = panel.offsetParent;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const scaleX = parentRect.width / Math.max(parent.clientWidth, 1) || 1;
      const scaleY = parentRect.height / Math.max(parent.clientHeight, 1) || 1;

      // Solta qualquer centralização CSS e transforma a posição atual em coordenadas locais.
      const left = (panelRect.left - parentRect.left) / scaleX + parent.scrollLeft;
      const top = (panelRect.top - parentRect.top) / scaleY + parent.scrollTop;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';

      drag = {
        pointerId: event.pointerId,
        parent,
        startX: event.clientX,
        startY: event.clientY,
        left,
        top,
        scaleX,
        scaleY
      };

      handle.style.cursor = 'grabbing';
      panel.classList.add('is-dragging');
      event.preventDefault();
    });

    document.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const parent = drag.parent;
      const maxLeft = Math.max(0, parent.clientWidth - panel.offsetWidth);
      const maxTop = Math.max(0, parent.clientHeight - panel.offsetHeight);

      const deltaX = (event.clientX - drag.startX) / drag.scaleX;
      const deltaY = (event.clientY - drag.startY) / drag.scaleY;

      const nextLeft = Math.min(maxLeft, Math.max(0, drag.left + deltaX));
      const nextTop = Math.min(maxTop, Math.max(0, drag.top + deltaY));

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    }, { passive: false });

    const stopDragging = (event) => {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      drag = null;
      handle.style.cursor = 'grab';
      panel.classList.remove('is-dragging');
    };

    document.addEventListener('pointerup', stopDragging);
    document.addEventListener('pointercancel', stopDragging);
  }

  enablePanelDrag($('rouletteStage'), $('rouletteStage'));
  enablePanelDrag($('livePollCard'), $('pollCardHead'));

  // ---------- ferramentas do anfitrião: roleta e espectadores ----------
  let rouletteItems = [], rouletteAngle = 0, rouletteBusy = false;
  const rouletteColors = ['#ff7b00','#090909'];
  const rouletteLogo = new Image();
  rouletteLogo.src = 'logo.jpg';
  function addRouletteRow(name = '', weight = 1) {
    const row = document.createElement('div'); row.className = 'roulette-row';
    const color = rouletteColors[$('rouletteList').children.length % rouletteColors.length];
    row.innerHTML = `<span class="option-color" style="background:${color}"></span><input class="option-name" maxlength="35" placeholder="Nome do item" value=""><input class="option-weight" type="number" min="1" max="1000" value="${weight}" aria-label="Peso"><button class="remove-option" type="button" aria-label="Remover"><i class="fa-solid fa-trash"></i></button>`;
    row.querySelector('.option-name').value = name;
    row.querySelector('.remove-option').addEventListener('click', () => row.remove());
    $('rouletteList').appendChild(row);
  }
  // Menu compacto de ferramentas: disponível somente no layout móvel.
  const mobileToolsMenu = $('mobileToolsMenu');
  const mobileToolsToggle = $('mobileToolsToggle');
  const mobileToolsPanel = $('mobileToolsPanel');
  const liveToolsCenter = document.querySelector('.live-tools-center');
  const liveToolsMedia = document.querySelector('.live-tools-media');
  const cameraButton = $('toggleCamera');
  const arrangeMobileTools = () => {
    if (!mobileToolsMenu || !liveToolsCenter || !liveToolsMedia) return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      // Ordem mobile: câmera, microfone e menu de ferramentas.
      liveToolsMedia.insertBefore(cameraButton, liveToolsMedia.firstChild);
      liveToolsMedia.appendChild(mobileToolsMenu);
    } else {
      liveToolsCenter.appendChild(mobileToolsMenu);
      // Restaura a ordem original do desktop: microfone e câmera.
      liveToolsMedia.appendChild($('toggleMicrophone'));
      liveToolsMedia.appendChild(cameraButton);
    }
  };
  arrangeMobileTools();
  window.addEventListener('resize', arrangeMobileTools);

  const closeMobileToolsMenu = () => {
    mobileToolsMenu?.classList.remove('is-open');
    mobileToolsToggle?.setAttribute('aria-expanded', 'false');
  };
  mobileToolsToggle?.addEventListener('click', () => {
    const isOpen = mobileToolsMenu.classList.toggle('is-open');
    mobileToolsToggle.setAttribute('aria-expanded', String(isOpen));
  });
  mobileToolsPanel?.addEventListener('click', (event) => {
    if (event.target.closest('button')) closeMobileToolsMenu();
  });
  document.addEventListener('click', (event) => {
    if (mobileToolsMenu && !mobileToolsMenu.contains(event.target)) closeMobileToolsMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileToolsMenu();
  });

  $('openRoulette').addEventListener('click', () => { $('rouletteModal').classList.add('open'); if (!$('rouletteList').children.length) { addRouletteRow(); addRouletteRow(); } });
  $('addRouletteOption').addEventListener('click', () => addRouletteRow());
  $('saveRoulette').addEventListener('click', () => {
    const rows = [...$('rouletteList').querySelectorAll('.roulette-row')];
    const items = rows.map((r, i) => ({ name: r.querySelector('.option-name').value.trim(), weight: Math.max(1, Number(r.querySelector('.option-weight').value) || 1), color: r.querySelector('.option-color').style.background || rouletteColors[i % rouletteColors.length] })).filter(x => x.name);
    if (items.length < 2) return toast('Adicione pelo menos duas opções com nome.');
    if (phase === 'admin' && conn?.open) { conn.send({ t: 'admin-roulette-create', items }); $('rouletteModal').classList.remove('open'); toast('Solicitando criação da roleta...'); return; }
    rouletteItems = items; $('rouletteModal').classList.remove('open'); $('spinRoulette').hidden = false;
    broadcastToViewers({ t: 'roulette-ready', items: rouletteItems }); toast('Roleta criada!');
  });
  function spinRouletteHost() {
    if (!rouletteItems.length || rouletteBusy) return;
    const total = rouletteItems.reduce((a, x) => a + x.weight, 0); let pick = Math.random() * total, winner = 0;
    for (let i = 0; i < rouletteItems.length; i++) { pick -= rouletteItems[i].weight; if (pick <= 0) { winner = i; break; } }
    let start = -Math.PI / 2;
    for (let i = 0; i < winner; i++) start += rouletteItems[i].weight / total * Math.PI * 2;
    const targetMid = start + rouletteItems[winner].weight / total * Math.PI;
    const desired = -Math.PI / 2 - targetMid; const current = rouletteAngle % (Math.PI * 2);
    const delta = ((desired - current) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const from = rouletteAngle, to = rouletteAngle + Math.PI * 2 * 6 + delta, duration = 5200;
    const spin = { t: 'roulette-spin', items: rouletteItems, winner, from, to, duration };
    $('rouletteStage').hidden = false; $('rouletteResult').hidden = true; drawRoulette(rouletteAngle);
    broadcastToViewers(spin); animateRoulette(spin);
  }
  $('spinRoulette').addEventListener('click', () => {
    if (phase === 'admin' && conn?.open) { conn.send({ t: 'admin-roulette-spin' }); return; }
    spinRouletteHost();
  });
  function playRemoteRoulette(data) {
    if (!Array.isArray(data.items) || data.items.length < 2) return;
    rouletteItems = data.items; $('rouletteStage').hidden = false; $('rouletteResult').hidden = true;
    animateRoulette(data);
  }
  function animateRoulette(data) {
    if (rouletteBusy) return;
    rouletteBusy = true; const from = Number(data.from) || 0, to = Number(data.to) || (from + Math.PI * 12), duration = Math.max(1000, Number(data.duration) || 5200);
    const began = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - began) / duration), eased = 1 - Math.pow(1 - t, 4);
      rouletteAngle = from + (to - from) * eased; drawRoulette(rouletteAngle);
      if (t < 1) requestAnimationFrame(frame);
      else {
        rouletteBusy = false; const winner = Math.max(0, Math.min(rouletteItems.length - 1, Number(data.winner) || 0));
        $('rouletteResult').textContent = 'Resultado: ' + rouletteItems[winner].name; $('rouletteResult').hidden = false;
      }
    }
    requestAnimationFrame(frame);
  }
  function drawRoulette(angle) {
    const canvas = $('rouletteCanvas'), ctx = canvas.getContext('2d'), cx = 210, cy = 210, radius = 195;
    ctx.clearRect(0, 0, 420, 420); const total = rouletteItems.reduce((a, x) => a + x.weight, 0); let a = angle - Math.PI / 2;
    rouletteItems.forEach((item, i) => { const next = a + item.weight / total * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, a, next); ctx.closePath(); ctx.fillStyle = i % 2 === 0 ? '#ff7b00' : '#090909'; ctx.fill(); ctx.save(); ctx.translate(cx, cy); ctx.rotate((a + next) / 2); ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.shadowColor = '#000'; ctx.shadowBlur = 3; ctx.fillText(item.name.slice(0, 18), radius - 18, 6); ctx.restore(); a = next; });
    // Apenas o contorno externo preto; sem divisórias entre os segmentos.
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.stroke();
    // Centro circular com a logo oficial da plataforma e aro preto.
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 31, 0, Math.PI * 2); ctx.fillStyle = '#090909'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke();
    if (rouletteLogo.complete && rouletteLogo.naturalWidth) { ctx.beginPath(); ctx.arc(cx, cy, 25, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(rouletteLogo, cx - 25, cy - 25, 50, 50); }
    ctx.restore();
  }
  // ---------- enquetes sincronizadas ----------
  $('openPoll').addEventListener('click', () => { $('pollModal').classList.add('open'); $('pollQuestionInput').focus(); });
  $('cancelPoll').addEventListener('click', () => $('pollModal').classList.remove('open'));
  $('addPollOption').addEventListener('click', () => {
    const box = $('pollCreateOptions'); if (box.children.length >= 4) return toast('O limite é de quatro opções.');
    const input = document.createElement('input'); input.className = 'poll-text-input'; input.maxLength = 50; input.placeholder = `Opção ${box.children.length + 1}`; box.appendChild(input);
  });
  $('publishPoll').addEventListener('click', () => {
    const question = $('pollQuestionInput').value.trim();
    const options = [...$('pollCreateOptions').querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    if (!question || options.length < 2) return toast('Informe a pergunta e pelo menos duas opções.');
    if (phase === 'admin' && conn?.open) { conn.send({ t: 'admin-poll-create', question, options }); $('pollModal').classList.remove('open'); toast('Solicitando publicação da enquete...'); return; }
    activePoll = { id: `${Date.now()}`, question, options, closed: false }; pollVotes.clear();
    $('pollModal').classList.remove('open'); renderPoll(activePoll, getPollCounts(), false); broadcastToViewers({ t: 'poll-state', poll: activePoll, counts: getPollCounts(), voted: false });
    toast('Enquete publicada!');
  });
  function getPollCounts() { const counts = activePoll ? activePoll.options.map(() => 0) : []; pollVotes.forEach(index => { if (counts[index] !== undefined) counts[index]++; }); return counts; }
  function registerPollVote(peerId, option) {
    if (!activePoll || activePoll.closed || pollVotes.has(peerId)) return;
    const index = Number(option); if (!Number.isInteger(index) || index < 0 || index >= activePoll.options.length) return;
    pollVotes.set(peerId, index); const counts = getPollCounts(); renderPoll(activePoll, counts, false); broadcastToViewers({ t: 'poll-results', counts, closed: false });
  }
  function renderPoll(poll, counts = [], voted = false) {
    if (!poll) return; $('livePollCard').hidden = false; $('pollQuestion').textContent = poll.question;
    $('pollDismiss').hidden = false;
    $('pollOptions').replaceChildren();
    poll.options.forEach((option, index) => {
      const button = document.createElement('button'); button.className = 'poll-option'; button.textContent = option;
      const count = Number(counts[index] || 0); const total = counts.reduce((a,b)=>a+Number(b||0),0); const pct = total ? Math.round(count/total*100) : 0;
      const bar = document.createElement('span'); bar.className = 'poll-option-bar'; bar.style.width = `${pct}%`; button.appendChild(bar);
      const label = document.createElement('small'); label.textContent = `${count} · ${pct}%`; button.appendChild(label);
      button.disabled = phase === 'watching' ? (voted || !!poll.closed) : true;
      if (phase === 'watching') button.addEventListener('click', () => { if (viewerHasVoted || !conn?.open) return; viewerHasVoted = true; conn.send({ t: 'poll-vote', option: index }); button.disabled = true; });
      $('pollOptions').appendChild(button);
    });
    $('pollFoot').replaceChildren();
    if (phase === 'hosting' && !poll.closed) {
      const closeButton = document.createElement('button'); closeButton.className = 'poll-close-button'; closeButton.textContent = `Encerrar enquete · ${pollVotes.size} voto(s)`; closeButton.addEventListener('click', closePoll); $('pollFoot').appendChild(closeButton);
    } else {
      const pollPrompt = !poll.closed && !(voted || viewerHasVoted);
      const pollFeedback = !poll.closed && (voted || viewerHasVoted);
      $('pollFoot').textContent = poll.closed ? 'Enquete encerrada' : (pollPrompt ? 'Escolha uma opção' : 'Seu voto foi registrado');
      $('pollFoot').classList.toggle('poll-prompt', pollPrompt);
      $('pollFoot').classList.toggle('poll-voted', pollFeedback);
      $('pollFoot').classList.toggle('poll-closed-foot', !!poll.closed);
      $('pollFoot').style.setProperty('color', (pollPrompt || pollFeedback) ? '#ff941f' : '', 'important');
      $('pollFoot').style.fontWeight = (pollPrompt || pollFeedback) ? '800' : '';
    }
  }
  $('pollDismiss').addEventListener('click', () => { $('livePollCard').hidden = true; });
  function updatePollResults(counts, closed) { if (!activePoll) return; activePoll.closed = !!closed; renderPoll(activePoll, counts, viewerHasVoted); }
  function closePoll() { if (!activePoll || activePoll.closed) return; activePoll.closed = true; const counts = getPollCounts(); renderPoll(activePoll, counts, false); broadcastToViewers({ t: 'poll-results', counts, closed: true }); }
  $('pollQuestionInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('publishPoll').click(); });
  $('viewerControls').hidden = true;

  $('closeRouletteStage').addEventListener('click', () => { if (!rouletteBusy) $('rouletteStage').hidden = true; });
  $('openViewers').addEventListener('click', () => { renderSpectators(); $('viewersModal').classList.add('open'); });
  let pendingBanId = null;
  function openBanConfirmation(id, viewerName) {
    pendingBanId = id;
    $('banTargetName').textContent = viewerName || 'este espectador';
    $('banConfirmModal').classList.add('open');
    $('confirmBan').focus();
  }
  function closeBanConfirmation() {
    $('banConfirmModal').classList.remove('open');
    pendingBanId = null;
  }
  $('cancelBan').addEventListener('click', closeBanConfirmation);
  $('cancelBanClose').addEventListener('click', closeBanConfirmation);
  $('banConfirmModal').addEventListener('click', e => { if (e.target === $('banConfirmModal')) closeBanConfirmation(); });
  $('confirmBan').addEventListener('click', () => {
    if (adminMode) {
      if (pendingBanId !== null && conn?.open) { conn.send({ t: 'admin-ban', viewerPeer: pendingBanId }); toast('Solicitando banimento...'); }
      closeBanConfirmation(); return;
    }
    if (pendingBanId === null || !viewers.has(pendingBanId)) { closeBanConfirmation(); return; }
    banViewerById(String(pendingBanId)); closeBanConfirmation();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('banConfirmModal').classList.contains('open')) closeBanConfirmation(); });
  function renderSpectators() {
    const list = $('spectatorList'); if (!list) return; list.replaceChildren();
    const entries = adminMode ? adminSpectators.map(v => [v.peerId, v]) : [...viewers.entries()].map(([id, v]) => [id, v]);
    $('viewerTotal').textContent = adminMode ? adminSpectators.length : viewers.size;
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'spectator-empty'; empty.textContent = 'Ninguém está assistindo no momento.'; list.appendChild(empty); }
    entries.forEach(([id, v]) => { const row = document.createElement('div'); row.className = 'spectator-row'; const name = document.createElement('strong'); name.textContent = v.name || 'Espectador'; const ban = document.createElement('button'); ban.className = 'ban-button'; ban.innerHTML = '<i class="fa-solid fa-ban"></i> Banir'; ban.addEventListener('click', () => openBanConfirmation(id, v.name || 'Espectador')); row.append(name, ban); list.appendChild(row); });
    if (phase === 'hosting') syncAdminState();
  }
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).classList.remove('open')));
  document.querySelectorAll('.feature-modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); }));

  window.addEventListener('online', () => { if (phase === 'watching' || phase === 'admin') scheduleRejoin(); });
});
