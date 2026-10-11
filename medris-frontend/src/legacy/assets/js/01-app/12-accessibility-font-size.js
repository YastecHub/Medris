// ---------- ACCESSIBILITY FONT SIZE ----------
const LEVRO_FONT_MIN=0.85, LEVRO_FONT_MAX=1.25, LEVRO_FONT_STEP=0.05;
function getLevromartFontScale(){const n=Number(localStorage.getItem("levromart-font-scale"));return Number.isFinite(n)?Math.max(LEVRO_FONT_MIN,Math.min(LEVRO_FONT_MAX,n)):0.95;}
function setLevromartFontScale(value){const n=Math.max(LEVRO_FONT_MIN,Math.min(LEVRO_FONT_MAX,Number(value)||1));const v=String(Number(n.toFixed(2)));localStorage.setItem("levromart-font-scale",v);document.documentElement.style.setProperty("--levro-font-scale",v);document.documentElement.style.setProperty("font-size",`calc(16px * ${v})`);document.body?.style.setProperty("--levro-font-scale",v);const range=byId("levroFontScaleRange");if(range)range.value=v;const out=byId("levroFontScaleValue");if(out)out.textContent=`${Math.round(n*100)}%`;}
function ensureCurrentInterfaceDefaults(){
  const KEY = "levromart-interface-defaults-v2";
  try {
    if (localStorage.getItem(KEY) !== "1") {
      localStorage.setItem("levromart-font-scale", "0.95");
      localStorage.setItem("medris-levi-fab-size", "55");
      localStorage.setItem(KEY, "1");
    }
  } catch (_) {}
}
function applyLevromartFontScale(){setLevromartFontScale(getLevromartFontScale());}

