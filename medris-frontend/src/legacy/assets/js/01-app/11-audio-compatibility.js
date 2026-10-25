
 // ---------- AUDIO COMPATIBILITY ----------
let soundEnabled = true;
let audioCtx = null;
const heardNotifications = new Set();
let notificationSoundUntil = 0;

function unlockNotificationAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new Ctx();
  }

  if (audioCtx.state !== "running") {
    audioCtx.resume().catch(() => {});
  }
}

// Levromart chime: three rising mallet notes, a low boom,
// and a brighter final note, synthesized without an audio file.
function levroChimeSamples(rate) {
  const dur = 1.9;
  const len = Math.floor(rate * dur);
  const out = new Float32Array(len);
  const TAU = 2 * Math.PI;

  const mallet = (at, hz, amp, ring) => {
    [[1, 1, ring], [2, 0.28, ring * 0.55],
      [3.98, 0.16, ring * 0.22],
      [6.2, 0.06, ring * 0.12]].forEach(([m, a, r]) => {
      const f = hz * m;
      const start = Math.floor(at * rate);

      for (let n = start; n < Math.min(len, start + Math.floor(rate * r * 5)); n++) {
        const t = (n - start) / rate;
        out[n] += Math.sin(TAU * f * t) * amp * a *
          Math.min(1, t / 0.004) * Math.exp(-t / r);
      }
    });
  };

  const boom = (at, amp) => {
    const start = Math.floor(at * rate);

    for (let n = start; n < Math.min(len, start + Math.floor(rate * 0.32)); n++) {
      const t = (n - start) / rate;
      const f = 120 + 70 * Math.exp(-t * 18);
      out[n] += Math.sin(TAU * f * t) * amp *
        Math.min(1, t / 0.006) * Math.exp(-t * 11);
    }
  };

  [[0, 587.33, 0.5], [0.13, 739.99, 0.5],
    [0.27, 880, 0.5]].forEach(([at, hz, amp]) => {
    boom(at, 0.5);
    mallet(at, hz, amp, 0.22);
  });

  boom(0.44, 0.35);
  mallet(0.44, 1174.66, 0.55, 0.5);

  // Two gentle echo delays.
  [[0.19, 0.34], [0.31, 0.26]].forEach(([delay, feedback]) => {
    const k = Math.floor(rate * delay);
    for (let n = k; n < len; n++) {
      out[n] += out[n - k] * feedback;
    }
  });

  let peak = 0;
  for (let n = 0; n < len; n++) {
    peak = Math.max(peak, Math.abs(out[n]));
  }

  const gain = peak > 0 ? 0.72 / peak : 1;
  const fade = Math.floor(rate * 0.12);

  for (let n = 0; n < len; n++) {
    out[n] *= gain;
    if (n > len - fade) out[n] *= (len - n) / fade;
  }

  return out;
}

let __chimeEl = null;
let __chimeBuf = null;

function chimeWavUrl() {
  if (window.__chimeWavUrl) return window.__chimeWavUrl;

  const rate = 22050;
  const samples = levroChimeSamples(rate);
  const len = samples.length;
  const pcm = new Int16Array(len);

  for (let n = 0; n < len; n++) {
    pcm[n] = Math.round(
      Math.max(-1, Math.min(1, samples[n])) * 32767
    );
  }

  const hdr = new ArrayBuffer(44);
  const view = new DataView(hdr);
  const write = (offset, str) => {
    for (let k = 0; k < str.length; k++) {
      view.setUint8(offset + k, str.charCodeAt(k));
    }
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + len * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, len * 2, true);

  window.__chimeWavUrl = URL.createObjectURL(
    new Blob([hdr, pcm.buffer], { type: "audio/wav" })
  );

  return window.__chimeWavUrl;
}

function playChimeFallback() {
  try {
    if (!__chimeEl) {
      __chimeEl = new Audio(chimeWavUrl());
      __chimeEl.preload = "auto";
    }

    __chimeEl.currentTime = 0;
    const promise = __chimeEl.play();
    if (promise?.catch) promise.catch(() => {});
  } catch (_) {}
}

function playNotificationSound(n) {
  if (!soundEnabled || !n?.id || !session?.user?.id) return;

  const key = `${session.user.id}:${n.id}`;
  if (heardNotifications.has(key)) return;
  if (document.hidden) return;

  heardNotifications.add(key);
  unlockNotificationAudio();

  const go = () => {
    if (!audioCtx || audioCtx.state !== "running") {
      playChimeFallback();
      return;
    }

    const now = audioCtx.currentTime;
    if (now < notificationSoundUntil) return;
    notificationSoundUntil = now + 2.2;

    try {
      if (!__chimeBuf || __chimeBuf.sampleRate !== audioCtx.sampleRate) {
        const samples = levroChimeSamples(audioCtx.sampleRate);
        __chimeBuf = audioCtx.createBuffer(
          1, samples.length, audioCtx.sampleRate
        );
        __chimeBuf.getChannelData(0).set(samples);
      }

      const source = audioCtx.createBufferSource();
      source.buffer = __chimeBuf;
      source.connect(audioCtx.destination);
      source.start(now);
    } catch (_) {
      playChimeFallback();
    }
  };

  if (audioCtx?.state === "running") {
    go();
    return;
  }

  if (audioCtx) {
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      playChimeFallback();
    }, 350);

    audioCtx.resume().then(() => {
      if (done) return;
      done = true;
      clearTimeout(timeout);

      if (audioCtx.state === "running") go();
      else playChimeFallback();
    }).catch(() => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      playChimeFallback();
    });
  } else {
    playChimeFallback();
  }
}

// Play fresh unread notifications while the app is open.
// The live notifications channel already plays the sound the moment a notification arrives; this check is the
// safety net. While that channel is connected it runs once a minute instead of every 6 seconds.
const __notifSoundBoot = Date.now() - 8000;
let __notifSoundLastCheck = 0;

setInterval(async () => {
  try {
    if (document.hidden || !session?.user?.id || !soundEnabled) return;
    if (window.__notificationRealtimeStatus === "SUBSCRIBED" && Date.now() - __notifSoundLastCheck < 60000) return;
    __notifSoundLastCheck = Date.now();

    const { data } = await levroData.notifications.recentUnread(
      session.user.id, 5
    );

    (data || []).forEach(n => {
      if (new Date(n.created_at).getTime() < __notifSoundBoot) return;
      if (n.type === "incoming_call") return;

      if (
        n.type === "new_message" &&
        currentView === "messages" &&
        activeConversationId &&
        String(n.target_params?.conversationId || "") ===
          String(activeConversationId)
      ) return;

      playNotificationSound(n);
    });
  } catch (_) {}
}, 6000);

function playReminderChime() {
  playNotificationSound({ id: `reminder-${Date.now()}` });
}

function playSound() {}

function initSound() {
  if (!window.__notificationAudioBound) {
    window.__notificationAudioBound = true;

    ["pointerdown", "touchstart", "touchend", "click", "keydown"]
      .forEach(event => {
        document.addEventListener(event, unlockNotificationAudio, {
          passive: true,
          capture: true
        });
      });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        unlockNotificationAudio();
      }
    });
  }

  soundEnabled = true;
}
