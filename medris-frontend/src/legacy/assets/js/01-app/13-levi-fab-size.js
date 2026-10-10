// ---------- LEVI FAB SIZE ----------
const LEVI_FAB_MIN_SIZE=44;
const LEVI_FAB_MAX_SIZE=74;
function getLeviFabSize(){const n=Number(localStorage.getItem("medris-levi-fab-size"));return Number.isFinite(n)?Math.max(LEVI_FAB_MIN_SIZE,Math.min(LEVI_FAB_MAX_SIZE,Math.round(n))):55;}
function setLeviFabSize(value){const size=Math.max(LEVI_FAB_MIN_SIZE,Math.min(LEVI_FAB_MAX_SIZE,Math.round(Number(value)||LEVI_FAB_MAX_SIZE)));localStorage.setItem("medris-levi-fab-size",String(size));document.documentElement.style.setProperty("--levi-fab-size",`${size}px`);const fab=byId("aiChatFab");if(fab){fab.style.setProperty("width",`${size}px`,"important");fab.style.setProperty("height",`${size}px`,"important");fab.style.setProperty("min-width",`${size}px`,"important");fab.style.setProperty("min-height",`${size}px`,"important");}const out=byId("leviSizeValue");if(out)out.textContent=`${size}px`;const range=byId("leviSizeRange");if(range)range.value=String(size);}
function applyLeviFabSize(){setLeviFabSize(getLeviFabSize());}


function syncLeviFabVisibility(){const fab=byId("aiChatFab"),panel=byId("aiChatPanel");if(!fab)return;const shouldHide=!leviVisible || !!panel&&!panel.classList.contains("hidden");fab.classList.toggle("hidden",shouldHide);if(!shouldHide)applyLeviFabSize();}

