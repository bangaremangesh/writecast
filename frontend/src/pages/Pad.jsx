import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Pen, Eraser, Trash2, Undo2, Redo2, Type
} from 'lucide-react';

const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

const QUICK_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#64748b', '#92400e'
];

const TOOLS = [
  { id: 'pen',    icon: <Pen className="w-5 h-5" />,           label: 'Pen',     active: 'bg-blue-600'    },
  { id: 'eraser', icon: <Eraser className="w-5 h-5" />,        label: 'Eraser',  active: 'bg-slate-500'   },
  { id: 'text',   icon: <Type className="w-5 h-5" />,          label: 'Text',    active: 'bg-emerald-600' },
];

export default function Pad() {
  const { sessionId } = useParams();
  const padRef        = useRef(null);
  const localCanvasRef= useRef(null);
  const ctxRef        = useRef(null);
  const textInputRef  = useRef(null);
  const textGestureRef = useRef({ x: 0, y: 0, moved: false, moveStarted: false });

  // Use refs for high-frequency drawing state to avoid React re-renders mid-stroke
  const isDrawingRef   = useRef(false);
  const lastEmitRef    = useRef(0);
  const THROTTLE_MS    = 35; // Cap to ~28 emits per second
  const padRectRef     = useRef(null);
  const socketRef      = useRef(null);
  const toolRef        = useRef('pen');
  const colorRef       = useRef('#000000');
  const lineWidthRef   = useRef(5);
  const bgColorRef2    = useRef('#ffffff');
  const sessionIdRef   = useRef(null);
  const initialSwipeYRef = useRef(null);
  
  // Local history for the scratchpad overlay
  const localHistoryRef = useRef([]);
  const currentStrokeRef = useRef(null);

  const [color, setColor]           = useState('#000000');
  const [lineWidth, setLineWidth]   = useState(5);
  const [tool, setTool]             = useState('pen');
  const [bgColor, setBgColor]       = useState('#ffffff');
  const [isPortrait, setIsPortrait] = useState(
    () => window.matchMedia('(orientation: portrait)').matches
  );
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos]     = useState(null);

  // Portrait listener
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => setIsPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function redrawLocalCanvas() {
    const canvas = localCanvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    localHistoryRef.current.forEach(stroke => {
      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.beginPath();
      if (stroke.points.length > 0) {
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for(let i=1; i<stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
      }
      ctx.stroke();
    });
  }

  // Setup local scratchpad canvas
  useEffect(() => {
    const canvas = localCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

    const resize = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      redrawLocalCanvas();
    };
    window.addEventListener('resize', resize);
    // slight delay to ensure layout complete
    setTimeout(resize, 0);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Keep refs in sync with state
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { lineWidthRef.current = lineWidth; }, [lineWidth]);
  useEffect(() => { bgColorRef2.current = bgColor; }, [bgColor]);

  // Socket setup
  useEffect(() => {
    const s = io(SOCKET_URL);
    socketRef.current = s;
    s.on('connect', () => s.emit('join-session', { sessionId, role: 'pad' }));
    s.on('change-bg', ({ color: c }) => setBgColor(c));
    return () => s.close();
  }, [sessionId]);

  // Keep sessionIdRef in sync
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Fast normalise
  const norm = (e, rect) => {
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    return {
      x: Math.max(0, Math.min(1, localX / rect.width)),
      y: Math.max(0, Math.min(1, localY / rect.height)),
      clientX: localX,
      clientY: localY
    };
  };

  const handlePointerDown = e => {
    if (!e.isPrimary) return;

    padRectRef.current = padRef.current?.getBoundingClientRect() ?? null;
    if (!padRectRef.current) return;

    const { x, y, clientX, clientY } = norm(e, padRectRef.current);

    if (toolRef.current === 'text') {
      textGestureRef.current = { x, y, moved: false, moveStarted: false };
      return;
    }

    isDrawingRef.current = true;
    lastEmitRef.current = Date.now();
    
    const s = socketRef.current;
    const sid = sessionIdRef.current;
    
    // Setup local scratchpad stroke
    const ctx = ctxRef.current;
    if (ctx) {
      ctx.globalCompositeOperation = toolRef.current === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = toolRef.current === 'eraser' ? 'rgba(0,0,0,1)' : colorRef.current;
      ctx.lineWidth = lineWidthRef.current;
      ctx.beginPath();
      ctx.moveTo(clientX, clientY);
      
      currentStrokeRef.current = {
        tool: toolRef.current,
        color: colorRef.current,
        lineWidth: lineWidthRef.current,
        points: [{x: clientX, y: clientY}]
      };
    }

    if (s) {
      s.emit('draw-start', { sessionId: sid, x, y, color: toolRef.current === 'eraser' ? bgColorRef2.current : colorRef.current, lineWidth: lineWidthRef.current });
    }
  };

  const handlePointerMove = e => {
    if (!e.isPrimary) return;

    const rect = padRectRef.current;
    if (!rect) return;
    const { x, y, clientX, clientY } = norm(e, rect);

    if (toolRef.current === 'text') {
      const g = textGestureRef.current;
      const dist = Math.hypot(x - g.x, y - g.y);
      if (!g.moveStarted && dist > 0.04) {
        g.moveStarted = true; g.moved = true;
        const s = socketRef.current;
        if (s) s.emit('text-move-start', { sessionId: sessionIdRef.current, x: g.x, y: g.y });
      }
      if (g.moveStarted) {
        const s = socketRef.current;
        if (s) s.emit('text-move', { sessionId: sessionIdRef.current, x, y });
      }
      return;
    }

    if (!isDrawingRef.current) return;

    // Draw locally instantly
    const ctx = ctxRef.current;
    if (ctx) {
      ctx.lineTo(clientX, clientY);
      ctx.stroke();
      if (currentStrokeRef.current) {
        currentStrokeRef.current.points.push({x: clientX, y: clientY});
      }
    }

    // Throttle network emissions
    const now = Date.now();
    if (now - lastEmitRef.current < THROTTLE_MS) return;
    lastEmitRef.current = now;

    const s = socketRef.current;
    const sid = sessionIdRef.current;
    const t = toolRef.current;
    const c = colorRef.current;
    const lw = lineWidthRef.current;
    const bg = bgColorRef2.current;

    if (s) {
      s.emit('draw', { sessionId: sid, x, y, color: t === 'eraser' ? bg : c, lineWidth: lw });
    }
  };

  const handlePointerUp = e => {
    if (!e.isPrimary) return;
    
    // We lost the two-finger swipe undo functionality by moving to pointer events, 
    // but the pad interface has visible undo/redo buttons now anyway.
    initialSwipeYRef.current = null;

    const t = toolRef.current;
    if (t === 'text') {
      const g = textGestureRef.current;
      const s = socketRef.current;
      const sid = sessionIdRef.current;
      if (g.moved) {
        if (s) s.emit('text-move-end', { sessionId: sid });
      } else {
        setTextPos({ x: g.x, y: g.y });
        setTextInput('');
        setTimeout(() => textInputRef.current?.focus(), 60);
      }
      textGestureRef.current = { x: 0, y: 0, moved: false, moveStarted: false };
      return;
    }

    if (isDrawingRef.current && currentStrokeRef.current) {
      localHistoryRef.current.push(currentStrokeRef.current);
      currentStrokeRef.current = null;
    }

    isDrawingRef.current = false;
    padRectRef.current = null;
    const s = socketRef.current;
    const sid = sessionIdRef.current;
    if (s) {
      s.emit('draw-end', { sessionId: sid });
    }
  };

  const handleClear = () => {
    const s = socketRef.current;
    if (s) s.emit('clear-board', { sessionId: sessionIdRef.current ?? sessionId });
    if (navigator.vibrate) navigator.vibrate(50);
    // Clear local cache
    localHistoryRef.current = [];
    redrawLocalCanvas();
  };

  const handleUndoRedo = (action) => {
    const s = socketRef.current;
    if (s) s.emit(action, { sessionId: sessionIdRef.current ?? sessionId });
    if (action === 'undo') {
      localHistoryRef.current.pop();
    } else {
      // For simplicity, redo on local isn't perfectly supported since we pop it permanently.
      // But typically redo is rare. It's safe to ignore for local scratchpad overlay.
    }
    redrawLocalCanvas();
  };

  const handleSetTool = (t) => {
    setTool(t);
    toolRef.current = t;
    const s = socketRef.current;
    if (s) s.emit('set-tool', { sessionId: sessionIdRef.current ?? sessionId, tool: t });
  };

  const submitText = () => {
    const s = socketRef.current;
    if (textInput.trim() && s && textPos) {
      localHistoryRef.current = [];
      redrawLocalCanvas(); // Clear local strokes conceptually when adding permanent text, or just leave it. Leaving it is fine.
      s.emit('add-text', {
        sessionId: sessionIdRef.current ?? sessionId,
        id: Math.random().toString(36).substr(2, 9),
        text: textInput.trim(),
        x: textPos.x, y: textPos.y,
        color, fontSize: 32, // larger text looks better on board
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

      {/* Main Container */}
      <div className="flex flex-row h-screen w-screen overflow-hidden select-none touch-none bg-slate-950" style={{ backgroundColor: bgColor }}>

        {/* ── All-in-One Sidebar ── */}
        <div className="z-40 flex-shrink-0 w-20 flex flex-col items-center gap-2 py-3 bg-slate-900 border-r border-slate-700/60 shadow-xl overflow-y-auto w-scroll-thin">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse mb-1 flex-shrink-0" />
          <div className="w-12 h-px bg-slate-700/50 flex-shrink-0" />

          {/* Tools */}
          {TOOLS.map(t => (
            <button
              key={t.id}
              onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); handleSetTool(t.id); }}
              onClick={() => handleSetTool(t.id)}
              title={t.label}
              className={`w-12 h-12 flex-shrink-0 flex items-center justify-center rounded-xl transition-all ${
                tool === t.id ? `${t.active} text-white shadow-lg scale-105` : 'text-slate-400 hover:bg-slate-800 active:scale-95'
              }`}
            >
              {t.icon}
            </button>
          ))}

          <div className="w-12 h-px bg-slate-700/50 mt-1 mb-1 flex-shrink-0" />

          {/* Color Blocks (Only active for Pen/Text) */}
          <div className={`flex flex-col gap-1 items-center transition-opacity ${tool === 'eraser' ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Color</p>
            <div className="grid grid-cols-2 gap-1.5 pb-2">
              {QUICK_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full transition-all border-2 ${
                    color === c ? 'border-sky-400 scale-125 shadow-md z-10' : 'border-slate-600 hover:scale-110'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="w-12 h-px bg-slate-700/50 my-1 flex-shrink-0" />

          {/* Size Slide (Vertical roughly or just simple buttons) */}
          <div className="flex flex-col items-center flex-shrink-0 gap-1 mt-1 mb-2">
            <p className="text-[9px] text-slate-500 uppercase tracking-widest">Size</p>
            <input 
              type="range" 
              min="1" max="50" 
              value={lineWidth}
              onChange={e => setLineWidth(Number(e.target.value))}
              className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500 origin-center -rotate-90 my-8"
              style={{ width: '60px' }}
            />
          </div>

          <div className="mt-auto flex-shrink-0" />

          {/* History / Actions */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button onClick={() => handleUndoRedo('undo')}
              className="w-12 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            ><Undo2 className="w-4 h-4" /></button>
            <button onClick={() => handleUndoRedo('redo')}
              className="w-12 h-10 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            ><Redo2 className="w-4 h-4" /></button>
            <button onClick={handleClear}
              className="w-12 h-10 flex items-center justify-center rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all text-sm mt-1"
            ><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>

        {/* ── Drawing Area ── */}
        <div
          ref={padRef}
          className="flex-1 h-full relative overflow-hidden"
          style={{ cursor: 'crosshair', touchAction: 'none' }} // better UX for drawing natively
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Faint Grid lines to help "Where to write" */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-[0.2]"
            style={{ 
              backgroundImage: `linear-gradient(rgba(100, 116, 139, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(100, 116, 139, 0.5) 1px, transparent 1px)`,
              backgroundSize: '40px 40px' 
            }}
          />

          {/* Local Scratchpad Canvas */}
          <canvas
            ref={localCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

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
                className="bg-slate-800 border-2 border-emerald-500 text-white text-base px-3 py-2 rounded-xl outline-none w-52 shadow-2xl"
                placeholder="Type & press Enter…"
              />
            </div>
          )}

          {/* Default Status Indicator */}
          <div className="absolute bottom-4 right-4 flex gap-2 items-center pointer-events-none bg-slate-900/40 px-3 py-1.5 rounded-full backdrop-blur">
            {tool === 'text' && !textPos && (
              <span className="text-[10px] text-emerald-400 font-mono font-medium tracking-wide">TAP TO TYPE</span>
            )}
            {(tool === 'pen' || tool === 'eraser') && (
              <span className="text-[10px] font-mono tracking-wide font-medium text-slate-300">
                {tool.toUpperCase()}
              </span>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
