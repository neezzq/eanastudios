/* ── Smart Selection / Magic Wand ── */

/**
 * Flood-fill based magic wand selection.
 * Returns an alpha mask canvas (white = selected).
 *
 * @param source - source canvas to sample colors from
 * @param seedX - click X in canvas coords
 * @param seedY - click Y in canvas coords
 * @param tolerance - color distance threshold (0-255)
 * @param contiguous - if true, only flood-fill connected pixels; if false, select all similar pixels globally
 * @param edgeSmooth - anti-alias edge width in pixels
 */
export function magicWandSelect(
  source: HTMLCanvasElement,
  seedX: number,
  seedY: number,
  tolerance: number,
  contiguous: boolean,
  edgeSmooth: number
): HTMLCanvasElement {
  const W = source.width;
  const H = source.height;
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  const sx = Math.round(Math.max(0, Math.min(W - 1, seedX)));
  const sy = Math.round(Math.max(0, Math.min(H - 1, seedY)));
  const seedIdx = (sy * W + sx) * 4;
  const sR = data[seedIdx];
  const sG = data[seedIdx + 1];
  const sB = data[seedIdx + 2];
  const sA = data[seedIdx + 3];

  // Selection mask (1 = selected, 0 = not)
  const mask = new Uint8Array(W * H);
  const tol2 = tolerance * tolerance;

  function colorDist(idx: number): number {
    const dr = data[idx] - sR;
    const dg = data[idx + 1] - sG;
    const db = data[idx + 2] - sB;
    const da = data[idx + 3] - sA;
    // Weighted distance (perceptual)
    return (dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114 + da * da * 0.1);
  }

  if (contiguous) {
    // Flood fill (scanline algorithm for speed)
    const visited = new Uint8Array(W * H);
    const stack: number[] = [sx, sy];

    while (stack.length > 0) {
      const cy = stack.pop()!;
      const cx = stack.pop()!;
      const pi = cy * W + cx;
      if (visited[pi]) continue;
      visited[pi] = 1;

      const idx = pi * 4;
      if (colorDist(idx) > tol2) continue;

      mask[pi] = 1;

      if (cx > 0 && !visited[pi - 1]) { stack.push(cx - 1, cy); }
      if (cx < W - 1 && !visited[pi + 1]) { stack.push(cx + 1, cy); }
      if (cy > 0 && !visited[pi - W]) { stack.push(cx, cy - 1); }
      if (cy < H - 1 && !visited[pi + W]) { stack.push(cx, cy + 1); }
    }
  } else {
    // Global: select all pixels within tolerance
    for (let i = 0; i < W * H; i++) {
      if (colorDist(i * 4) <= tol2) {
        mask[i] = 1;
      }
    }
  }

  // Edge smoothing: blur the mask edges slightly
  const result = document.createElement('canvas');
  result.width = W;
  result.height = H;
  const rCtx = result.getContext('2d')!;
  const outData = rCtx.createImageData(W, H);
  const out = outData.data;

  if (edgeSmooth > 0) {
    // Simple box blur on mask for anti-aliasing
    const radius = Math.min(edgeSmooth, 5);
    const blurred = new Float32Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
              sum += mask[ny * W + nx];
              count++;
            }
          }
        }
        blurred[y * W + x] = sum / count;
      }
    }

    for (let i = 0; i < W * H; i++) {
      const v = Math.round(blurred[i] * 255);
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = v;
    }
  } else {
    for (let i = 0; i < W * H; i++) {
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = mask[i] ? 255 : 0;
    }
  }

  rCtx.putImageData(outData, 0, 0);
  return result;
}

/**
 * Edge-detect based smart object selection.
 * Uses simple edge detection + region growing to find object boundaries.
 * Works like "Select Subject" in Photoshop (simplified).
 *
 * @param source - source canvas
 * @param seedX - click X
 * @param seedY - click Y
 * @param sensitivity - edge sensitivity (lower = more inclusive, 0.05-1.0)
 */
export function smartObjectSelect(
  source: HTMLCanvasElement,
  seedX: number,
  seedY: number,
  sensitivity: number
): HTMLCanvasElement {
  const W = source.width;
  const H = source.height;
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // Convert to grayscale
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
  }

  // Compute gradient magnitude (Sobel-like)
  const gradient = new Float32Array(W * H);
  let maxGrad = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -gray[(y - 1) * W + (x - 1)] + gray[(y - 1) * W + (x + 1)]
        - 2 * gray[y * W + (x - 1)] + 2 * gray[y * W + (x + 1)]
        - gray[(y + 1) * W + (x - 1)] + gray[(y + 1) * W + (x + 1)];
      const gy =
        -gray[(y - 1) * W + (x - 1)] - 2 * gray[(y - 1) * W + x] - gray[(y - 1) * W + (x + 1)]
        + gray[(y + 1) * W + (x - 1)] + 2 * gray[(y + 1) * W + x] + gray[(y + 1) * W + (x + 1)];
      const mag = Math.sqrt(gx * gx + gy * gy);
      gradient[y * W + x] = mag;
      if (mag > maxGrad) maxGrad = mag;
    }
  }

  // Normalize gradient
  if (maxGrad > 0) {
    for (let i = 0; i < W * H; i++) gradient[i] /= maxGrad;
  }

  // Edge threshold based on sensitivity
  const edgeThreshold = sensitivity;

  // Region growing with edge-aware cost
  const mask = new Uint8Array(W * H);
  const visited = new Uint8Array(W * H);
  const sx = Math.round(Math.max(0, Math.min(W - 1, seedX)));
  const sy = Math.round(Math.max(0, Math.min(H - 1, seedY)));

  // BFS with priority (simple version)
  const queue: [number, number][] = [[sx, sy]];
  visited[sy * W + sx] = 1;
  mask[sy * W + sx] = 1;

  // Also use color similarity
  const seedIdx = (sy * W + sx) * 4;
  const sR = data[seedIdx], sG = data[seedIdx + 1], sB = data[seedIdx + 2];

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    const neighbors = [
      [cx - 1, cy], [cx + 1, cy],
      [cx, cy - 1], [cx, cy + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;

      // Check if we cross a strong edge
      if (gradient[ni] >= edgeThreshold) continue;

      // Also check color similarity (less strict)
      const nIdx = ni * 4;
      const dr = data[nIdx] - sR;
      const dg = data[nIdx + 1] - sG;
      const db = data[nIdx + 2] - sB;
      const cdist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (cdist > 300 * (1 - sensitivity * 0.5)) continue;

      mask[ni] = 1;
      queue.push([nx, ny]);
    }
  }

  // Morphological close (dilate then erode) for cleaner edges
  const dilated = morphOp(mask, W, H, 2, 'dilate');
  const closed = morphOp(dilated, W, H, 2, 'erode');

  // Smooth edges
  const blurred = blurMask(closed, W, H, 2);

  // Output
  const result = document.createElement('canvas');
  result.width = W;
  result.height = H;
  const rCtx = result.getContext('2d')!;
  const outData = rCtx.createImageData(W, H);
  const out = outData.data;

  for (let i = 0; i < W * H; i++) {
    const v = Math.round(blurred[i] * 255);
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = v;
  }

  rCtx.putImageData(outData, 0, 0);
  return result;
}

function morphOp(mask: Uint8Array, W: number, H: number, radius: number, op: 'dilate' | 'erode'): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = op === 'dilate' ? 0 : 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            const v = mask[ny * W + nx];
            if (op === 'dilate') { if (v > best) best = v; }
            else { if (v < best) best = v; }
          }
        }
      }
      out[y * W + x] = best;
    }
  }
  return out;
}

function blurMask(mask: Uint8Array, W: number, H: number, radius: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            sum += mask[ny * W + nx];
            count++;
          }
        }
      }
      out[y * W + x] = sum / count;
    }
  }
  return out;
}
