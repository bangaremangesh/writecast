import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import QRCode from 'react-qr-code';
import { Pen, Eraser, Download, Trash2, Undo2, Redo2, Smartphone, Type, Square, Circle, Minus, PaintBucket, Triangle, Shapes, MousePointer2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import * as fabric from 'fabric';
import jsPDF from 'jspdf';

// In production, the socket connects to the same host serving the frontend.
// In development, it connects to the local dev server hostname.
const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

export default function Board() {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const [searchParams] = useSearchParams();
  
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [padConnected, setPadConnected] = useState(false);
  const [showQR, setShowQR] = useState(false);
  
  // Drawing state
  const [color, setColor] = useState('#000000'); 
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState('pen'); // pen, eraser, select, text, shape
  const [bgColor, setBgColor] = useState('#ffffff'); 
  const bgColorRef = useRef('#ffffff');
  
  // Board specific tool state
  const [shapeType, setShapeType] = useState('rect');
  const [shapeFill, setShapeFill] = useState(false);
  const [padUrl, setPadUrl] = useState('');
  const [laserPos, setLaserPos] = useState(null);

  // Multi-page state
  const [pages, setPages] = useState([{ id: 0, state: null }]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // History state for simpler fabric canvas manipulation
  const [history, setHistory] = useState([]);
  const [redoList, setRedoList] = useState([]);

  // Zoom state
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = () => {
    const fc = fabricRef.current;
    if (!fc) return;
    let newZoom = fc.getZoom() * 1.2;
    if (newZoom > 5) newZoom = 5;
    fc.zoomToPoint({ x: fc.width / 2, y: fc.height / 2 }, newZoom);
    setZoom(newZoom);
  };

  const handleZoomOut = () => {
    const fc = fabricRef.current;
    if (!fc) return;
    let newZoom = fc.getZoom() / 1.2;
    if (newZoom < 0.1) newZoom = 0.1;
    fc.zoomToPoint({ x: fc.width / 2, y: fc.height / 2 }, newZoom);
    setZoom(newZoom);
  };

  const handleZoomReset = () => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setZoom(1);
    fc.requestRenderAll();
  };

  // --- Multi-Page Functions ---
  function saveCurrentPage() {
    const fc = fabricRef.current;
    if (!fc) return;
    const json = fc.toJSON();
    setPages(prev => {
      const newPages = [...prev];
      newPages[currentPageIndex] = { ...newPages[currentPageIndex], state: json };
      return newPages;
    });
  }

  function loadPage(index) {
    const fc = fabricRef.current;
    if (!fc) return;
    
    // Save current before switching
    saveCurrentPage();

    const targetPage = pages[index];
    if (targetPage && targetPage.state) {
      fc.loadFromJSON(targetPage.state, () => {
        fc.backgroundColor = bgColorRef.current;
        fc.requestRenderAll();
        // Reset history purely for the new page view session
        setHistory([targetPage.state]);
        setRedoList([]);
        setCurrentPageIndex(index);
      });
    } else {
      fc.clear();
      fc.backgroundColor = bgColorRef.current;
      fc.requestRenderAll();
      setHistory([fc.toJSON()]);
      setRedoList([]);
      setCurrentPageIndex(index);
    }
  }

  function handleAddPage() {
    saveCurrentPage();
    const newIndex = pages.length;
    setPages(prev => [...prev, { id: newIndex, state: null }]);
    
    // Switch to the newly created blank page
    const fc = fabricRef.current;
    if (fc) {
      fc.clear();
      fc.backgroundColor = bgColorRef.current;
      fc.requestRenderAll();
      setHistory([fc.toJSON()]);
      setRedoList([]);
      setCurrentPageIndex(newIndex);
    }
  }

  // --- Helper Functions ---
  function saveHistoryState(fc) {
    if (!fc) return;
    const json = fc.toJSON();
    // avoid pushing duplicates rapidly
    setHistory(prev => [...prev, json]);
    setRedoList([]);
  }

  function handleUndo() {
    if (history.length > 1) {
      const fc = fabricRef.current;
      const nextH = [...history];
      const cur = nextH.pop(); // pop current
      setRedoList(prev => [...prev, cur]);
      setHistory(nextH);
      const prevState = nextH[nextH.length - 1]; // state right before
      
      fc.loadFromJSON(prevState, () => {
        fc.requestRenderAll();
      });
    }
  }

  function handleRedo() {
    if (redoList.length > 0) {
      const fc = fabricRef.current;
      const newR = [...redoList];
      const nextState = newR.pop();
      setHistory(prev => [...prev, nextState]);
      setRedoList(newR);
      
      fc.loadFromJSON(nextState, () => {
        fc.requestRenderAll();
      });
    }
  }

  function handleClear(emit = true) {
    const fc = fabricRef.current;
    if (fc) {
      fc.clear();
      fc.backgroundColor = bgColorRef.current;
      saveHistoryState(fc);
      if (emit && socket) socket.emit('clear-board', { sessionId });
    }
  }

  async function handleExport() {
    const fc = fabricRef.current;
    if (!fc) return;

    // Save current active screen state
    saveCurrentPage();

    if (pages.length <= 1) {
       // Single page: standard PNG
       const dataUrl = fc.toDataURL({ format: 'png', multiplier: 2 });
       const link = document.createElement('a');
       link.download = `WriteCast-${sessionId}.png`;
       link.href = dataUrl;
       link.click();
    } else {
       // Multiple pages: PDF
       const pdf = new jsPDF({
         orientation: fc.width > fc.height ? 'landscape' : 'portrait',
         unit: 'px',
         format: [fc.width, fc.height]
       });

       // We temporarily load each page into the canvas to get its image representation
       // Since users want their PDF instantly, we await the rendering callback.
       for (let i = 0; i < pages.length; i++) {
         const p = pages[i];
         const pageState = i === currentPageIndex ? fc.toJSON() : p.state;

         await new Promise((resolve) => {
           if (!pageState) {
             fc.clear();
             fc.backgroundColor = bgColorRef.current;
             fc.requestRenderAll();
             resolve();
           } else {
             fc.loadFromJSON(pageState, () => {
               fc.backgroundColor = bgColorRef.current;
               fc.requestRenderAll();
               resolve();
             });
           }
         });

         const dataUrl = fc.toDataURL({ format: 'png', multiplier: 1.5 });
         if (i > 0) pdf.addPage([fc.width, fc.height], fc.width > fc.height ? 'landscape' : 'portrait');
         pdf.addImage(dataUrl, 'PNG', 0, 0, fc.width, fc.height);
       }

       pdf.save(`WriteCast-Notes-${sessionId}.pdf`);

       // Restore back the original view
       loadPage(currentPageIndex);
    }
  }

  // Setup Fabric Canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const parent = canvasRef.current.parentElement;
    
    const fc = new fabric.Canvas(canvasRef.current, {
      width: parent.clientWidth,
      height: parent.clientHeight,
      backgroundColor: bgColor,
      isDrawingMode: true,
      selection: false,
    });
    
    fabricRef.current = fc;

    const handleResize = () => {
      fc.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
    };
    window.addEventListener('resize', handleResize);

    // Initial history save
    saveHistoryState(fc);

    // Wheel zoom & pan support
    fc.on('mouse:wheel', function(opt) {
      if (opt.e.ctrlKey || opt.e.metaKey) {
        let delta = opt.e.deltaY;
        let newZoom = fc.getZoom() * (0.999 ** delta);
        if (newZoom > 5) newZoom = 5;
        if (newZoom < 0.1) newZoom = 0.1;
        fc.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, newZoom);
        setZoom(newZoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
      } else {
        // Two-finger pan
        let vpt = this.viewportTransform;
        vpt[4] -= opt.e.deltaX;
        vpt[5] -= opt.e.deltaY;
        this.requestRenderAll();
      }
    });

    // Track path creation from free drawing so we can make it selectable and socket sync
    fc.on('path:created', (opt) => {
      const path = opt.path;
      path.set({ selectable: tool === 'select', evented: tool === 'select' });
      saveHistoryState(fc);
      if (socket) {
        socket.emit('object:added', { sessionId, obj: path.toJSON() });
      }
    });

    fc.on('object:modified', (opt) => {
      saveHistoryState(fc);
      if (socket) socket.emit('object:modified', { sessionId, obj: opt.target.toJSON() });
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      fc.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update canvas background
  function applyBgColor(newColor) {
    bgColorRef.current = newColor;
    setBgColor(newColor);
    const fc = fabricRef.current;
    if (fc) {
      fc.backgroundColor = newColor;
      fc.requestRenderAll();
      if (socket) socket.emit('change-bg', { sessionId, color: newColor });
    }
  }

  // Update tool setting logic
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    // Apply properties based on tool
    if (tool === 'pen' || tool === 'eraser') {
      fc.isDrawingMode = true;
      fc.selection = false;
      
      const brush = new fabric.PencilBrush(fc);
      brush.color = tool === 'eraser' ? bgColorRef.current : color;
      brush.width = parseInt(lineWidth, 10) || 5;
      fc.freeDrawingBrush = brush;
      
      fc.getObjects().forEach(o => o.set({ selectable: false, evented: false }));
    } else if (tool === 'select') {
      fc.isDrawingMode = false;
      fc.selection = true;
      fc.getObjects().forEach(o => o.set({ selectable: true, evented: true }));
      fc.requestRenderAll();
    } else {
      // shape or text tools
      fc.isDrawingMode = false;
      fc.selection = false;
      fc.getObjects().forEach(o => o.set({ selectable: false, evented: false }));
    }
    
    // Change active object color if changing color in select mode
    if (tool === 'select') {
      const activeObj = fc.getActiveObject();
      if (activeObj && activeObj.type !== 'image') {
        if (activeObj.type === 'path') {
          activeObj.set('stroke', color);
        } else if (activeObj.type === 'i-text' || activeObj.type === 'text') {
          activeObj.set('fill', color);
        } else {
          activeObj.set('stroke', color);
          if (activeObj.fill && activeObj.fill !== 'transparent') {
             activeObj.set('fill', color);
          }
        }
        fc.requestRenderAll();
        saveHistoryState(fc);
      }
    }
  }, [tool, color, lineWidth, bgColor]);

  // Shape drawing interactions
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    let isDrawingShape = false;
    let startPoint = null;
    let currentShape = null;

    const onMouseDown = (o) => {
      if (tool === 'shape') {
        isDrawingShape = true;
        const pointer = fc.getScenePoint(o.e);
        startPoint = pointer;

        const commonProps = {
          left: pointer.x,
          top: pointer.y,
          fill: shapeFill ? color : 'transparent',
          stroke: color,
          strokeWidth: parseInt(lineWidth, 10) || 5,
          selectable: false,
          evented: false,
        };

        if (shapeType === 'rect') {
          currentShape = new fabric.Rect({ ...commonProps, width: 0, height: 0 });
        } else if (shapeType === 'circle') {
          currentShape = new fabric.Circle({ ...commonProps, radius: 0, originX: 'center', originY: 'center' });
        } else if (shapeType === 'triangle') {
          currentShape = new fabric.Triangle({ ...commonProps, width: 0, height: 0 });
        } else if (shapeType === 'line') {
          currentShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], commonProps);
        }

        if (currentShape) {
          fc.add(currentShape);
        }
      } else if (tool === 'text') {
        const pointer = fc.getScenePoint(o.e);
        const textObj = new fabric.IText('Text', {
          left: pointer.x,
          top: pointer.y,
          fill: color,
          fontSize: 24,
          fontFamily: 'system-ui, sans-serif',
          selectable: true,
          evented: true
        });
        fc.add(textObj);
        fc.setActiveObject(textObj);
        textObj.enterEditing();
        textObj.selectAll();
        fc.requestRenderAll();
        setTool('select');
        saveHistoryState(fc);
      }
    };

    const onMouseMove = (o) => {
      if (!isDrawingShape || !currentShape) return;
      const pointer = fc.getScenePoint(o.e);
      
      if (shapeType === 'rect') {
        currentShape.set({
          width: Math.abs(pointer.x - startPoint.x),
          height: Math.abs(pointer.y - startPoint.y),
        });
        if (startPoint.x > pointer.x) currentShape.set({ left: pointer.x });
        if (startPoint.y > pointer.y) currentShape.set({ top: pointer.y });
      } else if (shapeType === 'circle') {
        const radius = Math.max(Math.abs(pointer.x - startPoint.x), Math.abs(pointer.y - startPoint.y)) / 2;
        currentShape.set({ radius });
        currentShape.set({ left: (startPoint.x + pointer.x) / 2, top: (startPoint.y + pointer.y) / 2 });
      } else if (shapeType === 'triangle') {
        currentShape.set({
          width: Math.abs(pointer.x - startPoint.x),
          height: Math.abs(pointer.y - startPoint.y)
        });
        if (startPoint.x > pointer.x) currentShape.set({ left: pointer.x });
        if (startPoint.y > pointer.y) currentShape.set({ top: pointer.y });
      } else if (shapeType === 'line') {
        currentShape.set({ x2: pointer.x, y2: pointer.y });
      }
      fc.requestRenderAll();
    };

    const onMouseUp = () => {
      if (!isDrawingShape) return;
      isDrawingShape = false;
      if (currentShape) {
        currentShape.setCoords();
        saveHistoryState(fc);
        if (socket) socket.emit('object:added', { sessionId, obj: currentShape.toJSON() });
      }
      currentShape = null;
      setTool('select');
    };

    // Keyboard support for selecting & deleting
    const onKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tool === 'select' && document.activeElement.tagName !== 'INPUT') {
          const actives = fc.getActiveObjects();
          if (actives.length) {
            actives.forEach(a => {
              if (a.isEditing) return; // don't delete if we are inside text
              fc.remove(a);
            });
            fc.discardActiveObject();
            saveHistoryState(fc);
          }
        }
      }
    };

    fc.on('mouse:down', onMouseDown);
    fc.on('mouse:move', onMouseMove);
    fc.on('mouse:up', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      fc.off('mouse:down', onMouseDown);
      fc.off('mouse:move', onMouseMove);
      fc.off('mouse:up', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, shapeType, shapeFill, color, lineWidth, socket, sessionId]);

  // Socket Initializer & Event Listeners
  useEffect(() => {
    const preSession = searchParams.get('session');
    const newSessionId = preSession || Math.random().toString(36).substring(2, 8);
    setSessionId(newSessionId);
    if (preSession) setPadConnected(true);
    setPadUrl(`${window.location.origin}/pad/${newSessionId}`);

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    newSocket.on('connect', () => newSocket.emit('join-session', { sessionId: newSessionId, role: 'board' }));
    newSocket.on('participant-joined', ({ role }) => { if (role === 'pad') setPadConnected(true); });
    
    return () => newSocket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for socket events from Pad
  const activeRemoteObj = useRef(null);

  useEffect(() => {
    if (!socket || !fabricRef.current) return;
    const fc = fabricRef.current;

    const ax = nx => nx * (fc.width || window.innerWidth);
    const ay = ny => ny * (fc.height || window.innerHeight);

    let remotePathPoints = [];
    socket.on('draw-start', ({ x, y, color: dc, lineWidth: dw }) => {
      remotePathPoints = [{ x: ax(x), y: ay(y) }];
      const polyline = new fabric.Polyline(remotePathPoints, {
        stroke: dc, strokeWidth: dw, fill: 'transparent',
        strokeLineCap: 'round', strokeLineJoin: 'round',
        selectable: tool === 'select', evented: tool === 'select',
        originX: 'center', originY: 'center'
      });
      fc.add(polyline);
      activeRemoteObj.current = polyline;
    });

    socket.on('draw', ({ x, y }) => {
      if (!activeRemoteObj.current) return;
      remotePathPoints.push({ x: ax(x), y: ay(y) });
      activeRemoteObj.current.set({ points: remotePathPoints });
      fc.requestRenderAll();
    });

    socket.on('draw-end', () => {
      if (activeRemoteObj.current) {
        activeRemoteObj.current.setCoords();
        saveHistoryState(fc);
        activeRemoteObj.current = null;
      }
    });

    socket.on('shape-start', ({ shape, x, y, color: sc, lineWidth: sw, fill }) => {
      const common = {
        left: ax(x), top: ay(y), fill: fill ? sc : 'transparent',
        stroke: sc, strokeWidth: sw, selectable: tool === 'select', evented: tool === 'select',
      };
      let s;
      if (shape === 'rect') s = new fabric.Rect({ ...common, width: 0, height: 0 });
      else if (shape === 'circle') s = new fabric.Circle({ ...common, radius: 0, originX: 'center', originY: 'center' });
      else if (shape === 'triangle') s = new fabric.Triangle({ ...common, width: 0, height: 0 });
      else if (shape === 'line') s = new fabric.Line([ax(x), ay(y), ax(x), ay(y)], common);
      
      fc.add(s);
      activeRemoteObj.current = { shapeObj: s, startX: ax(x), startY: ay(y), shape };
    });

    socket.on('shape-preview', ({ x2, y2 }) => {
      if (!activeRemoteObj.current) return;
      const { shapeObj, startX, startY, shape } = activeRemoteObj.current;
      const curX = ax(x2), curY = ay(y2);

      if (shape === 'rect') {
        shapeObj.set({ width: Math.abs(curX - startX), height: Math.abs(curY - startY) });
        if (startX > curX) shapeObj.set({ left: curX });
        if (startY > curY) shapeObj.set({ top: curY });
      } else if (shape === 'circle') {
        const radius = Math.max(Math.abs(curX - startX), Math.abs(curY - startY)) / 2;
        shapeObj.set({ radius, left: (startX + curX)/2, top: (startY + curY)/2 });
      } else if (shape === 'triangle') {
        shapeObj.set({ width: Math.abs(curX - startX), height: Math.abs(curY - startY) });
        if (startX > curX) shapeObj.set({ left: curX });
        if (startY > curY) shapeObj.set({ top: curY });
      } else if (shape === 'line') {
        shapeObj.set({ x2: curX, y2: curY });
      }
      fc.requestRenderAll();
    });

    socket.on('shape-end', () => {
      if (activeRemoteObj.current?.shapeObj) {
        activeRemoteObj.current.shapeObj.setCoords();
        saveHistoryState(fc);
        activeRemoteObj.current = null;
      }
    });

    socket.on('add-text', ({ text, x, y, color: tc, fontSize }) => {
      const textObj = new fabric.IText(text, {
        left: ax(x), top: ay(y), fill: tc, fontSize, fontFamily: 'system-ui, sans-serif',
        selectable: tool === 'select', evented: tool === 'select',
      });
      fc.add(textObj);
      saveHistoryState(fc);
    });

    socket.on('laser-start', d => setLaserPos({ x: d.x, y: d.y }));
    socket.on('laser-move',  d => setLaserPos({ x: d.x, y: d.y }));
    socket.on('laser-end',    () => setLaserPos(null));

    socket.on('clear-board', () => {
      fc.clear();
      fc.backgroundColor = bgColorRef.current;
      saveHistoryState(fc);
    });

    socket.on('undo', handleUndo);
    socket.on('redo', handleRedo);

    return () => {
      socket.off('draw-start'); socket.off('draw'); socket.off('draw-end');
      socket.off('shape-start'); socket.off('shape-preview'); socket.off('shape-end');
      socket.off('laser-start'); socket.off('laser-move'); socket.off('laser-end');
      socket.off('clear-board'); socket.off('undo'); socket.off('redo'); socket.off('add-text');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, tool]);

  const isDark = bgColor === '#000000';

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ backgroundColor: bgColor }}>
      
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="w-full h-full touch-none" />
      </div>

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

      {padConnected && (
        <div className="absolute top-4 left-4 glass px-2.5 py-1.5 rounded-full flex items-center gap-1.5 z-10 border border-green-400/30">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium text-green-400">Connected</span>
        </div>
      )}

      {tool === 'shape' && (
        <div className="absolute left-24 top-1/2 -translate-y-1/2 z-50 p-2 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl flex flex-col items-center gap-2 border border-slate-200 dark:border-slate-700 animate-in fade-in slide-in-from-left-2">
          <button title="Rectangle" onClick={() => setShapeType('rect')} className={`p-2.5 rounded-xl transition-colors ${shapeType === 'rect' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}><Square className="w-5 h-5" /></button>
          <button title="Circle" onClick={() => setShapeType('circle')} className={`p-2.5 rounded-xl transition-colors ${shapeType === 'circle' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}><Circle className="w-5 h-5" /></button>
          <button title="Triangle" onClick={() => setShapeType('triangle')} className={`p-2.5 rounded-xl transition-colors ${shapeType === 'triangle' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}><Triangle className="w-5 h-5" /></button>
          <button title="Line" onClick={() => setShapeType('line')} className={`p-2.5 rounded-xl transition-colors ${shapeType === 'line' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'}`}><Minus className="w-5 h-5" /></button>
          <div className="h-px w-8 bg-slate-300 dark:bg-slate-600 my-2" />
          <button title="Toggle Fill" onClick={() => setShapeFill(v => !v)} className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-[10px] uppercase tracking-wider font-bold transition-colors ${shapeFill ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/30 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent'}`}><PaintBucket className="w-4 h-4" />{shapeFill ? 'Filled' : 'Outline'}</button>
        </div>
      )}

      {/* Floating Toolbar */}
      <div className={`absolute top-1/2 left-4 -translate-y-1/2 px-2.5 py-4 rounded-full flex flex-col items-center gap-3 z-10 shadow-xl border ${
        isDark
          ? 'bg-slate-900/90 border-slate-700 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-800'
      } backdrop-blur-md`}>
        
        <button 
          onClick={() => setTool('select')} 
          className={`p-2 rounded-full flex gap-1 items-center transition-colors ${tool === 'select' ? 'bg-amber-500 text-white shadow-md' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400'}`}
          title="Select/Move"
        >
          <MousePointer2 className="w-4 h-4" />
        </button>

        <button 
          onClick={() => setTool('pen')} 
          className={`p-2 rounded-full transition-colors ${tool === 'pen' ? 'bg-blue-500 text-white shadow-md' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          title="Pen"
        >
          <Pen className="w-4 h-4" />
        </button>

        <button 
          onClick={() => setTool('eraser')}
          className={`p-2 rounded-full transition-colors ${tool === 'eraser' ? 'bg-slate-600 text-white shadow-md' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          title="Eraser"
        >
          <Eraser className="w-4 h-4" />
        </button>

        <button 
          onClick={() => setTool('text')}
          className={`p-2 rounded-full transition-colors ${tool === 'text' ? 'bg-emerald-500 text-white shadow-md' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400'}`}
          title="Text"
        >
          <Type className="w-4 h-4" />
        </button>

        <button 
          onClick={() => setTool('shape')}
          className={`p-2 rounded-full flex gap-1 items-center transition-colors ${tool === 'shape' ? 'bg-purple-500 text-white shadow-md' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-purple-600 dark:text-purple-400'}`}
          title="Shapes"
        >
          <Shapes className="w-4 h-4" />
        </button>

        <div className="h-px w-6 bg-slate-300 dark:bg-slate-600 my-0.5" />

        <div className="flex flex-col items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-slate-700/60 rounded-full" title="Board Background">
          <button
            onClick={() => applyBgColor('#ffffff')}
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              bgColor === '#ffffff' ? 'border-blue-500 scale-110' : 'border-slate-300 dark:border-slate-600'
            } bg-white`}
            title="White Board"
          />
          <button
            onClick={() => applyBgColor('#000000')}
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              bgColor === '#000000' ? 'border-blue-500 scale-110' : 'border-slate-300 dark:border-slate-600'
            } bg-black`}
            title="Black Board"
          />
        </div>

        <div className="flex flex-col items-center gap-1 pt-0.5" title="Color">
          <input 
            type="color" 
            value={color} 
            onChange={(e) => setColor(e.target.value)}
            className="w-6 h-6 rounded-full overflow-hidden cursor-pointer"
          />
        </div>

        <div className="py-8 flex items-center justify-center w-full relative">
          <input 
            type="range" 
            min="1" 
            max="50" 
            value={lineWidth} 
            onChange={(e) => setLineWidth(e.target.value)}
            className="w-20 accent-blue-500 cursor-pointer absolute -rotate-90"
            title="Size"
          />
        </div>

        <div className="h-px w-6 bg-slate-300 dark:bg-slate-600 my-0.5" />

        <button onClick={handleUndo} disabled={history.length <= 1} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full disabled:opacity-50 transition-colors" title="Undo">
          <Undo2 className="w-4 h-4" />
        </button>
        
        <button onClick={handleRedo} disabled={redoList.length === 0} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full disabled:opacity-50 transition-colors" title="Redo">
          <Redo2 className="w-4 h-4" />
        </button>

        <button onClick={() => handleClear(true)} className="p-1.5 hover:bg-red-500/20 text-red-500 rounded-full transition-colors" title="Clear Board">
          <Trash2 className="w-4 h-4" />
        </button>

        <div className="h-px w-6 bg-slate-300 dark:bg-slate-600 my-0.5" />

        {!padConnected && (
          <button
            onClick={() => setShowQR(v => !v)}
            className={`p-2 rounded-full transition-colors ${showQR ? 'bg-indigo-500 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            title="Connect Phone"
          >
            <Smartphone className="w-4 h-4" />
          </button>
        )}

        <button onClick={handleExport} className="p-2.5 bg-slate-900 border border-slate-700 dark:bg-white dark:text-slate-900 text-white rounded-full hover:scale-105 transition-transform shadow-lg mt-1" title={pages.length > 1 ? "Export PDF" : "Export PNG"}>
          <Download className="w-4 h-4" />
        </button>

      </div>

      {/* Pages Navigation */}
      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-full flex items-center gap-4 z-10 shadow-xl border ${
        isDark
          ? 'bg-slate-900/90 border-slate-700 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-800'
      } backdrop-blur-md`}>
        <button 
          onClick={() => loadPage(currentPageIndex - 1)} 
          disabled={currentPageIndex === 0}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors disabled:opacity-30" 
          title="Previous Page"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        <span className="text-sm font-semibold tracking-wide w-16 text-center">
          {currentPageIndex + 1} / {pages.length}
        </span>

        <button 
          onClick={() => loadPage(currentPageIndex + 1)} 
          disabled={currentPageIndex === pages.length - 1}
          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors disabled:opacity-30" 
          title="Next Page"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

        <button 
          onClick={handleAddPage} 
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors text-sm font-medium shadow-sm"
          title="Add New Page"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {/* Zoom Widget */}
      <div className={`absolute bottom-6 right-6 px-3 py-2 rounded-full flex items-center gap-2 z-10 shadow-xl border ${
        isDark
          ? 'bg-slate-900/90 border-slate-700 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-800'
      } backdrop-blur-md`}>
        <button onClick={handleZoomOut} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors" title="Zoom Out">
          <ZoomOut className="w-5 h-5" />
        </button>
        <button onClick={handleZoomReset} className="text-sm font-medium w-12 text-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg py-1 transition-colors" title="Reset Zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={handleZoomIn} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors" title="Zoom In">
          <ZoomIn className="w-5 h-5" />
        </button>
      </div>

    </div>
  );
}
