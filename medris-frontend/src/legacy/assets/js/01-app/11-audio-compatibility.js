// ---------- AUDIO COMPATIBILITY ----------
// Levromart notification sound. This is the app-level sound used while the web app
// is actively open. OS-level push notification audio remains controlled by the
// browser/phone notification settings (web apps cannot force a custom OS sound).
let soundEnabled = true;
let audioCtx = null;
const heardNotifications=new Set();let notificationSoundUntil=0;
function unlockNotificationAudio(){
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
  if(!audioCtx||audioCtx.state==='closed')audioCtx=new Ctx();
  if(audioCtx.state!=='running')audioCtx.resume().catch(()=>{});
}
// Soft bell: two warm, round notes ("bong, bong"), no sharp attack and no bright overtones.
// [start seconds, frequency Hz]; each note is a sine with two quiet, short-lived partials.
const BELL_NOTES=[[0,587.33],[.42,440]];
const BELL_PARTIALS=[[1,1,1.5],[2.01,.12,.7],[3.02,.03,.35]]; // [frequency multiple, loudness, decay seconds]
// Fallback chime for phones whose WebAudio context is locked or "interrupted":
// the same three notes rendered once into a tiny WAV that plays through <audio>.
let __chimeEl=null;
function chimeWavUrl(){
  if(window.__chimeWavUrl)return window.__chimeWavUrl;
  const rate=22050,len=Math.floor(rate*2.2),buf=new Int16Array(len);
  BELL_NOTES.forEach(([off,hz])=>{const start=Math.floor(off*rate);for(let n=start;n<len;n++){const t=(n-start)/rate;if(t>1.8)break;const att=Math.min(1,t/.012);let v=0;BELL_PARTIALS.forEach(([m,g,d])=>{v+=g*Math.sin(2*Math.PI*hz*m*t)*Math.exp(-t*3.2/d);});buf[n]+=Math.round(att*v*9000);}});
  const hdr=new ArrayBuffer(44),v=new DataView(hdr),w=(o,str)=>{for(let k=0;k<str.length;k++)v.setUint8(o+k,str.charCodeAt(k));};
  w(0,'RIFF');v.setUint32(4,36+len*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,len*2,true);
  window.__chimeWavUrl=URL.createObjectURL(new Blob([hdr,buf.buffer],{type:'audio/wav'}));
  return window.__chimeWavUrl;
}
function playChimeFallback(){
  try{ if(!__chimeEl){__chimeEl=new Audio(chimeWavUrl());__chimeEl.preload='auto';} __chimeEl.currentTime=0; const pr=__chimeEl.play(); if(pr&&pr.catch)pr.catch(()=>{}); }catch(_){}
}
function playNotificationSound(n){
  if(!soundEnabled||!n?.id||!session?.user?.id)return;
  const key=`${session.user.id}:${n.id}`;
  if(heardNotifications.has(key))return;
  if(document.hidden)return;
  heardNotifications.add(key);
  unlockNotificationAudio();
  const go=()=>{
    const now=audioCtx.currentTime;
    if(now<notificationSoundUntil)return;
    notificationSoundUntil=now+2.2;
    // Generated in-app (no audio file). A gentle low-pass keeps it smooth and easy on the ear.
    const master=audioCtx.createGain(),soft=audioCtx.createBiquadFilter();
    master.gain.value=.5;soft.type='lowpass';soft.frequency.value=2200;soft.Q.value=.5;
    master.connect(soft);soft.connect(audioCtx.destination);
    BELL_NOTES.forEach(([off,hz])=>{
      const at=now+off;
      BELL_PARTIALS.forEach(([m,g,d])=>{
        const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
        osc.type='sine';osc.frequency.setValueAtTime(hz*m,at);
        gain.gain.setValueAtTime(0,at);
        gain.gain.linearRampToValueAtTime(.4*g,at+.012);
        gain.gain.exponentialRampToValueAtTime(.0001,at+d+.3);
        osc.connect(gain);gain.connect(master);
        osc.start(at);osc.stop(at+d+.35);
      });
    });
  };
  if(audioCtx&&audioCtx.state==='running'){go();return;}
  if(audioCtx){
    let done=false;
    const t=setTimeout(()=>{if(!done){done=true;playChimeFallback();}},350);
    audioCtx.resume().then(()=>{if(done)return;done=true;clearTimeout(t);if(audioCtx.state==='running')go();else playChimeFallback();}).catch(()=>{if(!done){done=true;clearTimeout(t);playChimeFallback();}});
  } else playChimeFallback();
}
// A notification that arrives while the app is open must always chime, even if the
// live connection missed it: look for fresh unread ones every few seconds.
const __notifSoundBoot=Date.now()-8000;
setInterval(async()=>{
  try{
    if(document.hidden||!session?.user?.id||!soundEnabled)return;
    const {data}=await levroData.notifications.recentUnread(session.user.id,5);
    (data||[]).forEach(n=>{
      if(new Date(n.created_at).getTime()<__notifSoundBoot)return;
      if(n.type==='incoming_call')return;
      if(n.type==='new_message'&&currentView==='messages'&&activeConversationId&&String(n.target_params?.conversationId||'')===String(activeConversationId))return;
      playNotificationSound(n);
    });
  }catch(_){}
},6000);
function playReminderChime(){ playNotificationSound({id:'reminder-'+Date.now()}); }
function playSound() {}
function initSound() {
  if(!window.__notificationAudioBound){
    window.__notificationAudioBound=true;
    ["pointerdown","touchstart","touchend","click","keydown"].forEach(ev=>document.addEventListener(ev,unlockNotificationAudio,{passive:true,capture:true}));
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")unlockNotificationAudio();});
  }
  soundEnabled = true;
}


