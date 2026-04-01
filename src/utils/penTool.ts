/* ── Pen Tool: Bezier path editing utility ── */

export interface AnchorPoint {
  x: number;
  y: number;
  /** Control handle in (from previous segment). Relative to anchor. */
  cpIn: { x: number; y: number };
  /** Control handle out (to next segment). Relative to anchor. */
  cpOut: { x: number; y: number };
  /** Is this a corner (independent handles) or smooth (mirrored handles)? */
  smooth: boolean;
}

export interface PenPath {
  id: string;
  points: AnchorPoint[];
  closed: boolean;
}

/** Create a new anchor point at position */
export function createAnchor(x: number, y: number): AnchorPoint {
  return { x, y, cpIn: { x: 0, y: 0 }, cpOut: { x: 0, y: 0 }, smooth: true };
}

/** Evaluate cubic bezier at t ∈ [0,1] */
function cubicBez(p0: number, c0: number, c1: number, p1: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c0 + 3 * u * t * t * c1 + t * t * t * p1;
}

/** Get absolute control point position */
function absCpOut(pt: AnchorPoint) {
  return { x: pt.x + pt.cpOut.x, y: pt.y + pt.cpOut.y };
}
function absCpIn(pt: AnchorPoint) {
  return { x: pt.x + pt.cpIn.x, y: pt.y + pt.cpIn.y };
}

/** Build a canvas Path2D from a PenPath */
export function penPathToPath2D(path: PenPath): Path2D {
  const p2d = new Path2D();
  const pts = path.points;
  if (pts.length < 2) return p2d;

  p2d.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const co = absCpOut(prev);
    const ci = absCpIn(curr);
    p2d.bezierCurveTo(co.x, co.y, ci.x, ci.y, curr.x, curr.y);
  }

  if (path.closed && pts.length > 2) {
    const last = pts[pts.length - 1];
    const first = pts[0];
    const co = absCpOut(last);
    const ci = absCpIn(first);
    p2d.bezierCurveTo(co.x, co.y, ci.x, ci.y, first.x, first.y);
    p2d.closePath();
  }

  return p2d;
}

/** Flatten bezier path to polygon points for rendering/hit-testing */
export function flattenPath(path: PenPath, steps = 20): { x: number; y: number }[] {
  const pts = path.points;
  if (pts.length < 2) return pts.map(p => ({ x: p.x, y: p.y }));

  const result: { x: number; y: number }[] = [];
  const segCount = path.closed ? pts.length : pts.length - 1;

  for (let i = 0; i < segCount; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const c0 = absCpOut(p0);
    const c1 = absCpIn(p1);

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      result.push({
        x: cubicBez(p0.x, c0.x, c1.x, p1.x, t),
        y: cubicBez(p0.y, c0.y, c1.y, p1.y, t),
      });
    }
  }

  return result;
}

/** Draw pen path editor UI on a canvas context */
export function drawPenPathUI(
  ctx: CanvasRenderingContext2D,
  path: PenPath,
  activeIdx: number | null,
  hoverIdx: number | null,
  scale: number
) {
  const pts = path.points;
  if (pts.length === 0) return;

  const r = Math.max(3, 4 / scale);
  const hr = Math.max(2.5, 3 / scale);
  const lw = Math.max(1, 1.2 / scale);

  ctx.save();

  // Draw curve
  if (pts.length >= 2) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const co = absCpOut(prev);
      const ci = absCpIn(curr);
      ctx.bezierCurveTo(co.x, co.y, ci.x, ci.y, curr.x, curr.y);
    }

    if (path.closed && pts.length > 2) {
      const last = pts[pts.length - 1];
      const first = pts[0];
      const co = absCpOut(last);
      const ci = absCpIn(first);
      ctx.bezierCurveTo(co.x, co.y, ci.x, ci.y, first.x, first.y);
    }

    ctx.stroke();
  }

  // Draw control handles
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const isActive = i === activeIdx;
    const isHover = i === hoverIdx;

    // Handle lines
    const hasCpOut = Math.abs(pt.cpOut.x) > 0.5 || Math.abs(pt.cpOut.y) > 0.5;
    const hasCpIn = Math.abs(pt.cpIn.x) > 0.5 || Math.abs(pt.cpIn.y) > 0.5;

    if (isActive || isHover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = lw * 0.7;
      ctx.setLineDash([3 / scale, 3 / scale]);

      if (hasCpOut) {
        const co = absCpOut(pt);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(co.x, co.y);
        ctx.stroke();

        // Handle dot
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(co.x, co.y, hr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (hasCpIn) {
        const ci = absCpIn(pt);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(ci.x, ci.y);
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ci.x, ci.y, hr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.setLineDash([]);

    // Anchor point
    ctx.fillStyle = isActive ? '#fff' : isHover ? '#ccc' : '#000';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Close indicator
    if (i === 0 && pts.length > 2 && !path.closed) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Hit test — returns { type, idx } or null */
export type PenHitResult =
  | { type: 'anchor'; idx: number }
  | { type: 'cpIn'; idx: number }
  | { type: 'cpOut'; idx: number }
  | { type: 'close' }
  | null;

export function hitTestPenPath(
  path: PenPath,
  px: number,
  py: number,
  threshold: number
): PenHitResult {
  const t2 = threshold * threshold;
  const pts = path.points;

  // Check close indicator first (first point circle)
  if (!path.closed && pts.length > 2) {
    const fp = pts[0];
    if ((px - fp.x) ** 2 + (py - fp.y) ** 2 < (threshold * 2.5) ** 2) {
      return { type: 'close' };
    }
  }

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];

    // Anchor
    if ((px - pt.x) ** 2 + (py - pt.y) ** 2 < t2) {
      return { type: 'anchor', idx: i };
    }

    // Control handles
    const co = absCpOut(pt);
    if ((px - co.x) ** 2 + (py - co.y) ** 2 < t2) {
      return { type: 'cpOut', idx: i };
    }

    const ci = absCpIn(pt);
    if ((px - ci.x) ** 2 + (py - ci.y) ** 2 < t2) {
      return { type: 'cpIn', idx: i };
    }
  }

  return null;
}

/** Mirror a smooth handle: when moving cpOut, cpIn is mirrored and vice versa */
export function mirrorHandle(
  pt: AnchorPoint,
  which: 'cpIn' | 'cpOut'
): AnchorPoint {
  if (!pt.smooth) return pt;
  const src = which === 'cpOut' ? pt.cpOut : pt.cpIn;
  const len = Math.sqrt(src.x ** 2 + src.y ** 2);
  if (len < 0.5) return pt;

  const other = which === 'cpOut' ? 'cpIn' : 'cpOut';
  const otherLen = Math.sqrt(pt[other].x ** 2 + pt[other].y ** 2);
  const keepLen = otherLen > 0.5 ? otherLen : len;

  const newOther = {
    x: (-src.x / len) * keepLen,
    y: (-src.y / len) * keepLen,
  };

  return { ...pt, [other]: newOther };
}
