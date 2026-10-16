// ---------- LEVI VOICE ----------
let aiVoices = []; // browser speechSynthesis voices

// Browser/device voices only - no cloud voice service. Reused by both
// Levi and, further down, buyer↔vendor messages (speakMessageBubble).
function stopAiSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  document.querySelectorAll(".ai-chat-msg-speak.speaking, .msg-speak.speaking").forEach((b) => b.classList.remove("speaking"));
}
function speakAiChatMessage(text, btn) {
  const wasSpeakingThis = btn?.classList.contains("speaking");
  stopAiSpeaking();
  if (wasSpeakingThis) return; // clicking/tapping an already-speaking control stops it
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const preset = getAiVoicePreset();
  utter.rate = preset.rate;
  utter.pitch = preset.pitch;
  const voice = getSelectedBrowserVoice();
  if (voice) utter.voice = voice;
  btn?.classList.add("speaking");
  utter.onend = utter.onerror = () => {
    btn?.classList.remove("speaking");
  };
  speechSynthesis.speak(utter);
}

// Picking a good default voice (network/"enhanced" voices tend to sound
// noticeably less robotic than the compact on-device ones) so Levi doesn't
// just take the browser's arbitrary first voice. Still limited by whatever
// the phone/browser actually ships - there's no code-side way to make the
// built-in engine itself sound more human than that.
function getAiVoicePreset() { return { rate: 0.96, pitch: 1.0 }; }
function scoreAiVoice(v) {
  const name = `${v.name || ""} ${v.voiceURI || ""}`;
  let score = 0;
  if (!v.localService) score += 5;
  if (/Natural|Neural|Enhanced|Premium|Online|Cloud/i.test(name)) score += 8;
  if (/Samantha|Ava|Serena|Daniel|Moira|Karen|Tessa|Rishi|Aaron|Nicky|Eddy|Flo|Reed|Rocko|Shelley|Grandma|Grandpa/i.test(name)) score += 4;
  if (/Google|Microsoft|Apple|Siri/i.test(name)) score += 3;
  if (/en-NG|en_GB|en-GB|en-US|en_US/i.test(v.lang)) score += 2;
  if (/compact|espeak|robot|novelty|whisper|bad news|bells|boing|bubbles|cellos|organ|trinoids|zarvox/i.test(name)) score -= 12;
  return score;
}
function pickDefaultAiVoice(voices) {
  if (!voices.length) return null;
  return [...voices].sort((a,b) => scoreAiVoice(b) - scoreAiVoice(a) || String(a.name).localeCompare(String(b.name)))[0] || null;
}
function getSelectedBrowserVoice() {
  const uri = localStorage.getItem("levi-voice");
  return aiVoices.find((v) => v.voiceURI === uri) || pickDefaultAiVoice(aiVoices);
}
function loadAiVoices() {
  if (!("speechSynthesis" in window)) return;
  aiVoices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!aiVoices.length) return;
  const saved = localStorage.getItem("levi-voice");
  if (!saved || !aiVoices.some((v) => v.voiceURI === saved)) {
    const def = pickDefaultAiVoice(aiVoices);
    if (def) localStorage.setItem("levi-voice", def.voiceURI);
  }
  populateVoiceSelect();
}
function populateVoiceSelect() {
  byId("voiceSettingsSection")?.classList.remove("hidden");
  const sel = byId("voiceSelect");
  if (!sel) return;
  const activeURI = localStorage.getItem("levi-voice");
  const sorted = [...aiVoices].sort((a,b) => scoreAiVoice(b) - scoreAiVoice(a) || String(a.name).localeCompare(String(b.name)));
  const bestScore = sorted.length ? scoreAiVoice(sorted[0]) : 0;
  sel.innerHTML = sorted.map((v, i) => {
    const natural = scoreAiVoice(v) >= Math.max(5, bestScore - 2);
    return `<option value="${esc(v.voiceURI)}" ${v.voiceURI === activeURI ? "selected" : ""}>${natural ? "★ " : ""}${esc(v.name)} (${esc(v.lang)})</option>`;
  }).join("");
  const chosen = getSelectedBrowserVoice();
  const hint = byId("voiceQualityHint");
  if (hint && chosen) hint.textContent = scoreAiVoice(chosen) >= 5 ? `Recommended natural voice: ${chosen.name}.` : `Using ${chosen.name}. Your browser controls the underlying voice quality.`;
}
function setAiVoice(id) {
  localStorage.setItem("levi-voice", id);
  populateVoiceSelect();
  previewAiVoice();
}
function previewAiVoice() { speakAiChatMessage("Hi, I'm Levi. How can I help you today?", null); }
if ("speechSynthesis" in window) {
  loadAiVoices();
  speechSynthesis.onvoiceschanged = loadAiVoices;
}

// Tap-to-talk remains available inside Levi itself. The always-listening
// voice wake-up feature has been removed: Levromart no longer requests or
// starts background speech recognition for a wake word.
const AiSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
try { localStorage.removeItem("levromart-levi-wake"); } catch (_) {}
function syncSystemBarColor() {
  const theme = localStorage.getItem("medris-theme") || (document.documentElement.dataset.theme === "dark" ? "dark" : document.documentElement.dataset.theme === "black" ? "black" : "black");
  syncSystemBarColorForTheme(theme);
}
syncSystemBarColor();
/* Android: the browser's speech recogniser beeps on every restart, so record short WAV clips
   (cut at natural pauses) and transcribe them on the server. Same interface as SpeechRecognition. */
function lmChunkSttAvailable() {
  return /Android/i.test(navigator.userAgent) && !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}
class LmChunkRecognizer {
  constructor() { this.lang = "en"; this.continuous = true; this.interimResults = true; this.maxAlternatives = 1; this._chunks = []; this._queue = Promise.resolve(); this._active = false; this._buf = []; this._spoke = false; this._t0 = 0; this._lastVoice = 0; }
  async start() {
    this._starting = true;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (_) { this._starting = false; this.onerror?.({ error: "not-allowed" }); this.onend?.(); return; }
    if (this._aborted) { stream.getTracks().forEach((t) => t.stop()); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try { ctx = new AC({ sampleRate: 16000 }); } catch (_) { ctx = new AC(); }
    this._stream = stream; this._ctx = ctx;
    this._src = ctx.createMediaStreamSource(stream);
    this._proc = ctx.createScriptProcessor(4096, 1, 1);
    this._mute = ctx.createGain(); this._mute.gain.value = 0;
    this._proc.onaudioprocess = (e) => this._onAudio(e.inputBuffer.getChannelData(0));
    this._src.connect(this._proc); this._proc.connect(this._mute); this._mute.connect(ctx.destination);
    this._active = true; this._starting = false; this._t0 = Date.now(); this._lastVoice = Date.now();
    this.onstart?.();
  }
  _onAudio(data) {
    if (!this._active) return;
    this._buf.push(new Float32Array(data));
    let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length), now = Date.now();
    if (rms > 0.015) { this._spoke = true; this._lastVoice = now; }
    const age = now - this._t0;
    if (this._spoke && ((now - this._lastVoice > 700 && age > 900) || age > 14000)) this._cut();
    else if (!this._spoke && age > 6000) { this._buf = []; this._t0 = now; }
  }
  _cut() {
    const buf = this._buf, spoke = this._spoke;
    this._buf = []; this._spoke = false; this._t0 = Date.now(); this._lastVoice = Date.now();
    if (spoke && buf.length) this._submit(this._wav(buf, this._ctx.sampleRate));
  }
  _wav(chunks, rate) {
    let n = 0; chunks.forEach((c) => (n += c.length));
    const view = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, "data"); view.setUint32(40, n * 2, true);
    let o = 44;
    for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) { const v = Math.max(-1, Math.min(1, c[i])); view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return new Blob([view], { type: "audio/wav" });
  }
  _submit(blob) {
    this._queue = this._queue.then(async () => {
      if (this._aborted) return;
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); });
        const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "transcribe", accessToken: session?.access_token, audio: b64 }) });
        const j = await r.json().catch(() => ({}));
        if (this._aborted) return;
        if (j.text) { this._chunks.push(j.text); this.onresult?.({ results: this._chunks.map((t) => { const x = [{ transcript: t }]; x.isFinal = true; return x; }) }); }
        else if (!r.ok) this.onerror?.({ error: "network" });
      } catch (_) { if (!this._aborted) this.onerror?.({ error: "network" }); }
    });
  }
  _release() {
    this._active = false;
    try { this._proc && (this._proc.onaudioprocess = null); this._src?.disconnect(); this._proc?.disconnect(); this._mute?.disconnect(); } catch (_) {}
    try { this._stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { this._ctx?.close(); } catch (_) {}
  }
  stop() {
    if (this._ended) return; this._ended = true;
    if (this._active && this._spoke && this._buf.length) this._cut();
    this._release();
    this._queue.then(() => this.onend?.());
  }
  abort() {
    this._aborted = true; this._ended = true; this._buf = [];
    this._release();
    setTimeout(() => this.onend?.(), 0);
  }
}
function lmNewRecognizer() { return lmChunkSttAvailable() ? new LmChunkRecognizer() : new AiSpeechRecognition(); }
function lmMergeResults(results) {
  const kept = [];
  for (let i = 0; i < results.length; i++) {
    const t = String(results[i]?.[0]?.transcript || "").trim();
    if (!t) continue;
    const last = kept[kept.length - 1];
    if (last && t.toLowerCase().startsWith(last.toLowerCase())) kept[kept.length - 1] = t; // cumulative result (Android)
    else if (last && last.toLowerCase().startsWith(t.toLowerCase())) continue;
    else kept.push(t);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}
function lmCleanVoice(text) {
  let t = String(text || "").replace(/\b(?:um+|uh+|erm+|er|ah+|hmm+|mm+)\b[,.]?/gi, " ");
  t = t.replace(/\b(\w+)(\s+\1\b)+/gi, "$1").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  if (!t) return "";
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}
function lmJoinVoice(base, spoken) {
  base = String(base || "").trim(); spoken = String(spoken || "").trim();
  if (!spoken) return base;
  if (!base) return spoken;
  const sentences = (base.match(/[.!?](\s|$)/g) || []).length;
  return base + (sentences > 0 && sentences % 3 === 0 && !/\n\n$/.test(base) ? "\n\n" : " ") + spoken;
}
let aiChatWant = false;
let aiChatVoiceBase = "";
let msgWant = false;
let aiChatRecognizer = null;
let aiChatListening = false;
let aiChatVoicePaused = false;
let aiChatLastVoiceTranscript = "";
// Talked to Levi instead of typing? Its reply reads itself aloud automatically.
// Typed messages stay text-only unless the speaker icon is tapped manually.
let aiChatLastInputVoice = false;
function initAiChatMic() {
  const btn = byId("aiChatMicBtn");
  if (btn && AiSpeechRecognition) btn.classList.remove("hidden");
}
function updateAiVoiceStatus() {
  const status = byId("aiVoiceStatus");
  const text = byId("aiVoiceStatusText");
  const btn = byId("aiChatMicBtn");
  if (!status || !text) return;
  status.classList.toggle("hidden", !aiChatListening && !aiChatVoicePaused);
  text.textContent = aiChatVoicePaused ? "Paused - tap the microphone to resume" : "Listening...";
  const pauseBtn = status.querySelector("button:first-of-type i");
  if (pauseBtn) pauseBtn.className = `fa-solid ${aiChatVoicePaused ? "fa-play" : "fa-pause"}`;
  if (btn) {
    btn.classList.toggle("listening", aiChatListening);
    btn.innerHTML = `<i class="fa-solid fa-microphone"></i>`;
    btn.title = "Tap to talk";
    btn.setAttribute("aria-label", "Tap to talk");
  }
}
function scrollAiVoiceIntoView() {
  const messages = byId("aiChatMessages");
  if (messages) messages.scrollTop = messages.scrollHeight;
  const input = byId("aiChatInput");
  if (input) input.scrollTop = input.scrollHeight;
}
function toggleAiChatMic(evt) {
  evt?.preventDefault?.();
  evt?.stopPropagation?.();
  try { document.activeElement?.blur?.(); } catch (_) {}
  if (!AiSpeechRecognition) return;
  // Tapping the mic means "let me talk". Stop Levi's speech immediately so
  // the browser never has Levi's TTS competing with the microphone.
  if (("speechSynthesis" in window) && speechSynthesis.speaking) stopAiSpeaking();
  if (aiChatListening) {
    aiChatWant = false;
    try { aiChatRecognizer?.stop(); } catch (_) {}
    return;
  }
  if (!aiChatWant) { aiChatWant = true; aiChatVoiceBase = String(byId("aiChatInput")?.value || "").trim(); }
  aiChatRecognizer = lmNewRecognizer();
  const aiRecThis = aiChatRecognizer;
  aiChatRecognizer.lang = "en-NG";
  aiChatRecognizer.interimResults = true;
  aiChatRecognizer.continuous = true;
  aiChatRecognizer.maxAlternatives = 1;
  aiChatLastVoiceTranscript = "";
  aiChatRecognizer.onstart = () => {
    aiChatListening = true;
    aiChatVoicePaused = false;
    const input = byId("aiChatInput");
    if (input) { input.readOnly = true; try { input.blur(); } catch (_) {} }
    try { document.activeElement?.blur?.(); } catch (_) {}
    updateAiVoiceStatus();
  };
  aiChatRecognizer.onresult = (e) => {
    // This is deliberately the original non-continuous, tap-to-talk model.
    // Build the transcript from the single recognition session and REPLACE
    // the input value instead of appending every result event. That prevents
    // the continuous-recognition accumulation that was doubling sentences.
    let transcript = lmMergeResults(e.results);
    if (!transcript || transcript === aiChatLastVoiceTranscript) return;
    aiChatLastVoiceTranscript = transcript;
    const el = byId("aiChatInput");
    if (el) {
      el.value = lmJoinVoice(aiChatVoiceBase, transcript);
      autoGrowChatInput(el);
      el.scrollTop = el.scrollHeight;
      aiChatLastInputVoice = true;
      scrollAiVoiceIntoView();
    }
    updateAiVoiceStatus();
  };
  aiChatRecognizer.onerror = (e) => {
    // No app-generated audio/beeps. Normal no-speech/abort lifecycle events
    // are silent; only actual recognition failures get a visual toast.
    if (e.error === "not-allowed" || e.error === "service-not-allowed") aiChatWant = false;
    if (e.error !== "aborted" && e.error !== "no-speech") {
      showToast("Couldn't hear that, try again.", "error");
    }
  };
  aiChatRecognizer.onend = () => {
    const mine = aiChatRecognizer === aiRecThis;
    aiChatListening = false;
    aiChatVoicePaused = false;
    aiChatRecognizer = null;
    const input = byId("aiChatInput");
    if (mine && aiChatWant && input) {
      // A pause in speech ends this browser session; keep the text (tidied) and listen again.
      aiChatVoiceBase = lmJoinVoice(aiChatVoiceBase, lmCleanVoice(aiChatLastVoiceTranscript));
      input.value = aiChatVoiceBase; autoGrowChatInput(input);
      setTimeout(() => { if (aiChatWant && !aiChatListening) toggleAiChatMic(); }, 120);
      return;
    }
    aiChatWant = false;
    if (input && !mine && aiChatLastVoiceTranscript) { /* cancelled */ }
    else if (input && aiChatLastVoiceTranscript) { input.value = lmJoinVoice(aiChatVoiceBase, lmCleanVoice(aiChatLastVoiceTranscript)); autoGrowChatInput(input); }
    if (input) input.readOnly = false;
    try { document.activeElement?.blur?.(); } catch (_) {}
    updateAiVoiceStatus();
  };
  // Do not focus the Levi composer while starting voice input. Blurring the
  // active element keeps mobile keyboards closed when the mic is tapped.
  try {
    const input = byId("aiChatInput");
    if (input) input.readOnly = true;
    try { document.activeElement?.blur?.(); } catch (_) {}
  } catch (_) {}
  try {
    aiChatRecognizer.start();
  } catch (e) {
    aiChatRecognizer = null;
    aiChatListening = false;
    updateAiVoiceStatus();
    showToast("Couldn't start the microphone. Try again.", "error");
  }
  updateAiVoiceStatus();
}
async function cancelAiChatVoice() {
  if (!aiChatListening && !aiChatVoicePaused) return;
  const confirmed = await showConfirmDialog("Cancel your current voice recording? The text captured so far will be cleared.", { title: "Cancel recording", okLabel: "Cancel recording", danger: true });
  if (!confirmed) return;
  aiChatWant = false;
  try { aiChatRecognizer?.abort(); } catch (_) {}
  aiChatRecognizer = null;
  aiChatListening = false;
  aiChatVoicePaused = false;
  aiChatLastVoiceTranscript = "";
  aiChatLastInputVoice = false;
  const input = byId("aiChatInput");
  if (input) { input.readOnly = false; resetChatInput(input); }
  try { document.activeElement?.blur?.(); } catch (_) {}
  updateAiVoiceStatus();
}

// Same tap-to-talk pattern, for the ordinary buyer↔vendor message
// compose box rather than the Levi chat - separate recognizer instance so
// the two never fight over which input box is being filled.
let msgRecognizer = null;
let msgListening = false;
let msgVoicePaused = false;
let msgVoiceBaseText = "";
let msgVoiceFinalTranscript = "";
let msgVoiceInterimTranscript = "";

function renderMsgVoiceState() {
  const status = byId("msgVoiceStatus");
  const text = byId("msgVoiceStatusText");
  const btn = byId("msgMicBtn");
  if (!status || !text) return;
  status.classList.toggle("hidden", !msgListening && !msgVoicePaused);
  text.textContent = msgVoiceInterimTranscript || msgVoiceFinalTranscript || "Listening...";
  if (btn) {
    btn.classList.toggle("listening", msgListening);
    btn.innerHTML = `<i class="fa-solid fa-${msgListening ? "stop" : "microphone"}"></i>`;
    btn.title = msgListening ? "Stop recording" : "Add voice text";
    btn.setAttribute("aria-label", msgListening ? "Stop recording" : "Add voice text");
  }
}

function applyMsgVoiceTranscript() {
  const input = byId("chatInput");
  if (!input) return;
  const spoken = `${msgVoiceFinalTranscript}${msgVoiceVoiceInterimForInput()}`.replace(/\s+/g, " ").trim();
  const transcript = [msgVoiceBaseText, spoken].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!transcript) return;
  input.value = transcript;
  autoGrowChatInput(input);
  input.scrollTop = input.scrollHeight;
  scrollChatToBottom();
  handleChatTyping(activeConversationId);
}

function msgVoiceVoiceInterimForInput() {
  return msgVoiceInterimTranscript ? `${msgVoiceFinalTranscript ? " " : ""}${msgVoiceInterimTranscript}` : "";
}

function startMsgVoiceRecognition() {
  if (!AiSpeechRecognition) return;

  const input = byId("chatInput");
  // Preserve whatever is already in the compose box. Every new mic session
  // appends to that text instead of replacing/clearing it.
  msgVoiceBaseText = String(input?.value || "").trim();
  msgVoiceFinalTranscript = "";
  msgVoiceInterimTranscript = "";
  msgVoicePaused = false;

  try { msgRecognizer?.abort(); } catch (_) {}
  msgRecognizer = lmNewRecognizer();
  const msgRecThis = msgRecognizer;
  msgWant = true;
  const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  msgRecognizer.lang = isIOSDevice ? "en-US" : "en-NG";
  msgRecognizer.interimResults = true;
  msgRecognizer.continuous = true;
  msgRecognizer.maxAlternatives = 1;

  msgRecognizer.onstart = () => {
    msgListening = true;
    msgVoicePaused = false;
    renderMsgVoiceState();
    scrollChatToBottom();
    // Do NOT focus the textarea here. The microphone is a voice input control;
    // opening it must never summon the mobile keyboard.
    try { input?.blur(); } catch (_) {}
  };

  msgRecognizer.onresult = (e) => {
    // Only use the current recognition session. Browser engines may revise
    // interim results, so replacement is safer than append-on-every-event.
    let transcript = lmMergeResults(e.results);
    if (!transcript) return;
    const finalResult = Array.from(e.results).some(r => r.isFinal);
    if (finalResult) {
      msgVoiceFinalTranscript = transcript;
      msgVoiceInterimTranscript = "";
    } else {
      msgVoiceInterimTranscript = transcript;
    }
    applyMsgVoiceTranscript();
    renderMsgVoiceState();
  };

  msgRecognizer.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      msgWant = false;
      showToast("Microphone or speech recognition permission is blocked. Allow microphone access for Levromart and try again.", "error");
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      showToast("Couldn't hear that, try again.", "error");
    }
  };

  msgRecognizer.onend = () => {
    // Natural pauses end only this recognition session. The text stays in the
    // compose box so the user can tap the mic again and continue speaking.
    const mine = msgRecognizer === msgRecThis;
    msgListening = false;
    msgVoicePaused = false;
    const heard = msgVoiceFinalTranscript || msgVoiceInterimTranscript;
    msgVoiceInterimTranscript = "";
    msgRecognizer = null;
    if (mine && msgWant) {
      const inp = byId("chatInput");
      if (inp) { inp.value = lmJoinVoice(msgVoiceBaseText, lmCleanVoice(heard)); autoGrowChatInput(inp); }
      setTimeout(() => { if (msgWant && !msgListening && !msgRecognizer) startMsgVoiceRecognition(); }, 120);
      return;
    }
    msgWant = false;
    if (mine && heard) { const inp = byId("chatInput"); if (inp) { inp.value = lmJoinVoice(msgVoiceBaseText, lmCleanVoice(heard)); autoGrowChatInput(inp); } }
    else applyMsgVoiceTranscript();
    renderMsgVoiceState();
  };

  try {
    msgRecognizer.start();
  } catch (_) {
    msgRecognizer = null;
    msgListening = false;
    msgVoicePaused = false;
    renderMsgVoiceState();
    showToast("Couldn't start the microphone. Try again.", "error");
  }
}

function toggleMsgMic(evt) {
  evt?.stopPropagation?.();
  if (!AiSpeechRecognition) return;

  if (("speechSynthesis" in window) && speechSynthesis.speaking) {
    try { speechSynthesis.cancel(); } catch (_) {}
  }

  if (msgListening) {
    msgWant = false;
    try { msgRecognizer?.stop(); } catch (_) {}
    return;
  }

  // IMPORTANT: do not clear the existing compose text. Starting another voice
  // session deliberately continues from whatever is already typed/transcribed.
  startMsgVoiceRecognition();
  renderMsgVoiceState();
}

function toggleMsgMicPause() {
  if (msgListening) {
    msgWant = false;
    try { msgRecognizer?.stop(); } catch (_) {}
  } else {
    startMsgVoiceRecognition();
  }
}

function stopMsgVoiceRecording() {
  const status = byId("msgVoiceStatus");
  status?.classList.add("hidden");
  byId("msgMicBtn")?.classList.remove("listening");
  msgWant = false;
  try { msgRecognizer?.abort(); } catch (_) {}
  msgRecognizer = null;
  msgListening = false;
  msgVoicePaused = false;
  msgVoiceInterimTranscript = "";
  msgVoiceFinalTranscript = "";
  msgVoiceBaseText = String(byId("chatInput")?.value || "").trim();
  renderMsgVoiceState();
  const input = byId("chatInput");
  if (input) { autoGrowChatInput(input); input.scrollTop = input.scrollHeight; }
}

async function cancelMsgVoiceRecording() {
  if (!msgListening && !msgVoicePaused) return;
  const confirmed = await showConfirmDialog("Cancel your current voice recording? The text captured in this voice session will be removed, while any text already in the compose box is kept.", { title: "Cancel recording", okLabel: "Cancel recording", danger: true });
  if (!confirmed) return;
  msgWant = false;
  try { msgRecognizer?.abort(); } catch (_) {}
  msgRecognizer = null;
  msgListening = false;
  msgVoicePaused = false;
  msgVoiceFinalTranscript = "";
  msgVoiceInterimTranscript = "";
  const input = byId("chatInput");
  if (input) { input.value = msgVoiceBaseText; autoGrowChatInput(input); input.scrollTop = input.scrollHeight; }
  renderMsgVoiceState();
}
async function leviOfflineFallback(text) {
  const q = leviNormaliseText(text);
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    const name = (profile?.name || '').trim().split(/\s+/)[0];
    return `Hi${name ? `, ${name}` : ''}. I'm Levi. I can still help with Levromart navigation, your cart, wishlist, orders, products, vendors, and requests right now.`;
  }
  if (/\b(open|show|take me to|go to)\b.*\b(cart|basket)\b/.test(q)) {
    navigate('cart');
    return 'Done - I opened your cart.';
  }
  if (/\b(open|show|go to|take me to)\b.*\b(my shop|shop)\b/.test(q) && vendor) {
    navigate('vendorDashboard');
    return 'Done - I opened your shop.';
  }
  if (/\b(open|show|go to|take me to)\b.*\b(vendors?|vendor directory)\b/.test(q)) {
    navigate('vendors');
    return 'Done - here are the vendors.';
  }
  // The smart backend is down/unreachable, but a plain product search
  // doesn't need it -- try that before giving up, so an outage doesn't
  // turn every product question into the same unhelpful stock sentence.
  try {
    const result = await resolveLeviProduct(q);
    if (result?.product) {
      navigate("productDetail", { productId: result.product.id });
      return `I found ${result.product.name}${result.product.vendor?.business_name ? ` from ${result.product.vendor.business_name}` : ""}, opening it for you now.`;
    }
  } catch (_) {}
  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    const name = (profile?.name || '').trim().split(/\s+/)[0];
    return `Hi${name ? `, ${name}` : ''}. I'm Levi. Tell me what you need and I'll help you get there.`;
  }
  return `I’m on it. Tell me what you want to open, find, or do, and I’ll take care of the next step.`;
}

async function fetchLeviReply(payload) {
  const urls = ['/api/chat', '/api/chat.js'];
  const deadline = Date.now() + 12000;
  let lastError = null;
  for (const url of urls) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          cache: 'no-store',
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }
      const raw = await res.text();
      let json = {};
      try { json = raw ? JSON.parse(raw) : {}; } catch (_) {}
      if (res.ok && json.reply) return json;
      lastError = new Error(json.error || `Levi service returned HTTP ${res.status}.`);
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Levi service unavailable.');
}

function isLeviTourRequest(text) {
  const q = leviNormaliseText(text);
  return /\b(take me around|take me on (?:a )?tour|take me on the tour|show me around|show me the tour|give me (?:a )?tour|tour me|walk me around|walk me through the app|guide me around|guide me through the app|take me through the app)\b/.test(q);
}

async function startLeviTourFromChat() {
  const input = byId("aiChatInput");
  const text = input?.value?.trim() || "";
  if (!text) return false;
  resetChatInput(input);
  appendAiChatMessage("user", text);
  persistAiMessage("user", text);
  const reply = "Absolutely. I'll take you around Levromart now.";
  appendAiChatMessage("assistant", reply);
  persistAiMessage("assistant", reply);
  setTimeout(() => showTour(), 350);
  return true;
}

async function sendAiChatMessage() {
  const input = byId("aiChatInput");
  const text = input.value.trim();
  const wasVoice = aiChatLastInputVoice;
  aiChatLastInputVoice = false;
  if (!text) return;
  if (isLeviTourRequest(text)) {
    resetChatInput(input);
    appendAiChatMessage("user", text);
    persistAiMessage("user", text);
    const reply = "Absolutely. I'll take you around Levromart now.";
    appendAiChatMessage("assistant", reply);
    persistAiMessage("assistant", reply);
    setTimeout(() => showTour(), 350);
    return;
  }
  if (aiChatListening || aiChatRecognizer) { aiChatWant = false; try { aiChatRecognizer?.abort(); } catch (_) {} aiChatRecognizer = null; aiChatListening = false; aiChatVoicePaused = false; updateAiVoiceStatus(); }
  resetChatInput(input);
  appendAiChatMessage("user", text);
  persistAiMessage("user", text);

  // Levi has a local action layer for deterministic, low-risk tasks. This
  // means explicit commands such as "add this to my cart" do not depend on
  // the language model remembering a private tag format. The normal AI
  // conversation still goes to /api/chat for everything else.
  try {
    const action = await resolveLeviLocalAction(text);
    if (action?.handled) {
      appendAiChatMessage("assistant", action.reply, wasVoice);
      persistAiMessage("assistant", action.reply);
      playSound("notify");
      if (typeof action.afterReply === "function") {
        setTimeout(() => { Promise.resolve(action.afterReply()).catch((err) => console.warn("Levi post-action failed:", err)); }, 140);
      }
      return;
    }
  } catch (err) {
    console.warn("Levi local action failed; continuing with AI:", err);
  }

  appendAiChatMessage("typing", "");
  try {
    const leviHistory = aiChatMessages.filter((m) => m.role !== "typing").slice(-12);
    let leviChars = 0;
    const boundedLeviHistory = [];
    for (let i = leviHistory.length - 1; i >= 0; i--) {
      const msg = leviHistory[i];
      const textLen = String(msg.content || "").length;
      if (boundedLeviHistory.length >= 12 || leviChars + textLen > 6500) break;
      boundedLeviHistory.unshift(msg);
      leviChars += textLen;
    }
    const json = await fetchLeviReply({
      messages: boundedLeviHistory,
      accessToken: session?.access_token,
      lat: buyerLocation?.lat, lng: buyerLocation?.lng,
      currentView, currentViewParams, lastRenderError,
    });
    byId("aiChatTyping")?.remove();
    const assistantEl = appendAiChatMessage("assistant", json.reply, wasVoice);
    persistAiMessage("assistant", json.reply).then((id) => {
      if (id && assistantEl) { assistantEl.dataset.msgId = id; attachAiReactionUI(assistantEl, id, null); }
    });
    playSound("notify");
  } catch (err) {
    byId("aiChatTyping")?.remove();
    console.error("Levi chat error:", err);
    const fallback = await leviOfflineFallback(text);
    appendAiChatMessage("assistant", fallback, wasVoice);
    persistAiMessage("assistant", fallback);
  }
}

function leviNormaliseText(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function leviExtractCartTarget(text, mode) {
  let q = leviNormaliseText(text);
  if (mode === "add") {
    q = q.replace(/\b(please|levi|can you|could you|would you|kindly|help me)\b/g, " ")
      .replace(/\b(add|put|place|throw|move)\b/g, " ")
      .replace(/\b(this|that|the|item|product|one)\b/g, " ")
      .replace(/\b(to|into|in|on)\b/g, " ")
      .replace(/\b(my|me|a|an)\b/g, " ")
      .replace(/\bcart\b/g, " ")
      .trim();
  } else {
    q = q.replace(/\b(please|levi|can you|could you|would you|kindly|help me)\b/g, " ")
      .replace(/\b(remove|delete|take|drop)\b/g, " ")
      .replace(/\b(this|that|the|item|product|one)\b/g, " ")
      .replace(/\b(from|out of|out|in|my)\b/g, " ")
      .replace(/\bcart\b/g, " ")
      .trim();
  }
  return q.replace(/\s{2,}/g, " ").trim();
}

async function resolveLeviProduct(target) {
  const rawTarget = String(target || "").trim();
  const referentialTarget = /^(?:this|that|this item|that item|this product|that product|the current item|current item|the current product|current product|same item|same product)$/i.test(rawTarget);
  // Only referential requests may resolve to the product currently open. A
  // normal new request such as "scarf" or "shoes" must ALWAYS search the
  // catalogue, even if Levi is currently displaying another product.
  if (referentialTarget && currentView === "productDetail" && currentViewParams?.productId) {
    const { data, error } = await sb.from("products")
      .select("id,name,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name)")
      .eq("id", currentViewParams.productId).maybeSingle();
    if (!error && data) return { product: data, exact: true, matches: [data] };
  }

  const q = rawTarget;
  if (!q) return { product: null, exact: false, empty: true };

  // Literal name lookup comes first. A broad/stale search index must never
  // turn a fresh request such as "scarf" into the product that happened to be
  // open a few turns earlier (for example Penny).
  const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const phrase = words.join(" ");
  const productSelect = "id,name,description,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name)";
  try {
    const { data: byName, error: nameError } = await sb.from("products")
      .select(productSelect)
      .eq("status", "active")
      .ilike("name", `%${phrase}%`)
      .limit(12);
    if (!nameError && byName?.length) {
      const nq = normalize(q);
      const ranked = [...byName].sort((a,b) => {
        const an = normalize(a.name), bn = normalize(b.name);
        const ae = an === nq ? 0 : an.startsWith(nq) ? 1 : 2;
        const be = bn === nq ? 0 : bn.startsWith(nq) ? 1 : 2;
        return ae - be;
      });
      return { product: ranked[0], matches: ranked, exact: normalize(ranked[0].name) === nq || ranked.length === 1 };
    }
  } catch (_) {}

  // Use the same typo/word-aware database search used by the marketplace only
  // after literal matching. Even here, prefer results whose names contain the
  // current query before considering the RPC's relevance ranking.
  try {
    const { data: idRows, error: rpcError } = await sb.rpc("search_product_ids", { p_query: q });
    const ids = (idRows || []).slice(0, 12).map((r) => r.id).filter(Boolean);
    if (!rpcError && ids.length) {
      const { data: found, error } = await sb.from("products")
        .select(productSelect)
        .eq("status", "active").in("id", ids);
      if (!error && found?.length) {
        const ordered = [...found].sort((a,b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        const nq = normalize(q);
        const direct = ordered.filter((p) => normalize(p.name).includes(nq));
        // search_product_ids is a relevance helper, not proof that its first
        // row matches the current request. Never treat a lone unrelated row as
        // the requested product, that was the path that could turn a fresh
        // request like "shoe" into the previous "Penny" listing.
        if (direct.length) {
          return { product: direct[0], matches: direct, exact: direct.length === 1 && normalize(direct[0].name) === nq };
        }
        return { product: null, matches: [], exact: false };
      }
    }
  } catch (_) {}
  let query = sb.from("products")
    .select("id,name,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name)")
    .eq("status", "active").limit(8);
  const { data: byName, error: nameError } = await query.ilike("name", `%${phrase}%`);
  if (!nameError && byName?.length) return { product: byName[0], matches: byName };
  const first = words[0];
  const { data: fallback, error: fallbackError } = await sb.from("products")
    .select("id,name,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name)")
    .eq("status", "active").ilike("name", `%${first}%`).limit(8);
  if (!fallbackError && fallback?.length) return { product: fallback[0], matches: fallback };

  // Last-resort typo tolerance for small spelling mistakes (e.g. "shooe"
  // for "shoe"). We compare against active marketplace names only and keep
  // the closest high-confidence match. This is deliberately conservative so
  // a wildly different word does not silently turn into the wrong product.
  try {
    const { data: candidates } = await sb.from("products")
      .select("id,name,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name)")
      .eq("status", "active").limit(600);
    const clean = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const editDistance = (a,b) => {
      const aa = clean(a), bb = clean(b);
      if (!aa || !bb) return 999;
      const prev = Array.from({length:bb.length+1}, (_,i)=>i);
      for (let i=1;i<=aa.length;i++) {
        const cur=[i];
        for (let j=1;j<=bb.length;j++) cur[j] = Math.min(cur[j-1]+1, prev[j]+1, prev[j-1]+(aa[i-1]===bb[j-1]?0:1));
        for (let j=0;j<cur.length;j++) prev[j]=cur[j];
      }
      return prev[bb.length];
    };
    const scored = (candidates || []).map(p => {
      const name = clean(p.name);
      const direct = name === clean(q);
      const tokens = clean(q).split(' ').filter(Boolean);
      const nameTokens = name.split(' ').filter(Boolean);
      const tokenHit = tokens.length && tokens.every(t => nameTokens.some(nt => nt.includes(t) || editDistance(t,nt) <= (t.length >= 5 ? 2 : 1)));
      return { p, direct, tokenHit, d: editDistance(q, name) };
    }).sort((a,b) => (b.direct-a.direct) || (b.tokenHit-a.tokenHit) || (a.d-b.d));
    const best = scored[0];
    const qLen = clean(q).length;
    const maxDistance = qLen >= 7 ? 2 : qLen >= 4 ? 1 : 0;
    if (best && (best.direct || best.tokenHit || best.d <= maxDistance)) {
      return { product: best.p, matches: [best.p], exact: !!best.direct, typoRecovered: !best.direct };
    }
  } catch (_) {}
  return { product: null, matches: [] };
}

async function addCartWithFallback(productId, quantity) {
  const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
  const { error: rpcError } = await levroData.cart.add(productId, qty);
  if (!rpcError) return null;

  // Some deployments have the cart table but an out-of-date/missing RPC.
  // Fall back only after verifying the real listing is active and sellable.
  const { data: p, error: pErr } = await sb.from("products")
    .select("id,listing_type,sale_price,quantity_available,status,is_service")
    .eq("id", productId).maybeSingle();
  if (pErr || !p || p.status !== "active" || p.is_service || p.sale_price == null || !["sale","both"].includes(p.listing_type)) {
    return rpcError;
  }
  const { data: existing, error: readErr } = await sb.from("cart_items")
    .select("id,quantity").eq("buyer_id", session.user.id).eq("product_id", productId).maybeSingle();
  if (readErr) return rpcError;

  const currentQty = Number(existing?.quantity || 0);
  const nextQty = Math.min(currentQty + qty, Math.max(1, Number(p.quantity_available || 1)));
  if (existing?.id) {
    const { error } = await sb.from("cart_items").update({ quantity: nextQty }).eq("id", existing.id);
    return error || null;
  }
  const { error } = await sb.from("cart_items").insert({ buyer_id: session.user.id, product_id: productId, quantity: Math.max(1, Number(qty) || 1) });
  return error || null;
}


let leviPendingProductRequest = null;

async function resolveLeviVendor(target) {
  const clean = String(target || "").trim();
  if (!clean) return { vendor: null, matches: [] };
  const phrase = clean.replace(/\b(the|vendor|store|shop|seller)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!phrase) return { vendor: null, matches: [] };
  try {
    const { data, error } = await sb.from("vendors")
      .select("id,business_name,verification_status,is_active")
      .eq("verification_status", "verified")
      .eq("is_active", true)
      .ilike("business_name", `%${phrase}%`)
      .limit(8);
    if (!error && data?.length) return { vendor: data[0], matches: data };
  } catch (_) {}
  return { vendor: null, matches: [] };
}

async function resolveLeviProductSuggestions(target) {
  const clean = String(target || "").trim();
  if (!clean) return [];
  const groups = {
    icecream:["ice cream","icecream","frozen dessert","dessert","candy","sweet","yogurt"],
    "ice cream":["icecream","frozen dessert","dessert","candy","sweet","yogurt"],
    watch:["wristwatch","wrist watch","smartwatch","smart watch","timepiece"],
    jewelry:["jewellery","ring","rings","necklace","bracelet","earrings","chain"],
    jewellery:["jewelry","ring","rings","necklace","bracelet","earrings","chain"],
    shoe:["shoes","footwear","sneaker","sneakers","slipper","sandals","boots"],
    shoes:["shoe","footwear","sneaker","sneakers","slipper","sandals","boots"],
    food:["foodstuff","groceries","grocery","rice","pasta","spaghetti","penne","macaroni","snacks","candy"],
    clothes:["clothing","fashion","shirt","dress","trousers","jeans","jacket"],
    medical:["medical equipment","diagnostic","healthcare","clinical"]
  };
  const terms = new Set(clean.split(/\s+/).filter(Boolean).slice(0,6));
  [...terms].forEach(t => (groups[leviNormaliseText(t)] || []).forEach(x => terms.add(x)));
  try {
    const queries = [...terms].slice(0,14).map(term => sb.from("products")
      .select("id,name,description,sale_price,discount_price,rental_rate,quantity_available,status,is_service,photos,category:categories(id,name,sector_id),vendor:vendors(id,business_name,logo_url)")
      .eq("status","active").eq("is_service",false).or(`name.ilike.%${term}%,description.ilike.%${term}%`).limit(10));
    const responses = await Promise.all(queries);
    const map = new Map();
    responses.forEach(r => (r.data || []).forEach(p => { if (Number(p.quantity_available ?? 0) > 0) map.set(p.id,p); }));
    const qn = leviNormaliseText(clean);
    const allTerms = [...terms].map(leviNormaliseText);
    const score = p => { const hay=leviNormaliseText([p.name,p.description,p.category?.name].filter(Boolean).join(" ")); return (hay.includes(qn)?50:0)+allTerms.reduce((n,t)=>n+(t&&hay.includes(t)?4:0),0); };
    return [...map.values()].sort((a,b)=>score(b)-score(a)).slice(0,6);
  } catch (_) { return []; }
}

function leviProductSuggestionTag(products){return products?.length?`[[PRODUCTS:${products.map(p=>p.id).join(",")}]]`:"";}


function leviCatalogueTerms(text){
  const q=leviNormaliseText(text);
  const groups={drink:['drink','beverage','juice','water','smoothie','coffee','tea','soda'],snack:['snack','pastry','chicken','sandwich','cake','biscuit','chips'],eat:['food','meal','rice','pasta','noodles','chicken','snack']};
  const words=q.replace(/\b(i|want|would|like|something|some|to|a|an|the|please|recommend|find|me|cheap|affordable|near|nearby|eat|drink)\b/g,' ').split(/\s+/).filter(Boolean);
  for(const [key,terms] of Object.entries(groups))if(new RegExp(`\\b${key}\\b`).test(q))words.push(...terms);
  return [...new Set(words)];
}
async function resolveLeviCatalogueRequest(text){
  const q=leviNormaliseText(text);
  const named=q.match(/(?:catalogue|catalog|products|services|packages|listings)\s+(?:from|of|for|at)\s+(.+?)[?.!]*$/)||q.match(/what\s+(?:does|do)\s+(.+?)\s+(?:sell|offer|have)[?.!]*$/);
  const food=/\b(eat|food|snack|drink|beverage|spicy|chicken)\b/.test(q);
  const currentVendor=(currentView==='storefront'&&/\b(this|their|the)\b.*\b(vendor|shop|store|catalogue|products)\b/.test(q))?currentViewParams.vendorId:null;
  if(!named&&!food&&!currentVendor)return null;
  try{
    let vendorId=currentVendor;
    if(named){const found=await resolveLeviVendor(named[1].trim());if(found.matches?.length>1)return {handled:true,reply:`Which vendor do you mean: ${found.matches.map(v=>v.business_name).join(', ')}?`};vendorId=found.vendor?.id;if(!vendorId)return {handled:true,reply:'I couldn’t find a matching active vendor. What is the shop’s name?'};}
    const vf='id,business_name,bio,city,avg_rating,review_count,lat,lng,verification_status,is_active';
    let pq=sb.from('products').select(`*,vendor:vendors!inner(${vf}),category:categories(name,sector_id),variants:product_variants(*)`).eq('status','active').eq('vendor.verification_status','verified').eq('vendor.is_active',true).order('created_at',{ascending:false}).limit(200);
    let kq=sb.from('vendor_packages').select(`*,vendor:vendors!inner(${vf}),items:package_items(quantity,product:products(name))`).eq('status','active').eq('vendor.verification_status','verified').eq('vendor.is_active',true).order('created_at',{ascending:false}).limit(100);
    if(vendorId){pq=pq.eq('vendor_id',vendorId);kq=kq.eq('vendor_id',vendorId);}
    const [pr,kr]=await Promise.all([pq,kq]);if(pr.error)throw pr.error;if(kr.error)throw kr.error;
    const rows=[...(pr.data||[]).map(p=>({...p,_kind:p.is_service?'Service':'Product',_price:p.discount_price??p.sale_price??p.rental_rate})),...(kr.data||[]).map(p=>({...p,_kind:'Package',_price:p.price}))];
    const terms=leviCatalogueTerms(text);
    const ranked=rows.map(p=>{
      const category=p.category||{},sector=(sectors||[]).find(x=>String(x.id)===String(category.sector_id));
      const hay=leviNormaliseText([p.name,p.description,category.name,sector?.name,p.vendor?.business_name,String(p.tags||''),(p.variants||[]).map(v=>[v.name,v.description,v.size,v.color].join(' ')).join(' '),(p.items||[]).map(x=>x.product?.name).join(' ')].join(' '));
      return {p,score:terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0),distance:vendorDistanceKm(p.vendor)};
    }).filter(x=>vendorId||x.score>0).sort((a,b)=>{
      if(/\b(cheap|affordable|budget)\b/.test(q))return (a.p._price==null?Infinity:Number(a.p._price))-(b.p._price==null?Infinity:Number(b.p._price))||b.score-a.score;
      if(/\b(near|nearby|closest)\b/.test(q))return (a.distance??Infinity)-(b.distance??Infinity)||b.score-a.score;
      return b.score-a.score;
    });
    if(!ranked.length)return {handled:true,reply:vendorId?'This vendor has no active matching listings available right now.':'I couldn’t find a matching listing in the current catalogue results. What specific food or drink would you like?'};
    const chosen=ranked.slice(0,vendorId?20:5);
    const lines=chosen.map(({p,distance})=>{
      const price=p._price==null?'price not provided':naira(Number(p._price));
      const rating=p.vendor?.review_count>0?` · ${Number(p.vendor.avg_rating).toFixed(1)}★ (${p.vendor.review_count} reviews)`:'';
      const stock=p.quantity_available==null?'':` · ${p.quantity_available} available`;
      const variants=(p.variants||[]).map(v=>`${v.name}: ${v.sale_price==null?'price not provided':naira(Number(v.discount_price??v.sale_price))}${variantStock(v)==null?'':` (${variantStock(v)} available)`}`).join('; ');
      return `${p.name}, ${price} (${p._kind}) from ${p.vendor.business_name}${rating}${distance==null?'':` · ${distance.toFixed(1)} km away`}${stock}.${p.description?' '+String(p.description).slice(0,160):''}${variants?' Varieties: '+variants+'.':''} [[NAV:${p._kind==='Package'?'packageDetail|packageId':'productDetail|productId'}=${p.id}]]`;
    });
    return {handled:true,reply:`${vendorId?'Here are this vendor’s current listings':'These current listings match your request'}:\n${lines.join('\n')}\n${ranked.length>chosen.length?'Showing '+chosen.length+' of '+ranked.length+' matches in these results. ':''}${/\bnear\b/.test(q)&&!buyerLocation?'Distance is unavailable until you enable location.':''}`};
  }catch(err){console.warn('Levi catalogue lookup failed',err);return {handled:true,reply:'I couldn’t refresh the catalogue just now. Please try again; I won’t guess prices or availability.'};}
}
async function resolveLeviQuickDiscovery(text) {
  const q=leviNormaliseText(text);
  if(!session) return null;
  const hasLocation=!!(buyerLocation && Number.isFinite(Number(buyerLocation.lat)) && Number.isFinite(Number(buyerLocation.lng)));
  const vendorRequest=/\b(vendor|vendors|store|stores|shop|shops|seller|sellers)\b/.test(q);

  // Nearby/closest vendor discovery. If the user names a product, first find
  // vendors that actually carry it; then rank those vendors by real distance.
  if(vendorRequest && /\b(closest|nearest|near me|nearest to me|close to me)\b/.test(q)){
    if(!hasLocation){
      try{ showLocationPrompt?.("first-use"); }catch(_){}
      return {handled:true,reply:"I can find the closest vendor, but I need your location first. Turn on location and I’ll find the nearest real match."};
    }
    const wantsRent = /\b(rent|rents|rental|renting|hire|hiring)\b/.test(q);
    const wantsBuy = /\b(buy|buying|purchase|sell|selling)\b/.test(q);
    const productPhrase=q.replace(/\b(levi|please|what|are|is|the|a|an|my|closest|nearest|vendor|vendors|store|stores|shop|shops|seller|sellers|near|me|to|that|can|i|buy|buying|purchase|rent|rents|rental|renting|hire|hiring|from|for|around|here|there|are)\b/g," ").replace(/[?.!,]/g," ").replace(/\s+/g," ").trim();
    let vendors=[];
    let matchedProduct=false;
    try{
      if(productPhrase){
        const {data:ids}=await sb.rpc("search_product_ids",{p_query:productPhrase});
        const productIds=(ids||[]).slice(0,30).map(x=>x.id).filter(Boolean);
        if(productIds.length){
          let productQuery=sb.from("products").select("id,listing_type,vendor:vendors!inner(id,business_name,city,lat,lng,avg_rating,review_count,verification_status,is_active)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).in("id",productIds);
          if (wantsRent) productQuery=productQuery.in("listing_type",["rent","both"]);
          if (wantsBuy) productQuery=productQuery.in("listing_type",["sale","both"]);
          const {data:products}=await productQuery;
          const map=new Map();(products||[]).forEach(p=>{if(p.vendor?.id)map.set(p.vendor.id,p.vendor);});vendors=[...map.values()];
          matchedProduct=vendors.length>0;
        }
      }
      if(!vendors.length){
        const {data}=await sb.from("vendors").select("id,business_name,city,lat,lng,avg_rating,review_count").eq("verification_status","verified").eq("is_active",true).limit(300);
        vendors=data||[];
      }
    }catch(_){}
    vendors=vendors.filter(v=>Number.isFinite(Number(v.lat))&&Number.isFinite(Number(v.lng))).map(v=>({...v,distance:haversineKm(Number(buyerLocation.lat),Number(buyerLocation.lng),Number(v.lat),Number(v.lng))})).sort((a,b)=>a.distance-b.distance);
    if(!vendors.length) return {handled:true,reply:"I couldn't find a vendor with a mapped location for that request yet."};
    const top=vendors.slice(0,5);
    const lines=top.map((v,i)=>{
      const rating=v.review_count>0?` · ${Number(v.avg_rating||0).toFixed(1)}★ (${v.review_count} reviews)`:"";
      return `${i+1}. ${v.business_name}, ${formatDistanceKm(v.distance)}${rating}`;
    });
    const intro=productPhrase
      ? (matchedProduct
        ? `Here are the closest vendors I found carrying "${productPhrase}":`
        : `I couldn't confirm a vendor nearby carrying "${productPhrase}" specifically, but here are the closest verified vendors you could try instead:`)
      : "Here are the closest vendors to you:";
    return {handled:true,reply:`${intro}\n${lines.join("\n")}\nAsk me to take you to any of these by name.`};
  }

  // Rating discovery: use real public ratings, never guesses.
  if(vendorRequest && (/(highest|top|best|5[- ]?star|five[- ]?star|rated)/.test(q))){
    const minFive=/\b(5[- ]?star|five[- ]?star|five star)\b/.test(q)?5:null;
    const minFour=/\b(4[- ]?star|four[- ]?star)\b/.test(q)?4:null;
    const minRating=minFive??minFour;
    try{
      const {data}=await sb.from("vendors").select("id,business_name,city,avg_rating,review_count").eq("verification_status","verified").eq("is_active",true).limit(300);
      const rows=(data||[]).filter(v=>minRating==null||Number(v.avg_rating||0)>=minRating).sort((a,b)=>Number(b.avg_rating||0)-Number(a.avg_rating||0)||Number(b.review_count||0)-Number(a.review_count||0)).slice(0,8);
      if(rows.length) return {handled:true,reply:`Here are the ${minRating?`${minRating}-star-and-up `:"highest-rated "}vendors I found: ${rows.map((v,i)=>`${i+1}. ${v.business_name}, ${Number(v.avg_rating||0).toFixed(1)}★ (${Number(v.review_count||0)} reviews)`).join("; ")}.`};
    }catch(_){}
  }

  // Sector counts/lists are resolved against the live sector/vendor tables.
  const countMatch=q.match(/(?:how many|number of)\s+vendors?\s+(?:are\s+)?(?:in|under|within)\s+(?:the\s+)?(.+)$/);
  if(countMatch){
    const sectorName=countMatch[1].replace(/[?.!]+$/g,"").trim();
    try{
      const [{data:sectorsData},{data:vendorsData}]=await Promise.all([
        sb.from("sectors").select("id,name"),
        sb.from("vendors").select("sector_id").eq("verification_status","verified").eq("is_active",true)
      ]);
      const sec=(sectorsData||[]).find(x=>normalize(x.name)===normalize(sectorName)||normalize(x.name).includes(normalize(sectorName)));
      if(sec){const n=(vendorsData||[]).filter(v=>String(v.sector_id)===String(sec.id)).length;return {handled:true,reply:`There are ${n} verified active vendor${n===1?"":"s"} in the ${sec.name} sector.`};}
    }catch(_){}
  }

  if(vendorRequest && /\b(list|show|all)\b/.test(q) && /\b(in|under)\b/.test(q)){
    const sectorName=q.split(/\b(?:in|under)\b/).pop().replace(/[?.!]+$/g,"").trim();
    try{
      const {data:sectorsData}=await sb.from("sectors").select("id,name");
      const sec=(sectorsData||[]).find(x=>normalize(x.name)===normalize(sectorName)||normalize(x.name).includes(normalize(sectorName)));
      if(sec){
        const {data}=await sb.from("vendors").select("business_name,city,avg_rating,review_count").eq("sector_id",sec.id).eq("verification_status","verified").eq("is_active",true).order("avg_rating",{ascending:false}).limit(30);
        const rows=data||[]; return {handled:true,reply:rows.length?`Vendors in ${sec.name}: ${rows.map(v=>`${v.business_name} (${Number(v.avg_rating||0).toFixed(1)}★)`).join(", ")}.`:`There are no verified active vendors in ${sec.name} yet.`};
      }
    }catch(_){}
  }

  if(/\b(latest|newest|most recent)\b/.test(q) && /\b(product|listing|item)\b/.test(q)){
    try{
      const {data}=await sb.from("products").select("id,name,created_at,vendor:vendors!inner(id,business_name,verification_status,is_active)").eq("status","active").eq("vendor.verification_status","verified").eq("vendor.is_active",true).order("created_at",{ascending:false}).limit(5);
      const rows=data||[]; if(rows.length) return {handled:true,reply:`The latest listings are: ${rows.map((p,i)=>`${i+1}. ${p.name} from ${p.vendor?.business_name||"a vendor"}`).join("; ")}.`};
    }catch(_){}
  }
  return null;
}

async function resolveLeviVendorInsights(text) {
  if (!session?.user?.id || profile?.role !== "vendor") return null;
  const q = leviNormaliseText(text);
  const asksStore = /\b(my|our|the)\b.*\b(shop|store|storefront|listings?|products?|sales|revenue|performance)\b/.test(q) || /\b(shop|store|storefront)\b.*\b(doing|performance|sales|marketing|grow|growth)\b/.test(q);
  const asksPerformance = /\b(how is|how's|doing|performance|performing|sales|sell|sells|selling|revenue|views|saves|best|worst|poorly|strong|weak)\b/.test(q);
  const asksAdvice = /\b(improve|increase|boost|grow|growth|marketing|promote|promotion|sell more|what should i sell|what should i add|add next|next product|products should i add|complementary|cross[- ]sell|bundle|bundles|similar products|listing improvement|improve my listing|pricing)\b/.test(q);
  if (!asksStore && !asksPerformance && !asksAdvice) return null;
  const v = vendor || (await sb.from("vendors").select("id,business_name").eq("user_id",session.user.id).is("deleted_at",null).maybeSingle()).data;
  if (!v?.id) return null;
  try {
    const [{data:products},{data:orderItems},{data:stats}] = await Promise.all([
      sb.from("products").select("id,name,status,view_count,quantity_available,quantity_total,sale_price,discount_price,rental_rate,listing_type,is_service,category:categories(name)").eq("vendor_id",v.id).neq("status","removed").order("created_at",{ascending:false}),
      sb.from("order_items").select("product_id,quantity,unit_price,order:orders!inner(status,vendor_id)").eq("order.vendor_id",v.id),
      sb.rpc("get_vendor_stats",{p_vendor_id:v.id})
    ]);
    const rows=products||[];
    const {data:favRows}=rows.length ? await sb.rpc("get_favorite_counts",{p_product_ids:rows.map(p=>p.id)}) : {data:[]};
    if(!rows.length)return {handled:true,reply:`Your shop is set up, but you don't have any listings yet. Adding your first complete listing is the clearest next growth step.`};
    const fav={};(favRows||[]).forEach(r=>fav[r.product_id]=Number(r.count||0));const perf={};rows.forEach(p=>perf[p.id]={units:0,revenue:0});
    (orderItems||[]).forEach(oi=>{if(oi.order?.status!=="completed"||!perf[oi.product_id])return;perf[oi.product_id].units+=Number(oi.quantity||0);perf[oi.product_id].revenue+=Number(oi.quantity||0)*Number(oi.unit_price||0);});
    const views=rows.reduce((n,p)=>n+Number(p.view_count||0),0),saves=rows.reduce((n,p)=>n+Number(fav[p.id]||0),0),sales=Object.values(perf).reduce((n,p)=>n+p.units,0),revenue=Object.values(perf).reduce((n,p)=>n+p.revenue,0),active=rows.filter(p=>p.status==="active").length;
    if(/\b(?:what|which)\b.*\b(?:sells?|sold|selling|best|top)\b/.test(q)||/\b(best|top)\b.*\bproduct/.test(q)){const sorted=rows.slice().sort((a,b)=>perf[b.id].units-perf[a.id].units||perf[b.id].revenue-perf[a.id].revenue||Number(b.view_count||0)-Number(a.view_count||0));const top=sorted[0];if(perf[top.id].units>0)return {handled:true,reply:`Your strongest seller by completed units is ${top.name} with ${perf[top.id].units} sale${perf[top.id].units===1?"":"s"} and ${naira(perf[top.id].revenue)} in completed-item revenue. That's a known result from your order data.`};const e=rows.slice().sort((a,b)=>Number(b.view_count||0)-Number(a.view_count||0)||Number(fav[b.id]||0)-Number(fav[a.id]||0));return {handled:true,reply:`You don't have a completed sale yet, so I can't call a best seller. ${e[0].name} currently has the strongest visible engagement (${Number(e[0].view_count||0)} views, ${Number(fav[e[0].id]||0)} saves), so it's the best current signal to test from.`};}
    if(/\b(?:poorly|worst|weak|not selling|isn't selling|isnt selling|underperform|under-performing)\b/.test(q)){const sorted=rows.slice().sort((a,b)=>perf[a.id].units-perf[b.id].units||Number(a.view_count||0)-Number(b.view_count||0)||Number(fav[a.id]||0)-Number(fav[b.id]||0));const p=sorted[0];return {handled:true,reply:`The clearest weak signal is ${p.name} (${perf[p.id].units} completed sales, ${Number(p.view_count||0)} views, ${Number(fav[p.id]||0)} saves). ${perf[p.id].units===0?"It has no completed sales yet, so test its title, photos, description and price before concluding demand is poor.":"Its completed sales trail your other listings, so improving its positioning or testing a different price is worth trying."}`};}
    if(/\b(?:how is|how's)\b.*\b(?:shop|store)\b|\bhow.*\b(?:doing|performance)\b/.test(q)){const st=stats?.[0]||{};return {handled:true,reply:`Here’s the data I can see for ${v.business_name||"your shop"}: ${active} active listing${active===1?"":"s"}, ${views} product views, ${saves} saves, ${sales} completed units sold and ${naira(revenue)} completed-item revenue. ${st.sales_count!=null?`Vendor stats also report ${Number(st.sales_count||0)} completed sales. `:""}${sales>0?"Focus next on the listings already converting and improve listings with views but few saves or sales.":"You don't have enough completed sales yet to judge product-market fit; focus first on listing quality and qualified traffic."}`};}
    if(/\b(?:what should i sell|what should i add|add next|next product|products should i add|similar products|complementary|cross[- ]sell|bundle)\b/.test(q)){const lead=rows.slice().sort((a,b)=>perf[b.id].units-perf[a.id].units||Number(b.view_count||0)-Number(a.view_count||0))[0],base=lead?.category?.name||"your current categories";return {handled:true,reply:`Based on your current catalogue, ${base} is a sensible area to extend. ${lead?.name?`${lead.name} is your current lead listing by the available sales/engagement signals. `:""}Worth testing a complementary product, a bundle with related listings, or another product in a category where you already have buyer interest. These are recommendations, not guarantees.`};}
    if(asksAdvice){const p=rows.filter(p=>Number(p.view_count||0)>0&&Number(fav[p.id]||0)===0).sort((a,b)=>Number(b.view_count||0)-Number(a.view_count||0))[0];return {handled:true,reply:`For ${v.business_name||"your shop"}, use the data as the guide: ${p?`${p.name} has ${Number(p.view_count||0)} views but no saves, so its photo, title, description and price are worth testing.`:"promote listings that already show sales or strong engagement."} Also test complementary bundles and keep stock on stronger sellers. These are recommendations, not guarantees.`};}
    if(/\b(?:what products|which products)\b.*\b(?:do i have|in my shop|in my store|listed)\b/.test(q))return {handled:true,reply:`Your current listings are: ${rows.slice(0,12).map((p,i)=>`${i+1}. ${p.name}${p.category?.name?` · ${p.category.name}`:""}${p.status!=="active"?` · ${p.status}`:""}`).join("; ")}.`};
  }catch(e){console.warn("Levi vendor insights failed:",e)}
  return null;
}

async function resolveLeviLocalAction(text) {
  const q = leviNormaliseText(text);
  if (leviPendingProductRequest && /^(no|nope|not that|not this|that'?s not it|none|neither|wrong|different|something else|not what i want|i don'?t want that|i need something else)\b/.test(q)) {
    const target=leviPendingProductRequest; leviPendingProductRequest=null;
    return {handled:true,reply:`No problem, [[NAV:requestEquipment|prefill=${encodeURIComponent(target)}]]`};
  }
  if (!session) return null;

  const catalogueAnswer=await resolveLeviCatalogueRequest(text);
  if(catalogueAnswer?.handled)return catalogueAnswer;
  const vendorInsight = await resolveLeviVendorInsights(text);
  if (vendorInsight?.handled) return vendorInsight;

  // Deterministic navigation. Levi describes the destination and exposes a
  // single "Take me there" action. The action performs the actual SPA route
  // and collapses the expanded assistant after the user taps it.
  const directRoutes = [
    [/^(open|show|take me to|go to|view)\s+(my\s+)?cart$/, {view:"cart"}],
    [/^(open|show|take me to|go to|view)\s+(my\s+)?shop$/, {view:"vendorDashboard"}],
    [/^(open|show|take me to|go to|view)\s+(my\s+)?products?$/, {view:"vendorProducts"}],
    [/^(open|show|take me to|go to|view)\s+(settings|app settings|my settings|account settings)$/, {view:"settings"}],
    [/^(where (?:can|do) i (?:find|change|manage)|how (?:do|can) i (?:change|manage)|i want to (?:change|edit|update)|take me to|open|show)\s+(?:my\s+)?(?:app\s+)?(?:settings?|preferences?|configuration|notifications? settings?|privacy settings?|account settings?).*$/, {view:"settings"}],
    [/^(open|show|take me to|go to|view)\s+(my\s+)?profile$/, {view:"profile"}],
    [/^(open|show|take me to|go to|view)\s+(my\s+)?messages?$/, {view:"messages"}],
    [/^(open|show|take me to|go to|view)\s+(my\s+)?wishlist$/, {view:"wishlist"}],
    [/^(open|show|take me to|go to|view)\s+vendors?$/, {view:"vendors"}],
  ];
  if (/^(open|show|take me to|go to|view)\s+(my\s+)?orders?$/.test(q)) {
    return { handled:true, reply: vendor
      ? "Sure, [[NAV:vendorOrders|status=all|type=all|payment=all|perspective=sales]]"
      : "Sure, [[NAV:buyerOrders]]" };
  }
  if (vendor && /^(open|show|take me to|go to|view)\s+(my\s+)?shop$/.test(q)) {
    return { handled:true, reply:"Sure, [[NAV:vendorDashboard]]" };
  }
  if (vendor && /^(open|show|take me to|go to|view)\s+(edit\s+business\s+profile|business\s+profile)$/.test(q)) {
    return { handled:true, reply:"Sure, [[NAV:vendorEditProfile]]" };
  }
  for (const [re, nav] of directRoutes) {
    if (re.test(q)) return { handled:true, reply:`Sure, [[NAV:${nav.view}]]` };
  }

  const agentIntentRoutes = [
    [/\bopen\s+(?:the\s+)?marketplace\b|\bgo\s+home\b/, ["home", ""]],
    [/\b(?:book|find)\s+(?:a\s+)?service\b|\bshow\s+services\b/, ["home", "services"]],
    [/\b(?:browse|shop)\s+(?:for\s+)?products?\b|\bshop\s+products?\b/, ["home", "products"]],
    [/\b(?:browse|show)\s+packages?\b|\bshop\s+packages?\b/, ["home", "packages"]],
    [/\b(?:request|post)\s+(?:an?\s+)?item\b|\bneed\s+to\s+request\b/, ["requestEquipment", ""]],
    [/\b(?:chat|message)\s+(?:directly|a\s+vendor|someone)\b|\bopen\s+(?:my\s+)?messages?\b/, ["messages", ""]],
    [/\b(?:find|show|explore)\s+(?:verified\s+)?vendors?\b|\bopen\s+(?:the\s+)?vendor\s+(?:map|directory)\b/, ["vendors", ""]],
  ];
  for (const [re, target] of agentIntentRoutes) {
    if (re.test(q)) {
      return {handled:true, reply: target[1] ? `Done, [[NAV:${target[0]}|section=${target[1]}]]` : `Done, [[NAV:${target[0]}]]`};
    }
  }

  const catalogRouteMap = [
    [/(browse everything|browse all|open products|show products|go to products|take me to products)/, "home", "products"],
    [/(open services|show services|go to services|take me to services)/, "home", "services"],
    [/(open packages|show packages|go to packages|take me to packages)/, "home", "packages"],
    [/(open request|show request|go to request|take me to request|request an item)/, "requestEquipment", ""],
    [/(open support|show support|go to support|take me to support)/, "supportRequest", ""],
  ];
  for (const [re, view, section] of catalogRouteMap) {
    if (re.test(q)) return { handled:true, reply: section ? `Sure, [[NAV:${view}|section=${section}]]` : `Sure, [[NAV:${view}]]` };
  }

  // Named vendor/store/shop requests are resolved locally too. This keeps
  // obvious destinations deterministic even when the AI backend is slow.
  // A plain "take me to Campus Cravings" (just the business name, no
  // "vendor"/"shop"/"store" descriptor word) used to fail this check
  // entirely and fall through to product search instead of navigating --
  // try resolving the phrase as a vendor name regardless of wording, and
  // only fall through to product search when nothing matches.
  const vendorMatch = q.match(/^(?:take|open|show|go to|find|visit)\s+(?:me\s+)?(?:to\s+)?(?:the\s+)?(.+?)(?:\s+(?:vendor|store|shop|seller))?$/);
  if (vendorMatch) {
    const vendorTarget = vendorMatch[1].trim();
    if (vendorTarget.length >= 2) {
      const vr = await resolveLeviVendor(vendorTarget);
      if (vr.vendor) {
        return { handled:true, reply:`I found ${vr.vendor.business_name}. I’m taking you to their shop now. [[NAV:storefront|vendorId=${vr.vendor.id}]]` };
      }
      if (vr.matches?.length > 1) {
        return { handled:true, reply:`I found a few matches, which vendor do you mean: ${vr.matches.map(v=>v.business_name).join(", ")}?` };
      }
    }
  }

  // Fast live discovery handles concepts that are bigger than one product:
  // nearest vendors, rating lists, sector counts, latest listings, etc.
  const quickDiscovery = await resolveLeviQuickDiscovery(text);
  if (quickDiscovery?.handled) return quickDiscovery;

  // A short standalone search such as "Penne", "sleeves", or "ECG machine"
  // is still an actionable request. Resolve it directly instead of forcing
  // the user to phrase it as "I need ...".
  if (q.length >= 2 && q.length <= 60 && !/^(hi|hello|hey|thanks|thank you|okay|ok|yes|no|help|settings|cart|orders?|vendors?)$/.test(q)) {
    const result = await resolveLeviProduct(q);
    if (result.product && (result.exact || (result.matches || []).length === 1)) {
      return { handled:true, reply:`I found ${result.product.name}${result.product.vendor?.business_name ? ` from ${result.product.vendor.business_name}` : ""}. I’m taking you there now. [[NAV:productDetail|productId=${result.product.id}]]` };
    }
  }

  // Deterministic "I need/want X" -> find it and take the person straight
  // there. This is intentionally a local DB lookup, not a call to the AI
  // model -- so "I need shoe" behaves the same and just as fast whether the
  // Gemini-backed /api/chat is up, slow, or unreachable. If nothing in the
  // marketplace matches at all, send them to post a request instead of
  // leaving them with a dead end.
  const needMatch =
    q.match(/^(?:take|open|show|find|go to)\s+(?:me\s+)?(?:to\s+)?(?:a\s+|an\s+|some\s+)?(.+)$/) ||
    q.match(/^(?:i\s*(?:really\s+)?)?(?:need|want|require)(?:\s+to\s+(?:buy|rent|get|find))?\s+(?:a\s+|an\s+|some\s+)?(.+)$/) ||
    q.match(/\b(?:looking|searching)\s+for\s+(?:a\s+|an\s+|some\s+)?(.+)$/) ||
    q.match(/\bdo you (?:have|sell)\s+(?:a\s+|an\s+|any\s+)?(.+?)\??$/) ||
    q.match(/\bwhere (?:can|do) i (?:get|find|buy|rent)\s+(?:a\s+|an\s+)?(.+?)\??$/) ||
    q.match(/^(?:find|get)\s+me\s+(?:a\s+|an\s+|some\s+)?(.+)$/);
  if (needMatch) {
    const target = (needMatch[1] || "").trim().replace(/[?!.]+$/, "");
    // Guard against phrasing that shares this shape but isn't a product
    // ask ("I need to open my cart", "I need help") -- those either match
    // a more specific branch above already, or aren't a product at all.
    const nonProduct = /^(to|help|assistance|advice|someone|somebody|a hand|a favou?r)\b/;
    if (target.length >= 2 && target.length <= 60 && !nonProduct.test(target)) {
      const result = await resolveLeviProduct(target);
      if (result.product && (result.exact || (result.matches || []).length === 1)) {
        return { handled:true, reply:`I found ${result.product.name}${result.product.vendor?.business_name ? ` from ${result.product.vendor.business_name}` : ""}. [[NAV:productDetail|productId=${result.product.id}]]` };
      }
      if ((result.matches || []).length > 1) {
        const suggestions = await resolveLeviProductSuggestions(target);
        leviPendingProductRequest = null;
        return { handled:true, reply:`I found several real matches for "${target}". Here are the closest ones so you can choose the right listing. ${leviProductSuggestionTag(suggestions.length ? suggestions : result.matches.slice(0,6))}` };
      }
      const suggestions=await resolveLeviProductSuggestions(target);
      if (!suggestions.length) {
        leviPendingProductRequest=null;
        closeLeviIfOpen();
        await navigate("requestEquipment", {}, true);
        setTimeout(() => {
          const el=byId("reqTitle");
          if(el && !el.value) el.value=target.charAt(0).toUpperCase()+target.slice(1);
        }, 120);
        return {handled:true, reply:`I couldn't find ${target} in the marketplace, so I've opened the request page for you. Tell Levromart exactly what you need and we'll take it from there.`};
      }
      leviPendingProductRequest=target;
      return {handled:true, reply:`I couldn't find an exact match for "${target}", but I found some related listings that may work. ${leviProductSuggestionTag(suggestions)}`};
    }
  }



  // Fast order-history questions: answer from the signed-in user's own
  // orders without waiting for the model. Supports phrases such as
  // "what was my last order?" and "what was my 7th cancelled order?".
  if (/\b(?:last|latest|most recent|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\b/.test(q) && /\border\b/.test(q) && /\b(?:what|which|who|show|tell)\b/.test(q)) {
    const ordinalWords={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10};
    const om=q.match(/\b(\d+)(?:st|nd|rd|th)\b/);
    const word=q.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
    const ordinal=om?Number(om[1]):word?ordinalWords[word[1]]:1;
    const wantCancelled=/\b(?:cancelled|canceled|cancel)\b/.test(q);
    const wantPending=/\b(?:pending|awaiting)\b/.test(q);
    try {
      let oq=sb.from("orders").select("id,status,order_type,total_amount,created_at,vendor:vendors(id,business_name),items:order_items(quantity,unit_price,product:products(name))").eq("buyer_id",session.user.id).order("created_at",{ascending:false}).limit(50);
      const {data}=await oq;
      let rows=data||[];
      if(wantCancelled) rows=rows.filter(o=>/cancel/i.test(String(o.status||"")));
      if(wantPending) rows=rows.filter(o=>/pending|confirmed/i.test(String(o.status||"")));
      const order=rows[ordinal-1];
      if(!order) return {handled:true,reply:`I couldn't find a ${ordinal}${ordinal===1?"st":ordinal===2?"nd":ordinal===3?"rd":"th"} matching order in your history.`};
      const itemNames=(order.items||[]).map(i=>`${Number(i.quantity||1)}× ${i.product?.name||"item"}`).join(", ")||"No item details";
      const vendorName=order.vendor?.business_name||"a vendor";
      const when=order.created_at?new Date(order.created_at).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"}):"";
      return {handled:true,reply:`Your ${ordinal===1?"latest":`${ordinal}${ordinal===2?"nd":ordinal===3?"rd":"th"}`} ${wantCancelled?"cancelled ":""}order was with ${vendorName}: ${itemNames}. Total: ${naira(order.total_amount||0)}${when?` · ${when}`:""}.`};
    } catch (_) {}
  }

  // Levromart uses one fixed brand green. Keep old accent-change commands
  // harmless and explicit instead of opening a retired palette UI.
  if (/\b(accent|theme colour|theme color)\b/.test(q) && /\b(change|set|switch|make|choose|use)\b/.test(q)) {
    return { handled:true, reply:"Levromart now uses one consistent brand green across the app, so there are no separate accent colours to switch between." };
  }

  // Vendor product management: Levi opens the existing product manager for
  // additions and uses the existing guarded removal function for deletions.
  if (vendor && /\b(add|create|list)\b[\s\S]*\b(product|item)\b/.test(q)) {
    closeLeviIfOpen(); await navigate("vendorProducts");
    setTimeout(() => openAddProductModal(), 80);
    return { handled:true, reply:"Done - I opened your product manager. Add the product details and save it." };
  }
  if (vendor && /\b(pause|disable|deactivate|close)\b[\s\S]*\b(my\s+)?(shop|store|vendor|storefront)\b/.test(q)) {
    const ok=await showConfirmDialog("Pause your storefront? Buyers will no longer see it as an active vendor until you reactivate it.",{title:"Pause storefront",okLabel:"Pause storefront",danger:true});
    if(!ok)return {handled:true,reply:"Okay - I left your storefront active."};
    await toggleVendorActive(true); closeLeviIfOpen(); return {handled:true,reply:"Done - I paused your storefront."};
  }
  if (vendor && /\b(resume|reactivate|enable|open)\b[\s\S]*\b(my\s+)?(shop|store|vendor|storefront)\b/.test(q)) {
    await toggleVendorActive(false); closeLeviIfOpen(); return {handled:true,reply:"Done - your storefront is active again."};
  }
  if (/\b(remove|delete)\b[\s\S]*\b(my\s+)?(profile\s+)?(picture|photo|avatar)\b/.test(q)) {
    await removeProfileAvatar(); closeLeviIfOpen(); return {handled:true,reply:"Okay - I handled the profile picture removal request."};
  }
  if (vendor && /\b(change|update|edit|set)\b[\s\S]*\b(working|business|opening)\s*hours?\b/.test(q)) {
    closeLeviIfOpen(); await navigate("vendorEditProfile"); setTimeout(()=>document.querySelector("#veHoursRows")?.scrollIntoView({behavior:"smooth",block:"center"}),80); return {handled:true,reply:"Done - I opened your working hours so you can adjust the schedule."};
  }

  if (vendor && /\b(remove|delete|take down)\b[\s\S]*\b(product|item|listing)\b/.test(q)) {
    const target = q.replace(/\b(please|levi|can you|could you|remove|delete|take down|the|product|item|listing|from|my|shop|store)\b/g, " ").replace(/\s+/g," ").trim();
    if (!target) return { handled:true, reply:"Tell me the product name you want removed, and I'll handle it." };
    const { data: products } = await sb.from("products").select("id,name,status,quantity_available,vendor_id").eq("vendor_id", vendor.id).ilike("name", `%${target}%`).limit(8);
    const matches = products || [];
    if (!matches.length) return { handled:true, reply:`I couldn't find a product matching “${target}” in your shop.` };
    if (matches.length > 1) return { handled:true, reply:`I found several matches: ${matches.map(p=>p.name).join(", ")}. Tell me which one to remove.` };
    await removeProduct(matches[0].id);
    return { handled:true, reply:`I handled the removal request for ${matches[0].name}.` };
  }
  if (/\b(light|light mode|bright mode)\b/.test(q) && !/\bnot\b/.test(q)) {
    setTheme("light"); return { handled:true, reply:"Done - I switched Levromart to light mode." };
  }
  if (/\b(dark|dark mode)\b/.test(q) && !/\bnot\b/.test(q)) {
    setTheme("dark"); return { handled:true, reply:"Done - I switched Levromart to dark mode." };
  }
  if (/\b(deep black|black mode|oled mode)\b/.test(q)) {
    setTheme("black"); return { handled:true, reply:"Done - I switched Levromart to deep black." };
  }
  if (/\b(change|update|edit|set)\s+(my\s+)?(profile\s+)?name\b/.test(q)) {
    const rawText=String(text||"").trim();
    const m=rawText.match(/\b(?:to|as)\s+(.+)$/i);
    const name=(m?.[1]||"").replace(/\b(please|levi)\b/gi," ").trim();
    if(name.length>=2&&name.length<=80){
      const {error}=await sb.from("users").update({name}).eq("id",session.user.id);
      if(!error){profile.name=name;updateAuthUI();return {handled:true,reply:`Done - I changed your profile name to ${name}.`};}
      return {handled:true,reply:"I couldn't update your name right now. Please try again."};
    }
    closeLeviIfOpen(); await navigate("editProfile"); return {handled:true,reply:"Open My details and enter the name you want me to use."};
  }
  if (/\b(change|update|edit|set)\b[\s\S]*\b(profile picture|profile photo|avatar)\b/.test(q)) {
    const input=byId("avatarFileInput");
    if(input){ input.click(); return {handled:true,reply:"Sure - choose the photo you want. I’ll open the crop tool so you can position exactly what people see."}; }
    return {handled:true,reply:"I can change your profile picture, but the profile photo picker isn't available on this screen."};
  }
  const vendorMapTarget = q.match(/\b(?:show|take me to|open)\b[\s\S]*\bmap\b[\s\S]*\b(?:for|of|at)\s+(.+)$/);
  if (vendorMapTarget) {
    const vr = await resolveLeviVendor(vendorMapTarget[1]);
    closeLeviIfOpen();
    await navigate("vendors", {}, true);
    setTimeout(() => { try { switchVendorsView("map"); } catch (_) {} }, 80);
    return {handled:true,reply:vr.vendor ? `I found ${vr.vendor.business_name}. I’m opening their location on the map. [[NAV:vendors|map=true|vendorId=${vr.vendor.id}]]` : "I opened the vendor map. I couldn't match that vendor by name yet."};
  }
  if (/\b(take me to|open|show|go to)\s+(the\s+)?map\b/.test(q)) {
    closeLeviIfOpen(); await navigate("vendors"); setTimeout(()=>switchVendorsView("map"),80); return {handled:true,reply:"Done - I opened the vendor map."};
  }
  if (/\b(mark|clear|read)\b[\s\S]*\bnotifications?\b/.test(q)) {
    closeLeviIfOpen(); toggleNotifPanel(); return {handled:true,reply:"Done - I opened your notifications so you can manage them."};
  }
  if (/\b(clear|empty|remove|delete|wipe|clean)\b[\s\S]*\b(all|everything|every|entire|whole)\b[\s\S]*\b(my\s+)?cart\b/.test(q)
      || /\b(clear|empty|remove|delete|wipe|clean)\b[\s\S]*\b(my\s+)?cart\b/.test(q)
      || /\b(take|remove|delete|clear|empty)\b[\s\S]*\beverything\b[\s\S]*\b(?:from|out of|in)\b[\s\S]*\bcart\b/.test(q)) {
    const {data:rows,error}=await sb.from("cart_items").select("id").eq("buyer_id",session.user.id);
    if(error)return {handled:true,reply:"I couldn't load your cart right now."};
    if(!rows?.length){closeLeviIfOpen();return {handled:true,reply:"Your cart is already empty."};}
    if(!(await showConfirmDialog(`Remove all ${rows.length} item${rows.length===1?"":"s"} from your cart?`,{title:"Clear cart",okLabel:"Clear cart",danger:true}))) return {handled:true,reply:"Okay - I left your cart unchanged."};
    const {error:delErr}=await levroData.cart.clear(session.user.id);
    if(delErr)return {handled:true,reply:"I couldn't clear your cart right now."};
    updateCartFab();
    await refreshNotifications(false).catch(() => {});
    closeLeviIfOpen();
    await navigate("cart", {}, false).catch(() => {});
    return {handled:true,reply:`Done - I cleared all ${rows.length} item${rows.length===1?"":"s"} from your cart.`};
  }
  const addIntent = /\b(add|put|place)\b[\s\S]*\b(cart|basket)\b/.test(q) || /\b(add|put|place)\b.*\b(this|that)\b/.test(q);
  const removeIntent = /\b(remove|delete|take)\b[\s\S]*\bcart\b/.test(q);
  const wishIntent = /\b(save|add|put)\b[\s\S]*\b(wishlist|wish list)\b/.test(q) || /\b(favourite|favorite|wishlist)\b/.test(q);
  if (!addIntent && !removeIntent && !wishIntent) return null;

  let mode = addIntent ? "add" : removeIntent ? "remove" : "wishlist";
  let target = mode === "wishlist" ? q.replace(/\b(save|add|put|to|my|the|wishlist|wish|list|please|levi)\b/g, " ").trim()
                                   : leviExtractCartTarget(q, mode === "remove" ? "remove" : "add");
  target = target.replace(/\s{2,}/g, " ").trim();

  const numberWords = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20
  };
  const parseQuantityPrefix = (segment) => {
    const raw = String(segment || "").trim();
    const numeric = raw.match(/^(\d+)\s*(?:x|of)?\s*(.+)$/i);
    if (numeric) return { quantity: Math.max(1, Math.min(20, parseInt(numeric[1],10))), part: numeric[2].trim() };
    const words = raw.match(/^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:x|of)?\s*(.+)$/i);
    if (words) return { quantity: numberWords[words[1].toLowerCase()] ?? 1, part: words[2].trim() };
    return { quantity: 1, part: raw };
  };

  // Support per-item quantities such as "4 shoes and 1 sleeve". Quantities
  // are attached to their own segment instead of being reused for every item.
  const rawParts = /\s+and\s+|,/.test(target)
    ? target.split(/\s+and\s+|,/).map(s => s.trim()).filter(Boolean)
    : [target];
  const parts = rawParts.map(parseQuantityPrefix);

  const results = [];

  // Fast path for removals: use the customer's actual cart as the source of truth
  // and match names locally. This avoids an extra search RPC + products query,
  // which was the main reason "remove X from my cart" could feel slow.
  if (mode === "remove") {
    const { data: cartRows, error: cartErr } = await sb.from("cart_items")
      .select("id,product_id,product:products(id,name,listing_type,sale_price,rental_rate,quantity_available,status,is_service,vendor:vendors(business_name))")
      .eq("buyer_id", session.user.id);
    if (!cartErr) {
      const cart = cartRows || [];
      for (const partInfo of parts.slice(0, 5)) {
        const part = partInfo.part;
        const needle = leviNormaliseText(part);
        const matches = cart.filter((row) => {
          const name = leviNormaliseText(row.product?.name || "");
          return name === needle || name.includes(needle) || needle.includes(name);
        });
        if (!matches.length) { results.push({ part, error: "not-found" }); continue; }
        if (matches.length > 1) { results.push({ part, error: "ambiguous", matches: matches.map(r => r.product).filter(Boolean) }); continue; }
        const row = matches[0];
        const product = row.product;
        const currentQty = Math.max(1, Number(row.quantity || 1));
        const requestedQty = Math.max(1, Number(partInfo.quantity || 1));
        if (requestedQty < currentQty) {
          const upd = await sb.from("cart_items").update({quantity: currentQty-requestedQty}).eq("id", row.id).eq("buyer_id", session.user.id);
          results.push({ product, removedQuantity: requestedQty, remainingQuantity: currentQty-requestedQty, error: upd.error ? "failed" : null });
        } else {
          const del = await sb.from("cart_items").delete().eq("id", row.id).eq("buyer_id", session.user.id);
          results.push({ product, removedQuantity: currentQty, remainingQuantity: 0, error: del.error ? "failed" : null });
        }
      }
      refreshNotifications(); updateCartFab();
      const ok = results.filter(r => !r.error);
      const failed = results.filter(r => r.error === "failed");
      const missing = results.filter(r => r.error === "not-found");
      if (results.some(r => r.error === "ambiguous")) {
        const names = results.filter(r => r.error === "ambiguous").flatMap(r => r.matches || []).map(p => p?.name).filter(Boolean).slice(0, 6);
        return { handled: true, reply: `I found more than one cart match: ${names.join(", ")}. Tell me which one you mean.` };
      }
      if (ok.length) {
        closeLeviAfterCartAction();
        updateCartFab();
      }
      return { handled: true, reply: [
        ok.length ? `Done - I removed ${ok.map(r => r.product.name).join(", ")} from your cart.` : "",
        failed.length ? `I couldn't remove ${failed.map(r => r.product.name).join(", ")} right now.` : "",
        missing.length ? `I couldn't find ${missing.map(r => `“${r.part}”`).join(", ")} in your cart.` : "",
      ].filter(Boolean).join(" ") || "I couldn't find that item in your cart." };
    }
  }

  for (const partInfo of parts.slice(0, 5)) {
    const part = partInfo.part;
    const requestedQuantity = mode === "add" ? partInfo.quantity : 1;
    const resolved = await resolveLeviProduct(part);
    if (!resolved.product) { results.push({ part, error: "not-found" }); continue; }

    if (resolved.matches?.length > 1 && !resolved.exact) {
      results.push({ part, error: "ambiguous", matches: resolved.matches.slice(0,4) }); continue;
    }

    const product = resolved.product;
    if (mode === "add") {
      if (Number(product.quantity_available ?? 1) < 1) { results.push({ product, error: "out-of-stock" }); continue; }
      const error = await addCartWithFallback(product.id, requestedQuantity);
      results.push({ product, quantity: requestedQuantity, error: error ? "failed" : null });
    } else if (mode === "remove") {
      const { error } = await sb.from("cart_items").delete()
        .eq("buyer_id", session.user.id).eq("product_id", product.id);
      results.push({ product, error: error ? "failed" : null });
    } else {
      const { error } = favoriteIds.has(product.id)
        ? { error: null }
        : await levroData.favorites.addProduct(session.user.id, product.id);
      if (!error) favoriteIds.add(product.id);
      results.push({ product, error: error ? "failed" : null });
    }
  }

  if (results.some(r => r.error === "ambiguous")) {
    const names = results.filter(r => r.error === "ambiguous").flatMap(r => r.matches || []).map(p => p.name).slice(0,6);
    return { handled: true, reply: `I found more than one match: ${names.join(", ")}. Tell me which one you mean.` };
  }

  const ok = results.filter(r => !r.error);
  const failed = results.filter(r => r.error && r.error !== "out-of-stock" && r.error !== "not-found");
  const missing = results.filter(r => r.error === "not-found");
  const empty = results.filter(r => r.error === "out-of-stock");

  refreshNotifications(); updateCartFab();

  if (mode === "add") {
    const lines = [];
    if (ok.length) lines.push(`Done - I added ${ok.map(r => `${r.quantity > 1 ? `${r.quantity} × ` : ""}${r.product.name}`).join(", ")} to your cart.`);
    if (empty.length) lines.push(`${empty.map(r => r.product.name).join(", ")} ${empty.length === 1 ? "is" : "are"} out of stock.`);
    if (failed.length) lines.push(`I couldn't add ${failed.map(r => r.product.name).join(", ")} right now.`);
    if (missing.length) lines.push(`I couldn't find ${missing.map(r => `“${r.part}”`).join(", ")}.`);
    if (ok.length) {
      closeLeviAfterCartAction();
      updateCartFab();
      // Stay on the current screen; the cart badge is refreshed immediately.
    }
    return { handled: true, reply: lines.join(" ") || "Tell me the product name, or open the product and say “add this to my cart”." };
  }
  if (mode === "remove") {
    if (ok.length) {
      closeLeviAfterCartAction();
      updateCartFab();
    }
    return { handled: true, reply: ok.length ? `Done - I removed ${ok.map(r => r.product.name).join(", ")} from your cart.` : "I couldn't find that item in your cart." };
  }
  return { handled: true, reply: ok.length ? `Done - ${ok.map(r => r.product.name).join(", ")} ${ok.length === 1 ? "is" : "are"} on your wishlist.` : "I couldn't save that item right now." };
}


// Draggable floating action button - tap to fire onTap, drag to reposition
// (and it remembers where you leave it). Shared by the Levi FAB and the
// cart FAB, which each just pass their own element/storage key/tap action.
function resetFloatingFabPositions(target = "all") {
  const resetOne = (fab, storageKey) => {
    if (!fab) return;
    fab.style.removeProperty("left");
    fab.style.removeProperty("top");
    fab.style.removeProperty("right");
    fab.style.removeProperty("bottom");
    fab.classList.remove("dragging");
    try { localStorage.removeItem(storageKey); } catch (_) {}
  };
  if (target === "levi" || target === "all") resetOne(byId("aiChatFab"), "levromart_ai_fab_pos");
  if (target === "cart" || target === "all") resetOne(byId("cartFab"), "levromart_cart_fab_pos");
}

function setupDraggableFab(fab, storageKey, onTap, onLongPress) {
  if (!fab || fab.dataset.dragControllerReady === "1") return;
  fab.dataset.dragControllerReady = "1";

  const MOVE_THRESHOLD = 6;
  let dragging = false, moved = false, pointerId = null;
  let longTimer = null, longFired = false;
  let bounds = null, lastX = 0, lastY = 0, rafId = 0;
  let startClientX = 0, startClientY = 0, startLeft = 0, startTop = 0;

  function clamp(x, y) {
    const margin = 10;
    // Bounds come from the bars' fixed sizes, not where they happen to be on
    // screen right now, so they hold even while a bar is scrolled out of view.
    const header = document.querySelector("header");
    const headerH = header ? Math.max(header.offsetHeight || 0, header.getBoundingClientRect().bottom || 0) : 0;
    const minY = Math.max(margin, headerH + margin);
    const maxX = Math.max(margin, window.innerWidth - fab.offsetWidth - margin);
    // Keep the button between the top bar and the bottom nav so it can never
    // sit on top of the nav icons (Orders, Notifications, Messages...).
    const nav = document.getElementById("bottomNav");
    let navTop = window.innerHeight;
    if (nav && nav.offsetHeight > 0) {
      const navBottomGap = parseFloat(getComputedStyle(nav).bottom) || 0;
      navTop = window.innerHeight - nav.offsetHeight - navBottomGap;
    }
    const maxY = Math.max(minY, Math.min(window.innerHeight, navTop) - fab.offsetHeight - margin);
    return {
      x: Math.min(Math.max(Number.isFinite(x) ? x : maxX, margin), maxX),
      y: Math.min(Math.max(Number.isFinite(y) ? y : maxY, minY), maxY)
    };
  }

  function applyPosition(x, y, persist = true) {
    const pos = clamp(x, y);
    fab.style.setProperty("left", `${pos.x}px`, "important");
    fab.style.setProperty("top", `${pos.y}px`, "important");
    fab.style.setProperty("right", "auto", "important");
    fab.style.setProperty("bottom", "auto", "important");
    if (persist) {
      try { localStorage.setItem(storageKey, JSON.stringify({ x: pos.x, y: pos.y })); } catch (_) {}
    }
  }

  function restoreSavedPosition() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if(!saved||saved.explicit!==true||!Number.isFinite(Number(saved.x))||!Number.isFinite(Number(saved.y))){localStorage.removeItem(storageKey);return;}
      const x=Number(saved.x),y=Number(saved.y);if(x<8||y<8||x>window.innerWidth-fab.offsetWidth-8||y>window.innerHeight-fab.offsetHeight-8){localStorage.removeItem(storageKey);return;}applyPosition(x,y,false);
    } catch (_) {
      try { localStorage.removeItem(storageKey); } catch (_) {}
    }
  }

  fab.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (fab.classList.contains("hidden")) return;
    dragging = true;
    moved = false;
    longFired = false;
    clearTimeout(longTimer);
    if (onLongPress) {
      longTimer = setTimeout(() => {
        if (dragging && !moved) { longFired = true; try { navigator.vibrate?.(25); } catch (_) {} onLongPress(); }
      }, 650);
    }
    bounds = null;
    pointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    const rect = fab.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    try { fab.setPointerCapture(e.pointerId); } catch (_) {}
  }, { passive: true });

  fab.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (!moved && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      moved = true;
      clearTimeout(longTimer);
      window.__lvDragging = true;                                  // sideways auto-scrolling rows pause while a button is dragged
      try { homeCarouselPause?.(4000); } catch (_) {}
      fab.classList.add("dragging");
    }
    if (!moved) return;
    if (!bounds) bounds = clamp(0, 0) && { minX: 10, maxX: Math.max(10, window.innerWidth - fab.offsetWidth - 10), minY: (function () { const h = document.querySelector("header"); const hh = h ? Math.max(h.offsetHeight || 0, h.getBoundingClientRect().bottom || 0) : 0; return Math.max(10, hh + 10); })(), maxY: (function () { const n = document.getElementById("bottomNav"); let t = window.innerHeight; if (n && n.offsetHeight > 0) t = window.innerHeight - n.offsetHeight - (parseFloat(getComputedStyle(n).bottom) || 0); return Math.max(10, Math.min(window.innerHeight, t) - fab.offsetHeight - 10); })() };
    lastX = Math.min(Math.max(startLeft + dx, bounds.minX), bounds.maxX);
    lastY = Math.min(Math.max(startTop + dy, bounds.minY), Math.max(bounds.minY, bounds.maxY));
    // Dragging moves the button with a compositor-only offset (no layout work per frame, which is what made it crawl on the
    // heavy Home page). Its real left/top are written once, when the finger lifts.
    if (!fab.__lvPinned) {
      fab.__lvPinned = true;
      fab.style.setProperty("left", `${startLeft}px`, "important"); fab.style.setProperty("top", `${startTop}px`, "important");
      fab.style.setProperty("right", "auto", "important"); fab.style.setProperty("bottom", "auto", "important");
      fab.style.willChange = "translate";
    }
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; fab.style.translate = `${lastX - startLeft}px ${lastY - startTop}px`; });
  }, { passive: true });

  function endDrag(e) {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false;
    clearTimeout(longTimer);
    window.__lvDragging = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (fab.__lvPinned) {
      fab.__lvPinned = false;
      fab.style.setProperty("left", `${lastX}px`, "important"); fab.style.setProperty("top", `${lastY}px`, "important");
      fab.style.translate = ""; fab.style.willChange = "";
    }
    fab.classList.remove("dragging");
    if (moved) { try { localStorage.setItem(storageKey, JSON.stringify({ x: lastX, y: lastY, explicit: true })); } catch (_) {} }
    if (!moved && !longFired) onTap?.();
    longFired = false;
    pointerId = null;
  }

  fab.addEventListener("pointerup", endDrag, { passive: true });
  fab.addEventListener("pointercancel", endDrag, { passive: true });

  // Debounced, and only touches the FAB if it's now genuinely out of
  // bounds. The on-screen keyboard opening/closing (e.g. right around
  // closing the chat panel, whose input just had focus) fires a burst of
  // resize events at transient, mid-animation viewport sizes; reacting to
  // every one of those with the viewport's momentarily-wrong height was
  // what made the FAB visibly jump toward a corner on its own.
  let resizeSettleTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = setTimeout(() => {
      if (!fab.isConnected || fab.classList.contains("hidden")) return;
      if (!fab.style.left && !fab.style.top) return;
      // Not currently rendered (e.g. a full-page chat hides it): its rect is
      // all zeros, and clamping that used to fling it to the top-left corner.
      if (!fab.offsetWidth || !fab.offsetHeight || getComputedStyle(fab).display === "none") return;
      const rect = fab.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pos = clamp(rect.left, rect.top);
      if (Math.abs(pos.x - rect.left) > 1 || Math.abs(pos.y - rect.top) > 1) {
        applyPosition(pos.x, pos.y, false);
      }
    }, 200);
  }, { passive: true });

  requestAnimationFrame(restoreSavedPosition);
}

(function setupLeviFab() {
  const fab = byId("aiChatFab");
  if (!fab) return;
  setupDraggableFab(fab, "levromart_ai_fab_pos", () => { toggleAiChat(); }, () => { if (leviVisible) toggleLeviVisible(); });
  applyLeviFabSize();
})();
setupDraggableFab(byId("cartFab"), "levromart_cart_fab_pos", () => { navigate("cart"); });

// Levi's chat panel stays centered; only the FAB itself is draggable.
// Levi chat panel is intentionally NOT draggable. It always opens centered.
try { localStorage.removeItem('levromart_ai_panel_pos'); } catch (_) {}
function closeLeviAfterCartAction(){
  const panel=byId("aiChatPanel");
  if(panel) panel.classList.add("hidden");
  syncLeviFabVisibility();
  updateCartFab();
}

