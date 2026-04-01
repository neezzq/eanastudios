import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Download, Eraser, Pen, Brush, Eye, EyeOff,
  ChevronUp, ChevronDown, Trash2, Sparkles, Grid3X3,
  Layers, GripVertical, PaintBucket, Circle,
} from 'lucide-react';
import { processDither } from './utils/dither';
import { processGlow } from './utils/glow';
import { processHalftone } from './utils/halftone';
import { cn } from './utils/cn';

/* ─── Types ─── */
type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'luminosity';

interface DitherSettings {
  pixelSize: number;
  matrixSize: number;
  brightness: number;
  contrast: number;
  darkColor: string;
  lightColor: string;
}

interface GlowSettings {
  radius: number;
  intensity: number;
  threshold: number;
  color: string;
}

interface HalftoneSettings {
  cellSize: number;
  exposure: number;
  gamma: number;
  darkColor: string;
  lightColor: string;
}

interface EffectLayer {
  id: string;
  name: string;
  type: 'dither' | 'glow' | 'halftone';
  enabled: boolean;
  opacity: number;
  blendMode: BlendMode;
  useMask: boolean;
  settings: DitherSettings | GlowSettings | HalftoneSettings;
}

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'luminosity', label: 'Luminosity' },
];

/* ─── Helpers ─── */
let _nextId = 1;
const uid = () => `l${_nextId++}`;

function defaultDither(): EffectLayer {
  return {
    id: uid(), name: 'Dither', type: 'dither',
    enabled: true, opacity: 1, blendMode: 'source-over', useMask: false,
    settings: { pixelSize: 3, matrixSize: 4, brightness: 10, contrast: 20, darkColor: '#1a1a2e', lightColor: '#ffffff' } as DitherSettings,
  };
}

function defaultGlow(): EffectLayer {
  return {
    id: uid(), name: 'Glow', type: 'glow',
    enabled: true, opacity: 0.7, blendMode: 'screen', useMask: false,
    settings: { radius: 20, intensity: 1.5, threshold: 128, color: '#ffaa44' } as GlowSettings,
  };
}

function defaultHalftone(): EffectLayer {
  return {
    id: uid(), name: 'Halftone', type: 'halftone',
    enabled: true, opacity: 1, blendMode: 'source-over', useMask: false,
    settings: { cellSize: 10, exposure: 1, gamma: 1, darkColor: '#000000', lightColor: '#e6e6e6' } as HalftoneSettings,
  };
}

/* ─── Slider ─── */
function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-[10px] text-neutral-500 tabular-nums">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
      />
    </div>
  );
}

/* ═══════════════════ APP ═══════════════════ */
export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [layers, setLayers] = useState<EffectLayer[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<'none' | 'brush' | 'erase'>('none');
  const [brushSize, setBrushSize] = useState(50);
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const origRef = useRef(document.createElement('canvas'));
  const tempRef = useRef(document.createElement('canvas'));
  const layerData = useRef<Map<string, { effect: HTMLCanvasElement; mask: HTMLCanvasElement }>>(new Map());
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const sel = layers.find(l => l.id === selId) ?? null;

  /* ─── Canvas helpers ─── */
  const ensureCanvases = (id: string) => {
    if (!layerData.current.has(id)) {
      const w = origRef.current.width || 1;
      const h = origRef.current.height || 1;
      const eff = document.createElement('canvas'); eff.width = w; eff.height = h;
      const msk = document.createElement('canvas'); msk.width = w; msk.height = h;
      layerData.current.set(id, { effect: eff, mask: msk });
    }
    return layerData.current.get(id)!;
  };

  const genEffect = useCallback((layer: EffectLayer) => {
    const orig = origRef.current;
    if (!orig.width) return;
    const { effect } = ensureCanvases(layer.id);
    const w = orig.width, h = orig.height;
    if (effect.width !== w || effect.height !== h) { effect.width = w; effect.height = h; }
    const ctx = effect.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    if (layer.type === 'dither') {
      const s = layer.settings as DitherSettings;
      const sw = Math.max(1, Math.floor(w / s.pixelSize));
      const sh = Math.max(1, Math.floor(h / s.pixelSize));
      const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
      const sCtx = sm.getContext('2d', { willReadFrequently: true })!;
      sCtx.drawImage(orig, 0, 0, sw, sh);
      const d = sCtx.getImageData(0, 0, sw, sh);
      processDither(d, s.matrixSize, s.brightness, s.contrast, s.darkColor, s.lightColor);
      sCtx.putImageData(d, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sm, 0, 0, w, h);
    } else if (layer.type === 'glow') {
      const s = layer.settings as GlowSettings;
      const g = processGlow(orig, s.radius, s.intensity, s.threshold, s.color);
      ctx.drawImage(g, 0, 0);
    } else {
      const s = layer.settings as HalftoneSettings;
      const ht = processHalftone(orig, s.cellSize, s.exposure, s.gamma, s.darkColor, s.lightColor);
      ctx.drawImage(ht, 0, 0);
    }
  }, []);

  const composite = useCallback(() => {
    const ctx = displayRef.current?.getContext('2d');
    if (!ctx) return;
    const orig = origRef.current;
    if (!orig.width) return;
    const w = orig.width, h = orig.height;
    const tmp = tempRef.current;
    if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(orig, 0, 0);

    for (const layer of layersRef.current) {
      if (!layer.enabled) continue;
      const d = layerData.current.get(layer.id);
      if (!d) continue;

      ctx.save();
      ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
      ctx.globalAlpha = layer.opacity;

      if (layer.useMask) {
        const tCtx = tmp.getContext('2d')!;
        tCtx.clearRect(0, 0, w, h);
        tCtx.globalCompositeOperation = 'source-over';
        tCtx.drawImage(d.mask, 0, 0);
        tCtx.globalCompositeOperation = 'source-in';
        tCtx.drawImage(d.effect, 0, 0);
        tCtx.globalCompositeOperation = 'source-over';
        ctx.drawImage(tmp, 0, 0);
      } else {
        ctx.drawImage(d.effect, 0, 0);
      }
      ctx.restore();
    }
  }, []);

  const regenAll = useCallback(() => {
    layersRef.current.forEach(l => { if (l.enabled) genEffect(l); });
    composite();
  }, [genEffect, composite]);

  /* ─── Image upload ─── */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => { if (ev.target?.result) setImageSrc(ev.target.result as string); };
    r.readAsDataURL(f);
  };

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const w = img.width, h = img.height;
      origRef.current.width = w; origRef.current.height = h;
      origRef.current.getContext('2d')!.drawImage(img, 0, 0);
      tempRef.current.width = w; tempRef.current.height = h;
      if (displayRef.current) { displayRef.current.width = w; displayRef.current.height = h; }

      layerData.current.clear();
      if (layersRef.current.length === 0) {
        const d = defaultDither();
        setLayers([d]);
        setSelId(d.id);
      } else {
        layersRef.current.forEach(l => {
          const c = ensureCanvases(l.id);
          c.effect.width = w; c.effect.height = h;
          c.mask.width = w; c.mask.height = h;
        });
        regenAll();
      }
    };
  }, [imageSrc]);

  /* ─── React to layer state changes ─── */
  useEffect(() => {
    if (!imageSrc) return;
    const t = setTimeout(() => {
      layersRef.current.forEach(l => ensureCanvases(l.id));
      regenAll();
    }, 40);
    return () => clearTimeout(t);
  }, [layers, imageSrc, regenAll]);

  /* ─── Layer ops ─── */
  const addLayer = (type: 'dither' | 'glow' | 'halftone') => {
    const l = type === 'dither' ? defaultDither() : type === 'glow' ? defaultGlow() : defaultHalftone();
    setLayers(p => [...p, l]);
    setSelId(l.id);
  };
  const removeLayer = (id: string) => {
    layerData.current.delete(id);
    setLayers(p => p.filter(l => l.id !== id));
    if (selId === id) setSelId(null);
  };
  const moveLayer = (id: string, dir: 1 | -1) => {
    setLayers(p => {
      const i = p.findIndex(l => l.id === id);
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  };
  const patchLayer = (id: string, u: Partial<EffectLayer>) =>
    setLayers(p => p.map(l => l.id === id ? { ...l, ...u } : l));
  const patchSettings = (id: string, u: Record<string, unknown>) =>
    setLayers(p => p.map(l => l.id === id ? { ...l, settings: { ...l.settings, ...u } } : l));

  /* ─── Mask ops ─── */
  const clearMask = () => {
    if (!selId) return;
    const d = layerData.current.get(selId);
    if (!d) return;
    d.mask.getContext('2d')!.clearRect(0, 0, d.mask.width, d.mask.height);
    composite();
  };
  const fillMask = () => {
    if (!selId) return;
    const d = layerData.current.get(selId);
    if (!d) return;
    const c = d.mask.getContext('2d')!;
    c.fillStyle = 'white';
    c.fillRect(0, 0, d.mask.width, d.mask.height);
    composite();
  };

  /* ─── Drawing ─── */
  const pos = (e: React.PointerEvent) => {
    const c = displayRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const canPaint = sel?.useMask && brushMode !== 'none';

  const onDown = (e: React.PointerEvent) => {
    if (!canPaint) return;
    setIsDrawing(true);
    const p = pos(e);
    lastPos.current = p;
    paint(p, p);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const p = pos(e);
    if (lastPos.current) paint(lastPos.current, p);
    lastPos.current = p;
  };
  const onUp = (e: React.PointerEvent) => {
    setIsDrawing(false);
    lastPos.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };
  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (!selId) return;
    const d = layerData.current.get(selId);
    if (!d) return;
    const c = d.mask.getContext('2d')!;
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = brushSize;
    if (brushMode === 'brush') {
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = 'white';
    } else {
      c.globalCompositeOperation = 'destination-out'; c.strokeStyle = 'rgba(0,0,0,1)';
    }
    c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke();
    c.globalCompositeOperation = 'source-over';
    composite();
  };

  /* ─── Drag reorder ─── */
  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setLayers(p => {
      const di = p.findIndex(l => l.id === dragId);
      const ti = p.findIndex(l => l.id === targetId);
      if (di === -1 || ti === -1) return p;
      const n = [...p]; const [d] = n.splice(di, 1); n.splice(ti, 0, d); return n;
    });
  };
  const onDragEnd = () => setDragId(null);

  /* ─── Download ─── */
  const download = () => {
    if (!displayRef.current) return;
    const a = document.createElement('a');
    a.download = 'halftone-studio.png';
    a.href = displayRef.current.toDataURL('image/png');
    a.click();
  };

  /* ─── Render ─── */
  const ds = sel?.type === 'dither' ? sel.settings as DitherSettings : null;
  const gs = sel?.type === 'glow' ? sel.settings as GlowSettings : null;
  const hs = sel?.type === 'halftone' ? sel.settings as HalftoneSettings : null;

  return (
    <div className="h-screen bg-neutral-950 text-neutral-100 flex flex-col md:flex-row font-sans overflow-hidden">

      {/* ═══ SIDEBAR ═══ */}
      <div className="w-full md:w-[340px] bg-neutral-900 border-b md:border-b-0 md:border-r border-neutral-800 flex flex-col shrink-0 z-10 overflow-y-auto">
        <div className="p-4 space-y-4 flex-1">

          {/* Header */}
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <Layers size={18} className="text-indigo-400" /> Halftone Studio
            </h1>
            <p className="text-[11px] text-neutral-500 mt-0.5">Layered effects · Masks · Blend modes</p>
          </div>

          {/* Upload */}
          <label className="flex items-center justify-center gap-2 w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer transition-colors text-sm font-medium">
            <Upload size={15} /> Upload Photo
            <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
          </label>

          {imageSrc && (
            <>
              {/* ── LAYERS PANEL ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest">Layers</h3>
                  <div className="flex gap-1">
                    <button
                      onClick={() => addLayer('dither')}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 transition-colors border border-purple-500/20"
                    >
                      <Grid3X3 size={10} /> + Dither
                    </button>
                    <button
                      onClick={() => addLayer('glow')}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-amber-600/20 text-amber-300 hover:bg-amber-600/40 transition-colors border border-amber-500/20"
                    >
                      <Sparkles size={10} /> + Glow
                    </button>
                      <button
                        onClick={() => addLayer('halftone')}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 transition-colors border border-cyan-500/20"
                      >
                        <Circle size={10} /> + Halftone
                      </button>
                  </div>
                </div>

                <div className="bg-neutral-950 rounded-lg border border-neutral-800 overflow-hidden">
                  {layers.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-neutral-600">
                      No layers yet. Add one above.
                    </div>
                  )}
                  {[...layers].reverse().map(layer => (
                    <div
                      key={layer.id}
                      draggable
                      onDragStart={e => onDragStart(e, layer.id)}
                      onDragOver={e => onDragOver(e, layer.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => setSelId(layer.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-2 cursor-pointer transition-all text-xs border-l-2 select-none',
                        selId === layer.id
                          ? 'bg-indigo-500/10 border-indigo-500'
                          : 'border-transparent hover:bg-neutral-800/60',
                        dragId === layer.id && 'opacity-40',
                      )}
                    >
                      <GripVertical size={12} className="text-neutral-600 cursor-grab shrink-0" />

                      <button
                        onClick={e => { e.stopPropagation(); patchLayer(layer.id, { enabled: !layer.enabled }); }}
                        className="text-neutral-500 hover:text-white transition-colors shrink-0"
                      >
                        {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>

                      {layer.type === 'dither' && <Grid3X3 size={13} className="text-purple-400 shrink-0" />}
                      {layer.type === 'glow' && <Sparkles size={13} className="text-amber-400 shrink-0" />}
                      {layer.type === 'halftone' && <Circle size={13} className="text-cyan-400 shrink-0" />}

                      <span className="flex-1 truncate font-medium text-[11px]">{layer.name}</span>

                      <span className="text-[9px] text-neutral-600 tabular-nums w-7 text-right shrink-0">
                        {Math.round(layer.opacity * 100)}%
                      </span>

                      <div className="flex shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); moveLayer(layer.id, 1); }}
                          className="p-0.5 text-neutral-600 hover:text-white transition-colors"
                          title="Move up"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveLayer(layer.id, -1); }}
                          className="p-0.5 text-neutral-600 hover:text-white transition-colors"
                          title="Move down"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); removeLayer(layer.id); }}
                          className="p-0.5 text-neutral-600 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── SELECTED LAYER ── */}
              {sel && (
                <div className="space-y-3 animate-in fade-in">
                  <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest flex items-center gap-1.5">
                      {sel.type === 'dither' && <Grid3X3 size={10} className="text-purple-400" />}
                      {sel.type === 'glow' && <Sparkles size={10} className="text-amber-400" />}
                      {sel.type === 'halftone' && <Circle size={10} className="text-cyan-400" />}
                    {sel.name}
                  </h3>

                  {/* Name edit */}
                  <input
                    value={sel.name}
                    onChange={e => patchLayer(sel.id, { name: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />

                  {/* Blend mode */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Blend Mode</span>
                    <select
                      value={sel.blendMode}
                      onChange={e => patchLayer(sel.id, { blendMode: e.target.value as BlendMode })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      {BLEND_MODES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                  </div>

                  {/* Opacity */}
                  <Slider
                    label="Opacity" value={sel.opacity} min={0} max={1} step={0.01}
                    display={`${Math.round(sel.opacity * 100)}%`}
                    onChange={v => patchLayer(sel.id, { opacity: v })}
                  />

                  {/* Mask toggle */}
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox" checked={sel.useMask}
                      onChange={e => patchLayer(sel.id, { useMask: e.target.checked })}
                      className="accent-indigo-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-neutral-300 group-hover:text-white transition-colors">Use Mask (brush mode)</span>
                  </label>

                  {/* Mask brush controls */}
                  {sel.useMask && (
                    <div className="space-y-2.5 bg-neutral-800/40 rounded-lg p-3 border border-neutral-800">
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setBrushMode('brush')}
                          className={cn(
                            'flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-all',
                            brushMode === 'brush'
                              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                              : 'bg-neutral-800 text-neutral-400 hover:text-white'
                          )}
                        >
                          <Pen size={12} /> Brush
                        </button>
                        <button
                          onClick={() => setBrushMode('erase')}
                          className={cn(
                            'flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-all',
                            brushMode === 'erase'
                              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                              : 'bg-neutral-800 text-neutral-400 hover:text-white'
                          )}
                        >
                          <Eraser size={12} /> Erase
                        </button>
                      </div>
                      <Slider
                        label="Brush Size" value={brushSize} min={5} max={300} step={1}
                        display={`${brushSize}px`} onChange={setBrushSize}
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <button onClick={clearMask} className="py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs rounded transition-colors text-neutral-400 hover:text-white">
                          Clear Mask
                        </button>
                        <button onClick={fillMask} className="py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs rounded transition-colors text-neutral-400 hover:text-white flex items-center justify-center gap-1">
                          <PaintBucket size={11} /> Fill
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="border-t border-neutral-800 pt-3">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Effect Settings</span>
                  </div>

                  {/* ── DITHER SETTINGS ── */}
                  {ds && (
                    <div className="space-y-2.5">
                      <Slider
                        label="Pixel Size" value={ds.pixelSize} min={1} max={10} step={1}
                        display={`${ds.pixelSize}x`}
                        onChange={v => patchSettings(sel.id, { pixelSize: v })}
                      />
                      <Slider
                        label="Matrix Pattern" value={ds.matrixSize} min={2} max={8} step={2}
                        display={`${ds.matrixSize}×${ds.matrixSize}`}
                        onChange={v => {
                          const val = Math.round(v);
                          patchSettings(sel.id, { matrixSize: val === 6 ? 8 : val });
                        }}
                      />
                      <Slider
                        label="Brightness" value={ds.brightness} min={-100} max={100} step={1}
                        display={`${ds.brightness}`}
                        onChange={v => patchSettings(sel.id, { brightness: v })}
                      />
                      <Slider
                        label="Contrast" value={ds.contrast} min={-100} max={100} step={1}
                        display={`${ds.contrast}`}
                        onChange={v => patchSettings(sel.id, { contrast: v })}
                      />
                      <div className="flex gap-3 pt-1">
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-neutral-500">Dark</span>
                          <div className="relative w-full h-8 rounded overflow-hidden border border-neutral-700">
                            <input type="color" value={ds.darkColor}
                              onChange={e => patchSettings(sel.id, { darkColor: e.target.value })}
                              className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer"
                            />
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-neutral-500">Light</span>
                          <div className="relative w-full h-8 rounded overflow-hidden border border-neutral-700">
                            <input type="color" value={ds.lightColor}
                              onChange={e => patchSettings(sel.id, { lightColor: e.target.value })}
                              className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── GLOW SETTINGS ── */}
                  {gs && (
                    <div className="space-y-2.5">
                      <Slider
                        label="Blur Radius" value={gs.radius} min={1} max={60} step={1}
                        display={`${gs.radius}px`}
                        onChange={v => patchSettings(sel.id, { radius: v })}
                      />
                      <Slider
                        label="Intensity" value={gs.intensity} min={0} max={3} step={0.05}
                        display={gs.intensity.toFixed(2)}
                        onChange={v => patchSettings(sel.id, { intensity: v })}
                      />
                      <Slider
                        label="Threshold" value={gs.threshold} min={0} max={255} step={1}
                        display={`${gs.threshold}`}
                        onChange={v => patchSettings(sel.id, { threshold: v })}
                      />
                      <div className="space-y-1">
                        <span className="text-[10px] text-neutral-500">Glow Color</span>
                        <div className="relative w-full h-8 rounded overflow-hidden border border-neutral-700">
                          <input type="color" value={gs.color}
                            onChange={e => patchSettings(sel.id, { color: e.target.value })}
                            className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── HALFTONE SETTINGS ── */}
                  {hs && (
                    <div className="space-y-2.5">
                      <Slider
                        label="Cell Size" value={hs.cellSize} min={3} max={30} step={1}
                        display={`${hs.cellSize}px`}
                        onChange={v => patchSettings(sel.id, { cellSize: v })}
                      />
                      <Slider
                        label="Exposure" value={hs.exposure} min={0.4} max={2.5} step={0.01}
                        display={hs.exposure.toFixed(2)}
                        onChange={v => patchSettings(sel.id, { exposure: v })}
                      />
                      <Slider
                        label="Gamma" value={hs.gamma} min={0.4} max={2.5} step={0.01}
                        display={hs.gamma.toFixed(2)}
                        onChange={v => patchSettings(sel.id, { gamma: v })}
                      />
                      <div className="flex gap-3 pt-1">
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-neutral-500">Dot Color</span>
                          <div className="relative w-full h-8 rounded overflow-hidden border border-neutral-700">
                            <input type="color" value={hs.darkColor}
                              onChange={e => patchSettings(sel.id, { darkColor: e.target.value })}
                              className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer"
                            />
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[10px] text-neutral-500">Background</span>
                          <div className="relative w-full h-8 rounded overflow-hidden border border-neutral-700">
                            <input type="color" value={hs.lightColor}
                              onChange={e => patchSettings(sel.id, { lightColor: e.target.value })}
                              className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Download */}
              <button
                onClick={download}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-sm font-medium"
              >
                <Download size={15} /> Save Result
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══ CANVAS ═══ */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden bg-neutral-950 pattern-grid">
        {!imageSrc ? (
          <div className="flex flex-col items-center justify-center text-neutral-500 max-w-sm text-center">
            <div className="w-16 h-16 mb-5 bg-neutral-900 rounded-full flex items-center justify-center border border-neutral-800">
              <Brush size={28} className="text-neutral-600" />
            </div>
            <h2 className="text-lg font-medium text-neutral-300 mb-1">No image loaded</h2>
            <p className="text-xs leading-relaxed">Upload a photo to start. Apply layered dithering and glow effects, paint masks with the brush tool, and blend layers like in Photoshop.</p>
          </div>
        ) : (
          <div
            className="relative shadow-2xl shadow-black/60 border border-neutral-800 bg-neutral-900 rounded-md overflow-hidden"
            style={{ maxHeight: '100%', maxWidth: '100%', touchAction: 'none' }}
          >
            <canvas
              ref={displayRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="w-auto h-auto max-w-full max-h-[85vh] object-contain block"
              style={{ cursor: canPaint ? 'crosshair' : 'default' }}
            />

            {/* Floating status */}
            {canPaint && (
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-[10px] font-medium flex items-center gap-1.5 pointer-events-none border border-white/10">
                {brushMode === 'brush' ? <Pen size={10} /> : <Eraser size={10} />}
                {brushMode === 'brush' ? 'Paint to reveal effect' : 'Erase effect area'}
              </div>
            )}

            {/* Layer count badge */}
            <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-neutral-400 px-2 py-1 rounded text-[9px] pointer-events-none border border-white/5">
              {layers.filter(l => l.enabled).length} / {layers.length} layers
            </div>
          </div>
        )}
      </div>

      <style>{`
        .pattern-grid {
          background-image:
            linear-gradient(to right, rgba(255,255,255,.02) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,.02) 1px, transparent 1px);
          background-size: 20px 20px;
        }
        @keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: fade-in .15s ease-out; }
      `}</style>
    </div>
  );
}
