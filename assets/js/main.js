
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

    function closeMenu() {
      const mobileMenu = document.getElementById('mobileMenu');
      const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
      const menuButton = document.querySelector('.mobile-menu-btn');

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
      const isOpen = mobileMenu.classList.toggle('open');

      mobileMenuOverlay.classList.toggle('open', isOpen);
      document.body.classList.toggle('menu-open', isOpen);
      if (menuButton) {
        menuButton.setAttribute('aria-expanded', String(isOpen));
      }
    }

    // Close mobile menu with Escape key for accessibility
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const mobileMenu = document.getElementById('mobileMenu');
        if (mobileMenu.classList.contains('open')) {
          closeMenu();
        }
      }
    });

    // Close mobile menu when clicking a link
    document.querySelectorAll('.mobile-nav a').forEach(link => {
      link.addEventListener('click', closeMenu);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1200) {
        closeMenu();
      }
    });

    // Generate particles
    function createParticles() {
      const particlesContainer = document.getElementById('particles');
      const particleCount = 25;
      
      for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        
        // Random positioning
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        
        // Random size variation
        const size = Math.random() * 4 + 2;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        
        // Random animation delay
        particle.style.animationDelay = Math.random() * 15 + 's';
        particle.style.animationDuration = (Math.random() * 10 + 10) + 's';
        
        particlesContainer.appendChild(particle);
      }
    }

    // Initialize particles on load
    window.addEventListener('load', createParticles);

    // FFT Nano Slide Viewer
    (function() {
      // Configuration
      const FFT_TOTAL_SLIDES = 17;
      const FFT_SLIDES_PATH = 'slides/terminal-pitchdeck/slide-';
      let fftCurrentSlide = 1;
      const fftThumbnails = [];

      // Generate thumbnails
      function fftGenerateThumbnails() {
        const container = document.getElementById('fft-thumbnails');
        if (!container) return;

        container.innerHTML = '';

        for (let i = 1; i <= FFT_TOTAL_SLIDES; i++) {
          const thumb = document.createElement('div');
          thumb.className = 'fft-thumb' + (i === fftCurrentSlide ? ' active' : '');
          thumb.onclick = () => fftGoToSlide(i);

          const img = document.createElement('img');
          img.src = `${FFT_SLIDES_PATH}${String(i).padStart(2, '0')}.png`;
          img.alt = `Slide ${i}`;
          img.loading = 'lazy';

          const number = document.createElement('div');
          number.className = 'fft-thumb-number';
          number.textContent = i;
          number.style.cssText = 'position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600;';

          thumb.appendChild(img);
          thumb.appendChild(number);
          container.appendChild(thumb);
        }

        fftThumbnails.push(...container.children);
      }

      // Update slide display
      function fftUpdateSlide() {
        const slideImage = document.getElementById('fft-current-slide');
        const slideNumber = document.getElementById('fft-slide-number');
        const prevBtn = document.getElementById('fft-prev-btn');
        const nextBtn = document.getElementById('fft-next-btn');
        const thumbs = document.querySelectorAll('.fft-thumb');

        if (!slideImage || !slideNumber || !prevBtn || !nextBtn) return;

        // Add fade-out class
        slideImage.classList.add('fade-out');

        // Update after fade completes
        setTimeout(() => {
          slideImage.src = `${FFT_SLIDES_PATH}${String(fftCurrentSlide).padStart(2, '0')}.png`;
          slideNumber.textContent = fftCurrentSlide;

          // Update thumbnails
          thumbs.forEach((thumb, index) => {
            const slideNum = index + 1;
            if (slideNum === fftCurrentSlide) {
              thumb.classList.add('active');
            } else {
              thumb.classList.remove('active');
            }
          });

          // Update buttons
          prevBtn.disabled = fftCurrentSlide <= 1;
          nextBtn.disabled = fftCurrentSlide >= FFT_TOTAL_SLIDES;

          // Remove fade-out, add fade-in
          setTimeout(() => {
            slideImage.classList.remove('fade-out');
            slideImage.classList.add('fade-in');

            setTimeout(() => {
              slideImage.classList.remove('fade-in');
            }, 300);
          }, 300);
        }, 300);
      }

      // Navigation functions
      function fftGoToSlide(slideNum) {
        if (slideNum >= 1 && slideNum <= FFT_TOTAL_SLIDES) {
          fftCurrentSlide = slideNum;
          fftUpdateSlide();
        }
      }

      function fftNextSlide() {
        if (fftCurrentSlide < FFT_TOTAL_SLIDES) {
          fftCurrentSlide++;
          fftUpdateSlide();
        }
      }

      function fftPrevSlide() {
        if (fftCurrentSlide > 1) {
          fftCurrentSlide--;
          fftUpdateSlide();
        }
      }

      // Keyboard navigation
      document.addEventListener('keydown', function(e) {
        // Only handle if slide viewer is visible in viewport
        const viewer = document.getElementById('fft-current-slide');
        if (!viewer) return;

        const rect = viewer.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

        if (isVisible) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            fftNextSlide();
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            fftPrevSlide();
          }
        }
      });

      // Event Listeners
      document.addEventListener('DOMContentLoaded', function() {
        const prevBtn = document.getElementById('fft-prev-btn');
        const nextBtn = document.getElementById('fft-next-btn');

        if (prevBtn) prevBtn.addEventListener('click', fftPrevSlide);
        if (nextBtn) nextBtn.addEventListener('click', fftNextSlide);

        // Generate thumbnails on load
        fftGenerateThumbnails();
      });
    })();

    // ── Lazy-load demo video when section enters viewport ─────────────────────
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

    // ── Lenis smooth scroll ────────────────────────────────────────────────────
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      smoothTouch: false,
    });

    // Wire Lenis into GSAP ticker
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // ScrollTrigger uses Lenis scroll position
    lenis.on('scroll', ScrollTrigger.update);

    // Anchor link smooth scroll via Lenis
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) {
          e.preventDefault();
          lenis.scrollTo(target, { offset: -80 });
        }
      });
    });

    // ── GSAP ScrollTrigger section reveals ────────────────────────────────────
    // Hero is immediately visible — only fade-in sections below it
    document.querySelectorAll('section:not(.hero)').forEach(el => {
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

    // ── Card staggered entrance ────────────────────────────────────────────────
    ['.feature-card', '.matters-card', '.product-card'].forEach(sel => {
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

    // ── Hero parallax ──────────────────────────────────────────────────────────
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
        }
      });
    }

    // ── Presentation section staggered reveal ─────────────────────────────────
    const presentationEls = document.querySelectorAll(
      '.fft-slide-viewer, .fft-slide-controls, .fft-thumbnails, .presentation-actions'
    );
    if (presentationEls.length) {
      gsap.set(presentationEls, { opacity: 0, y: 30 });
      ScrollTrigger.batch(presentationEls, {
        onEnter: batch => gsap.to(batch, {
          opacity: 1, y: 0, duration: 0.6,
          stagger: 0.12, ease: 'power2.out', overwrite: true,
        }),
        start: 'top 88%',
        once: true,
      });
    }

    // ── Progressive transparency — dashboard.webp bleeds through more as user scrolls down ──
    // Hero has its own dark overlay; non-hero sections start opaque and get lighter
    const sectionOpacities = [0.88, 0.84, 0.80, 0.76, 0.72, 0.68, 0.68, 0.68, 0.68];
    document.querySelectorAll('section:not(.hero)').forEach((section, i) => {
      section.style.background = `rgba(240, 236, 230, ${sectionOpacities[i] ?? 0.68})`;
    });

    // ── Reduced motion: disable everything ────────────────────────────────────
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lenis.destroy();
      ScrollTrigger.getAll().forEach(t => t.kill());
      document.querySelectorAll('section:not(.hero), .feature-card, .matters-card, .product-card, .fft-slide-viewer, .fft-slide-controls, .fft-thumbnails, .presentation-actions').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    }
  