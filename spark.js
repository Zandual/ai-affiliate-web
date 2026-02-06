/**
 * spark.js
 * ------------------------------------------------------------
 * Safe, non-blocking background animation.
 * Educational notes:
 * - We draw ONLY on a dedicated <canvas id="spark-canvas">.
 * - We NEVER modify #root or any app DOM. That avoids "blank page" bugs.
 * - We use pointer-events:none on the canvas so clicks go through to the app.
 * - Wrapped in try/catch so if anything fails, the app still runs.
 */

(function () {
  try {
    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) return;

    const canvas = document.getElementById("spark-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0,
      h = 0,
      dpr = 1;

    function resize() {
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      w = Math.floor(window.innerWidth);
      h = Math.floor(window.innerHeight);

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";

      // Scale drawing to look crisp on HiDPI displays
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    window.addEventListener("resize", resize, { passive: true });
    resize();

    const particles = [];
    const MAX_PARTICLES = 260;

    const mouse = {
      x: w * 0.5,
      y: h * 0.4,
      vx: 0,
      vy: 0,
      lastX: w * 0.5,
      lastY: h * 0.4,
    };

    window.addEventListener(
      "mousemove",
      (e) => {
        const x = e.clientX,
          y = e.clientY;
        mouse.vx = x - mouse.lastX;
        mouse.vy = y - mouse.lastY;
        mouse.lastX = x;
        mouse.lastY = y;
        mouse.x = x;
        mouse.y = y;

        spawn(x, y, 2, 0.8);
      },
      { passive: true }
    );

    window.addEventListener("click", (e) => spawn(e.clientX, e.clientY, 28, 2.6));

    function spawn(x, y, count, power) {
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) particles.shift();

        const angle = Math.random() * Math.PI * 2;
        const speed = (0.6 + Math.random() * 1.6) * power;

        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed + mouse.vx * 0.03,
          vy: Math.sin(angle) * speed + mouse.vy * 0.03,
          r: 1 + Math.random() * 3.5,
          life: 1,
          decay: 0.012 + Math.random() * 0.02,
          hue: 210 + Math.random() * 80,
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.life -= p.decay;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        const alpha = Math.max(0, Math.min(1, p.life));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 85%, 65%, ${alpha * 0.9})`;
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    draw();
  } catch (err) {
    console.warn("spark.js disabled due to error:", err);
  }
})();
