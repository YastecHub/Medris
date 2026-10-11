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
// Fallback chime for phones whose WebAudio context is locked or "interrupted":
// the same three notes rendered once into a tiny WAV that plays through <audio>.
let __chimeEl=null;
function chimeWavUrl(){
  if(window.__chimeWavUrl)return window.__chimeWavUrl;
  const rate=22050,len=Math.floor(rate*2.4),buf=new Int16Array(len);
  [0,1.05].forEach(off=>[523.25,659.25,783.99].forEach((hz,i)=>{const start=Math.floor((off+i*.2)*rate);for(let n=start;n<Math.min(len,start+rate);n++){const t=(n-start)/rate;const env=Math.min(1,t/.02)*Math.exp(-t*4);buf[n]+=Math.round(Math.sin(2*Math.PI*hz*t)*env*11000);}}));
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
    notificationSoundUntil=now+3.2;
    // Levromart chime: three notes, repeated once, loud enough to hear in a busy room.
    // Generated in-app so there is no audio file to download.
    [0,1.05].forEach(off=>[523.25,659.25,783.99].forEach((hz,i)=>{
      const at=now+off+i*.2;
      ['sine','triangle'].forEach((type,k)=>{
        const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
        osc.type=type;osc.frequency.setValueAtTime(hz*(k?2:1),at);
        gain.gain.setValueAtTime(0,at);
        gain.gain.linearRampToValueAtTime(k?.18:.55,at+.02);
        gain.gain.exponentialRampToValueAtTime(.0001,at+.95);
        osc.connect(gain);gain.connect(audioCtx.destination);
        osc.start(at);osc.stop(at+1);
      });
    }));
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
    const {data}=await sb.from('notifications').select('id,type,created_at,target_params').eq('user_id',session.user.id).eq('read',false).order('created_at',{ascending:false}).limit(5);
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


