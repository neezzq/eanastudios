function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function processHalftone(
  original: HTMLCanvasElement,
  cellSize: number,
  exposure: number,
  gamma: number,
  darkColor: string,
  lightColor: string
): HTMLCanvasElement {
  const w = original.width;
  const h = original.height;
  const result = document.createElement('canvas');
  result.width = w;
  result.height = h;

  const srcCtx = original.getContext('2d', { willReadFrequently: true });
  const src = srcCtx?.getImageData(0, 0, w, h).data;
  const ctx = result.getContext('2d');
  if (!ctx || !src) return result;

  const dark = hexToRgb(darkColor);
  const step = Math.max(3, Math.floor(cellSize));

  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `rgb(${dark.r}, ${dark.g}, ${dark.b})`;

  // Diamond lattice gives a retro clustered halftone look similar to the reference.
  const cx = w / 2;
  const cy = h / 2;
  const gxMin = Math.floor(-(w + h) / step);
  const gxMax = Math.ceil((w + h) / step);

  for (let gy = gxMin; gy <= gxMax; gy++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const x = cx + (gx - gy) * (step * 0.5);
      const y = cy + (gx + gy) * (step * 0.5);
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;

      const i = (iy * w + ix) * 4;
      const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      const normalized = clamp((lum / 255) * exposure, 0, 1);
      const shaped = Math.pow(normalized, gamma);
      const darkness = 1 - shaped;

      if (darkness < 0.03) continue;

      const radius = (step * 0.5) * darkness;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return result;
}