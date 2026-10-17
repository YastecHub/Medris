// ---------- SWIPE PRODUCT / PACKAGE GALLERIES ----------
function initGallerySwipeSurfaces() {
  document.querySelectorAll('.product-gallery-track, .package-detail-gallery-track').forEach((track) => {
    if (track.dataset.carouselReady === '1') return;
    track.dataset.carouselReady = '1';
    let raf = 0;
    const sync = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (track.id === 'productGalleryTrack') syncProductGalleryIndex(track);
        else syncPackageGalleryIndex(track);
      });
    };
    track.addEventListener('scroll', sync, { passive: true });
    // Native scrolling remains in control of the gesture. These listeners only
    // mirror the settled position into the already-loaded variety state.
    track.addEventListener('scrollend', sync, { passive: true });
    track.addEventListener('pointerup', sync, { passive: true });
    track.addEventListener('touchend', sync, { passive: true });
    // Endless photos: swiping past the last photo goes back to the first, and past the first goes to the last.
    let sx = 0, sy = 0, atStart = false, atEnd = false;
    track.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      atStart = track.scrollLeft <= 2; atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    }, { passive: true });
    track.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const slides = track.querySelectorAll('.product-gallery-slide, .package-detail-gallery-slide');
      if (slides.length < 2) return;
      const go = track.id === 'productGalleryTrack' && typeof setProductGalleryPhoto === 'function' ? setProductGalleryPhoto : null;
      const target = dx < 0 && atEnd ? 0 : dx > 0 && atStart ? slides.length - 1 : -1;
      if (target < 0) return;
      if (go) go(target, true);
      else slides[target].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, { passive: true });
  });
}

