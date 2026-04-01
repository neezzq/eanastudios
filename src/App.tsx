import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Download, Eraser, Pen, Eye, EyeOff,
  ChevronUp, ChevronDown, Trash2, Grid3X3,
  Layers, GripVertical, PaintBucket, Circle,
  Play, Pause, Film, Minus, Plus, Square,
} from 'lucide-react';
import { processDither } from './utils/dither';
import { processGlow } from './utils/glow';
import { processHalftone } from './utils/halftone';
import { processLego } from './utils/lego';
import { cn } from './utils/cn';

/* ─────────────────────────── Types ─────────────────────────── */
type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'luminosity';

type MediaKind = 'image' | 'video';
type ToolMode = 'none' | 'brush' | 'erase' | 'select-rect' | 'select-ellipse';
type SelectionCombine = 'replace' | 'add' | 'subtract';
type LayerType = 'dither' | 'glow' | 'halftone' | 'lego';

interface DitherSettings {
  pixelSize: number; matrixSize: number;
  brightness: number; contrast: number;
  darkColor: string; lightColor: string;
}
interface GlowSettings {
  radius: number; intensity: number; threshold: number; color: string;
}
interface HalftoneSettings {
  cellSize: number; exposure: number; gamma: number;
  darkColor: string; lightColor: string;
}
interface LegoSettings {
  brickSize: number; saturation: number; brightness: number;
  studOpacity: number; quantize: number; borderWidth: number;
}
interface EffectLayer {
  id: string; name: string; type: LayerType;
  enabled: boolean; opacity: number; blendMode: BlendMode;
  useMask: boolean;
  settings: DitherSettings | GlowSettings | HalftoneSettings | LegoSettings;
}
interface SelectionShape {
  id: string; type: 'rect' | 'ellipse'; combine: SelectionCombine;
  x: number; y: number; w: number; h: number;
}
interface DraftSelection {
  type: 'rect' | 'ellipse'; combine: SelectionCombine;
  startX: number; startY: number; endX: number; endY: number;
}

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply',    label: 'Multiply' },
  { value: 'screen',      label: 'Screen' },
  { value: 'overlay',     label: 'Overlay' },
  { value: 'darken',      label: 'Darken' },
  { value: 'lighten',     label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn',  label: 'Color Burn' },
  { value: 'hard-light',  label: 'Hard Light' },
  { value: 'soft-light',  label: 'Soft Light' },
  { value: 'difference',  label: 'Difference' },
  { value: 'exclusion',   label: 'Exclusion' },
  { value: 'luminosity',  label: 'Luminosity' },
];

let nextId = 1;
const uid = () => `id-${nextId++}`;

function defaultDither(): EffectLayer {
  return {
    id: uid(), name: 'Dither', type: 'dither',
    enabled: true, opacity: 1, blendMode: 'source-over', useMask: false,
    settings: { pixelSize: 3, matrixSize: 4, brightness: 10, contrast: 20, darkColor: '#000000', lightColor: '#ffffff' } as DitherSettings,
  };
}
function defaultGlow(): EffectLayer {
  return {
    id: uid(), name: 'Glow', type: 'glow',
    enabled: true, opacity: 0.7, blendMode: 'screen', useMask: false,
    settings: { radius: 18, intensity: 1.4, threshold: 120, color: '#ffffff' } as GlowSettings,
  };
}
function defaultHalftone(): EffectLayer {
  return {
    id: uid(), name: 'Halftone', type: 'halftone',
    enabled: true, opacity: 1, blendMode: 'source-over', useMask: false,
    settings: { cellSize: 10, exposure: 1, gamma: 1, darkColor: '#000000', lightColor: '#ffffff' } as HalftoneSettings,
  };
}
function defaultLego(): EffectLayer {
  return {
    id: uid(), name: 'LEGO', type: 'lego',
    enabled: true, opacity: 1, blendMode: 'source-over', useMask: false,
    settings: { brickSize: 16, saturation: 1.2, brightness: 5, studOpacity: 0.85, quantize: 16, borderWidth: 2 } as LegoSettings,
  };
}

function ensureSize(canvas: HTMLCanvasElement, w: number, h: number) {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
}
function draftToShape(draft: DraftSelection): SelectionShape {
  const { x, y, w, h } = normalizeRect(draft.startX, draft.startY, draft.endX, draft.endY);
  return { id: 'draft', type: draft.type, combine: draft.combine, x, y, w, h };
}
function drawSelectionPath(ctx: CanvasRenderingContext2D, shape: Pick<SelectionShape, 'type'|'x'|'y'|'w'|'h'>) {
  ctx.beginPath();
  if (shape.type === 'ellipse') ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, shape.w / 2, shape.h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(shape.x, shape.y, shape.w, shape.h);
}
function formatTime(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}
function sanitizeFileBase(name: string) {
  return (name || 'eana-studio').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'eana-studio';
}
function detectTransparency(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/* ─────────────────── UI primitives ─────────────────── */

function SliderRow({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-[#666] font-medium tracking-wide">{label}</span>
        <span className="text-[11px] font-mono text-[#888] bg-[#111] border border-[#222] rounded px-1.5 py-0.5">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="range-slim cursor-pointer"
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label">{children}</div>;
}

function IconBtn({ onClick, title, children, active }: {
  onClick: (e: React.MouseEvent) => void; title?: string;
  children: React.ReactNode; active?: boolean;
}) {
  return (
    <button
      onClick={onClick} title={title}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded transition',
        active ? 'bg-white text-black' : 'text-[#555] hover:text-white hover:bg-[#1a1a1a]'
      )}
    >
      {children}
    </button>
  );
}

function ToolBtn({ active, onClick, children, label }: {
  active: boolean; onClick: () => void; children: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded text-[12px] font-medium transition border',
        active
          ? 'bg-white text-black border-white'
          : 'bg-transparent text-[#777] border-[#222] hover:border-[#444] hover:text-white'
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="border-t border-[#1a1a1a] my-3" />;
}

/* layer type colour dot (monochrome version — just grey shades) */
function LayerDot({ type }: { type: LayerType }) {
  return (
    <span className={cn(
      'w-1.5 h-1.5 rounded-full shrink-0',
      type === 'dither'   ? 'bg-[#888]' :
      type === 'glow'     ? 'bg-[#bbb]' :
      type === 'halftone' ? 'bg-[#666]' :
                            'bg-[#aaa]'
    )} />
  );
}

/* ─────────────────────────── App ─────────────────────────── */
export default function App() {
  const [sourceUrl, setSourceUrl]         = useState<string | null>(null);
  const [sourceKind, setSourceKind]       = useState<MediaKind | null>(null);
  const [sourceName, setSourceName]       = useState('');
  const [sourceReady, setSourceReady]     = useState(false);
  const [sourceHasAlpha, setSourceHasAlpha] = useState(false);
  const [mediaSize, setMediaSize]         = useState({ width: 0, height: 0 });

  const [layers, setLayers]               = useState<EffectLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [dragId, setDragId]               = useState<string | null>(null);

  const [tool, setTool]                   = useState<ToolMode>('none');
  const [brushSize, setBrushSize]         = useState(56);
  const [isPointerActive, setIsPointerActive] = useState(false);

  const [selectionMode, setSelectionMode] = useState<SelectionCombine>('replace');
  const [selectionShapes, setSelectionShapes] = useState<SelectionShape[]>([]);
  const [draftSelection, setDraftSelection]   = useState<DraftSelection | null>(null);

  const [previewFps, setPreviewFps]       = useState(18);
  const [videoPlaying, setVideoPlaying]   = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrent, setVideoCurrent]   = useState(0);
  const [isRecording, setIsRecording]     = useState(false);

  // Left sidebar section collapse state
  const [secTools, setSecTools]       = useState(true);
  const [secLayers, setSecLayers]     = useState(true);
  const [secInspect, setSecInspect]   = useState(true);

  const displayRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);

  const origRef      = useRef(document.createElement('canvas'));
  const tempRef      = useRef(document.createElement('canvas'));
  const scratchRef   = useRef(document.createElement('canvas'));
  const selMaskRef   = useRef(document.createElement('canvas'));
  const layerDataRef = useRef<Map<string, { effect: HTMLCanvasElement; mask: HTMLCanvasElement }>>(new Map());

  const lastPtRef    = useRef<{ x: number; y: number } | null>(null);
  const objUrlRef    = useRef<string | null>(null);
  const rafRef       = useRef<number | null>(null);
  const lastVidRenderRef = useRef(0);
  const antsRef      = useRef(0);
  const fpsRef       = useRef(previewFps);
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);

  const layersRef    = useRef(layers);
  const selShapesRef = useRef(selectionShapes);
  const draftRef     = useRef(draftSelection);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { selShapesRef.current = selectionShapes; }, [selectionShapes]);
  useEffect(() => { draftRef.current = draftSelection; }, [draftSelection]);
  useEffect(() => { fpsRef.current = previewFps; }, [previewFps]);

  const selectedLayer = layers.find(l => l.id === selectedLayerId) ?? null;
  const hasSelection  = selectionShapes.length > 0;
  const canPaint      = !!selectedLayer && selectedLayer.useMask && (tool === 'brush' || tool === 'erase');

  /* ── buffer helpers ── */
  const ensureLayerBuffers = useCallback((id: string) => {
    const W = Math.max(1, origRef.current.width);
    const H = Math.max(1, origRef.current.height);
    if (!layerDataRef.current.has(id)) {
      const effect = document.createElement('canvas');
      const mask   = document.createElement('canvas');
      effect.width = W; effect.height = H;
      mask.width   = W; mask.height   = H;
      layerDataRef.current.set(id, { effect, mask });
    }
    const d = layerDataRef.current.get(id)!;
    ensureSize(d.effect, W, H);
    ensureSize(d.mask,   W, H);
    return d;
  }, []);

  const clearSelMask = useCallback(() => {
    const c = selMaskRef.current;
    const ctx = c.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
  }, []);

  /* ── marching ants overlay ── */
  const redrawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const W = origRef.current.width;
    const H = origRef.current.height;
    if (!overlay || !W || !H) return;
    ensureSize(overlay, W, H);
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const shapes = selShapesRef.current;
    const draft  = draftRef.current;

    if (shapes.length > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(selMaskRef.current, 0, 0);
      ctx.restore();
    }

    const drawAnts = (shape: SelectionShape, light = '#fff') => {
      ctx.save();
      drawSelectionPath(ctx, shape);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -antsRef.current;
      ctx.strokeStyle = light;
      ctx.stroke();
      ctx.lineDashOffset = -(antsRef.current + 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke();
      ctx.restore();
    };

    shapes.forEach(s => drawAnts(s, s.combine === 'subtract' ? '#aaa' : '#fff'));

    if (draft) {
      const ds = draftToShape(draft);
      ctx.save();
      drawSelectionPath(ctx, ds);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.restore();
      drawAnts(ds as SelectionShape, '#ccc');
    }
  }, []);

  /* ── composite ── */
  const composite = useCallback(() => {
    const output = displayRef.current;
    const src    = origRef.current;
    if (!output || !src.width || !src.height) return;
    ensureSize(output, src.width, src.height);
    ensureSize(tempRef.current, src.width, src.height);

    const out  = output.getContext('2d')!;
    const temp = tempRef.current.getContext('2d')!;

    out.clearRect(0, 0, src.width, src.height);
    out.drawImage(src, 0, 0);

    for (const layer of layersRef.current) {
      if (!layer.enabled) continue;
      const d = layerDataRef.current.get(layer.id);
      if (!d) continue;

      temp.clearRect(0, 0, src.width, src.height);
      temp.globalCompositeOperation = 'source-over';
      temp.globalAlpha = 1;
      temp.drawImage(d.effect, 0, 0);

      // alpha-aware: clip effect to source alpha
      temp.globalCompositeOperation = 'destination-in';
      temp.drawImage(src, 0, 0);

      if (layer.useMask) {
        temp.globalCompositeOperation = 'destination-in';
        temp.drawImage(d.mask, 0, 0);
      }
      temp.globalCompositeOperation = 'source-over';

      out.save();
      out.globalAlpha = layer.opacity;
      out.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      out.drawImage(tempRef.current, 0, 0);
      out.restore();
    }
  }, []);

  /* ── generate effect for one layer ── */
  const generateEffect = useCallback((layer: EffectLayer) => {
    const src = origRef.current;
    if (!src.width || !src.height) return;
    const { effect } = ensureLayerBuffers(layer.id);
    ensureSize(effect, src.width, src.height);
    const ctx = effect.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, effect.width, effect.height);

    if (layer.type === 'dither') {
      const s = layer.settings as DitherSettings;
      const sw = Math.max(1, Math.floor(src.width  / s.pixelSize));
      const sh = Math.max(1, Math.floor(src.height / s.pixelSize));
      const sm = document.createElement('canvas');
      sm.width = sw; sm.height = sh;
      const sc = sm.getContext('2d', { willReadFrequently: true })!;
      sc.drawImage(src, 0, 0, sw, sh);
      const id = sc.getImageData(0, 0, sw, sh);
      processDither(id, s.matrixSize, s.brightness, s.contrast, s.darkColor, s.lightColor);
      sc.putImageData(id, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sm, 0, 0, src.width, src.height);
    } else if (layer.type === 'glow') {
      const s = layer.settings as GlowSettings;
      ctx.drawImage(processGlow(src, s.radius, s.intensity, s.threshold, s.color), 0, 0);
    } else if (layer.type === 'halftone') {
      const s = layer.settings as HalftoneSettings;
      ctx.drawImage(processHalftone(src, s.cellSize, s.exposure, s.gamma, s.darkColor, s.lightColor), 0, 0);
    } else if (layer.type === 'lego') {
      const s = layer.settings as LegoSettings;
      ctx.drawImage(processLego(src, s.brickSize, s.saturation, s.brightness, s.studOpacity, s.quantize, s.borderWidth), 0, 0);
    }
  }, [ensureLayerBuffers]);

  const regenerateAll = useCallback(() => {
    if (!origRef.current.width || !origRef.current.height) return;
    layersRef.current.forEach(l => { ensureLayerBuffers(l.id); if (l.enabled) generateEffect(l); });
    composite();
    redrawOverlay();
  }, [composite, ensureLayerBuffers, generateEffect, redrawOverlay]);

  /* ── video loop ── */
  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const renderVideoFrame = useCallback(() => {
    const vid = hiddenVideoRef.current;
    if (!vid || vid.readyState < 2) return;
    const W = vid.videoWidth  || origRef.current.width;
    const H = vid.videoHeight || origRef.current.height;
    if (!W || !H) return;
    ensureSize(origRef.current, W, H);
    const ctx = origRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(vid, 0, 0, W, H);
    setVideoCurrent(vid.currentTime || 0);
    regenerateAll();
  }, [regenerateAll]);

  const startLoop = useCallback(() => {
    stopLoop();
    lastVidRenderRef.current = 0;
    const tick = (t: number) => {
      const vid = hiddenVideoRef.current;
      if (!vid || vid.paused || vid.ended) { stopLoop(); setVideoPlaying(false); renderVideoFrame(); return; }
      const gap = 1000 / Math.max(1, fpsRef.current);
      if (t - lastVidRenderRef.current >= gap) { renderVideoFrame(); lastVidRenderRef.current = t; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [renderVideoFrame, stopLoop]);

  /* ── prepare source canvas ── */
  const prepareSource = useCallback((W: number, H: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    ensureSize(origRef.current, W, H);
    ensureSize(tempRef.current, W, H);
    ensureSize(scratchRef.current, W, H);
    ensureSize(selMaskRef.current, W, H);
    if (displayRef.current) ensureSize(displayRef.current, W, H);
    if (overlayRef.current) ensureSize(overlayRef.current, W, H);

    const ctx = origRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    draw(ctx);

    setMediaSize({ width: W, height: H });
    setSourceHasAlpha(detectTransparency(origRef.current));

    layerDataRef.current.clear();
    clearSelMask();
    setSelectionShapes([]); selShapesRef.current = [];
    setDraftSelection(null); draftRef.current = null;

    if (layersRef.current.length === 0) {
      const base = defaultDither();
      setLayers([base]); setSelectedLayerId(base.id);
    } else {
      layersRef.current.forEach(l => ensureLayerBuffers(l.id));
    }

    setSourceReady(true);
    redrawOverlay();

    if (layersRef.current.length > 0) regenerateAll(); else composite();
  }, [clearSelMask, composite, ensureLayerBuffers, redrawOverlay, regenerateAll]);

  /* ── upload handler ── */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopLoop();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setVideoPlaying(false);
    if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    const url = URL.createObjectURL(file);
    objUrlRef.current = url;
    setSourceName(file.name);
    setSourceReady(false);
    setSourceKind(file.type.startsWith('video/') ? 'video' : 'image');
    setSourceUrl(url);
    e.target.value = '';
  };

  /* ── source url → canvas ── */
  useEffect(() => {
    if (!sourceUrl || !sourceKind) return;
    stopLoop();
    setVideoPlaying(false); setVideoDuration(0); setVideoCurrent(0); setSourceReady(false);

    if (sourceKind === 'image') {
      const img = new Image();
      img.onload = () => prepareSource(img.naturalWidth, img.naturalHeight, ctx => ctx.drawImage(img, 0, 0));
      img.src = sourceUrl;
      return () => { img.onload = null; };
    }

    const vid = hiddenVideoRef.current;
    if (!vid) return;

    const onLoaded = () => {
      const W = vid.videoWidth || 1, H = vid.videoHeight || 1;
      prepareSource(W, H, ctx => ctx.drawImage(vid, 0, 0, W, H));
      setVideoDuration(vid.duration || 0);
      setVideoCurrent(vid.currentTime || 0);
      setSourceHasAlpha(false);
    };
    const onPlay    = () => { setVideoPlaying(true);  startLoop(); };
    const onPause   = () => { setVideoPlaying(false); stopLoop(); renderVideoFrame(); };
    const onEnded   = () => { setVideoPlaying(false); stopLoop(); renderVideoFrame(); if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };

    vid.addEventListener('loadeddata', onLoaded);
    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('ended', onEnded);
    vid.src = sourceUrl;
    vid.load();

    return () => {
      vid.pause(); stopLoop();
      vid.removeEventListener('loadeddata', onLoaded);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('ended', onEnded);
    };
  }, [prepareSource, renderVideoFrame, sourceKind, sourceUrl, startLoop, stopLoop]);

  /* ── regenerate on layer settings change ── */
  useEffect(() => {
    if (!sourceReady) return;
    const t = window.setTimeout(() => {
      layersRef.current.forEach(l => ensureLayerBuffers(l.id));
      regenerateAll();
    }, 35);
    return () => window.clearTimeout(t);
  }, [ensureLayerBuffers, layers, regenerateAll, sourceReady]);

  /* ── overlay refresh ── */
  useEffect(() => { redrawOverlay(); }, [draftSelection, redrawOverlay, selectionShapes, sourceReady, tool]);

  /* ── marching ants animation ── */
  useEffect(() => {
    const iv = window.setInterval(() => { antsRef.current = (antsRef.current + 1) % 12; redrawOverlay(); }, 80);
    return () => window.clearInterval(iv);
  }, [redrawOverlay]);

  /* ── cleanup ── */
  useEffect(() => {
    return () => {
      stopLoop();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
      recStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [stopLoop]);

  /* ─── layer management ─── */
  const addLayer = (type: LayerType) => {
    const l = type === 'dither' ? defaultDither() : type === 'glow' ? defaultGlow() : type === 'halftone' ? defaultHalftone() : defaultLego();
    setLayers(prev => [...prev, l]);
    setSelectedLayerId(l.id);
  };

  const removeLayer = (id: string) => {
    const cur = layersRef.current;
    const idx = cur.findIndex(l => l.id === id);
    const next = cur.filter(l => l.id !== id);
    layerDataRef.current.delete(id);
    setLayers(next);
    if (selectedLayerId === id) {
      const rep = next[Math.max(0, Math.min(idx - 1, next.length - 1))] ?? next[next.length - 1] ?? null;
      setSelectedLayerId(rep?.id ?? null);
    }
  };

  const moveLayer = (id: string, dir: 1 | -1) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id);
      const ni = i + dir;
      if (i === -1 || ni < 0 || ni >= prev.length) return prev;
      const n = [...prev]; [n[i], n[ni]] = [n[ni], n[i]]; return n;
    });
  };

  const patchLayer = (id: string, up: Partial<EffectLayer>) =>
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...up } : l));

  const patchSettings = (id: string, up: Record<string, unknown>) =>
    setLayers(prev => prev.map(l => l.id === id ? { ...l, settings: { ...l.settings, ...up } } : l));

  const chooseTool = (next: ToolMode) => {
    setTool(next);
    if ((next === 'brush' || next === 'erase') && selectedLayerId) patchLayer(selectedLayerId, { useMask: true });
  };

  const clearMask = () => {
    if (!selectedLayerId) return;
    const d = ensureLayerBuffers(selectedLayerId);
    const ctx = d.mask.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, d.mask.width, d.mask.height);
    composite();
  };

  const fillMask = () => {
    if (!selectedLayerId) return;
    const d = ensureLayerBuffers(selectedLayerId);
    const ctx = d.mask.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, d.mask.width, d.mask.height);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, d.mask.width, d.mask.height);
    composite();
  };

  const clearSelection = () => {
    clearSelMask(); setSelectionShapes([]); selShapesRef.current = [];
    setDraftSelection(null); draftRef.current = null; redrawOverlay();
  };

  const selectAll = () => {
    if (!origRef.current.width || !origRef.current.height) return;
    clearSelMask();
    const ctx = selMaskRef.current.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, selMaskRef.current.width, selMaskRef.current.height);
    const shape: SelectionShape = { id: uid(), type: 'rect', combine: 'replace', x: 0, y: 0, w: origRef.current.width, h: origRef.current.height };
    setSelectionShapes([shape]); selShapesRef.current = [shape]; redrawOverlay();
  };

  const commitDraft = (draft: DraftSelection) => {
    const shape = draftToShape(draft);
    if (shape.w < 3 || shape.h < 3) return;
    const canvas = selMaskRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (draft.combine === 'replace') ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = 'white';
    ctx.globalCompositeOperation = draft.combine === 'subtract' ? 'destination-out' : 'source-over';
    drawSelectionPath(ctx, shape);
    ctx.fill();
    ctx.restore();
    const next = draft.combine === 'replace' ? [{ ...shape, id: uid() }] : [...selShapesRef.current, { ...shape, id: uid() }];
    setSelectionShapes(next); selShapesRef.current = next;
  };

  const applySelToMask = (mode: 'replace' | 'add' | 'subtract') => {
    if (!selectedLayerId || !hasSelection) return;
    const d = ensureLayerBuffers(selectedLayerId);
    const ctx = d.mask.getContext('2d');
    if (!ctx) return;
    patchLayer(selectedLayerId, { useMask: true });
    if (mode === 'replace') { ctx.clearRect(0, 0, d.mask.width, d.mask.height); ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(selMaskRef.current, 0, 0); }
    else if (mode === 'add') { ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(selMaskRef.current, 0, 0); }
    else { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(selMaskRef.current, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
    ctx.globalCompositeOperation = 'source-over';
    composite();
  };

  /* ── pointer events ── */
  const getCanvasPt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = overlayRef.current || displayRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const paintLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (!selectedLayerId) return;
    const d = ensureLayerBuffers(selectedLayerId);
    const sc = scratchRef.current;
    ensureSize(sc, d.mask.width, d.mask.height);
    const sCtx = sc.getContext('2d')!;
    const mCtx = d.mask.getContext('2d')!;
    sCtx.clearRect(0, 0, sc.width, sc.height);
    sCtx.lineCap = 'round'; sCtx.lineJoin = 'round';
    sCtx.lineWidth = brushSize; sCtx.strokeStyle = 'white';
    sCtx.beginPath(); sCtx.moveTo(from.x, from.y); sCtx.lineTo(to.x, to.y); sCtx.stroke();
    if (selShapesRef.current.length > 0) {
      sCtx.globalCompositeOperation = 'destination-in';
      sCtx.drawImage(selMaskRef.current, 0, 0);
      sCtx.globalCompositeOperation = 'source-over';
    }
    if (tool === 'brush') { mCtx.globalCompositeOperation = 'source-over'; mCtx.drawImage(sc, 0, 0); }
    else { mCtx.globalCompositeOperation = 'destination-out'; mCtx.drawImage(sc, 0, 0); mCtx.globalCompositeOperation = 'source-over'; }
    composite();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceReady) return;
    const pt = getCanvasPt(e);
    lastPtRef.current = pt;
    setIsPointerActive(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'brush' || tool === 'erase') { if (canPaint) paintLine(pt, pt); return; }
    if (tool === 'select-rect' || tool === 'select-ellipse') {
      setDraftSelection({ type: tool === 'select-rect' ? 'rect' : 'ellipse', combine: selectionMode, startX: pt.x, startY: pt.y, endX: pt.x, endY: pt.y });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerActive) return;
    const pt = getCanvasPt(e);
    if ((tool === 'brush' || tool === 'erase') && canPaint) {
      if (lastPtRef.current) paintLine(lastPtRef.current, pt);
      lastPtRef.current = pt; return;
    }
    if ((tool === 'select-rect' || tool === 'select-ellipse') && draftRef.current) {
      const nd = { ...draftRef.current, endX: pt.x, endY: pt.y };
      draftRef.current = nd; setDraftSelection(nd);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsPointerActive(false);
    const ad = draftRef.current;
    if ((tool === 'select-rect' || tool === 'select-ellipse') && ad) {
      commitDraft(ad); setDraftSelection(null); draftRef.current = null; redrawOverlay();
    }
    lastPtRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  /* ── drag & drop layers ── */
  const handleDragStart = (e: React.DragEvent, id: string) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver  = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setLayers(prev => {
      const di = prev.findIndex(l => l.id === dragId);
      const ti = prev.findIndex(l => l.id === targetId);
      if (di === -1 || ti === -1) return prev;
      const n = [...prev]; const [dl] = n.splice(di, 1); n.splice(ti, 0, dl); return n;
    });
  };
  const handleDragEnd = () => setDragId(null);

  /* ── download ── */
  const downloadFrame = () => {
    if (!displayRef.current) return;
    const a = document.createElement('a');
    a.download = `${sanitizeFileBase(sourceName)}-processed.png`;
    a.href = displayRef.current.toDataURL('image/png');
    a.click();
  };

  /* ── video controls ── */
  const togglePlay = async () => {
    const v = hiddenVideoRef.current;
    if (!v) return;
    if (v.paused || v.ended) { if (v.ended) v.currentTime = 0; try { await v.play(); } catch { /**/ } }
    else v.pause();
  };

  const seekVideo = (t: number) => {
    const v = hiddenVideoRef.current;
    if (!v) return;
    v.currentTime = t; setVideoCurrent(t);
    if (v.paused) window.setTimeout(() => renderVideoFrame(), 0);
  };

  const exportVideo = async () => {
    const canvas = displayRef.current;
    const vid    = hiddenVideoRef.current;
    if (!canvas || !vid || typeof MediaRecorder === 'undefined') return;
    if (isRecording) return;

    const stream = canvas.captureStream(Math.max(12, fpsRef.current));
    recStreamRef.current = stream;
    recChunksRef.current = [];

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
               : MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8'
               : 'video/webm';

    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    recorderRef.current = rec;
    rec.ondataavailable = ev => { if (ev.data.size > 0) recChunksRef.current.push(ev.data); };
    rec.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${sanitizeFileBase(sourceName)}-processed.webm`; a.click();
      URL.revokeObjectURL(url);
      recStreamRef.current?.getTracks().forEach(t => t.stop());
      recStreamRef.current = null; recorderRef.current = null; setIsRecording(false);
    };

    setIsRecording(true);
    vid.pause(); vid.currentTime = 0; renderVideoFrame();
    rec.start();
    try { await vid.play(); } catch { rec.stop(); setIsRecording(false); }
  };

  /* ── derived ── */
  const dither   = selectedLayer?.type === 'dither'   ? selectedLayer.settings as DitherSettings   : null;
  const glow     = selectedLayer?.type === 'glow'     ? selectedLayer.settings as GlowSettings     : null;
  const halftone = selectedLayer?.type === 'halftone' ? selectedLayer.settings as HalftoneSettings : null;
  const lego     = selectedLayer?.type === 'lego'     ? selectedLayer.settings as LegoSettings     : null;

  const cursor = tool === 'brush' || tool === 'erase' ? 'crosshair'
               : tool === 'select-rect' || tool === 'select-ellipse' ? 'cell' : 'default';

  /* ── render ── */
  return (
    <div className="flex h-screen overflow-hidden bg-black text-white select-none">

      {/* ── Left sidebar ── */}
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-[#1a1a1a]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a] shrink-0">
          <div>
            <div className="logo-text text-[22px] leading-none tracking-[-0.05em]">.eana studio</div>
            <div className="text-[10px] text-[#444] font-medium tracking-[0.18em] uppercase mt-1">Effects Editor</div>
          </div>
          <label className="btn btn-solid text-[11px] px-3 py-1.5 cursor-pointer">
            <Upload size={13} />
            <span>Open</span>
            <input type="file" className="hidden" accept="image/*,video/*" onChange={handleUpload} />
          </label>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto surface-scroll">

          {/* Media info */}
          {sourceUrl && (
            <div className="px-4 py-3 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2 text-[11px] text-[#555]">
                <span className="truncate flex-1 text-[#888]">{sourceName || '—'}</span>
                {sourceKind && <span className="tag tag-white">{sourceKind}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {mediaSize.width > 0 && (
                  <span className="tag tag-white">{mediaSize.width}×{mediaSize.height}</span>
                )}
                {sourceHasAlpha && (
                  <span className="tag tag-white">alpha</span>
                )}
                {sourceKind === 'video' && (
                  <span className="tag tag-white">{formatTime(videoDuration)}</span>
                )}
              </div>
            </div>
          )}

          {/* Video controls */}
          {sourceKind === 'video' && sourceReady && (
            <div className="px-4 py-3 border-b border-[#1a1a1a]">
              <div className="flex items-center gap-2 mb-2">
                <Film size={12} className="text-[#555]" />
                <span className="text-[11px] text-[#555] font-medium tracking-wide uppercase">Video</span>
                <div className="flex-1" />
                <button onClick={togglePlay} className="btn btn-ghost text-[11px] px-2 py-1">
                  {videoPlaying ? <Pause size={11} /> : <Play size={11} />}
                  {videoPlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <div className="space-y-2">
                <SliderRow label="FPS Preview" value={previewFps} min={6} max={30} step={1} display={`${previewFps}`} onChange={setPreviewFps} />
                <div>
                  <div className="flex justify-between text-[10px] text-[#444] mb-1">
                    <span>Timeline</span>
                    <span>{formatTime(videoCurrent)} / {formatTime(videoDuration)}</span>
                  </div>
                  <input type="range" className="range-slim cursor-pointer" min={0} max={Math.max(0.001, videoDuration)} step={0.01}
                    value={Math.min(videoCurrent, Math.max(0.001, videoDuration))}
                    onChange={e => seekVideo(parseFloat(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {/* Tools */}
          <div className="border-b border-[#1a1a1a]">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-semibold tracking-[0.2em] uppercase text-[#444] hover:text-[#666] transition"
              onClick={() => setSecTools(v => !v)}
            >
              Tools {secTools ? <Minus size={11} /> : <Plus size={11} />}
            </button>
            {secTools && (
              <div className="px-4 pb-3 space-y-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <ToolBtn active={tool === 'none'} onClick={() => chooseTool('none')} label="View">
                    <Square size={12} />
                  </ToolBtn>
                  <ToolBtn active={tool === 'brush'} onClick={() => chooseTool('brush')} label="Brush">
                    <Pen size={12} />
                  </ToolBtn>
                  <ToolBtn active={tool === 'erase'} onClick={() => chooseTool('erase')} label="Erase">
                    <Eraser size={12} />
                  </ToolBtn>
                  <ToolBtn active={tool === 'select-rect'} onClick={() => chooseTool('select-rect')} label="Rect Sel">
                    <Grid3X3 size={12} />
                  </ToolBtn>
                  <div className="col-span-2">
                    <ToolBtn active={tool === 'select-ellipse'} onClick={() => chooseTool('select-ellipse')} label="Ellipse Sel">
                      <Circle size={12} />
                    </ToolBtn>
                  </div>
                </div>

                <SliderRow label="Brush size" value={brushSize} min={4} max={320} step={1} display={`${brushSize}px`} onChange={setBrushSize} />

                {/* Selection mode */}
                <div className="flex gap-1 pt-1">
                  {(['replace','add','subtract'] as SelectionCombine[]).map(m => (
                    <button key={m}
                      onClick={() => setSelectionMode(m)}
                      className={cn('flex-1 rounded text-[10px] py-1 border transition font-medium',
                        selectionMode === m ? 'bg-white text-black border-white' : 'border-[#222] text-[#555] hover:text-white hover:border-[#444]'
                      )}
                    >
                      {m === 'replace' ? 'New' : m === 'add' ? 'Add' : 'Sub'}
                    </button>
                  ))}
                </div>

                {hasSelection && (
                  <div className="flex gap-1.5">
                    <button onClick={selectAll} className="btn btn-ghost text-[11px] flex-1 py-1">All</button>
                    <button onClick={clearSelection} className="btn btn-ghost text-[11px] flex-1 py-1">Clear sel.</button>
                  </div>
                )}

                {selectedLayer?.useMask && hasSelection && (
                  <div className="flex gap-1.5">
                    <button onClick={() => applySelToMask('replace')} className="btn btn-ghost text-[11px] flex-1 py-1">Mask ← sel</button>
                    <button onClick={() => applySelToMask('subtract')} className="btn btn-ghost text-[11px] flex-1 py-1">Cut mask</button>
                  </div>
                )}

                {selectedLayer?.useMask && (
                  <div className="flex gap-1.5">
                    <button onClick={clearMask} className="btn btn-ghost text-[11px] flex-1 py-1">Clear mask</button>
                    <button onClick={fillMask} className="btn btn-ghost text-[11px] flex-1 py-1 gap-1">
                      <PaintBucket size={11} />Fill mask
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Layers */}
          <div className="border-b border-[#1a1a1a]">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-semibold tracking-[0.2em] uppercase text-[#444] hover:text-[#666] transition"
              onClick={() => setSecLayers(v => !v)}
            >
              <span className="flex items-center gap-2">
                <Layers size={11} />
                Layers
                <span className="tag tag-white">{layers.length}</span>
              </span>
              {secLayers ? <Minus size={11} /> : <Plus size={11} />}
            </button>

            {secLayers && (
              <div className="pb-2">
                {/* Add layer buttons */}
                <div className="flex flex-wrap gap-1 px-4 pb-2">
                  {([ ['dither','Dither'], ['glow','Glow'], ['halftone','Halftone'], ['lego','LEGO'] ] as [LayerType, string][]).map(([type, label]) => (
                    <button
                      key={type}
                      onClick={() => addLayer(type)}
                      disabled={!sourceReady}
                      className="text-[10px] font-medium px-2.5 py-1 rounded border border-[#222] text-[#666] hover:text-white hover:border-[#444] transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      + {label}
                    </button>
                  ))}
                </div>

                {/* Layer list (reversed = top layer shown first) */}
                <div className="border-t border-[#1a1a1a]">
                  {layers.length === 0 ? (
                    <div className="px-4 py-5 text-center text-[11px] text-[#333]">Load media first</div>
                  ) : (
                    [...layers].reverse().map(layer => (
                      <div
                        key={layer.id}
                        draggable
                        onDragStart={e => handleDragStart(e, layer.id)}
                        onDragOver={e => handleDragOver(e, layer.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedLayerId(layer.id)}
                        className={cn(
                          'layer-row group flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer',
                          selectedLayerId === layer.id && 'selected',
                          dragId === layer.id && 'opacity-30'
                        )}
                      >
                        <GripVertical size={12} className="text-[#2a2a2a] shrink-0" />

                        <button
                          onClick={e => { e.stopPropagation(); patchLayer(layer.id, { enabled: !layer.enabled }); }}
                          className="shrink-0 text-[#333] hover:text-white transition"
                        >
                          {layer.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>

                        <LayerDot type={layer.type} />

                        <span className={cn('flex-1 truncate font-medium', layer.enabled ? 'text-[#ccc]' : 'text-[#444]')}>
                          {layer.name}
                        </span>

                        <span className="text-[10px] font-mono text-[#333] w-8 text-right shrink-0">
                          {Math.round(layer.opacity * 100)}%
                        </span>

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <IconBtn onClick={e => { e.stopPropagation(); moveLayer(layer.id, 1); }} title="Move up"><ChevronUp size={11} /></IconBtn>
                          <IconBtn onClick={e => { e.stopPropagation(); moveLayer(layer.id, -1); }} title="Move down"><ChevronDown size={11} /></IconBtn>
                          <IconBtn onClick={e => { e.stopPropagation(); removeLayer(layer.id); }} title="Delete">
                            <Trash2 size={11} className="hover:text-red-400" />
                          </IconBtn>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Inspector */}
          {selectedLayer && (
            <div className="border-b border-[#1a1a1a]">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-semibold tracking-[0.2em] uppercase text-[#444] hover:text-[#666] transition"
                onClick={() => setSecInspect(v => !v)}
              >
                Inspector {secInspect ? <Minus size={11} /> : <Plus size={11} />}
              </button>

              {secInspect && (
                <div className="px-4 pb-4 space-y-3 fade-in">
                  {/* Layer name */}
                  <div className="flex items-center gap-2">
                    <LayerDot type={selectedLayer.type} />
                    <input
                      value={selectedLayer.name}
                      onChange={e => patchLayer(selectedLayer.id, { name: e.target.value })}
                      className="field text-[13px]"
                    />
                  </div>

                  {/* Blend + opacity */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-[#444] mb-1 font-medium">Blend</div>
                      <select
                        value={selectedLayer.blendMode}
                        onChange={e => patchLayer(selectedLayer.id, { blendMode: e.target.value as BlendMode })}
                        className="field text-[12px] py-1.5"
                      >
                        {BLEND_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#444] mb-1 font-medium">Opacity</div>
                      <div className="flex items-center gap-2">
                        <input type="range" className="range-slim cursor-pointer flex-1"
                          min={0} max={1} step={0.01} value={selectedLayer.opacity}
                          onChange={e => patchLayer(selectedLayer.id, { opacity: parseFloat(e.target.value) })} />
                        <span className="text-[11px] font-mono text-[#555] w-8 text-right shrink-0">
                          {Math.round(selectedLayer.opacity * 100)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Mask toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedLayer.useMask}
                      onChange={e => patchLayer(selectedLayer.id, { useMask: e.target.checked })}
                      className="accent-white w-3.5 h-3.5" />
                    <span className="text-[12px] text-[#666]">Use layer mask</span>
                  </label>

                  <Divider />

                  <SectionLabel>Effect Settings</SectionLabel>

                  {/* ── Dither ── */}
                  {dither && (
                    <div className="space-y-3">
                      <SliderRow label="Pixel Size" value={dither.pixelSize} min={1} max={10} step={1} display={`${dither.pixelSize}x`}
                        onChange={v => patchSettings(selectedLayer.id, { pixelSize: v })} />
                      <SliderRow label="Matrix" value={dither.matrixSize} min={2} max={8} step={2} display={`${dither.matrixSize}×${dither.matrixSize}`}
                        onChange={v => patchSettings(selectedLayer.id, { matrixSize: Math.round(v) === 6 ? 8 : Math.round(v) })} />
                      <SliderRow label="Brightness" value={dither.brightness} min={-100} max={100} step={1} display={`${dither.brightness}`}
                        onChange={v => patchSettings(selectedLayer.id, { brightness: v })} />
                      <SliderRow label="Contrast" value={dither.contrast} min={-100} max={100} step={1} display={`${dither.contrast}`}
                        onChange={v => patchSettings(selectedLayer.id, { contrast: v })} />
                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <div className="text-[10px] text-[#444] mb-1">Dark color</div>
                          <input type="color" value={dither.darkColor}
                            onChange={e => patchSettings(selectedLayer.id, { darkColor: e.target.value })}
                            className="w-full h-8 cursor-pointer rounded bg-transparent border border-[#222]" />
                        </label>
                        <label>
                          <div className="text-[10px] text-[#444] mb-1">Light color</div>
                          <input type="color" value={dither.lightColor}
                            onChange={e => patchSettings(selectedLayer.id, { lightColor: e.target.value })}
                            className="w-full h-8 cursor-pointer rounded bg-transparent border border-[#222]" />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ── Glow ── */}
                  {glow && (
                    <div className="space-y-3">
                      <SliderRow label="Blur Radius" value={glow.radius} min={1} max={60} step={1} display={`${glow.radius}px`}
                        onChange={v => patchSettings(selectedLayer.id, { radius: v })} />
                      <SliderRow label="Intensity" value={glow.intensity} min={0} max={3} step={0.05} display={glow.intensity.toFixed(2)}
                        onChange={v => patchSettings(selectedLayer.id, { intensity: v })} />
                      <SliderRow label="Threshold" value={glow.threshold} min={0} max={255} step={1} display={`${glow.threshold}`}
                        onChange={v => patchSettings(selectedLayer.id, { threshold: v })} />
                      <label>
                        <div className="text-[10px] text-[#444] mb-1">Glow color</div>
                        <input type="color" value={glow.color}
                          onChange={e => patchSettings(selectedLayer.id, { color: e.target.value })}
                          className="w-full h-8 cursor-pointer rounded bg-transparent border border-[#222]" />
                      </label>
                    </div>
                  )}

                  {/* ── Halftone ── */}
                  {halftone && (
                    <div className="space-y-3">
                      <SliderRow label="Cell Size" value={halftone.cellSize} min={3} max={30} step={1} display={`${halftone.cellSize}px`}
                        onChange={v => patchSettings(selectedLayer.id, { cellSize: v })} />
                      <SliderRow label="Exposure" value={halftone.exposure} min={0.4} max={2.5} step={0.01} display={halftone.exposure.toFixed(2)}
                        onChange={v => patchSettings(selectedLayer.id, { exposure: v })} />
                      <SliderRow label="Gamma" value={halftone.gamma} min={0.4} max={2.5} step={0.01} display={halftone.gamma.toFixed(2)}
                        onChange={v => patchSettings(selectedLayer.id, { gamma: v })} />
                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <div className="text-[10px] text-[#444] mb-1">Dot color</div>
                          <input type="color" value={halftone.darkColor}
                            onChange={e => patchSettings(selectedLayer.id, { darkColor: e.target.value })}
                            className="w-full h-8 cursor-pointer rounded bg-transparent border border-[#222]" />
                        </label>
                        <label>
                          <div className="text-[10px] text-[#444] mb-1">Background</div>
                          <input type="color" value={halftone.lightColor}
                            onChange={e => patchSettings(selectedLayer.id, { lightColor: e.target.value })}
                            className="w-full h-8 cursor-pointer rounded bg-transparent border border-[#222]" />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ── LEGO ── */}
                  {lego && (
                    <div className="space-y-3">
                      <SliderRow label="Brick Size" value={lego.brickSize} min={6} max={48} step={1} display={`${lego.brickSize}px`}
                        onChange={v => patchSettings(selectedLayer.id, { brickSize: v })} />
                      <SliderRow label="Saturation" value={lego.saturation} min={0} max={3} step={0.05} display={lego.saturation.toFixed(2)}
                        onChange={v => patchSettings(selectedLayer.id, { saturation: v })} />
                      <SliderRow label="Brightness" value={lego.brightness} min={-80} max={80} step={1} display={`${lego.brightness > 0 ? '+' : ''}${lego.brightness}`}
                        onChange={v => patchSettings(selectedLayer.id, { brightness: v })} />
                      <SliderRow label="Stud Opacity" value={lego.studOpacity} min={0} max={1} step={0.01} display={`${Math.round(lego.studOpacity * 100)}%`}
                        onChange={v => patchSettings(selectedLayer.id, { studOpacity: v })} />
                      <SliderRow label="Color Quantize" value={lego.quantize} min={2} max={64} step={1} display={`${lego.quantize}`}
                        onChange={v => patchSettings(selectedLayer.id, { quantize: v })} />
                      <SliderRow label="Border Width" value={lego.borderWidth} min={0} max={4} step={0.5} display={lego.borderWidth.toFixed(1)}
                        onChange={v => patchSettings(selectedLayer.id, { borderWidth: v })} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </aside>

      {/* ── Main canvas area ── */}
      <main className="flex flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center justify-between px-5 h-[49px] border-b border-[#1a1a1a] shrink-0">
          <div className="flex items-center gap-2">
            {layers.filter(l => l.enabled).length > 0 && (
              <span className="tag tag-white">
                {layers.filter(l => l.enabled).length} / {layers.length} layers active
              </span>
            )}
            {hasSelection && <span className="tag tag-white">Selection active</span>}
            {sourceHasAlpha && <span className="tag tag-white">Alpha aware</span>}
            {canPaint && (
              <span className="tag tag-inv">
                {tool === 'brush' ? 'Painting mask' : 'Erasing mask'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {sourceKind === 'video' && (
              <button
                onClick={exportVideo}
                disabled={!sourceReady || isRecording}
                className="btn btn-ghost text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Film size={13} />
                {isRecording ? 'Recording…' : 'Export WebM'}
              </button>
            )}
            <button
              onClick={downloadFrame}
              disabled={!sourceReady}
              className="btn btn-solid text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} />
              Save PNG
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative flex flex-1 items-center justify-center canvas-grid overflow-hidden">

          {!sourceReady ? (
            /* Empty state */
            <div className="flex flex-col items-center gap-5 text-center px-8 fade-in">
              <div className="logo-text text-[64px] leading-none tracking-[-0.05em] text-[#1a1a1a]">.eana</div>
              <div className="text-[#333] text-[13px] max-w-[320px] leading-relaxed">
                Open an image or video to start. Stack effects as layers, paint masks, select regions, and export.
              </div>
              <label className="btn btn-solid text-[13px] px-5 py-2.5 cursor-pointer">
                <Upload size={15} />
                Open file
                <input type="file" className="hidden" accept="image/*,video/*" onChange={handleUpload} />
              </label>
              <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                {['Dither','Glow','Halftone','LEGO','Video','PNG alpha'].map(f => (
                  <span key={f} className="tag tag-white">{f}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="relative max-h-full max-w-full">
              {/* checkerboard container */}
              <div className="checkerboard-bg relative overflow-hidden border border-[#1a1a1a] shadow-[0_8px_40px_rgba(0,0,0,0.8)]">
                <canvas ref={displayRef} className="block h-auto max-h-[calc(100vh-100px)] w-auto max-w-full" />
                <canvas
                  ref={overlayRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="absolute inset-0 block h-auto max-h-[calc(100vh-100px)] w-auto max-w-full"
                  style={{ cursor, touchAction: 'none' }}
                />
              </div>

              {/* size badge */}
              <div className="absolute bottom-2 right-2 tag tag-white opacity-60">
                {mediaSize.width} × {mediaSize.height}
              </div>
            </div>
          )}
        </div>
      </main>

      <video ref={hiddenVideoRef} className="hidden" playsInline muted />
    </div>
  );
}
