import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Pen, Eraser, Trash2, Crosshair, Circle, StickyNote,
  Undo2, Redo2, ChevronRight, ChevronLeft, Palette
} from 'lucide-react';

const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

export default function Pad() {
  const { sessionId } = useParams();
  const padRef = useRef(null);
  const [socket, setSocket] = useState(null);

  // Drawing state
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff'); // mirrors board bg for eraser

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Swipe-to-undo/redo
  const [initialSwipeY, setInitialSwipeY] = useState(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join-session', { sessionId, role: 'pad' });
    });

    // Keep eraser in sync with board background
    newSocket.on('change-bg', ({ color: newBg }) => {
      setBgColor(newBg);
    });

    return () => newSocket.close();
  }, [sessionId]);

  const getNormalizedCoordinates = (e) => {
    const pad = padRef.current;
    if (!pad) return { x: 0, y: 0 };
    const rect = pad.getBoundingClientRect();
    const touch = e.touches[0];
    return {
      x: Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height)),
    };
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 3) { handleClear(); return; }

    // Two-finger vertical swipe for undo/redo
    if (e.touches.length === 2) {
      setInitialSwipeY(e.touches[0].clientY);
      setIsDrawing(false);
      return;
    }

    setIsDrawing(true);
    if (!socket) return;
    const { x, y } = getNormalizedCoordinates(e);

    if (tool === 'laser') {
      socket.emit('laser-start', { sessionId, x, y });
    } else {
      socket.emit('draw-start', {
        sessionId, x, y,
        color: tool === 'eraser' ? bgColor : color,
        lineWidth,
      });
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && initialSwipeY !== null) {
      const dy = initialSwipeY - e.touches[0].clientY;
      if (dy > 80) {
        if (socket) socket.emit('undo', { sessionId });
        if (navigator.vibrate) navigator.vibrate(40);
        setInitialSwipeY(null);
      } else if (dy < -80) {
        if (socket) socket.emit('redo', { sessionId });
        if (navigator.vibrate) navigator.vibrate(40);
        setInitialSwipeY(null);
      }
      return;
    }

    if (!isDrawing || !socket || e.touches.length > 1) return;
    const { x, y } = getNormalizedCoordinates(e);

    if (tool === 'laser') {
      socket.emit('laser-move', { sessionId, x, y });
    } else {
      socket.emit('draw', {
        sessionId, x, y,
        color: tool === 'eraser' ? bgColor : color,
        lineWidth,
      });
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length === 0) setInitialSwipeY(null);
    setIsDrawing(false);
    if (!socket) return;
    if (tool === 'laser') socket.emit('laser-end', { sessionId });
    else socket.emit('draw-end', { sessionId });
  };

  const handleClear = () => {
    if (socket) socket.emit('clear-board', { sessionId });
    if (navigator.vibrate) navigator.vibrate(50);
  };

  const handleAddNote = () => {
    const text = prompt('Enter note text:');
    if (text && socket) {
      const id = Math.random().toString(36).substr(2, 9);
      socket.emit('add-sticky', { sessionId, id, text, x: 0.5, y: 0.5, color: '#fef08a' });
    }
  };

  return (
    // Force landscape: full screen, row layout
    <div className="flex flex-row h-screen w-screen overflow-hidden select-none touch-none bg-slate-950">

      {/* ── Left Drawer ── */}
      <div
        className={`absolute left-0 top-0 h-full z-30 flex flex-row transition-transform duration-300 ease-out ${
          drawerOpen ? 'translate-x-0' : '-translate-x-[220px]'
        }`}
      >
        {/* Drawer Panel */}
        <div className="w-[220px] h-full bg-slate-900 border-r border-slate-700/60 flex flex-col gap-3 p-4 shadow-2xl overflow-y-auto">

          {/* Session indicator */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-slate-400 text-xs font-mono">#{sessionId}</span>
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Tool selector */}
          <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Tool</p>
          <div className="flex flex-col gap-2">
            {[
              { id: 'pen',    icon: <Pen className="w-5 h-5" />,       label: 'Pen',     active: 'bg-blue-600' },
              { id: 'eraser', icon: <Eraser className="w-5 h-5" />,    label: 'Eraser',  active: 'bg-slate-600' },
              { id: 'laser',  icon: <Crosshair className="w-5 h-5" />, label: 'Laser',   active: 'bg-red-600' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => { setTool(t.id); }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  tool === t.id
                    ? `${t.active} text-white shadow-md`
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Pen Color */}
          {tool !== 'laser' && (
            <>
              <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Pen Colour</p>
              <label className="flex items-center gap-3 px-4 py-2 cursor-pointer rounded-xl hover:bg-slate-800 transition-colors">
                <div
                  className="w-8 h-8 rounded-full border-2 border-slate-600 shadow-inner flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-slate-300 text-sm">Pick colour</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => { setColor(e.target.value); setTool('pen'); }}
                  className="opacity-0 absolute w-0 h-0"
                />
              </label>

              <div className="w-full h-px bg-slate-700/60" />

              {/* Pen Size */}
              <p className="text-xs text-slate-500 uppercase tracking-widest px-1">Pen Size</p>
              <div className="px-2 flex flex-col gap-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Fine</span><span>{lineWidth}px</span><span>Thick</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={lineWidth}
                  onChange={(e) => setLineWidth(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div className="w-full h-px bg-slate-700/60" />
            </>
          )}

          {/* Undo / Redo */}
          <p className="text-xs text-slate-500 uppercase tracking-widest px-1">History</p>
          <div className="flex gap-2">
            <button
              onClick={() => socket && socket.emit('undo', { sessionId })}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            >
              <Undo2 className="w-4 h-4" /> Undo
            </button>
            <button
              onClick={() => socket && socket.emit('redo', { sessionId })}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 active:scale-95 transition-all text-sm"
            >
              <Redo2 className="w-4 h-4" /> Redo
            </button>
          </div>

          <div className="w-full h-px bg-slate-700/60" />

          {/* Add Note */}
          <button
            onClick={handleAddNote}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 active:scale-95 transition-all text-sm font-medium"
          >
            <StickyNote className="w-5 h-5" />
            Add Sticky Note
          </button>

          {/* Clear Board */}
          <button
            onClick={handleClear}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95 transition-all text-sm font-medium mt-auto"
          >
            <Trash2 className="w-5 h-5" />
            Clear Board
          </button>
        </div>

        {/* Drawer Pull Tab */}
        <button
          onClick={() => setDrawerOpen(v => !v)}
          className="self-center bg-slate-800 border border-slate-700 rounded-r-2xl px-1.5 py-6 text-slate-400 hover:bg-slate-700 active:scale-95 transition-all shadow-lg"
        >
          {drawerOpen
            ? <ChevronLeft className="w-5 h-5" />
            : <ChevronRight className="w-5 h-5" />
          }
        </button>
      </div>

      {/* ── Drawing Area ── */}
      <div
        ref={padRef}
        className="flex-1 h-full relative overflow-hidden"
        style={{ cursor: tool === 'laser' ? 'crosshair' : 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04]">
          <span className="text-white font-black text-7xl tracking-widest uppercase rotate-[-15deg]">Draw</span>
        </div>

        {/* Drawing active indicator */}
        {isDrawing && tool !== 'laser' && (
          <div className="absolute bottom-4 right-4 flex gap-2 items-center pointer-events-none">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            <span className="text-xs text-blue-400 font-mono opacity-70">drawing…</span>
          </div>
        )}

        {/* Laser active indicator */}
        {tool === 'laser' && (
          <div className="absolute bottom-4 right-4 flex gap-2 items-center pointer-events-none">
            <Circle className="w-3 h-3 text-red-500 animate-pulse" />
            <span className="text-xs text-red-400 font-mono opacity-70">laser</span>
          </div>
        )}

        {/* Hint — shown when drawer is closed */}
        {!drawerOpen && (
          <div className="absolute top-1/2 left-3 -translate-y-1/2 pointer-events-none flex flex-col items-center gap-1 opacity-20">
            <ChevronRight className="w-5 h-5 text-white animate-bounce" />
          </div>
        )}

        {/* Tool badge top-left */}
        <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
          <div
            className="w-5 h-5 rounded-full border-2 border-white/20 shadow"
            style={{ backgroundColor: tool === 'eraser' ? bgColor : tool === 'laser' ? '#ef4444' : color }}
          />
          <div
            className="rounded-full opacity-60 bg-white/10"
            style={{ width: `${Math.max(8, lineWidth)}px`, height: `${Math.max(8, lineWidth)}px` }}
          />
        </div>
      </div>

    </div>
  );
}
