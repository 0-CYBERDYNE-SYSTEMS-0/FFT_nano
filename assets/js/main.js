/* ═══════════════════════════════════════════════════════════════════════════
   FFT Nano — Main JavaScript
   Agricultural AI product landing page
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Calendly Integration ─────────────────────────────────────────────────── */

const CALENDLY_URL = 'https://calendly.com/scrim_wiggins/farm-friend-on-board';

function openCalendlyWidget(event) {
  if (event) event.preventDefault();
  if (window.Calendly && typeof window.Calendly.initPopupWidget === 'function') {
    window.Calendly.initPopupWidget({ url: CALENDLY_URL });
  } else {
    window.open(CALENDLY_URL, '_blank', 'noopener');
  }
  return false;
}

/* ── Mobile Menu ──────────────────────────────────────────────────────────── */

function closeMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
  const menuButton = document.querySelector('.mobile-menu-btn');
  if (!mobileMenu || !mobileMenuOverlay) return;

  mobileMenu.classList.remove('open');
  mobileMenuOverlay.classList.remove('open');
  document.body.classList.remove('menu-open');
  if (menuButton) {
    menuButton.setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu() {
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
  const menuButton = document.querySelector('.mobile-menu-btn');
  if (!mobileMenu || !mobileMenuOverlay) return;

  const isOpen = mobileMenu.classList.toggle('open');
  mobileMenuOverlay.classList.toggle('open', isOpen);
  document.body.classList.toggle('menu-open', isOpen);
  if (menuButton) {
    menuButton.setAttribute('aria-expanded', String(isOpen));
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu && mobileMenu.classList.contains('open')) {
      closeMenu();
    }
  }
});

document.querySelectorAll('.mobile-nav a').forEach(link => {
  link.addEventListener('click', closeMenu);
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    closeMenu();
  }
});

/* ── Hero Particles ───────────────────────────────────────────────────────── */

function createParticles() {
  const particlesContainer = document.getElementById('particles');
  if (!particlesContainer) return;

  const particleCount = 25;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');

    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `${Math.random() * 100}%`;

    const size = Math.random() * 4 + 2;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;

    particle.style.animationDelay = `${Math.random() * 15}s`;
    particle.style.animationDuration = `${Math.random() * 10 + 10}s`;

    particlesContainer.appendChild(particle);
  }
}

window.addEventListener('load', createParticles);

/* ── Lazy-load Demo Video ─────────────────────────────────────────────────── */

const demoPlayer = document.getElementById('demo-player');
if (demoPlayer) {
  const videoObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      const src = demoPlayer.querySelector('source[data-src]');
      if (src) {
        src.src = src.dataset.src;
        demoPlayer.load();
        demoPlayer.play().catch(() => {});
      }
      videoObserver.disconnect();
    }
  }, { rootMargin: '200px' });
  videoObserver.observe(demoPlayer);
}

/* ── Lenis Smooth Scroll + GSAP ScrollTrigger ─────────────────────────────── */

const lenis = new Lenis({
  lerp: 0.1,
  smoothWheel: true,
  smoothTouch: false,
});

gsap.registerPlugin(ScrollTrigger);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

lenis.on('scroll', ScrollTrigger.update);

/* ── Anchor Link Smooth Scroll ────────────────────────────────────────────── */

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const href = anchor.getAttribute('href');
    if (!href || href === '#') return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      lenis.scrollTo(target, { offset: -80 });
    }
  });
});

/* ── GSAP ScrollTrigger Section Reveals ───────────────────────────────────── */

const revealSections = document.querySelectorAll('section:not(.hero)');
revealSections.forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(40px)';
});

ScrollTrigger.batch('section:not(.hero)', {
  onEnter: batch => gsap.to(batch, {
    opacity: 1,
    y: 0,
    duration: 0.7,
    stagger: 0.1,
    ease: 'power2.out',
    overwrite: true,
  }),
  start: 'top 85%',
  once: true,
});

/* ── Card Staggered Entrance Animations ───────────────────────────────────── */

['.outcome-card', '.value-card', '.pricing-card'].forEach(sel => {
  const cards = document.querySelectorAll(sel);
  if (!cards.length) return;

  cards.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px) scale(0.97)';
  });

  ScrollTrigger.batch(sel, {
    onEnter: batch => gsap.to(batch, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.6,
      stagger: 0.08,
      ease: 'power2.out',
      overwrite: true,
    }),
    start: 'top 88%',
    once: true,
  });
});

/* ── Hero Parallax Effect ─────────────────────────────────────────────────── */

const heroBg = document.querySelector('.hero-video-bg, .hero');
if (heroBg) {
  gsap.to(heroBg, {
    yPercent: 20,
    ease: 'none',
    scrollTrigger: {
      trigger: heroBg.closest('section') || heroBg,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
    },
  });
}

/* ── Progressive Section Transparency ─────────────────────────────────────── */

const sectionOpacities = [0.92, 0.91, 0.90, 0.89, 0.88, 0.87, 0.87, 0.87, 0.87];
document.querySelectorAll('section:not(.hero)').forEach((section, i) => {
  section.style.background = `rgba(240, 236, 230, ${sectionOpacities[i] ?? 0.68})`;
});

/* ── Reduced Motion: Disable All Animations ───────────────────────────────── */

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  lenis.destroy();
  ScrollTrigger.getAll().forEach(t => t.kill());

  document.querySelectorAll(
    'section:not(.hero), .outcome-card, .value-card, .pricing-card'
  ).forEach(el => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
}
