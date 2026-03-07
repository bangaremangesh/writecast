import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Pen, Eraser, Trash2, Crosshair, Circle,
  Undo2, Redo2, Type, Square, Minus,
  SlidersHorizontal, PaintBucket, Triangle,
  MousePointer2, ZoomIn, ZoomOut, Maximize2,
  ImagePlus, MoreHorizontal, ChevronLeft
} from 'lucide-react';

const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

const QUICK_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#64748b', '#92400e'
];

const TOOLS = [
  { id: 'select', icon: <MousePointer2 className="w-5 h-5" />, label: 'Select',  active: 'bg-amber-500'   },
  { id: 'pen',    icon: <Pen className="w-5 h-5" />,           label: 'Pen',     active: 'bg-blue-600'    },
  { id: 'eraser', icon: <Eraser className="w-5 h-5" />,        label: 'Eraser',  active: 'bg-slate-500'   },
  { id: 'laser',  icon: <Crosshair className="w-5 h-5" />,     label: 'Laser',   active: 'bg-red-600'     },
  { id: 'text',   icon: <Type className="w-5 h-5" />,          label: 'Text',    active: 'bg-emerald-600' },
  { id: 'shape',  icon: <Square className="w-5 h-5" />,        label: 'Shape',   active: 'bg-purple-600'  },
];

export default function Pad() {
  const { sessionId } = useParams();
  const padRef        = useRef(null);
  const fileInputRef  = useRef(null);
  const textInputRef  = useRef(null);
  const textGestureRef = useRef({ x: 0, y: 0, moved: false, moveStarted: false });

  const [socket, setSocket]         = useState(null);
  const [color, setColor]           = useState('#000000');
  const [lineWidth, setLineWidth]   = useState(5);
  const [tool, setTool]             = useState('pen');
  const [isDrawing, setIsDrawing]   = useState(false);
  const [bgColor, setBgColor]       = useState('#ffffff');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen]     = useState(false);
  const [initialSwipeY, setInitialSwipeY] = useState(null);
  const [isPortrait, setIsPortrait] = useState(
    () => window.matchMedia('(orientation: portrait)').matches
  );
  const [shapeType, setShapeType] = useState('rect');
  const [shapeFill, setShapeFill] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos]     = useState(null);

  // Portrait listener
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Socket
  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);
    s.on('connect', () => s.emit('join-session', { sessionId, role: 'pad' }));
    s.on('change-bg', ({ color: c }) => setBgColor(c));
    return () => s.close();
  }, [sessionId]);

  // Close panels when tool changes
  useEffect(() => {
    setMoreOpen(false);
  }, [tool]);

  const norm = e => {
    const pad = padRef.current;
    if (!pad) return { x: 0, y: 0 };
    const rect = pad.getBoundingClientRect();
    const t = e.touches[0];
    return {
      x: Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (t.clientY - rect.top)  / rect.height)),
    };
  };

  const handleTouchStart = e => {
    if (e.touches.length === 3) { handleClear(); return; }
    if (e.touches.length === 2) { setInitialSwipeY(e.touches[0].clientY); setIsDrawing(false); return; }

    const { x, y } = norm(e);

    if (tool === 'text') {
      textGestureRef.current = { x, y, moved: false, moveStarted: false };
      return;
    }
    if (tool === 'select') return; // select mode handled by board

    setIsDrawing(true);
    if (!socket) return;

    if (tool === 'laser') {
      socket.emit('laser-start', { sessionId, x, y });
    } else if (tool === 'shape') {
      socket.emit('shape-start', { sessionId, shape: shapeType, x, y, color, lineWidth, fill: shapeFill });
    } else {
      socket.emit('draw-start', { sessionId, x, y, color: tool === 'eraser' ? bgColor : color, lineWidth });
    }
  };

  const handleTouchMove = e => {
    if (e.touches.length === 2 && initialSwipeY !== null) {
      const dy = initialSwipeY - e.touches[0].clientY;
      if (Math.abs(dy) > 80) {
        if (socket) socket.emit(dy > 0 ? 'undo' : 'redo', { sessionId });
        if (navigator.vibrate) navigator.vibrate(40);
        setInitialSwipeY(null);
      }
      return;
    }
    if (e.touches.length > 1) return;

    const { x, y } = norm(e);

    if (tool === 'text') {
      const g = textGestureRef.current;
      const dist = Math.hypot(x - g.x, y - g.y);
      if (!g.moveStarted && dist > 0.04) {
        g.moveStarted = true; g.moved = true;
        if (socket) socket.emit('text-move-start', { sessionId, x: g.x, y: g.y });
      }
      if (g.moveStarted && socket) socket.emit('text-move', { sessionId, x, y });
      return;
    }

    if (!isDrawing || !socket) return;

    if (tool === 'laser')       socket.emit('laser-move',     { sessionId, x, y });
    else if (tool === 'shape')  socket.emit('shape-preview',  { sessionId, x2: x, y2: y });
    else socket.emit('draw', { sessionId, x, y, color: tool === 'eraser' ? bgColor : color, lineWidth });
  };

  const handleTouchEnd = e => {
    if (e.touches.length === 0) setInitialSwipeY(null);

    if (tool === 'text') {
      const g = textGestureRef.current;
      if (g.moved) {
        if (socket) socket.emit('text-move-end', { sessionId });
      } else {
        setTextPos({ x: g.x, y: g.y });
        setTextInput('');
        setTimeout(() => textInputRef.current?.focus(), 60);
      }
      textGestureRef.current = { x: 0, y: 0, moved: false, moveStarted: false };
      return;
    }

    setIsDrawing(false);
    if (!socket) return;
    if (tool === 'laser')      socket.emit('laser-end',  { sessionId });
    else if (tool === 'shape') socket.emit('shape-end',  { sessionId });
    else if (tool !== 'select') socket.emit('draw-end',  { sessionId });
  };

  const handleClear = () => {
    if (socket) socket.emit('clear-board', { sessionId });
    if (navigator.vibrate) navigator.vibrate(50);
  };

  // Switch tool on board remotely
  const handleSetTool = (t) => {
    setTool(t);
    if (socket) socket.emit('set-tool', { sessionId, tool: t });
  };

  const handleZoomIn    = () => socket && socket.emit('zoom-in',    { sessionId });
  const handleZoomOut   = () => socket && socket.emit('zoom-out',   { sessionId });
  const handleZoomReset = () => socket && socket.emit('zoom-reset', { sessionId });

  const handleBgColor = (c) => {
    setBgColor(c);
    if (socket) socket.emit('change-bg', { sessionId, color: c });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !socket) return;
    const reader = new FileReader();
    reader.onload = (f) => {
      socket.emit('add-image', { sessionId, dataUrl: f.target.result });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const submitText = () => {
    if (textInput.trim() && socket && textPos) {
      socket.emit('add-text', {
        sessionId,
        id: Math.random().toString(36).substr(2, 9),
        text: textInput.trim(),
        x: textPos.x, y: textPos.y,
        color, fontSize: 20,
      });
    }
    setTextPos(null); setTextInput('');
  };

  return (
    <>
      {/* Portrait overlay */}
      {isPortrait && (
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center gap-6 select-none">
          <div className="text-6xl animate-bounce">🔄</div>
          <p className="text-white text-xl font-semibold tracking-wide">Rotate your phone</p>
          <p className="text-slate-400 text-sm text-center px-8">
            The pad works in <span className="text-blue-400 font-medium">landscape mode</span>.<br />
            Turn your phone sideways to start drawing.
          </p>
        </div>
      )}

      <div className="flex flex-row h-screen w-screen overflow-hidden select-none touch-none bg-slate-950">

        {/* ── Persistent Left Toolbar ── */}
        <div className="z-40 flex-shrink-0 w-14 flex flex-col items-center gap-2 py-3 bg-slate-900 border-r border-slate-700/60 shadow-xl">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mb-1" />
          <div className="w-8 h-px bg-slate-700/50" />

          {TOOLS.map(t => (
            <button
              key={t.id}
              onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); handleSetTool(t.id); }}
              onClick={() => handleSetTool(t.id)}
              title={t.label}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                tool === t.id ? `${t.active} text-white shadow-lg scale-105` : 'text-slate-400 hover:bg-slate-800 active:scale-95'
              }`}
            >
              {t.icon}
            </button>
          ))}

          <div className="w-8 h-px bg-slate-700/50" />

          {/* More panel toggle */}
          <button
            onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); setMoreOpen(v => !v); setDrawerOpen(false); }}
            onClick={() => { setMoreOpen(v => !v); setDrawerOpen(false); }}
            title="More"
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
              moreOpen ? 'bg-sky-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 active:scale-95'
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          <div className="mt-auto" />

          {/* Settings / Drawer toggle */}
          <button
            onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); setDrawerOpen(v => !v); setMoreOpen(false); }}
            onClick={() => { setDrawerOpen(v => !v); setMoreOpen(false); }}
            title="Settings"
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all mb-1 ${
              drawerOpen ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 active:scale-95'
            }`}
          >
            <SlidersHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* ── "More" Panel ── */}
        <div className={`absolute left-14 top-0 h-full z-30 w-[200px] bg-slate-900/97 backdrop-blur border-r border-slate-700/60 shadow-2xl flex flex-col gap-3 p-4 overflow-y-auto transition-transform duration-300 ease-out ${
          moreOpen ? 'translate-x-0' : '-translate-x-[200px]'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">More Tools</p>
            <button onClick={() => setMoreOpen(false)} className="text-slate-500 hover:text-slate-300 active:scale-95 transition-all">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Zoom */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest px-1 mb-1.5">Zoom</p>
            <div className="flex gap-1.5">
              <button
                onClick={handleZoomIn}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-xs"
              >
                <ZoomIn className="w-4 h-4" /> In
              </button>
              <button
                onClick={handleZoomOut}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-xs"
              >
                <ZoomOut className="w-4 h-4" /> Out
              </button>
              <button
                onClick={handleZoomReset}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-xs"
              >
                <Maximize2 className="w-4 h-4" /> Reset
              </button>
            </div>
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Board Background */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest px-1 mb-1.5">Background</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleBgColor('#ffffff')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all border-2 ${
                  bgColor === '#ffffff' ? 'bg-white text-slate-800 border-blue-400 shadow-md' : 'bg-slate-700 text-slate-300 border-transparent hover:border-slate-500'
                }`}
              >
                ☀️ White
              </button>
              <button
                onClick={() => handleBgColor('#000000')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all border-2 ${
                  bgColor === '#000000' ? 'bg-black text-white border-blue-400 shadow-md' : 'bg-slate-700 text-slate-300 border-transparent hover:border-slate-500'
                }`}
              >
                🌙 Black
              </button>
            </div>
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Image Upload */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest px-1 mb-1.5">Image</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 text-pink-400 hover:bg-slate-700 active:scale-95 transition-all text-sm font-medium border border-pink-500/20"
            >
              <ImagePlus className="w-4 h-4" /> Upload Photo
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Quick Undo/Redo */}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest px-1 mb-1.5">History</p>
            <div className="flex gap-2">
              <button onClick={() => socket && socket.emit('undo', { sessionId })}
                className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
              ><Undo2 className="w-4 h-4" /> Undo</button>
              <button onClick={() => socket && socket.emit('redo', { sessionId })}
                className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
              ><Redo2 className="w-4 h-4" /> Redo</button>
            </div>
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Clear */}
          <button onClick={handleClear}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all text-sm font-medium mt-auto"
          >
            <Trash2 className="w-5 h-5" /> Clear Board
          </button>
        </div>

        {/* ── Settings Drawer ── */}
        <div className={`absolute left-14 top-0 h-full z-30 w-[210px] bg-slate-900/95 backdrop-blur border-r border-slate-700/60 shadow-2xl flex flex-col gap-3 p-4 overflow-y-auto transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-x-0' : '-translate-x-[210px]'
        }`}>

          {/* Shape sub-panel */}
          {tool === 'shape' && (
            <>
              <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Shape</p>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { id: 'rect',     icon: <Square   className="w-4 h-4" />, label: 'Rect'   },
                  { id: 'circle',   icon: <Circle   className="w-4 h-4" />, label: 'Circle' },
                  { id: 'triangle', icon: <Triangle className="w-4 h-4" />, label: 'Tri'    },
                  { id: 'line',     icon: <Minus    className="w-4 h-4" />, label: 'Line'   },
                ].map(s => (
                  <button key={s.id} onClick={() => setShapeType(s.id)}
                    className={`flex-1 min-w-[35px] flex flex-col items-center gap-1 py-2 rounded-xl text-xs transition-all ${
                      shapeType === s.id ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 bg-slate-800 hover:bg-slate-700'
                    }`}
                  >{s.icon}{s.label}</button>
                ))}
              </div>
              <button onClick={() => setShapeFill(v => !v)}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  shapeFill ? 'bg-purple-600/30 border border-purple-500/40 text-purple-300' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-transparent'
                }`}
              >
                <PaintBucket className="w-4 h-4" /> {shapeFill ? 'Filled' : 'Outline'}
              </button>
              <div className="w-full h-px bg-slate-700/60" />
            </>
          )}

          {/* Colour */}
          {tool !== 'laser' && tool !== 'eraser' && (
            <>
              <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Colour</p>
              {/* Quick swatches */}
              <div className="grid grid-cols-6 gap-1.5 px-1">
                {QUICK_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-7 h-7 rounded-full transition-all border-2 ${
                      color === c ? 'border-blue-400 scale-110 shadow-md' : 'border-slate-600 hover:scale-105'
                    }`}
                  />
                ))}
              </div>
              {/* Custom colour picker */}
              <label className="flex items-center gap-3 px-4 py-2 cursor-pointer rounded-xl hover:bg-slate-800 transition-colors">
                <div className="w-8 h-8 rounded-full border-2 border-slate-600 shadow-inner flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-slate-300 text-sm">Custom…</span>
                <input type="color" value={color} onChange={e => setColor(e.target.value)} className="opacity-0 absolute w-0 h-0" />
              </label>
              <div className="w-full h-px bg-slate-700/60" />
            </>
          )}

          {/* Size */}
          {(tool === 'pen' || tool === 'eraser' || tool === 'shape') && (
            <>
              <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Size</p>
              <div className="px-2 flex flex-col gap-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Fine</span><span>{lineWidth}px</span><span>Thick</span>
                </div>
                <input type="range" min="1" max="50" value={lineWidth}
                  onChange={e => setLineWidth(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>
              <div className="w-full h-px bg-slate-700/60" />
            </>
          )}

          {/* History */}
          <p className="text-xs text-slate-500 uppercase tracking-widest px-1">History</p>
          <div className="flex gap-2">
            <button onClick={() => socket && socket.emit('undo', { sessionId })}
              className="flex-1 flex items-center justify-center gap-1 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            ><Undo2 className="w-4 h-4" /> Undo</button>
            <button onClick={() => socket && socket.emit('redo', { sessionId })}
              className="flex-1 flex items-center justify-center gap-1 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            ><Redo2 className="w-4 h-4" /> Redo</button>
          </div>
          <div className="w-full h-px bg-slate-700/60" />

          {/* Clear */}
          <button onClick={handleClear}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all text-sm font-medium mt-auto"
          >
            <Trash2 className="w-5 h-5" /> Clear Board
          </button>
        </div>

        {/* ── Drawing Area ── */}
        <div
          ref={padRef}
          className="flex-1 h-full relative overflow-hidden"
          style={{ cursor: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* Watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
            <span className="text-white font-black text-7xl tracking-widest uppercase rotate-[-15deg]">Draw</span>
          </div>

          {/* Select mode overlay hint */}
          {tool === 'select' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl px-5 py-3 border border-amber-500/30 flex flex-col items-center gap-1">
                <MousePointer2 className="w-6 h-6 text-amber-400" />
                <p className="text-amber-300 text-xs font-medium">Select mode active on board</p>
                <p className="text-slate-500 text-xs">Use the board screen to move objects</p>
              </div>
            </div>
          )}

          {/* Text input overlay */}
          {textPos && (
            <div className="absolute z-50" style={{ left: `${textPos.x * 100}%`, top: `${textPos.y * 100}%`, transform: 'translate(-50%,-50%)' }}>
              <input
                ref={textInputRef}
                type="text"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitText();
                  if (e.key === 'Escape') { setTextPos(null); setTextInput(''); }
                }}
                onBlur={submitText}
                style={{ touchAction: 'auto', pointerEvents: 'auto' }}
                className="bg-slate-900/95 border border-emerald-500/60 text-white text-base px-3 py-2 rounded-xl outline-none w-52 shadow-2xl ring-2 ring-emerald-500/30"
                placeholder="Type & press Enter…"
              />
            </div>
          )}

          {/* Status indicator */}
          <div className="absolute bottom-4 right-4 flex gap-2 items-center pointer-events-none">
            {isDrawing && tool !== 'laser' && (
              <>
                <div className={`w-2 h-2 rounded-full animate-ping ${tool === 'shape' ? 'bg-purple-400' : 'bg-blue-400'}`} />
                <span className={`text-xs font-mono opacity-70 ${tool === 'shape' ? 'text-purple-400' : 'text-blue-400'}`}>
                  {tool === 'shape' ? `${shapeType}…` : 'drawing…'}
                </span>
              </>
            )}
            {tool === 'laser' && (
              <>
                <Circle className="w-3 h-3 text-red-500 animate-pulse" />
                <span className="text-xs text-red-400 font-mono opacity-70">laser</span>
              </>
            )}
            {tool === 'text' && !textPos && (
              <span className="text-xs text-emerald-400 font-mono opacity-70">tap to add text · drag to move</span>
            )}
          </div>

          {/* Active tool colour dot (top-right) */}
          <div className="absolute top-3 right-3 pointer-events-none">
            <div className="w-5 h-5 rounded-full border-2 border-white/20 shadow" style={{
              backgroundColor:
                tool === 'eraser' ? bgColor :
                tool === 'laser'  ? '#ef4444' :
                tool === 'shape'  ? '#a855f7' :
                tool === 'select' ? '#f59e0b' :
                tool === 'text'   ? '#10b981' : color
            }} />
          </div>
        </div>

      </div>
    </>
  );
}
