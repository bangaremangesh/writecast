import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import QRCode from 'react-qr-code';
import { Pen, Eraser, Download, Trash2, Undo2, Redo2, Smartphone, Type, Square, Circle, Minus, PaintBucket } from 'lucide-react';
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
  const bgColorRef = useRef('#ffffff'); // Keep ref in sync for use in clearBoard
  
  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000'); // Default pen color: black
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); // pen, eraser, text, shape
  const [bgColor, setBgColor] = useState('#ffffff'); // default white background
  
  // Board specific tool state
  const [shapeType, setShapeType] = useState('rect');
  const [shapeFill, setShapeFill] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState(null);
  const textInputRef = useRef(null);

  // Keep ref in sync with state so clearBoard always has latest value
  function applyBgColor(newColor) {
    bgColorRef.current = newColor;
    setBgColor(newColor);
  }
  const [padUrl, setPadUrl] = useState('');
  const [laserPos, setLaserPos] = useState(null);

  // History for Undo/Redo
  const [history, setHistory] = useState([]);
  const [redoList, setRedoList] = useState([]);
  const historyRef = useRef([]);

  // Text labels
  const [texts, setTexts] = useState([]);
  const selectedTextRef = useRef(null); // { id, offsetX, offsetY }

  // Shape preview
  const previewCanvasRef = useRef(null);
  const shapePreviewRef  = useRef(null);

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

  // Repaint canvas background whenever bgColor changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
  }, [bgColor]);

  // Initialize Canvas + Preview Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const dpr = window.devicePixelRatio;

    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.fillStyle   = bgColor;
    ctx.fillRect(0, 0, w, h);
    contextRef.current = ctx;

    // Preview canvas (no DPR scaling — CSS-pixel drawing for shapes)
    const pc = previewCanvasRef.current;
    if (pc) {
      pc.width  = w; pc.height = h;
      pc.style.width  = `${w}px`;
      pc.style.height = `${h}px`;
    }

    saveHistoryState(canvas);
  }, []);

  function saveHistoryState(canvas) {
    const url = canvas.toDataURL();
    historyRef.current = [...historyRef.current, url];
    setHistory(historyRef.current);
    setRedoList([]);
  }

  // Shape drawing helper (used for preview and commit)
  function drawShapeOnCtx(ctx, { shape, x1, y1, x2, y2, color: c, lineWidth: lw, fill }) {
    ctx.beginPath();
    ctx.strokeStyle = c;
    ctx.lineWidth   = lw;
    if (fill) ctx.fillStyle = c;
    if (shape === 'rect') {
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
    } else if (shape === 'circle') {
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, rx, ry, 0, 0, Math.PI * 2);
    } else if (shape === 'line') {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    if (fill && shape !== 'line') ctx.fill();
    ctx.closePath();
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

    if (tool === 'text') {
      setTextPos({ x: normalizedX, y: normalizedY });
      setTextInput('');
      setTimeout(() => textInputRef.current?.focus(), 60);
      return;
    }

    setIsDrawing(true);
    
    if (tool === 'shape') {
      shapePreviewRef.current = { shape: shapeType, x1: x, y1: y, x2: x, y2: y, color, lineWidth, fill: shapeFill };
      if (socket) socket.emit('shape-start', { sessionId, shape: shapeType, x: normalizedX, y: normalizedY, color, lineWidth, fill: shapeFill });
      return;
    }

    // Default pen/eraser
    contextRef.current.beginPath();
    contextRef.current.moveTo(x, y);
    if (socket) {
      socket.emit('draw-start', { sessionId, x: normalizedX, y: normalizedY, color: tool === 'eraser' ? bgColor : color, lineWidth });
    }
  };

  function draw(e) {
    if (!isDrawing) return;
    const { x, y, normalizedX, normalizedY } = getCoordinates(e);
    
    if (tool === 'shape') {
      const s = shapePreviewRef.current;
      if (!s) return;
      s.x2 = x; s.y2 = y;
      const pc = previewCanvasRef.current;
      if (!pc) return;
      const pctx = pc.getContext('2d');
      pctx.clearRect(0, 0, pc.width, pc.height);
      drawShapeOnCtx(pctx, s);
      if (socket) socket.emit('shape-preview', { sessionId, x2: normalizedX, y2: normalizedY });
      return;
    }

    // Default pen/eraser
    contextRef.current.strokeStyle = tool === 'eraser' ? bgColor : color;
    contextRef.current.lineWidth = lineWidth;
    contextRef.current.lineTo(x, y);
    contextRef.current.stroke();

    if (socket) {
      socket.emit('draw', { sessionId, x: normalizedX, y: normalizedY, color: tool === 'eraser' ? bgColor : color, lineWidth });
    }
  };

  function stopDrawing() {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (tool === 'shape') {
      const s = shapePreviewRef.current;
      if (s) {
        drawShapeOnCtx(contextRef.current, s);
        const pc = previewCanvasRef.current;
        if (pc) pc.getContext('2d').clearRect(0, 0, pc.width, pc.height);
        saveHistoryState(canvasRef.current);
        shapePreviewRef.current = null;
        if (socket) socket.emit('shape-end', { sessionId });
      }
      return;
    }

    // Default pen/eraser
    contextRef.current.closePath();
    saveHistoryState(canvasRef.current);
    if (socket) {
      socket.emit('draw-end', { sessionId });
    }
  };

  function submitText() {
    if (textInput.trim() && textPos) {
      const newLabel = {
        id: Math.random().toString(36).substr(2, 9),
        text: textInput.trim(),
        x: textPos.x,
        y: textPos.y,
        color,
        fontSize: 20,
      };
      setTexts(prev => [...prev, newLabel]);
      if (socket) socket.emit('add-text', { sessionId, ...newLabel });
    }
    setTextPos(null);
    setTextInput('');
  }

  // Listen for socket events from Pad
  useEffect(() => {
    if (!socket || !contextRef.current || !canvasRef.current) return;

    const c  = canvasRef.current;
    const ctx = contextRef.current;

    const ax = nx => nx * c.clientWidth;
    const ay = ny => ny * c.clientHeight;

    socket.on('draw-start', ({ x, y, color: dc, lineWidth: dw }) => {
      ctx.beginPath(); ctx.moveTo(ax(x), ay(y));
      ctx.strokeStyle = dc; ctx.lineWidth = dw;
    });
    socket.on('draw', ({ x, y, color: dc, lineWidth: dw }) => {
      ctx.strokeStyle = dc; ctx.lineWidth = dw;
      ctx.lineTo(ax(x), ay(y)); ctx.stroke();
    });
    socket.on('draw-end', () => { ctx.closePath(); saveHistoryState(c); });

    socket.on('clear-board', () => { clearBoard(false); setTexts([]); });

    socket.on('laser-start', d => setLaserPos({ x: d.x, y: d.y }));
    socket.on('laser-move',  d => setLaserPos({ x: d.x, y: d.y }));
    socket.on('laser-end',    () => setLaserPos(null));

    socket.on('undo', handleUndo);
    socket.on('redo', handleRedo);

    // ── Text events ──
    socket.on('add-text', data => setTexts(prev => [...prev, data]));
    socket.on('text-move-start', ({ x, y }) => {
      setTexts(prev => {
        if (!prev.length) return prev;
        // Find closest text
        let best = prev[0], bestDist = Infinity;
        prev.forEach(t => {
          const d = Math.hypot(t.x - x, t.y - y);
          if (d < bestDist) { bestDist = d; best = t; }
        });
        selectedTextRef.current = { id: best.id, offsetX: x - best.x, offsetY: y - best.y };
        return prev;
      });
    });
    socket.on('text-move', ({ x, y }) => {
      const sel = selectedTextRef.current;
      if (!sel) return;
      setTexts(prev => prev.map(t =>
        t.id === sel.id ? { ...t, x: x - sel.offsetX, y: y - sel.offsetY } : t
      ));
    });
    socket.on('text-move-end', () => { selectedTextRef.current = null; });

    // ── Shape events ──
    socket.on('shape-start', ({ shape, x, y, color: sc, lineWidth: sw, fill }) => {
      shapePreviewRef.current = { shape, x1: ax(x), y1: ay(y), x2: ax(x), y2: ay(y), color: sc, lineWidth: sw, fill };
    });
    socket.on('shape-preview', ({ x2, y2 }) => {
      const s = shapePreviewRef.current;
      if (!s) return;
      s.x2 = ax(x2); s.y2 = ay(y2);
      const pc = previewCanvasRef.current;
      if (!pc) return;
      const pctx = pc.getContext('2d');
      pctx.clearRect(0, 0, pc.width, pc.height);
      drawShapeOnCtx(pctx, s);
    });
    socket.on('shape-end', () => {
      const s = shapePreviewRef.current;
      if (!s) return;
      drawShapeOnCtx(ctx, s);
      const pc = previewCanvasRef.current;
      if (pc) pc.getContext('2d').clearRect(0, 0, pc.width, pc.height);
      saveHistoryState(c);
      shapePreviewRef.current = null;
    });

    return () => {
      ['draw-start','draw','draw-end','clear-board','laser-start','laser-move',
       'laser-end','undo','redo','add-text','text-move-start','text-move',
       'text-move-end','shape-start','shape-preview','shape-end'
      ].forEach(ev => socket.off(ev));
    };
  }, [socket, history, redoList]);

  function clearBoard(emit = true) {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    // Use ref to always get the latest bgColor (avoids stale closure)
    ctx.fillStyle = bgColorRef.current;
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
    const h = historyRef.current;
    if (h.length > 1) {
      const next = [...h];
      const cur = next.pop();
      setRedoList(prev => [...prev, cur]);
      historyRef.current = next;
      setHistory(next);
      restoreCanvas(next[next.length - 1]);
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

  // Toolbar icon/text color should contrast with the board background
  const isDark = bgColor === '#000000';

  // Custom cursor
  const [cursorPos, setCursorPos] = useState(null);
  const cursorSize = Math.max(8, lineWidth);
  const cursorColor = tool === 'eraser' ? bgColor : tool === 'pen' ? color : '#ef4444';

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ backgroundColor: bgColor }}>
      
      {/* Canvas */}
      <div
        className="absolute inset-0"
        style={{ cursor: 'none' }}
        onMouseMove={e => setCursorPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setCursorPos(null)}
      >
        <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw}
          onMouseUp={stopDrawing} onMouseOut={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
          className="w-full h-full touch-none"
        />
        {/* Shape preview layer */}
        <canvas ref={previewCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>

      {/* Text input overlay for Board */}
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
            className="bg-white/90 dark:bg-slate-900/90 border border-blue-500/60 text-slate-900 dark:text-white text-base px-3 py-2 rounded-xl outline-none w-52 shadow-2xl"
            placeholder="Type & press Enter…"
          />
        </div>
      )}

      {/* Custom Cursor */}
      {cursorPos && (
        <div
          className="pointer-events-none fixed z-[200]"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            transform: 'translate(-50%, -50%)',
            width: cursorSize,
            height: cursorSize,
            borderRadius: '50%',
            backgroundColor: tool === 'eraser' ? 'transparent' : cursorColor,
            border: `2px solid ${isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'}`,
            boxShadow: isDark
              ? '0 0 0 1px rgba(0,0,0,0.5)'
              : '0 0 0 1px rgba(255,255,255,0.5)',
            transition: 'width 0.1s, height 0.1s',
          }}
        />
      )}

      {/* Text Labels */}
      {texts.map(tl => (
        <div
          key={tl.id}
          className="absolute z-[80] select-none cursor-move font-semibold drop-shadow-md"
          style={{
            left: `${tl.x * 100}%`,
            top:  `${tl.y * 100}%`,
            color: tl.color || '#000000',
            fontSize: `${tl.fontSize || 20}px`,
            transform: 'translate(-50%, -50%)',
            whiteSpace: 'nowrap',
          }}
          onMouseDown={e => {
            const startX = e.clientX, startY = e.clientY;
            const startTX = tl.x, startTY = tl.y;
            const cw = canvasRef.current?.clientWidth  || window.innerWidth;
            const ch = canvasRef.current?.clientHeight || window.innerHeight;
            const onMove = mv => setTexts(prev => prev.map(t =>
              t.id === tl.id
                ? { ...t, x: startTX + (mv.clientX - startX) / cw, y: startTY + (mv.clientY - startY) / ch }
                : t
            ));
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          onDoubleClick={() => setTexts(prev => prev.filter(t => t.id !== tl.id))}
          title="Drag to move · double-click to delete"
        >
          {tl.text}
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
        <div className="absolute top-4 left-4 glass px-2.5 py-1.5 rounded-full flex items-center gap-1.5 z-10 border border-green-400/30">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium text-green-400">Connected</span>
        </div>
      )}

      {/* Floating Toolbar */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-4 rounded-full flex items-center gap-4 z-10 shadow-xl border ${
        isDark
          ? 'bg-slate-900/90 border-slate-700 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-800'
      } backdrop-blur-md`}>
        
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
          onClick={() => setTool('text')}
          className={`p-3 rounded-full transition-colors ${tool === 'text' ? 'bg-emerald-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400'}`}
          title="Text"
        >
          <Type className="w-5 h-5" />
        </button>

        <div className="relative group">
          <button 
            onClick={() => setTool('shape')}
            className={`p-3 rounded-full transition-colors ${tool === 'shape' ? 'bg-purple-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-purple-600 dark:text-purple-400'}`}
            title="Shapes"
          >
            {shapeType === 'rect' ? <Square className="w-5 h-5" /> : shapeType === 'circle' ? <Circle className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
          </button>
          {/* Shape Sub-menu */}
          {tool === 'shape' && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl flex items-center gap-2 border border-slate-200 dark:border-slate-700">
              <button onClick={() => setShapeType('rect')} className={`p-2 rounded-lg ${shapeType === 'rect' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Square className="w-4 h-4" /></button>
              <button onClick={() => setShapeType('circle')} className={`p-2 rounded-lg ${shapeType === 'circle' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Circle className="w-4 h-4" /></button>
              <button onClick={() => setShapeType('line')} className={`p-2 rounded-lg ${shapeType === 'line' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}><Minus className="w-4 h-4" /></button>
              <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />
              <button onClick={() => setShapeFill(v => !v)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${shapeFill ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}><PaintBucket className="w-3 h-3" />{shapeFill ? 'Fill' : 'Outl'}</button>
            </div>
          )}
        </div>


        <div className="w-px h-8 bg-slate-300 dark:bg-slate-600 mx-1" />

        {/* Background Color Toggle: White / Black */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/60 dark:bg-slate-700/60 rounded-full" title="Board Background">
          <button
            onClick={() => {
              applyBgColor('#ffffff');
              if (socket) socket.emit('change-bg', { sessionId, color: '#ffffff' });
            }}
            className={`w-7 h-7 rounded-full border-2 transition-all ${
              bgColor === '#ffffff' ? 'border-blue-500 scale-110' : 'border-slate-300 dark:border-slate-600'
            } bg-white`}
            title="White Board"
          />
          <button
            onClick={() => {
              applyBgColor('#000000');
              if (socket) socket.emit('change-bg', { sessionId, color: '#000000' });
            }}
            className={`w-7 h-7 rounded-full border-2 transition-all ${
              bgColor === '#000000' ? 'border-blue-500 scale-110' : 'border-slate-300 dark:border-slate-600'
            } bg-black`}
            title="Black Board"
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
