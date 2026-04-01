/**
 * LEGO Brick Effect
 * Renders each "cell" as a LEGO brick stud with coloured plate.
 */

export function processLego(
  src: HTMLCanvasElement,
  brickSize: number,      // px per brick cell
  saturation: number,     // 0..2  colour boost
  brightness: number,     // -100..100
  studOpacity: number,    // 0..1 visibility of the stud circle
  quantize: number,       // 4..64 number of colour levels per channel
  borderWidth: number,    // 0..4 dark border fraction
): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;

  // ── 1. Sample the source at low resolution ──────────────────────────────
  const cols = Math.ceil(W / brickSize);
  const rows = Math.ceil(H / brickSize);

  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  const sCtx = small.getContext('2d', { willReadFrequently: true })!;
  sCtx.drawImage(src, 0, 0, cols, rows);
  const raw = sCtx.getImageData(0, 0, cols, rows);

  // ── 2. Build output canvas ───────────────────────────────────────────────
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // quantize helper
  const q = (v: number) => {
    if (quantize <= 1) return v;
    const step = 255 / (quantize - 1);
    return Math.round(Math.round(v / step) * step);
  };

  // brightness / saturation helper
  const adjust = (r: number, g: number, b: number) => {
    // brightness
    const br = brightness / 100;
    let nr = r / 255 + br;
    let ng = g / 255 + br;
    let nb = b / 255 + br;

    // saturation
    const lum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
    nr = lum + (nr - lum) * saturation;
    ng = lum + (ng - lum) * saturation;
    nb = lum + (nb - lum) * saturation;

    // clamp + quantize
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return [q(clamp(nr)), q(clamp(ng)), q(clamp(nb))];
  };

  const border = Math.max(1, Math.round(brickSize * Math.min(borderWidth / 10, 0.4)));

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = (row * cols + col) * 4;
      const [nr, ng, nb] = adjust(raw.data[idx], raw.data[idx + 1], raw.data[idx + 2]);

      const x = col * brickSize;
      const y = row * brickSize;
      const bw = Math.min(brickSize, W - x);
      const bh = Math.min(brickSize, H - y);

      // ── Plate base ────────────────────────────────────────────────────
      ctx.fillStyle = `rgb(${nr},${ng},${nb})`;
      ctx.fillRect(x, y, bw, bh);

      // ── Inner shadow (gives depth) ────────────────────────────────────
      if (border > 0) {
        // top/left lighter edge
        ctx.fillStyle = `rgba(255,255,255,0.18)`;
        ctx.fillRect(x, y, bw, border);
        ctx.fillRect(x, y, border, bh);
        // bottom/right darker edge
        ctx.fillStyle = `rgba(0,0,0,0.35)`;
        ctx.fillRect(x, y + bh - border, bw, border);
        ctx.fillRect(x + bw - border, y, border, bh);
      }

      // ── Stud (circle on top) ─────────────────────────────────────────
      if (studOpacity > 0) {
        const padding = brickSize * 0.17;
        const cx = x + bw / 2;
        const cy = y + bh / 2;
        const r = Math.max(1, bw / 2 - padding);

        // stud base – slightly lighter than brick
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        const lighter = `rgba(255,255,255,${studOpacity * 0.25})`;
        ctx.fillStyle = lighter;
        ctx.fill();

        // stud rim highlight (top-left arc)
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.9);
        ctx.strokeStyle = `rgba(255,255,255,${studOpacity * 0.55})`;
        ctx.lineWidth = Math.max(1, r * 0.25);
        ctx.stroke();

        // stud rim shadow (bottom-right arc)
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 0.1, Math.PI * 0.9);
        ctx.strokeStyle = `rgba(0,0,0,${studOpacity * 0.45})`;
        ctx.lineWidth = Math.max(1, r * 0.22);
        ctx.stroke();
      }
    }
  }

  // ── 3. Thin dark grid lines between bricks ───────────────────────────────
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#000';
  // vertical
  for (let col = 1; col < cols; col++) {
    ctx.fillRect(col * brickSize - 1, 0, 1, H);
  }
  // horizontal
  for (let row = 1; row < rows; row++) {
    ctx.fillRect(0, row * brickSize - 1, W, 1);
  }
  ctx.globalAlpha = 1;

  return out;
}
