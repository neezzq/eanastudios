/* ── Neon Glow, Motion Blur, Text Fill, Sparkle ── */

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function clamp(v: number, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
void clamp;

/* ───────────── helpers ───────────── */
function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
  const v = parseInt(full || 'ffffff', 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ───────────── NEON GLOW ───────────── */
export interface NeonGlowSettings {
  radius: number;
  intensity: number;
  threshold: number;
  color1: string;
  color2: string;
  colorMix: number;
  edgeGlow: number;
  pulsePhase: number;
}

export function processNeonGlow(src: HTMLCanvasElement, s: NeonGlowSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;

  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const srcData = srcCtx.getImageData(0, 0, W, H);
  const sd = srcData.data;

  const edges = new Float32Array(W * H);
  if (s.edgeGlow > 0) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        const lumL = sd[i - 4] * 0.299 + sd[i - 3] * 0.587 + sd[i - 2] * 0.114;
        const lumR = sd[i + 4] * 0.299 + sd[i + 5] * 0.587 + sd[i + 6] * 0.114;
        const up = ((y - 1) * W + x) * 4;
        const dn = ((y + 1) * W + x) * 4;
        const lumU = sd[up] * 0.299 + sd[up + 1] * 0.587 + sd[up + 2] * 0.114;
        const lumD = sd[dn] * 0.299 + sd[dn + 1] * 0.587 + sd[dn + 2] * 0.114;
        const gx = Math.abs(lumR - lumL);
        const gy = Math.abs(lumD - lumU);
        edges[y * W + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 128);
      }
    }
  }

  const mask = makeCanvas(W, H);
  const maskCtx = mask.getContext('2d')!;
  const maskData = maskCtx.createImageData(W, H);
  const md = maskData.data;

  const [r1, g1, b1] = hexToRgb(s.color1);
  const [r2, g2, b2] = hexToRgb(s.color2);
  const phase = (s.pulsePhase / 360) * Math.PI * 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const alpha = sd[i + 3] / 255;
      const lum = sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114;
      const brightFactor = lum > s.threshold ? Math.pow((lum - s.threshold) / (255 - s.threshold + 1), 0.6) : 0;
      const edgeFactor = edges[y * W + x] * s.edgeGlow;
      const factor = Math.min(1, (brightFactor + edgeFactor) * alpha) * s.intensity;
      const spatialMix = (Math.sin(x * 0.02 + phase) * 0.5 + 0.5) * s.colorMix + (1 - s.colorMix) * 0.5;
      const r = r1 * (1 - spatialMix) + r2 * spatialMix;
      const g = g1 * (1 - spatialMix) + g2 * spatialMix;
      const b = b1 * (1 - spatialMix) + b2 * spatialMix;
      md[i] = clamp(r * factor);
      md[i + 1] = clamp(g * factor);
      md[i + 2] = clamp(b * factor);
      md[i + 3] = clamp(factor * 255);
    }
  }
  maskCtx.putImageData(maskData, 0, 0);

  ctx.drawImage(src, 0, 0);
  const passes = [
    { r: s.radius * 0.3, alpha: 0.9 },
    { r: s.radius * 0.7, alpha: 0.7 },
    { r: s.radius * 1.2, alpha: 0.5 },
    { r: s.radius * 2.0, alpha: 0.3 },
  ];

  for (const pass of passes) {
    const tmp = makeCanvas(W, H);
    const tCtx = tmp.getContext('2d')!;
    tCtx.filter = `blur(${Math.max(1, Math.round(pass.r))}px)`;
    tCtx.drawImage(mask, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = pass.alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.8;
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
  return out;
}

/* ───────────── MOTION BLUR ───────────── */
export interface MotionBlurSettings {
  angle: number;
  distance: number;
  samples: number;
  opacity: number;
}

export function processMotionBlur(src: HTMLCanvasElement, s: MotionBlurSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  const angleRad = (s.angle * Math.PI) / 180;
  const dx = Math.cos(angleRad) * s.distance;
  const dy = Math.sin(angleRad) * s.distance;
  const samples = Math.max(3, Math.min(32, Math.round(s.samples)));
  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) - 0.5;
    const ox = dx * t;
    const oy = dy * t;
    const dist = Math.abs(t) * 2;
    const alpha = (1 - dist * (1 - s.opacity)) / samples;
    ctx.save();
    ctx.globalAlpha = Math.max(0.01, alpha * 2);
    ctx.drawImage(src, ox, oy);
    ctx.restore();
  }
  return out;
}

/* ───────────── TEXT FILL ───────────── */
export interface TextFillSettings {
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: string;
  color: string;
  bgColor: string;
  randomize: boolean;
  randomSeed: number;
  density: number;
  fillOpaque: boolean;
  showOriginalColor: boolean;
}

export function processTextFill(src: HTMLCanvasElement, s: TextFillSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const srcData = srcCtx.getImageData(0, 0, W, H);
  const sd = srcData.data;

  if (s.bgColor && s.bgColor.toLowerCase() !== 'transparent' && s.bgColor !== 'rgba(0,0,0,0)') {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
  }

  const text = s.text || 'HELLO WORLD ';
  const fontSize = Math.max(4, s.fontSize);
  const lineH = fontSize * s.lineHeight;
  const font = `${fontSize}px "${s.fontFamily}", "Space Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.font = font;
  ctx.textBaseline = 'top';

  const rng = mulberry32(Math.floor(s.randomSeed * 9999) + 1);
  const cleanChars = text.length ? text.split('') : [' '];
  
  if (s.fillOpaque) {
    const measureBase = ctx.measureText('M').width;
    const avgCharW = Math.max(1, (measureBase + s.letterSpacing) * (1 / Math.max(0.25, s.density)));
    const totalLines = Math.max(1, Math.ceil(H / lineH));
    let charIdx = 0;
    for (let row = 0; row < totalLines; row++) {
      const y = row * lineH;
      let x = 0;
      while (x < W) {
        const ch = s.randomize ? cleanChars[Math.floor(rng() * cleanChars.length)] : cleanChars[charIdx % cleanChars.length];
        charIdx++;
        const sx = Math.min(W - 1, Math.max(0, Math.round(x)));
        const sy = Math.min(H - 1, Math.max(0, Math.round(y)));
        const si = (sy * W + sx) * 4;
        if (sd[si + 3] > 20) {
          ctx.fillStyle = s.showOriginalColor ? `rgb(${sd[si]},${sd[si+1]},${sd[si+2]})` : s.color;
          ctx.fillText(ch, x, y);
        }
        x += avgCharW;
      }
    }
  } else {
    let y = 0;
    let charIdx = 0;
    while(y < H) {
        let x = 0;
        while(x < W) {
            const ch = s.randomize ? cleanChars[Math.floor(rng() * cleanChars.length)] : cleanChars[charIdx % cleanChars.length];
            charIdx++;
            ctx.fillStyle = s.color;
            ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width + s.letterSpacing;
        }
        y += lineH;
    }
  }

  if (s.fillOpaque) {
    const alphaCanvas = makeCanvas(W, H);
    const alphaCtx = alphaCanvas.getContext('2d')!;
    const alphaData = alphaCtx.createImageData(W, H);
    for (let i = 0; i < sd.length; i += 4) {
      alphaData.data[i] = 255;
      alphaData.data[i + 1] = 255;
      alphaData.data[i + 2] = 255;
      alphaData.data[i + 3] = sd[i + 3];
    }
    alphaCtx.putImageData(alphaData, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(alphaCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  return out;
}

/* ───────────── SPARKLE / STAR FILTER ───────────── */
export interface SparkleSettings {
  threshold: number;
  intensity: number;
  size: number;
  streaks: number;
  angle: number;
  color: string;
  rainbow: number;
}

export function processSparkle(src: HTMLCanvasElement, s: SparkleSettings): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d')!;
  const srcCtx = src.getContext('2d', { willReadFrequently: true })!;
  const { data } = srcCtx.getImageData(0, 0, W, H);
  ctx.drawImage(src, 0, 0);

  const [cr, cg, cb] = hexToRgb(s.color);
  const maxPoints = Math.max(12, Math.round((W * H) / 18000));
  const points: { x: number; y: number; lum: number; a: number }[] = [];

  for (let y = 2; y < H - 2; y += 2) {
    for (let x = 2; x < W - 2; x += 2) {
      const i = (y * W + x) * 4;
      const a = data[i + 3] / 255;
      if (a <= 0.02) continue;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < s.threshold) continue;
      const left = ((y * W + (x - 2)) * 4);
      const right = ((y * W + (x + 2)) * 4);
      const up = ((((y - 2) * W + x) * 4));
      const down = ((((y + 2) * W + x) * 4));
      const localPeak = lum >= (data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114)
        && lum >= (data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114)
        && lum >= (data[up] * 0.299 + data[up + 1] * 0.587 + data[up + 2] * 0.114)
        && lum >= (data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114);
      if (localPeak) points.push({ x, y, lum, a });
    }
  }

  points.sort((p1, p2) => p2.lum - p1.lum);
  const selected = points.slice(0, maxPoints);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let idx = 0; idx < selected.length; idx++) {
    const p = selected[idx];
    const base = Math.max(6, s.size * ((p.lum - s.threshold) / Math.max(1, 255 - s.threshold) + 0.35));
    const alpha = Math.min(1, s.intensity * 0.16 + (p.lum / 255) * 0.35);
    const hueMix = s.rainbow > 0 ? (Math.sin((idx * 0.85) + s.angle * 0.05) * 0.5 + 0.5) * s.rainbow : 0;
    const rr = clamp(lerp(cr, 255, hueMix));
    const gg = clamp(lerp(cg, 220, hueMix * 0.7));
    const bb = clamp(lerp(cb, 255, hueMix));

    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, base * 0.7);
    grad.addColorStop(0, `rgba(${rr},${gg},${bb},${alpha})`);
    grad.addColorStop(0.35, `rgba(${rr},${gg},${bb},${alpha * 0.45})`);
    grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, base * 0.7, 0, Math.PI * 2);
    ctx.fill();

    const streakCount = Math.max(4, Math.round(s.streaks));
    for (let k = 0; k < streakCount; k++) {
      const ang = (s.angle * Math.PI / 180) + (Math.PI / streakCount) * k;
      const len = base * (k % 2 === 0 ? 2.2 : 1.3);
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alpha * (k % 2 === 0 ? 0.85 : 0.45)})`;
      ctx.lineWidth = Math.max(1, base * (k % 2 === 0 ? 0.12 : 0.08));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
      ctx.lineTo(p.x + Math.cos(ang) * len, p.y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  ctx.restore();
  return out;
}
