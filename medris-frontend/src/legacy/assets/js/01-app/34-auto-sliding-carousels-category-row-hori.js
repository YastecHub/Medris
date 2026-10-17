// ---------- AUTO-SLIDING CAROUSELS (category row + horizontal product/vendor rails) ----------
let autoScrollTimers = [];
function clearAutoScrollTimers() {
  autoScrollTimers.forEach((timer) => {
    try { clearInterval(timer); } catch (_) {}
    try { timer.__container && delete timer.__container.__levroAutoScrollTimer; } catch (_) {}
  });
  autoScrollTimers = [];
}
function setupAutoScroll(container, { interval = 30, pauseAfterInteraction = 6500 } = {}) {
  if (!container || !horizontalBrowseEnabled) return;
  // The category rail is a persistent filter selector, not a browse-more
  // showcase -- auto-scrolling it made the tapped category chip silently
  // drift out of view and eventually wrap back to "All" a few seconds
  // after every tap, looking like the selection had reset itself. This
  // exclusion referenced the rail's old class name (.cat-row), which no
  // longer exists -- it's .levro-home-cat-rail now -- so it silently
  // stopped excluding anything.
  if (container.matches(".trending-scroll, .top-rated-vendors-scroll, .levro-home-cat-rail")) return;
  if (container.__levroAutoScrollTimer) return;
  let paused = false;
  let pauseTimeout = null;
  const pause = () => {
    paused = true;
    clearTimeout(pauseTimeout);
    pauseTimeout = setTimeout(() => { paused = false; }, pauseAfterInteraction);
  };
  if (container.dataset.continuousCarouselReady !== "1") {
    container.dataset.continuousCarouselReady = "1";
    container.addEventListener("touchstart", pause, { passive: true });
    container.addEventListener("wheel", pause, { passive: true });
    container.addEventListener("mousedown", pause);
  }
  const timer = setInterval(() => {
    if (!horizontalBrowseEnabled || paused || window.__lvDragging || document.hidden || !container.isConnected) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll <= 4) return;
    const step = 1.8;
    let next = container.scrollLeft + step;
    if (next >= maxScroll - 1) next = 0;
    container.scrollLeft = next;
  }, interval);
  timer.__container = container;
  container.__levroAutoScrollTimer = timer;
  autoScrollTimers.push(timer);
}

