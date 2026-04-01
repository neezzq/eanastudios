/* ── All 10 new effects ── */

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function clamp(v: number, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }

/* ───────────── 1. GLITCH ───────────── */
export interface GlitchSettings {
  intensity: number;   // 0–1
  bands: number;       // 1–30
  rgbShift: number;    // 0–40
  seed: number;        // 0–100
}

export function processGlitch(src: HTMLCanvasElement, s: GlitchSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);

  const rng = mulberry32(Math.floor(s.seed * 1337));

  // RGB channel shift
  if (s.rgbShift > 0) {
    const id = ctx.getImageData(0, 0, W, H);
    const orig = new Uint8ClampedArray(id.data);
    const shift = Math.round(s.rgbShift);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        // Red channel shifted right
        const rx = Math.min(W - 1, x + shift);
        const ri = (y * W + rx) * 4;
        id.data[i] = orig[ri];
        // Blue channel shifted left
        const bx = Math.max(0, x - shift);
        const bi = (y * W + bx) * 4;
        id.data[i + 2] = orig[bi + 2];
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // Glitch bands (horizontal shifts)
  if (s.intensity > 0 && s.bands > 0) {
    const bandCount = Math.round(s.bands);
    for (let b = 0; b < bandCount; b++) {
      const y = Math.floor(rng() * H);
      const h = Math.max(2, Math.floor(rng() * 20 * s.intensity));
      const shift = Math.floor((rng() - 0.5) * 60 * s.intensity);
      if (y + h <= H && Math.abs(shift) > 0) {
        const strip = ctx.getImageData(0, y, W, h);
        ctx.putImageData(strip, shift, y);
        // Color tint on the band
        ctx.save();
        ctx.globalAlpha = 0.15 * s.intensity;
        ctx.fillStyle = rng() > 0.5 ? '#ff0040' : '#00ffaa';
        ctx.fillRect(0, y, W, h);
        ctx.restore();
      }
    }
  }

  return out;
}

/* ───────────── 2. CHROMATIC ABERRATION ───────────── */
export interface ChromaticSettings {
  offsetR: number;  // -30..30
  offsetB: number;  // -30..30
  radial: number;   // 0..1 — radial falloff from center
}

export function processChromatic(src: HTMLCanvasElement, s: ChromaticSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const orig = srcCtx.getImageData(0, 0, W, H);
  const od = orig.data;
  const result = ctx.createImageData(W, H);
  const rd = result.data;

  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;

      // Radial factor
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = s.radial > 0 ? Math.pow(dist / maxR, 1.5) * s.radial + (1 - s.radial) : 1;

      const oR = Math.round(s.offsetR * factor);
      const oB = Math.round(s.offsetB * factor);

      // Red channel
      const rx = clamp(x + oR, 0, W - 1);
      const ri = (y * W + rx) * 4;
      rd[i] = od[ri];

      // Green channel — no shift
      rd[i + 1] = od[i + 1];

      // Blue channel
      const bx = clamp(x + oB, 0, W - 1);
      const bi = (y * W + bx) * 4;
      rd[i + 2] = od[bi + 2];

      rd[i + 3] = od[i + 3];
    }
  }

  ctx.putImageData(result, 0, 0);
  return out;
}

/* ───────────── 3. PIXELATE / MOSAIC ───────────── */
export interface PixelateSettings {
  blockSize: number;  // 2–64
  shape: 'square' | 'circle';
}

export function processPixelate(src: HTMLCanvasElement, s: PixelateSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const orig = srcCtx.getImageData(0, 0, W, H);
  const od = orig.data;

  const bs = Math.max(2, Math.round(s.blockSize));

  if (s.shape === 'circle') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }

  for (let by = 0; by < H; by += bs) {
    for (let bx = 0; bx < W; bx += bs) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      const bw = Math.min(bs, W - bx);
      const bh = Math.min(bs, H - by);
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const i = ((by + dy) * W + (bx + dx)) * 4;
          r += od[i]; g += od[i + 1]; b += od[i + 2]; a += od[i + 3];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      a = Math.round(a / count);

      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      if (s.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(bx + bw / 2, by + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(bx, by, bw, bh);
      }
    }
  }

  return out;
}

/* ───────────── 4. BLUR / MOTION BLUR ───────────── */
export interface BlurSettings {
  type: 'gaussian' | 'motion' | 'zoom';
  radius: number;     // 1–40
  angle: number;      // 0–360 (for motion blur)
}

export function processBlur(src: HTMLCanvasElement, s: BlurSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  if (s.type === 'gaussian') {
    ctx.filter = `blur(${s.radius}px)`;
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
  } else if (s.type === 'motion') {
    const steps = Math.max(4, Math.round(s.radius * 1.5));
    const rad = (s.angle * Math.PI) / 180;
    const dx = Math.cos(rad) * s.radius / steps;
    const dy = Math.sin(rad) * s.radius / steps;
    ctx.globalAlpha = 1 / steps;
    for (let i = 0; i < steps; i++) {
      const ox = (i - steps / 2) * dx;
      const oy = (i - steps / 2) * dy;
      ctx.drawImage(src, ox, oy);
    }
    ctx.globalAlpha = 1;
  } else {
    // Zoom blur
    const steps = Math.max(6, Math.round(s.radius * 2));
    ctx.globalAlpha = 1 / steps;
    for (let i = 0; i < steps; i++) {
      const scale = 1 + (i - steps / 2) * (s.radius * 0.002);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  return out;
}

/* ───────────── 5. NOISE / GRAIN ───────────── */
export interface NoiseSettings {
  amount: number;     // 0–100
  monochrome: boolean;
  blend: 'overlay' | 'add' | 'screen';
}

export function processNoise(src: HTMLCanvasElement, s: NoiseSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const strength = s.amount * 2.55; // 0–255

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (s.monochrome) {
      const n = (Math.random() - 0.5) * strength;
      if (s.blend === 'add') {
        d[i] = clamp(d[i] + n);
        d[i + 1] = clamp(d[i + 1] + n);
        d[i + 2] = clamp(d[i + 2] + n);
      } else if (s.blend === 'screen') {
        const nv = 128 + n;
        d[i] = clamp(255 - ((255 - d[i]) * (255 - nv) / 255));
        d[i + 1] = clamp(255 - ((255 - d[i + 1]) * (255 - nv) / 255));
        d[i + 2] = clamp(255 - ((255 - d[i + 2]) * (255 - nv) / 255));
      } else {
        // overlay
        const nv = 128 + n;
        for (let c = 0; c < 3; c++) {
          const base = d[i + c] / 255;
          const blend = nv / 255;
          d[i + c] = clamp(Math.round((base <= 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend)) * 255));
        }
      }
    } else {
      for (let c = 0; c < 3; c++) {
        const n = (Math.random() - 0.5) * strength;
        d[i + c] = clamp(d[i + c] + n);
      }
    }
  }

  ctx.putImageData(id, 0, 0);
  return out;
}

/* ───────────── 6. VHS / CRT ───────────── */
export interface VHSSettings {
  scanlineOpacity: number;  // 0–1
  scanlineWidth: number;    // 1–6
  noise: number;            // 0–60
  colorBleed: number;       // 0–20
  warp: number;             // 0–0.05
}

export function processVHS(src: HTMLCanvasElement, s: VHSSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  // Color bleed (horizontal chroma shift)
  if (s.colorBleed > 0) {
    const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
    const orig = srcCtx.getImageData(0, 0, W, H);
    const result = ctx.createImageData(W, H);
    const od = orig.data, rd = result.data;
    const shift = Math.round(s.colorBleed);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rd[i] = od[i]; // R stays
        const gx = clamp(x + Math.round(shift * 0.5), 0, W - 1);
        rd[i + 1] = od[(y * W + gx) * 4 + 1];
        const bx = clamp(x + shift, 0, W - 1);
        rd[i + 2] = od[(y * W + bx) * 4 + 2];
        rd[i + 3] = od[i + 3];
      }
    }
    ctx.putImageData(result, 0, 0);
  } else {
    ctx.drawImage(src, 0, 0);
  }

  // Barrel warp (subtle CRT curve)
  if (s.warp > 0.001) {
    const tmpCanvas = makeCanvas(W, H);
    const tmpCtx = tmpCanvas.getContext('2d')!;
    const warped = ctx.getImageData(0, 0, W, H);
    const result = tmpCtx.createImageData(W, H);
    const wd = warped.data, rd = result.data;
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let nx = (x - cx) / cx;
        let ny = (y - cy) / cy;
        const r2 = nx * nx + ny * ny;
        const factor = 1 + s.warp * r2;
        nx *= factor; ny *= factor;
        const sx = Math.round(nx * cx + cx);
        const sy = Math.round(ny * cy + cy);
        const di = (y * W + x) * 4;
        if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
          const si = (sy * W + sx) * 4;
          rd[di] = wd[si]; rd[di+1] = wd[si+1]; rd[di+2] = wd[si+2]; rd[di+3] = wd[si+3];
        }
      }
    }
    ctx.putImageData(result, 0, 0);
  }

  // Scanlines
  if (s.scanlineOpacity > 0) {
    const sw = Math.max(1, Math.round(s.scanlineWidth));
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${s.scanlineOpacity})`;
    for (let y = 0; y < H; y += sw * 2) {
      ctx.fillRect(0, y, W, sw);
    }
    ctx.restore();
  }

  // Noise
  if (s.noise > 0) {
    const id = ctx.getImageData(0, 0, W, H);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const n = (Math.random() - 0.5) * s.noise;
      d[i] = clamp(d[i] + n);
      d[i + 1] = clamp(d[i + 1] + n * 0.8);
      d[i + 2] = clamp(d[i + 2] + n);
    }
    ctx.putImageData(id, 0, 0);
  }

  return out;
}

/* ───────────── 7. BLOOM ───────────── */
export interface BloomSettings {
  radius: number;     // 1–60
  intensity: number;  // 0–3
  threshold: number;  // 0–255
  softness: number;   // 0–1
}

export function processBloom(src: HTMLCanvasElement, s: BloomSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);

  // Extract bright areas
  const bright = makeCanvas(W, H);
  const bCtx = bright.getContext('2d')!;
  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const id = srcCtx.getImageData(0, 0, W, H);
  const bd = bCtx.createImageData(W, H);

  for (let i = 0; i < id.data.length; i += 4) {
    const lum = id.data[i] * 0.299 + id.data[i + 1] * 0.587 + id.data[i + 2] * 0.114;
    const t = s.threshold;
    const softT = Math.max(0.01, s.softness * 60);
    // Smooth threshold via sigmoid-like curve
    const factor = clamp((lum - t + softT) / (softT * 2), 0, 1);
    bd.data[i]     = id.data[i]     * factor;
    bd.data[i + 1] = id.data[i + 1] * factor;
    bd.data[i + 2] = id.data[i + 2] * factor;
    bd.data[i + 3] = id.data[i + 3];
  }
  bCtx.putImageData(bd, 0, 0);

  // Multi-pass blur for bloom
  const passes = [s.radius, s.radius * 1.5, s.radius * 2.5];
  for (const r of passes) {
    const blurred = makeCanvas(W, H);
    const blurCtx = blurred.getContext('2d')!;
    blurCtx.filter = `blur(${Math.round(r)}px)`;
    blurCtx.drawImage(bright, 0, 0);
    blurCtx.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = s.intensity / passes.length;
    ctx.drawImage(blurred, 0, 0);
    ctx.restore();
  }

  return out;
}

/* ───────────── 8. EMBOSS / EDGE ───────────── */
export interface EmbossSettings {
  type: 'emboss' | 'edge' | 'outline';
  strength: number;  // 0.5–3
  mix: number;       // 0–1 original mix
}

export function processEmboss(src: HTMLCanvasElement, s: EmbossSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const orig = srcCtx.getImageData(0, 0, W, H);
  const od = orig.data;
  const result = ctx.createImageData(W, H);
  const rd = result.data;

  let kernelX: number[], kernelY: number[];

  if (s.type === 'emboss') {
    // Emboss kernel
    kernelX = [-2, -1, 0, -1, 1, 1, 0, 1, 2];
    kernelY = kernelX; // same kernel for emboss
  } else {
    // Sobel
    kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  }

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let gx = 0, gy = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const pi = ((y + ky) * W + (x + kx)) * 4;
          const gray = od[pi] * 0.299 + od[pi + 1] * 0.587 + od[pi + 2] * 0.114;
          gx += gray * kernelX[ki];
          gy += gray * kernelY[ki];
          ki++;
        }
      }

      const i = (y * W + x) * 4;
      let val: number;

      if (s.type === 'emboss') {
        val = clamp(128 + gx * s.strength);
        // Mix with original
        rd[i]     = clamp(val * (1 - s.mix) + od[i] * s.mix);
        rd[i + 1] = clamp(val * (1 - s.mix) + od[i + 1] * s.mix);
        rd[i + 2] = clamp(val * (1 - s.mix) + od[i + 2] * s.mix);
      } else if (s.type === 'edge') {
        val = clamp(Math.sqrt(gx * gx + gy * gy) * s.strength);
        rd[i]     = clamp(val * (1 - s.mix) + od[i] * s.mix);
        rd[i + 1] = clamp(val * (1 - s.mix) + od[i + 1] * s.mix);
        rd[i + 2] = clamp(val * (1 - s.mix) + od[i + 2] * s.mix);
      } else {
        // outline: inverted edge on white
        val = clamp(Math.sqrt(gx * gx + gy * gy) * s.strength);
        const inv = 255 - val;
        rd[i]     = clamp(inv * (1 - s.mix) + od[i] * s.mix);
        rd[i + 1] = clamp(inv * (1 - s.mix) + od[i + 1] * s.mix);
        rd[i + 2] = clamp(inv * (1 - s.mix) + od[i + 2] * s.mix);
      }
      rd[i + 3] = od[i + 3];
    }
  }

  // Copy edges
  for (let x = 0; x < W; x++) {
    const t = x * 4;
    const b = ((H - 1) * W + x) * 4;
    rd[t] = od[t]; rd[t+1] = od[t+1]; rd[t+2] = od[t+2]; rd[t+3] = od[t+3];
    rd[b] = od[b]; rd[b+1] = od[b+1]; rd[b+2] = od[b+2]; rd[b+3] = od[b+3];
  }
  for (let y = 0; y < H; y++) {
    const l = (y * W) * 4;
    const r2 = (y * W + W - 1) * 4;
    rd[l] = od[l]; rd[l+1] = od[l+1]; rd[l+2] = od[l+2]; rd[l+3] = od[l+3];
    rd[r2] = od[r2]; rd[r2+1] = od[r2+1]; rd[r2+2] = od[r2+2]; rd[r2+3] = od[r2+3];
  }

  ctx.putImageData(result, 0, 0);
  return out;
}

/* ───────────── 9. POSTERIZE ───────────── */
export interface PosterizeSettings {
  levels: number;     // 2–32
  gamma: number;      // 0.5–2
}

export function processPosterize(src: HTMLCanvasElement, s: PosterizeSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const levels = Math.max(2, Math.round(s.levels));

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] / 255;
      v = Math.pow(v, s.gamma);
      v = Math.round(v * (levels - 1)) / (levels - 1);
      v = Math.pow(v, 1 / s.gamma);
      d[i + c] = clamp(Math.round(v * 255));
    }
  }

  ctx.putImageData(id, 0, 0);
  return out;
}

/* ───────────── 10. DUOTONE ───────────── */
export interface DuotoneSettings {
  darkColor: string;   // hex
  lightColor: string;  // hex
  contrast: number;    // 0.5–2
}

function hexToRGB(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function processDuotone(src: HTMLCanvasElement, s: DuotoneSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  const dark = hexToRGB(s.darkColor);
  const light = hexToRGB(s.lightColor);

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    // Apply contrast
    lum = clamp(((lum - 0.5) * s.contrast + 0.5) * 255, 0, 255) / 255;
    // Interpolate
    d[i]     = clamp(Math.round(dark[0] + (light[0] - dark[0]) * lum));
    d[i + 1] = clamp(Math.round(dark[1] + (light[1] - dark[1]) * lum));
    d[i + 2] = clamp(Math.round(dark[2] + (light[2] - dark[2]) * lum));
  }

  ctx.putImageData(id, 0, 0);
  return out;
}

/* ── Deterministic PRNG for glitch seed ── */
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
