// ---------- "INSTALL AS APP" PROMPT ----------
let deferredInstallPrompt = null;
let awaitingInstallPromptForLogin = false;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Chrome can fire this well after page load (engagement heuristics), so if
  // we already tried and failed to show the banner right after login, retry
  // now that the browser has actually made the prompt available.
  if (awaitingInstallPromptForLogin) maybeShowInstallPrompt();
});
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function maybeShowInstallPrompt() {
  if (isStandalone()) return;
  if (localStorage.getItem("medris-install-dismissed")) return;
  const modal = byId("installPromptModal");
  if (!modal || !modal.classList.contains("hidden")) return;
  // Same reasoning as the banner's own check on this modal: never show both
  // at once, they'd just be two separate ways to ask for the same tap.
  if (byId("levroInstallBanner")?.classList.contains("is-visible")) return;
  if (deferredInstallPrompt) {
    byId("installModalActionBtn").classList.remove("hidden");
    byId("installModalIosMsg").classList.add("hidden");
  } else if (isIos()) {
    byId("installModalActionBtn").classList.add("hidden");
    byId("installModalIosMsg").classList.remove("hidden");
  } else {
    return; // not installable and no manual instructions to give
  }
  modal.classList.remove("hidden");
  trackModalOpened("installPromptModal");
}
async function runInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dismissInstallPrompt();
}
function dismissInstallPrompt() {
  byId("installPromptModal")?.classList.add("hidden");
  localStorage.setItem("medris-install-dismissed", "1");
  if (dismissibleModalId === "installPromptModal") dismissibleModalId = null;
  setTimeout(maybeShowNotifPrompt, 400);
}

