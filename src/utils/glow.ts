function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 255, g: 255, b: 255 };
}

export function processGlow(
  original: HTMLCanvasElement,
  radius: number,
  intensity: number,
  threshold: number,
  color: string
): HTMLCanvasElement {
  const w = original.width;
  const h = original.height;

  // Step 1: Extract bright areas
  const bright = document.createElement('canvas');
  bright.width = w;
  bright.height = h;
  const bCtx = bright.getContext('2d', { willReadFrequently: true })!;
  bCtx.drawImage(original, 0, 0);

  const imgData = bCtx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const rgb = hexToRgb(color);

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < threshold) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    } else {
      const t =
        Math.min(1, (lum - threshold) / Math.max(1, 255 - threshold)) *
        intensity;
      data[i] = Math.min(255, Math.round(rgb.r * t));
      data[i + 1] = Math.min(255, Math.round(rgb.g * t));
      data[i + 2] = Math.min(255, Math.round(rgb.b * t));
      data[i + 3] = Math.min(255, Math.round(255 * Math.min(1, t)));
    }
  }
  bCtx.putImageData(imgData, 0, 0);

  // Step 2: Multi-pass bloom for rich glow
  const result = document.createElement('canvas');
  result.width = w;
  result.height = h;
  const rCtx = result.getContext('2d')!;

  // Large blur pass
  const p1 = document.createElement('canvas');
  p1.width = w;
  p1.height = h;
  const p1Ctx = p1.getContext('2d')!;
  p1Ctx.filter = `blur(${radius * 2}px)`;
  p1Ctx.drawImage(bright, 0, 0);

  // Medium blur pass
  const p2 = document.createElement('canvas');
  p2.width = w;
  p2.height = h;
  const p2Ctx = p2.getContext('2d')!;
  p2Ctx.filter = `blur(${radius}px)`;
  p2Ctx.drawImage(bright, 0, 0);

  // Small blur pass (sharp inner glow)
  const p3 = document.createElement('canvas');
  p3.width = w;
  p3.height = h;
  const p3Ctx = p3.getContext('2d')!;
  p3Ctx.filter = `blur(${Math.max(1, radius * 0.3)}px)`;
  p3Ctx.drawImage(bright, 0, 0);

  // Composite all passes
  rCtx.globalAlpha = 0.5;
  rCtx.drawImage(p1, 0, 0);
  rCtx.globalAlpha = 0.7;
  rCtx.drawImage(p2, 0, 0);
  rCtx.globalAlpha = 1.0;
  rCtx.drawImage(p3, 0, 0);
  rCtx.globalAlpha = 1.0;

  return result;
}
