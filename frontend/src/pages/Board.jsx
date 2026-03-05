import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import QRCode from 'react-qr-code';
import { Pen, Eraser, Download, Trash2, Undo2, Redo2, MonitorPlay, StickyNote, X, Smartphone } from 'lucide-react';
import html2canvas from 'html2canvas';

// In production, the socket connects to the same host serving the frontend.
// In development, it connects to the local dev server hostname.
const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

export default function Board() {
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [searchParams] = useSearchParams();
  
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [padConnected, setPadConnected] = useState(false);
  const [showQR, setShowQR] = useState(false);
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ffffff'); // Default light mode stroke could be dark, let's use a standard default
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); // pen or eraser
  const [bgColor, setBgColor] = useState('#0f172a'); // default dark background
  const [padUrl, setPadUrl] = useState('');
  const [laserPos, setLaserPos] = useState(null);

  // History for Undo/Redo
  const [history, setHistory] = useState([]);
  const [redoList, setRedoList] = useState([]);

  // Stickies
  const [stickies, setStickies] = useState([]);

  useEffect(() => {
    // Use pre-established session from ?session= param, or generate a new one
    const preSession = searchParams.get('session');
    const newSessionId = preSession || Math.random().toString(36).substring(2, 8);
    setSessionId(newSessionId);
    
    // If arriving via Connect Device flow, pad is already connected
    if (preSession) setPadConnected(true);

    // Construct the URL for the pad
    const url = `${window.location.origin}/pad/${newSessionId}`;
    setPadUrl(url);

    // Initialize Socket
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join-session', { sessionId: newSessionId, role: 'board' });
    });

    newSocket.on('participant-joined', ({ role }) => {
      if (role === 'pad') setPadConnected(true);
    });

    return () => newSocket.close();
  }, []);

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth * window.devicePixelRatio;
    canvas.height = parent.clientHeight * window.devicePixelRatio;
    canvas.style.width = `${parent.clientWidth}px`;
    canvas.style.height = `${parent.clientHeight}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    
    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    contextRef.current = ctx;
    
    // Save initial state to history
    saveHistoryState(canvas);
  }, []);

  function saveHistoryState(canvas) {
    setHistory(prev => [...prev, canvas.toDataURL()]);
    setRedoList([]); // Clear redo on new action
  }

  function getCoordinates(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Support both mouse and touch
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      normalizedX: (clientX - rect.left) / rect.width,
      normalizedY: (clientY - rect.top) / rect.height
    };
  }

  function startDrawing(e) {
    const { x, y, normalizedX, normalizedY } = getCoordinates(e);
    contextRef.current.beginPath();
    contextRef.current.moveTo(x, y);
    setIsDrawing(true);
    
    // Emit to socket
    if (socket) {
      socket.emit('draw-start', { sessionId, x: normalizedX, y: normalizedY, color: tool === 'eraser' ? bgColor : color, lineWidth });
    }
  };

  function draw(e) {
    if (!isDrawing) return;
    const { x, y, normalizedX, normalizedY } = getCoordinates(e);
    
    contextRef.current.strokeStyle = tool === 'eraser' ? bgColor : color;
    contextRef.current.lineWidth = lineWidth;
    contextRef.current.lineTo(x, y);
    contextRef.current.stroke();

    if (socket) {
      socket.emit('draw', { sessionId, x: normalizedX, y: normalizedY, color: tool === 'eraser' ? bgColor : color, lineWidth });
    }
  };

  function stopDrawing() {
    if (isDrawing) {
      contextRef.current.closePath();
      setIsDrawing(false);
      saveHistoryState(canvasRef.current);
      
      if (socket) {
        socket.emit('draw-end', { sessionId });
      }
    }
  };

  // Listen for socket events from Pad
  useEffect(() => {
    if (!socket || !contextRef.current || !canvasRef.current) return;

    socket.on('draw-start', (data) => {
      const { x, y, color: drawColor, lineWidth: drawWidth } = data;
      const canvas = canvasRef.current;
      const actualX = x * canvas.clientWidth;
      const actualY = y * canvas.clientHeight;
      
      contextRef.current.beginPath();
      contextRef.current.moveTo(actualX, actualY);
      contextRef.current.strokeStyle = drawColor;
      contextRef.current.lineWidth = drawWidth;
    });

    socket.on('draw', (data) => {
      const { x, y, color: drawColor, lineWidth: drawWidth } = data;
      const canvas = canvasRef.current;
      const actualX = x * canvas.clientWidth;
      const actualY = y * canvas.clientHeight;
      
      contextRef.current.strokeStyle = drawColor;
      contextRef.current.lineWidth = drawWidth;
      contextRef.current.lineTo(actualX, actualY);
      contextRef.current.stroke();
    });

    socket.on('draw-end', () => {
      contextRef.current.closePath();
      saveHistoryState(canvasRef.current);
    });

    socket.on('clear-board', () => {
      clearBoard(false);
      setStickies([]); // optionally clear stickies on clear board
    });

    socket.on('laser-start', (data) => setLaserPos({ x: data.x, y: data.y }));
    socket.on('laser-move', (data) => setLaserPos({ x: data.x, y: data.y }));
    socket.on('laser-end', () => setLaserPos(null));

    socket.on('undo', () => handleUndo());
    socket.on('redo', () => handleRedo());
    socket.on('add-sticky', (data) => {
      setStickies(prev => [...prev, data]);
    });
    socket.on('remove-sticky', (data) => {
      setStickies(prev => prev.filter(s => s.id !== data.id));
    });

    return () => {
      socket.off('draw-start');
      socket.off('draw');
      socket.off('draw-end');
      socket.off('clear-board');
      socket.off('laser-start');
      socket.off('laser-move');
      socket.off('laser-end');
      socket.off('undo');
      socket.off('redo');
      socket.off('add-sticky');
      socket.off('remove-sticky');
    };
  }, [socket, history, redoList]);

  function clearBoard(emit = true) {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    ctx.fillStyle = bgColor;
    // We must fill the entire actual canvas size
    ctx.fillRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    saveHistoryState(canvas);
    
    if (emit && socket) {
      socket.emit('clear-board', { sessionId });
    }
  };

  async function handleExport() {
    if (!canvasRef.current) return;
    const canvas = await html2canvas(canvasRef.current);
    const link = document.createElement('a');
    link.download = `WriteCast-${sessionId}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  // Undo/Redo logic (simplified)
  function handleUndo() {
    if (history.length > 1) {
      const newHistory = [...history];
      const currentState = newHistory.pop(); // Remove current
      setRedoList(prev => [...prev, currentState]);
      
      const previousState = newHistory[newHistory.length - 1];
      setHistory(newHistory);
      
      restoreCanvas(previousState);
    }
  };

  function handleRedo() {
    if (redoList.length > 0) {
      const newRedo = [...redoList];
      const nextState = newRedo.pop();
      setHistory(prev => [...prev, nextState]);
      setRedoList(newRedo);
      
      restoreCanvas(nextState);
    }
  };

  function restoreCanvas(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = contextRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
    };
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900" style={{ backgroundColor: bgColor }}>
      
      {/* Canvas */}
      <div className="absolute inset-0 cursor-crosshair">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full touch-none"
        />
      </div>

      {/* Stickies */}
      {stickies.map(sticky => (
        <div 
          key={sticky.id}
          className="absolute z-[80] shadow-xl p-4 rotate-2 hover:rotate-0 transition-transform cursor-pointer"
          style={{ 
            left: `${sticky.x * 100}%`, 
            top: `${sticky.y * 100}%`,
            backgroundColor: sticky.color || '#fef08a',
            width: '200px',
            minHeight: '150px'
          }}
        >
          <button 
            onClick={() => {
              setStickies(prev => prev.filter(s => s.id !== sticky.id));
              if(socket) socket.emit('remove-sticky', { sessionId, id: sticky.id });
            }}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow hover:scale-110"
          >
            <X className="w-3 h-3" />
          </button>
          <div className="font-medium text-slate-800 break-words whitespace-pre-wrap">
            {sticky.text}
          </div>
        </div>
      ))}

      {/* Laser Pointer */}
      {laserPos && (
        <div 
          className="absolute w-6 h-6 bg-red-500 rounded-full blur-[2px] pointer-events-none z-[100] transform -translate-x-1/2 -translate-y-1/2"
          style={{ 
            left: `${laserPos.x * 100}%`, 
            top: `${laserPos.y * 100}%`,
            boxShadow: '0 0 20px 10px rgba(239, 68, 68, 0.6)'
          }}
        />
      )}

      {/* QR Code Overlay — only shown when user opens it and pad not yet connected */}
      {showQR && !padConnected && (
        <div className="absolute top-6 left-6 glass p-4 rounded-2xl flex items-center gap-4 z-10 transition-transform hover:scale-105">
          <div className="bg-white p-2 rounded-xl">
            {padUrl && <QRCode value={padUrl} size={80} level="H" />}
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Join via Phone</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Scan to turn your phone<br/>into a drawing pad.</p>
            <div className="mt-2 text-xs font-mono bg-slate-200 dark:bg-slate-700 p-1 rounded text-center">
              ID: {sessionId}
            </div>
          </div>
        </div>
      )}

      {/* Connected Badge — shown when pad joins */}
      {padConnected && (
        <div className="absolute top-6 left-6 glass px-4 py-3 rounded-2xl flex items-center gap-3 z-10 border border-green-400/30">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-semibold text-green-400">Device Connected</span>
        </div>
      )}

      {/* Floating Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 glass px-6 py-4 rounded-full flex items-center gap-4 z-10">
        
        <button 
          onClick={() => setTool('pen')} 
          className={`p-3 rounded-full transition-colors ${tool === 'pen' ? 'bg-blue-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          title="Pen"
        >
          <Pen className="w-5 h-5" />
        </button>

        <button 
          onClick={() => setTool('eraser')}
          className={`p-3 rounded-full transition-colors ${tool === 'eraser' ? 'bg-blue-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          title="Eraser"
        >
          <Eraser className="w-5 h-5" />
        </button>

        <button 
          onClick={() => {
            const id = Math.random().toString(36).substr(2, 9);
            const newSticky = { id, text: 'New Note', x: 0.5, y: 0.5, color: '#fef08a' };
            setStickies(prev => [...prev, newSticky]);
            if(socket) socket.emit('add-sticky', { sessionId, ...newSticky });
          }}
          className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-yellow-500"
          title="Add Sticky Note"
        >
          <StickyNote className="w-5 h-5" />
        </button>

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 mx-1" />

        <div className="flex flex-col items-center gap-1" title="Background Color">
          <input 
            type="color" 
            value={bgColor} 
            onChange={(e) => { 
              setBgColor(e.target.value); 
              if (socket) socket.emit('change-bg', { sessionId, color: e.target.value }); 
            }}
            className="w-6 h-6 rounded-full overflow-hidden cursor-pointer"
          />
        </div>

        <div className="flex flex-col items-center gap-1" title="Pen Color">
          <input 
            type="color" 
            value={color} 
            onChange={(e) => { setColor(e.target.value); setTool('pen'); }}
            className="w-6 h-6 rounded-full overflow-hidden cursor-pointer"
          />
        </div>

        <input 
          type="range" 
          min="1" 
          max="50" 
          value={lineWidth} 
          onChange={(e) => setLineWidth(e.target.value)}
          className="w-24 accent-blue-500 cursor-pointer"
          title="Pen Size"
        />

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 mx-1" />

        <button onClick={handleUndo} disabled={history.length <= 1} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full disabled:opacity-50 transition-colors" title="Undo">
          <Undo2 className="w-5 h-5" />
        </button>
        
        <button onClick={handleRedo} disabled={redoList.length === 0} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full disabled:opacity-50 transition-colors" title="Redo">
          <Redo2 className="w-5 h-5" />
        </button>

        <button onClick={() => clearBoard(true)} className="p-2 hover:bg-red-500/20 text-red-500 rounded-full transition-colors" title="Clear Board">
          <Trash2 className="w-5 h-5" />
        </button>

        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 mx-1" />

        {/* Connect Phone toggle */}
        {!padConnected && (
          <button
            onClick={() => setShowQR(v => !v)}
            className={`p-3 rounded-full transition-colors ${showQR ? 'bg-indigo-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            title="Connect Phone"
          >
            <Smartphone className="w-5 h-5" />
          </button>
        )}

        <button onClick={handleExport} className="p-3 bg-slate-900 border border-slate-700 dark:bg-white dark:text-slate-900 text-white rounded-full hover:scale-105 transition-transform shadow-lg" title="Export PNG">
          <Download className="w-5 h-5" />
        </button>

      </div>
    </div>
  );
}
