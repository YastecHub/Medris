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
  });
}

