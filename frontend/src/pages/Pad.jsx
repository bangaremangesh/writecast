import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2, Crosshair, Circle, StickyNote } from 'lucide-react';

const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

export default function Pad() {
  const { sessionId } = useParams();
  const padRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [color, setColor] = useState('#ffffff');
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); // pen, eraser, laser
  const [isDrawing, setIsDrawing] = useState(false);
  const [initialSwipeX, setInitialSwipeX] = useState(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join-session', { sessionId, role: 'pad' });
    });

    return () => newSocket.close();
  }, [sessionId]);

  const getNormalizedCoordinates = (e) => {
    const pad = padRef.current;
    if (!pad) return { x: 0, y: 0 };
    
    const rect = pad.getBoundingClientRect();
    const touch = e.touches[0];
    
    // Normalize to 0-1 range
    const normalizedX = (touch.clientX - rect.left) / rect.width;
    const normalizedY = (touch.clientY - rect.top) / rect.height;
    
    return { x: Math.max(0, Math.min(1, normalizedX)), y: Math.max(0, Math.min(1, normalizedY)) };
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 3) {
      handleClear();
      setIsDrawing(false);
      return;
    }
    
    if (e.touches.length === 2) {
      setInitialSwipeX(e.touches[0].clientX);
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
        sessionId, 
        x, 
        y, 
        color: tool === 'eraser' ? '#0f172a' : color, 
        lineWidth 
      });
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && initialSwipeX !== null) {
      const currentX = e.touches[0].clientX;
      if (initialSwipeX - currentX > 100) {
        // swipe left -> undo
        if (socket) socket.emit('undo', { sessionId });
        if (navigator.vibrate) navigator.vibrate(50);
        setInitialSwipeX(null); // prevent multiple fires
      } else if (currentX - initialSwipeX > 100) {
        // swipe right -> redo
        if (socket) socket.emit('redo', { sessionId });
        if (navigator.vibrate) navigator.vibrate(50);
        setInitialSwipeX(null);
      }
      return;
    }

    if (!isDrawing || !socket || e.touches.length > 1) return;
    
    const { x, y } = getNormalizedCoordinates(e);
    
    if (tool === 'laser') {
      socket.emit('laser-move', { sessionId, x, y });
    } else {
      socket.emit('draw', { 
        sessionId, 
        x, 
        y, 
        color: tool === 'eraser' ? '#0f172a' : color, 
        lineWidth 
      });
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length === 0) setInitialSwipeX(null);

    setIsDrawing(false);
    if (!socket) return;
    
    if (tool === 'laser') {
      socket.emit('laser-end', { sessionId });
    } else {
      socket.emit('draw-end', { sessionId });
    }
  };

  const handleClear = () => {
    if (socket) {
      socket.emit('clear-board', { sessionId });
    }
    // Haptic feedback if available
    if (navigator.vibrate) navigator.vibrate(50);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-900 overflow-hidden select-none touch-none">
      
      {/* Top Details */}
      <div className="bg-slate-800 p-4 shadow-md flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white font-medium text-sm">Session: {sessionId}</span>
        </div>
        
        <button 
          onClick={() => {
            const text = prompt('Enter note text:');
            if (text && socket) {
              const id = Math.random().toString(36).substr(2, 9);
              socket.emit('add-sticky', { sessionId, id, text, x: 0.5, y: 0.5, color: '#fef08a' });
            }
          }}
          className="flex items-center gap-2 px-3 py-2 bg-yellow-500/20 text-yellow-500 rounded-full text-sm font-bold active:bg-yellow-500/40"
        >
          <StickyNote className="w-4 h-4" />
          <span className="hidden sm:inline">Add Note</span>
        </button>

        <button 
          onClick={handleClear}
          className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-full text-sm font-bold active:bg-red-500/30"
        >
          <Trash2 className="w-4 h-4" />
          Clear Board
        </button>
      </div>

      {/* Main Touch Pad Area */}
      <div 
        ref={padRef}
        className="flex-1 w-full bg-slate-900 border-y border-slate-700/50 relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
          <div className="text-center font-bold text-4xl text-white tracking-widest uppercase">
            Drawing Pad
          </div>
        </div>
        
        {/* Visual feedback for drawing */}
        {isDrawing && tool !== 'laser' && (
          <div className="absolute top-4 left-4 flex gap-2 items-center pointer-events-none opacity-50">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span className="text-xs text-blue-500 font-mono">Drawing...</span>
          </div>
        )}
      </div>

      {/* Tools Dock */}
      <div className="bg-slate-800 p-6 flex flex-col gap-6 z-10 pb-8 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        
        {/* Tool Selector */}
        <div className="flex justify-between items-center p-2 bg-slate-900/50 rounded-2xl">
          <button 
            onClick={() => setTool('pen')}
            className={`flex-1 flex justify-center p-3 rounded-xl transition-all ${tool === 'pen' ? 'bg-blue-600 shadow-md transform scale-105' : 'text-slate-400'}`}
          >
            <Pen className="w-6 h-6" />
          </button>
          
          <button 
            onClick={() => setTool('eraser')}
            className={`flex-1 flex justify-center p-3 rounded-xl transition-all ${tool === 'eraser' ? 'bg-slate-700 shadow-md transform scale-105' : 'text-slate-400'}`}
          >
            <Eraser className="w-6 h-6" />
          </button>

          <button 
            onClick={() => setTool('laser')}
            className={`flex-1 flex justify-center p-3 rounded-xl transition-all ${tool === 'laser' ? 'bg-red-600 shadow-md transform scale-105 shadow-red-500/30' : 'text-slate-400'}`}
          >
            <Crosshair className="w-6 h-6" />
          </button>
        </div>

        {/* Color and Size Controls (hide if laser is selected) */}
        {tool !== 'laser' ? (
          <div className="flex items-center gap-6">
            <label className="relative flex-shrink-0">
              <input 
                type="color" 
                value={color} 
                onChange={(e) => { setColor(e.target.value); setTool('pen'); }}
                className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" 
              />
              <div 
                className="w-12 h-12 rounded-full border-4 border-slate-700 shadow-inner" 
                style={{ backgroundColor: color }} 
              />
            </label>
            
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex justify-between text-xs text-slate-400 px-1">
                <span>Fine</span>
                <span>Thick</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={lineWidth} 
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="w-full accent-blue-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <div className="h-12 flex items-center justify-center text-slate-400 text-sm">
            <Circle className="w-4 h-4 text-red-500 animate-pulse mr-2" />
            Laser Pointer Mode Active
          </div>
        )}
      </div>
    </div>
  );
}
