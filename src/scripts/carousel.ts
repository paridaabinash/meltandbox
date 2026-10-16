// Auto-advancing scroll-snap rails: add data-autoplay to a .rail of .rail-item children.
// Moves one card every few seconds while the rail is on screen. The moment the shopper touches, drags,
// scrolls (wheel) or uses the keyboard on it, autoplay stops for good and the rail is theirs.
// Mouse hover only pauses it. Off entirely for prefers-reduced-motion.
const STEP_MS = 3000;

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const rail of document.querySelectorAll<HTMLElement>('[data-autoplay]')) {
    let visible = false;
    let hovering = false;

    const timer = setInterval(() => {
      if (!visible || hovering || document.hidden) return;
      const item = rail.querySelector<HTMLElement>('.rail-item');
      if (!item) return;
      const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
      rail.scrollTo({ left: atEnd ? 0 : rail.scrollLeft + item.offsetWidth + gap, behavior: 'smooth' });
    }, STEP_MS);

    const stop = () => {
      clearInterval(timer);
      io.disconnect();
    };
    for (const ev of ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const) rail.addEventListener(ev, stop, { passive: true, once: true });
    rail.addEventListener('pointerenter', (e) => (hovering = e.pointerType === 'mouse'));
    rail.addEventListener('pointerleave', () => (hovering = false));

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.5 });
    io.observe(rail);
  }
}
