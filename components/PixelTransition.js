/**
 * PixelTransition - React Bits (Vanilla JS Adaptation)
 * Source algorithm & physics: https://reactbits.dev/animations/pixel-transition
 * Compatible with shadcn @react-bits/PixelTransition-JS-CSS
 */

(function (global) {
  const PATTERNS = ['random', 'dither', 'ripple', 'wipe'];
  const ANIMATIONS = ['pop', 'grow', 'fade'];
  const SHAPES = ['square', 'rounded', 'circle'];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const WINDOW = 0.35;
  const SEAL = 0.22;
  const TONES = 5;
  const LEVELS = 16;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smooth = t => t * t * (3 - 2 * t);

  const hash = (x, y, seed) => {
    let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(seed + 1, 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  class PixelTransition {
    constructor(root, options = {}) {
      if (typeof root === 'string') {
        this.root = document.querySelector(root);
      } else {
        this.root = root;
      }

      if (!this.root) {
        console.warn('PixelTransition: root element not found');
        return;
      }

      this.canvas = this.root.querySelector('.pixelated-image-card__pixels');
      this.firstEl = this.root.querySelector('.pixelated-image-card__default');
      this.secondEl = this.root.querySelector('.pixelated-image-card__active');
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

      if (!this.canvas || !this.ctx) {
        console.warn('PixelTransition: canvas or 2d context missing');
        return;
      }

      this.settings = {
        gridSize: clamp(Math.round(options.gridSize ?? 14), 2, 80),
        pixelColor: options.pixelColor ?? '#ff80bf',
        mosaic: clamp(options.mosaic ?? 0.3, 0, 1),
        duration: Math.max(0.05, options.animationStepDuration ?? 0.45),
        pattern: PATTERNS.includes(options.pattern) ? options.pattern : 'dither',
        randomness: clamp(options.randomness ?? 0.3, 0, 1),
        animation: ANIMATIONS.includes(options.pixelAnimation) ? options.pixelAnimation : 'grow',
        shape: SHAPES.includes(options.pixelShape) ? options.pixelShape : 'rounded',
        gap: Math.max(0, options.gap ?? 1),
        fps: clamp(options.fps ?? 0, 0, 120),
        trigger: options.trigger ?? 'hover',
        once: !!options.once
      };

      this.onActiveChange = options.onActiveChange;
      this.hovering = false;
      this.focused = false;
      this.pointerType = 'mouse';

      const initialActive = options.active ? 1 : 0;
      this.state = {
        progress: 0,
        base: initialActive,
        goal: initialActive,
        shown: initialActive,
        seed: 1,
        originX: 0.5,
        originY: 0.5,
        edge: 'left',
        tones: ['#ffffff'],
        toneKey: '',
        dpr: 1
      };

      this.raf = 0;
      this.last = 0;
      this.drawnAt = 0;
      this.alive = true;

      this.probe = document.createElement('canvas');
      this.probe.width = 1;
      this.probe.height = 1;
      this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
      this.reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

      this.show(this.state.shown);
      this.initEvents();
      this.initResize();
    }

    resolveTones() {
      const s = this.settings;
      this.canvas.style.color = s.pixelColor;
      const color = getComputedStyle(this.canvas).color || s.pixelColor;
      this.canvas.style.color = '';
      let rgba = [255, 128, 191, 1];
      if (this.probeCtx) {
        this.probeCtx.clearRect(0, 0, 1, 1);
        this.probeCtx.fillStyle = color;
        this.probeCtx.fillRect(0, 0, 1, 1);
        const data = this.probeCtx.getImageData(0, 0, 1, 1).data;
        rgba = [data[0], data[1], data[2], data[3] / 255];
      }
      const target = (0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]) / 255 > 0.5 ? 0 : 255;
      this.state.tones = Array.from({ length: TONES }, (_, index) => {
        const mix = s.mosaic * 0.5 * (index / (TONES - 1));
        const [r, g, b] = rgba.slice(0, 3).map(value => Math.round(value + (target - value) * mix));
        return `rgba(${r}, ${g}, ${b}, ${rgba[3]})`;
      });
      this.state.toneKey = `${s.pixelColor}|${s.mosaic}`;
    }

    show(index) {
      this.state.shown = index;
      if (this.firstEl) this.firstEl.style.visibility = index === 0 ? '' : 'hidden';
      if (this.secondEl) this.secondEl.style.visibility = index === 1 ? '' : 'hidden';
    }

    draw() {
      const s = this.settings;
      const { width, height } = this.canvas;
      const ctx = this.ctx;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, width, height);
      const progress = this.state.progress;
      if (progress <= 0 || progress >= 1) return;
      if (this.state.toneKey !== `${s.pixelColor}|${s.mosaic}`) this.resolveTones();

      const covering = progress < 0.5;
      const local = covering ? progress * 2 : progress * 2 - 1;
      const seal = covering ? smooth(clamp((local - 1 + SEAL) / SEAL, 0, 1)) : 1 - smooth(clamp(local / SEAL, 0, 1));
      const cols = s.gridSize;
      const cell = width / cols;
      const rows = Math.ceil(height / cell);
      const top = (height - rows * cell) / 2;
      const gap = Math.min(cell * 0.8, s.gap * this.state.dpr) * (1 - seal);
      const ox = this.state.originX * width;
      const oy = this.state.originY * height;
      const far = Math.max(
        Math.hypot(ox, oy),
        Math.hypot(width - ox, oy),
        Math.hypot(ox, height - oy),
        Math.hypot(width - ox, height - oy)
      );
      const paths = new Map();

      for (let row = 0; row < rows; row++) {
        const y0 = top + row * cell;
        const cy = y0 + cell / 2;
        for (let col = 0; col < cols; col++) {
          const x0 = col * cell;
          const cx = x0 + cell / 2;
          const noise = hash(col, row, this.state.seed);
          let delay = noise;
          if (s.pattern === 'dither') delay = (BAYER[(row & 3) * 4 + (col & 3)] + noise) / 16;
          else if (s.pattern !== 'random') {
            let base;
            if (s.pattern === 'ripple') base = Math.hypot(cx - ox, cy - oy) / Math.max(1, far);
            else if (this.state.edge === 'left') base = cx / width;
            else if (this.state.edge === 'right') base = 1 - cx / width;
            else if (this.state.edge === 'top') base = cy / height;
            else base = 1 - cy / height;
            delay = clamp(base, 0, 1) * (1 - s.randomness) + noise * s.randomness;
          }

          let amount;
          if (s.animation === 'pop') amount = local >= delay === covering ? 1 : 0;
          else {
            const t = smooth(clamp((local - delay * (1 - WINDOW)) / WINDOW, 0, 1));
            amount = covering ? t : 1 - t;
          }
          if (amount <= 0.002) continue;

          const size = (s.animation === 'grow' ? cell * amount : cell) - gap;
          if (size <= 0) continue;
          const level = s.animation === 'fade' ? Math.max(1, Math.round(amount * LEVELS)) : LEVELS;
          const tone = s.mosaic > 0 ? Math.floor(hash(col, row, 7) * TONES) : 0;
          const key = tone * (LEVELS + 1) + level;
          let path = paths.get(key);
          if (!path) {
            path = new Path2D();
            paths.set(key, path);
          }

          if (s.shape === 'circle') {
            const radius = (size / 2) * (1 + 0.45 * seal);
            path.moveTo(cx + radius, cy);
            path.arc(cx, cy, radius, 0, Math.PI * 2);
          } else if (s.shape === 'rounded' && seal < 1 && path.roundRect) {
            path.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.3 * (1 - seal));
          } else if (size >= cell - 0.01) {
            const left = Math.round(x0);
            const upper = Math.round(y0);
            path.rect(left, upper, Math.round(x0 + cell) - left, Math.round(y0 + cell) - upper);
          } else {
            path.rect(cx - size / 2, cy - size / 2, size, size);
          }
        }
      }

      paths.forEach((path, key) => {
        ctx.globalAlpha = (key % (LEVELS + 1)) / LEVELS;
        ctx.fillStyle = this.state.tones[Math.floor(key / (LEVELS + 1))] ?? this.state.tones[0];
        ctx.fill(path);
      });
      ctx.globalAlpha = 1;
    }

    paint() {
      const index = this.state.progress >= 0.5 ? 1 - this.state.base : this.state.base;
      if (index !== this.state.shown) this.show(index);
      this.draw();
    }

    frame = now => {
      this.raf = 0;
      if (!this.alive) return;
      const s = this.settings;
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      const aim = this.state.goal === this.state.base ? 0 : 1;
      const step = this.reduce ? 1 : dt / (2 * s.duration);
      this.state.progress =
        aim > this.state.progress ? Math.min(aim, this.state.progress + step) : Math.max(aim, this.state.progress - step);
      const settled = this.state.progress === aim;
      if (settled && aim === 1) {
        this.state.base = 1 - this.state.base;
        this.state.progress = 0;
      }
      if (settled || !s.fps || now - this.drawnAt >= 1000 / s.fps - 2) {
        this.drawnAt = now;
        this.paint();
      }
      if (!settled) this.raf = requestAnimationFrame(this.frame);
    };

    start(point) {
      const rect = this.root.getBoundingClientRect();
      const x = point ? clamp((point.x - rect.left) / Math.max(1, rect.width), 0, 1) : 0.5;
      const y = point ? clamp((point.y - rect.top) / Math.max(1, rect.height), 0, 1) : 0.5;
      this.state.originX = x;
      this.state.originY = y;
      this.state.seed = Math.floor(Math.random() * 65536);
      if (!point) this.state.edge = 'left';
      else {
        const sides = [
          ['left', x * rect.width],
          ['right', (1 - x) * rect.width],
          ['top', y * rect.height],
          ['bottom', (1 - y) * rect.height]
        ];
        this.state.edge = sides.reduce((best, side) => (side[1] < best[1] ? side : best))[0];
      }
      this.resolveTones();
    }

    go(next, point) {
      const goal = next ? 1 : 0;
      if (goal === this.state.goal) return;
      if (!goal && this.settings.once) return;
      this.state.goal = goal;
      if (this.state.progress === 0 && goal !== this.state.base) this.start(point);
      if (this.raf) return;
      this.last = 0;
      this.drawnAt = 0;
      this.raf = requestAnimationFrame(this.frame);
    }

    /**
     * Triggers reveal animation: begins from pixels covering the card (progress = 0.5)
     * and clears away smoothly to reveal content.
     */
    playReveal(point) {
      cancelAnimationFrame(this.raf);
      this.state.base = 1;
      this.state.goal = 0;
      this.state.progress = 0.5;
      this.state.shown = 0;
      this.show(0);
      this.start(point || null);
      this.last = 0;
      this.drawnAt = 0;
      this.raf = requestAnimationFrame(this.frame);
    }

    triggerSwap(point) {
      this.go(this.state.goal !== 1, point);
    }

    initEvents() {
      const hover = this.settings.trigger !== 'click';
      const pointOf = event => ({ x: event.clientX, y: event.clientY });

      this.root.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        this.hovering = true;
        if (hover) {
          this.go(true, pointOf(event));
          this.onActiveChange?.(true);
        }
      });

      this.root.addEventListener('pointerleave', event => {
        if (event.pointerType === 'touch') return;
        this.hovering = false;
        if (hover && !this.focused) {
          this.go(false, pointOf(event));
          this.onActiveChange?.(false);
        }
      });

      this.root.addEventListener('pointerdown', event => {
        this.pointerType = event.pointerType;
      });

      this.root.addEventListener('click', event => {
        this.triggerSwap(pointOf(event));
      });

      this.root.addEventListener('focus', event => {
        if (!hover || event.currentTarget.contains(event.relatedTarget)) return;
        this.focused = true;
        this.go(true, null);
      });

      this.root.addEventListener('blur', event => {
        if (!this.focused || event.currentTarget.contains(event.relatedTarget)) return;
        this.focused = false;
        if (!this.hovering) this.go(false, null);
      });

      this.root.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.triggerSwap(null);
      });
    }

    initResize() {
      const resize = () => {
        this.state.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.round(this.root.clientWidth * this.state.dpr));
        this.canvas.height = Math.max(1, Math.round(this.root.clientHeight * this.state.dpr));
        this.draw();
      };

      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(resize);
        this.resizeObserver.observe(this.root);
      } else {
        window.addEventListener('resize', resize);
      }
      resize();
    }

    destroy() {
      this.alive = false;
      cancelAnimationFrame(this.raf);
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
    }
  }

  global.PixelTransition = PixelTransition;
})(typeof window !== 'undefined' ? window : globalThis);
