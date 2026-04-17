import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2, Undo2, Type, Zap, WifiOff } from 'lucide-react';
import * as fabric from 'fabric';
import msgpackParser from 'socket.io-msgpack-parser';
import { SOCKET_URL } from '../lib/connection';

// ─── Constants ───────────────────────────────────────────────────────────────

const QUICK_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#64748b', '#a3e635',
];

const TOOLS = [
  { id: 'pen',    icon: <Pen    size={18} />, label: 'Pen',    active: 'bg-blue-600 text-white',    hint: 'DRAW'     },
  { id: 'eraser', icon: <Eraser size={18} />, label: 'Eraser', active: 'bg-slate-500 text-white',   hint: 'ERASE'    },
  { id: 'text',   icon: <Type   size={18} />, label: 'Text',   active: 'bg-emerald-600 text-white', hint: 'TAP TYPE' },
  { id: 'laser',  icon: <Zap    size={18} />, label: 'Laser',  active: 'bg-red-600 text-white',     hint: 'LASER ⚡' },
];

const BATCH_MS = 40; // flush draw points every 40ms (~25fps over socket)

// Normalise a canvas coordinate to the 0–1 range (module-level, no deps)
const norm = (v, max) => Math.max(0, Math.min(1, v / max));

// ─── Component ───────────────────────────────────────────────────────────────

export default function Pad() {
  const { sessionId } = useParams();

  // DOM refs
  const padRef         = useRef(null);
  const canvasElRef    = useRef(null);
  const textInputRef   = useRef(null);

  // Fabric ref
  const fcRef = useRef(null);

  // High-frequency drawing state kept in refs to avoid re-render during strokes
  const isDrawingRef    = useRef(false);
  const pointBatchRef   = useRef([]);
  const batchTimerRef   = useRef(null);
  const laserDownRef    = useRef(false);

  // Stable refs for values needed inside Fabric event closures
  const socketRef    = useRef(null);
  const toolRef      = useRef('pen');
  const colorRef     = useRef('#000000');
  const widthRef     = useRef(5);
  const bgRef        = useRef('#ffffff');
  const sessionIdRef = useRef(sessionId);

  // React state (only for UI rendering)
  const [tool,       setToolState]   = useState('pen');
  const [color,      setColorState]  = useState('#000000');
  const [lineWidth,  setWidthState]  = useState(5);
  const [bgColor,    setBgColor]     = useState('#ffffff');
  const [connected,  setConnected]   = useState(false);
  const [isPortrait, setIsPortrait]  = useState(
    () => window.matchMedia('(orientation: portrait)').matches
  );
  const [textPos,   setTextPos]   = useState(null); // { x, y } normalised 0-1
  const [textInput, setTextInput] = useState('');

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Keep refs in sync whenever state changes
  const setTool = useCallback((t) => {
    toolRef.current = t;
    setToolState(t);
  }, []);

  const setColor = useCallback((c) => {
    colorRef.current = c;
    setColorState(c);
  }, []);

  const setLineWidth = useCallback((w) => {
    widthRef.current = w;
    setWidthState(w);
  }, []);



  // Emit draw-batch and reset buffer
  const flushBatch = useCallback(() => {
    const s   = socketRef.current;
    const sid = sessionIdRef.current;
    if (s && sid && pointBatchRef.current.length > 0) {
      s.emit('draw-batch', { sessionId: sid, pts: [...pointBatchRef.current] });
      pointBatchRef.current = [];
    }
    batchTimerRef.current = null;
  }, []);

  // Apply brush settings to the Fabric canvas based on current tool
  const applyBrush = useCallback((fc, t, c, w, bg) => {
    if (t === 'pen' || t === 'eraser') {
      fc.isDrawingMode = true;
      const brush = new fabric.PencilBrush(fc);
      if (t === 'eraser') {
        // Paints with the background colour to approximate erasing on solid backgrounds
        brush.color            = bg;
        brush.width            = Math.max(w * 2, 24);
        brush.strokeLineCap    = 'round';
        brush.strokeLineJoin   = 'round';
      } else {
        brush.color          = c;
        brush.width          = w;
        brush.strokeLineCap  = 'round';
        brush.strokeLineJoin = 'round';
      }
      fc.freeDrawingBrush = brush;
    } else {
      // text / laser — disable fabric free draw
      fc.isDrawingMode = false;
    }
  }, []);

  // ─── Portrait listener ────────────────────────────────────────────────────

  useEffect(() => {
    const mq      = window.matchMedia('(orientation: portrait)');
    const handler = (e) => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ─── Socket setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    const s = io(SOCKET_URL, { parser: msgpackParser });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      s.emit('join-session', { sessionId, role: 'pad' });
    });

    // 'connect' already fires on every reconnection, so no separate 'reconnect' handler needed
    s.on('disconnect', () => setConnected(false));

    s.on('change-bg', ({ color: c }) => {
      setBgColor(c);
      bgRef.current = c;
      const fc = fcRef.current;
      if (fc) {
        fc.backgroundColor = c;
        fc.requestRenderAll();
        // Update eraser brush if active
        if (toolRef.current === 'eraser') {
          applyBrush(fc, 'eraser', colorRef.current, widthRef.current, c);
        }
      }
    });

    return () => s.close();
  }, [sessionId, applyBrush]);

  // Keep sessionIdRef current (in case of hot reloads etc.)
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // ─── Fabric canvas setup ──────────────────────────────────────────────────

  useEffect(() => {
    const el     = canvasElRef.current;
    const parent = padRef.current;
    if (!el || !parent) return;

    const fc = new fabric.Canvas(el, {
      width:         parent.clientWidth,
      height:        parent.clientHeight,
      isDrawingMode: true,
      selection:     false,
      backgroundColor: bgRef.current,
    });
    fcRef.current = fc;

    // Apply initial brush
    applyBrush(fc, toolRef.current, colorRef.current, widthRef.current, bgRef.current);

    // ── Resize ──
    const resize = () => {
      fc.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
      fc.requestRenderAll();
    };
    window.addEventListener('resize', resize);
    // Fire once on next frame so CSS layout has settled
    requestAnimationFrame(resize);

    // ── mouse:down ──
    fc.on('mouse:down', (o) => {
      // Fabric v6: pointer coords are on o.scenePoint (canvas space)
      const ptr = o.scenePoint ?? o.pointer;
      if (!ptr) return;
      const x = norm(ptr.x, fc.width);
      const y = norm(ptr.y, fc.height);
      const t = toolRef.current;

      if (t === 'text') {
        // Show text input at tap position
        setTextPos({ x, y });
        setTextInput('');
        setTimeout(() => textInputRef.current?.focus(), 80);
        return;
      }

      if (t === 'laser') {
        laserDownRef.current = true;
        const s  = socketRef.current;
        const id = sessionIdRef.current;
        if (s && id) s.emit('laser-start', { sessionId: id, x, y });
        return;
      }

      // pen / eraser
      isDrawingRef.current   = true;
      pointBatchRef.current  = [];

      const s  = socketRef.current;
      const id = sessionIdRef.current;
      if (s && id) {
        s.emit('draw-start', {
          sessionId: id,
          x, y,
          color:     t === 'eraser' ? bgRef.current : colorRef.current,
          lineWidth: widthRef.current,
        });
      }
    });

    // ── mouse:move ──
    fc.on('mouse:move', (o) => {
      const ptr = o.scenePoint ?? o.pointer;
      if (!ptr) return;
      const x = norm(ptr.x, fc.width);
      const y = norm(ptr.y, fc.height);
      const t = toolRef.current;

      if (t === 'laser') {
        if (!laserDownRef.current) return;
        const s  = socketRef.current;
        const id = sessionIdRef.current;
        if (s && id) s.emit('laser-move', { sessionId: id, x, y });
        return;
      }

      if (!isDrawingRef.current) return;

      pointBatchRef.current.push([x, y]);

      if (!batchTimerRef.current) {
        batchTimerRef.current = setTimeout(flushBatch, BATCH_MS);
      }
    });

    // ── mouse:up ──
    fc.on('mouse:up', () => {
      const t = toolRef.current;

      if (t === 'laser') {
        laserDownRef.current = false;
        const s  = socketRef.current;
        const id = sessionIdRef.current;
        if (s && id) s.emit('laser-end', { sessionId: id });
        return;
      }

      if (t === 'text') return; // text is handled via React state

      isDrawingRef.current = false;

      // Flush remaining batch immediately
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      flushBatch();
    });

    // ── path:created → send final serialised stroke to Board ──
    fc.on('path:created', (opt) => {
      const s  = socketRef.current;
      const id = sessionIdRef.current;
      if (s && id) {
        s.emit('draw-end', {
          sessionId: id,
          path:      opt.path.toJSON(),
          padWidth:  fc.width,
          padHeight: fc.height,
        });
      }
    });

    return () => {
      window.removeEventListener('resize', resize);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      fc.dispose();
    };
    // Intentionally empty deps — canvas is set up once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Keep brush in sync when tool / color / width / bg changes ────────────

  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    applyBrush(fc, tool, color, lineWidth, bgColor);
  }, [tool, color, lineWidth, bgColor, applyBrush]);

  // ─── Action handlers ──────────────────────────────────────────────────────

  const handleSetTool = (t) => {
    setTool(t);
    const s  = socketRef.current;
    const id = sessionIdRef.current ?? sessionId;
    if (s) s.emit('set-tool', { sessionId: id, tool: t });
  };

  const handleUndo = () => {
    const s  = socketRef.current;
    const id = sessionIdRef.current ?? sessionId;
    if (s) s.emit('undo', { sessionId: id });

    const fc = fcRef.current;
    if (fc) {
      const objs = fc.getObjects();
      if (objs.length > 0) {
        fc.remove(objs[objs.length - 1]);
        fc.requestRenderAll();
      }
    }
  };

  const handleClear = () => {
    if (navigator.vibrate) navigator.vibrate(60);
    const s  = socketRef.current;
    const id = sessionIdRef.current ?? sessionId;
    if (s) s.emit('clear-board', { sessionId: id });

    const fc = fcRef.current;
    if (fc) {
      fc.clear();
      fc.backgroundColor = bgRef.current;
      fc.requestRenderAll();
    }
  };

  const submitText = () => {
    const s  = socketRef.current;
    const id = sessionIdRef.current ?? sessionId;
    if (textInput.trim() && s && textPos) {
      s.emit('add-text', {
        sessionId: id,
        id:        Math.random().toString(36).substring(2, 11),
        text:      textInput.trim(),
        x:         textPos.x,
        y:         textPos.y,
        color:     colorRef.current,
        fontSize:  32,
      });
    }
    setTextPos(null);
    setTextInput('');
  };

  // ─── Current tool meta ────────────────────────────────────────────────────
  const toolMeta = TOOLS.find(t => t.id === tool);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Portrait guard */}
      {isPortrait && (
        <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col items-center justify-center gap-6 select-none">
          <div className="text-6xl animate-bounce">🔄</div>
          <p className="text-white text-xl font-semibold tracking-wide">Rotate your phone</p>
          <p className="text-slate-400 text-sm text-center px-10 leading-relaxed">
            The pad works in{' '}
            <span className="text-blue-400 font-medium">landscape mode</span>.<br />
            Turn your phone sideways to start drawing.
          </p>
        </div>
      )}

      <div
        className="flex flex-row h-[100dvh] w-screen overflow-hidden select-none touch-none"
        style={{ backgroundColor: bgColor }}
      >
        {/* ── Sidebar toolbar ── */}
        <aside className="z-40 flex-shrink-0 w-[72px] flex flex-col items-center gap-1.5 py-3 bg-slate-900/95 backdrop-blur border-r border-slate-700/50 shadow-2xl overflow-y-auto">

          {/* Connection dot */}
          <div
            title={connected ? 'Connected' : 'Disconnected'}
            className={`w-2 h-2 rounded-full mb-1 flex-shrink-0 transition-colors ${
              connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'
            }`}
          />

          {!connected && (
            <WifiOff size={14} className="text-red-400 mb-1 flex-shrink-0" />
          )}

          <div className="w-10 h-px bg-slate-700/60 flex-shrink-0 mb-1" />

          {/* Tool buttons */}
          {TOOLS.map(t => (
            <button
              key={t.id}
              onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); handleSetTool(t.id); }}
              onClick={() => handleSetTool(t.id)}
              title={t.label}
              className={`w-11 h-11 flex-shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl transition-all duration-150 ${
                tool === t.id
                  ? `${t.active} shadow-lg ring-2 ring-white/20 scale-105`
                  : 'text-slate-400 hover:bg-slate-800 active:scale-95'
              }`}
            >
              {t.icon}
              <span className="text-[8px] font-medium tracking-wide opacity-70">{t.label}</span>
            </button>
          ))}

          <div className="w-10 h-px bg-slate-700/60 flex-shrink-0 my-1" />

          {/* Color section */}
          <div className={`flex flex-col gap-1 items-center transition-opacity duration-200 ${
            tool === 'eraser' || tool === 'laser' ? 'opacity-25 pointer-events-none' : 'opacity-100'
          }`}>
            <p className="text-[8px] text-slate-500 uppercase tracking-widest mb-0.5">Color</p>

            {/* Custom color picker */}
            <label
              className="w-9 h-9 rounded-full cursor-pointer border-[3px] border-sky-400 shadow-lg flex-shrink-0 overflow-hidden relative"
              style={{ backgroundColor: color }}
              title="Custom color"
            >
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </label>

            {/* Quick color grid */}
            <div className="grid grid-cols-2 gap-1 mt-1 pb-1">
              {QUICK_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full transition-all border-2 flex-shrink-0 ${
                    color === c
                      ? 'border-sky-400 scale-[1.3] shadow-sm z-10'
                      : 'border-slate-600/80 hover:scale-110'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="w-10 h-px bg-slate-700/60 flex-shrink-0 my-1" />

          {/* Brush size */}
          <div className={`flex flex-col items-center flex-shrink-0 gap-1 ${
            tool === 'laser' ? 'opacity-25 pointer-events-none' : ''
          }`}>
            <p className="text-[8px] text-slate-500 uppercase tracking-widest">Size</p>
            {/* Vertical size preview dot */}
            <div
              className="rounded-full bg-current flex-shrink-0 transition-all"
              style={{
                width:  `${Math.max(6, Math.min(28, lineWidth))}px`,
                height: `${Math.max(6, Math.min(28, lineWidth))}px`,
                color:  tool === 'eraser' ? '#94a3b8' : color,
              }}
            />
            <input
              type="range"
              min="1" max="50"
              value={lineWidth}
              onChange={e => setLineWidth(Number(e.target.value))}
              className="origin-center -rotate-90 my-7 accent-sky-500 cursor-pointer"
              style={{ width: '60px' }}
            />
          </div>

          {/* Push actions to bottom */}
          <div className="mt-auto" />

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 flex-shrink-0 pb-1">
            <button
              onTouchEnd={e => { e.preventDefault(); handleUndo(); }}
              onClick={handleUndo}
              title="Undo"
              className="w-11 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all"
            >
              <Undo2 size={16} />
            </button>
            <button
              onTouchEnd={e => { e.preventDefault(); handleClear(); }}
              onClick={handleClear}
              title="Clear board"
              className="w-11 h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </aside>

        {/* ── Canvas area ── */}
        <div
          ref={padRef}
          className="flex-1 h-full relative overflow-hidden"
          style={{ touchAction: textPos ? 'auto' : 'none' }}
        >
          {/* Subtle grid */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              opacity: bgColor === '#000000' ? 0.08 : 0.12,
              backgroundImage: `linear-gradient(rgba(100,116,139,0.6) 1px, transparent 1px),
                                linear-gradient(90deg, rgba(100,116,139,0.6) 1px, transparent 1px)`,
              backgroundSize: '40px 40px',
            }}
          />

          {/* Fabric canvas */}
          <canvas
            ref={canvasElRef}
            className="absolute inset-0 touch-none"
            style={{
              cursor: tool === 'text'
                ? 'text'
                : tool === 'laser'
                ? 'crosshair'
                : 'crosshair',
            }}
          />

          {/* Text input overlay */}
          {textPos && (
            <div
              className="absolute z-50"
              style={{
                left:      `${textPos.x * 100}%`,
                top:       `${textPos.y * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <input
                ref={textInputRef}
                type="text"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  submitText();
                  if (e.key === 'Escape') { setTextPos(null); setTextInput(''); }
                }}
                onBlur={submitText}
                style={{ touchAction: 'auto', pointerEvents: 'auto' }}
                className="bg-slate-900/95 backdrop-blur border-2 border-emerald-500 text-white text-base px-3 py-2 rounded-xl outline-none w-56 shadow-2xl ring-4 ring-emerald-500/20"
                placeholder="Type & press Enter…"
              />
            </div>
          )}

          {/* Tool hint badge */}
          <div className="absolute bottom-4 right-4 pointer-events-none">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md text-[10px] font-mono font-semibold tracking-widest uppercase border transition-all ${
              tool === 'laser'
                ? 'bg-red-500/20 border-red-500/30 text-red-400'
                : tool === 'text'
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                : tool === 'eraser'
                ? 'bg-slate-500/20 border-slate-500/30 text-slate-300'
                : 'bg-blue-500/20 border-blue-500/30 text-blue-300'
            }`}>
              {toolMeta?.hint ?? tool}
            </div>
          </div>

          {/* Disconnected banner */}
          {!connected && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-900/80 backdrop-blur border border-red-700/50 text-red-300 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
              <WifiOff size={12} /> Reconnecting…
            </div>
          )}
        </div>
      </div>
    </>
  );
}
