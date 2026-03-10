import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenTool, Smartphone, Monitor, ChevronRight, Info, Wifi, X, CheckCircle2, Loader2 } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import QRCode from 'react-qr-code';

const SOCKET_URL = import.meta.env.PROD ? undefined : `http://${window.location.hostname}:3001`;

export default function Home() {
  const navigate = useNavigate();
  const [showQR, setShowQR] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [padUrl, setPadUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('waiting'); // 'waiting' | 'connected'
  const socketRef = useRef(null);

  function startConnect() {
    // Generate session
    const newSessionId = Math.random().toString(36).substring(2, 8);
    setSessionId(newSessionId);
    const url = `${window.location.origin}/pad/${newSessionId}`;
    setPadUrl(url);
    setConnectionStatus('waiting');
    setShowQR(true);

    // Connect socket
    if (socketRef.current) {
      socketRef.current.close();
    }
    const sock = io(SOCKET_URL);
    socketRef.current = sock;
    let didConnect = false;

    const completeConnection = () => {
      if (didConnect) return;
      didConnect = true;
      setConnectionStatus('connected');
      // Short delay to show success animation before navigating
      setTimeout(() => {
        if (socketRef.current === sock) {
          socketRef.current = null;
        }
        sock.close();
        navigate(`/board?session=${newSessionId}`);
      }, 1000);
    };

    sock.on('connect', () => {
      sock.emit('join-session', { sessionId: newSessionId, role: 'board' });
    });

    sock.on('session-state', ({ participants = [] }) => {
      if (participants.some(participant => participant.role === 'pad')) {
        completeConnection();
      }
    });

    sock.on('participant-joined', ({ role }) => {
      if (role === 'pad') {
        completeConnection();
      }
    });
  }

  function cancelConnect() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setShowQR(false);
    setConnectionStatus('waiting');
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  return (
    <div className="relative overflow-hidden min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900 transition-colors duration-500">
      
      {/* Animated Mesh Gradient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] bg-blue-500/20 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-lighten" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            rotate: [0, -90, 0],
            opacity: [0.3, 0.6, 0.3]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-purple-500/20 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-lighten" 
        />
      </div>
      
      <motion.div 
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="glass max-w-4xl w-full p-10 md:p-16 rounded-[2.5rem] text-center space-y-10 relative z-10 shadow-2xl shadow-blue-900/10 dark:shadow-blue-500/10 border border-white/40 dark:border-slate-700/50"
      >
        <motion.div 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
          className="flex justify-center mb-6"
        >
          <div className="p-5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl shadow-blue-500/30">
            <PenTool className="w-14 h-14 text-white" />
          </div>
        </motion.div>
        
        <div className="space-y-4">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="text-6xl md:text-8xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 drop-shadow-sm"
          >
            WriteCast
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="text-xl md:text-2xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed font-medium"
          >
            The brilliant digital whiteboard for modern presentations. Control your PC screen seamlessly using your mobile device.
          </motion.p>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8 pb-4"
        >
          {/* Start New Board */}
          <motion.button 
            whileHover={{ scale: 1.05, boxShadow: "0 20px 25px -5px rgb(59 130 246 / 0.4)" }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/board')}
            className="group flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-white dark:to-slate-100 text-white dark:text-slate-900 rounded-full font-bold text-lg transition-all shadow-xl w-full sm:w-auto justify-center cursor-pointer border border-transparent dark:border-white/50"
          >
            <Monitor className="w-6 h-6" />
            Start New Board
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </motion.button>

          {/* Connect Device */}
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: "0 20px 25px -5px rgb(99 102 241 / 0.4)" }}
            whileTap={{ scale: 0.95 }}
            onClick={startConnect}
            className="group flex items-center gap-3 px-10 py-5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-full font-bold text-lg transition-all shadow-xl w-full sm:w-auto justify-center cursor-pointer border border-white/20"
          >
            <Wifi className="w-6 h-6" />
            Connect Device
            <Smartphone className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </motion.button>
        </motion.div>

        {/* Onboarding Tooltip */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 mt-2"
        >
          <Info className="w-4 h-4" />
          <span>Need to cast using your phone? Just start a board and scan the QR code!</span>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1 }}
          className="grid md:grid-cols-2 gap-8 mt-12 pt-12 border-t border-slate-200/50 dark:border-slate-700/50 text-left"
        >
          <motion.div whileHover={{ y: -5 }} className="flex gap-5 p-4 rounded-2xl hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="bg-blue-100 dark:bg-blue-900/40 p-4 rounded-2xl h-fit shadow-inner">
              <Monitor className="w-7 h-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-bold text-xl mb-2 text-slate-800 dark:text-slate-100">PC Display</h3>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Open the board on your main screen. Draw directly or cast from your phone.</p>
            </div>
          </motion.div>

          <motion.div whileHover={{ y: -5 }} className="flex gap-5 p-4 rounded-2xl hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition-colors">
            <div className="bg-indigo-100 dark:bg-indigo-900/40 p-4 rounded-2xl h-fit shadow-inner">
              <Smartphone className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-bold text-xl mb-2 text-slate-800 dark:text-slate-100">Mobile Pad</h3>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Scan the QR code to turn your smartphone into a wireless remote drawing tablet.</p>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* QR Connect Modal */}
      <AnimatePresence>
        {showQR && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(16px)', backgroundColor: 'rgba(15,23,42,0.75)' }}
            onClick={(e) => { if (e.target === e.currentTarget) cancelConnect(); }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center border border-slate-200 dark:border-slate-700"
            >
              {/* Close Button */}
              <button
                onClick={cancelConnect}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="mb-5">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-full text-sm font-semibold mb-4">
                  <Wifi className="w-4 h-4" />
                  Connect Device
                </div>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white">Scan to Connect</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Point your phone's camera at the QR code</p>
              </div>

              {/* QR Code */}
              <AnimatePresence mode="wait">
                {connectionStatus === 'waiting' ? (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <div className="p-4 bg-white rounded-2xl shadow-inner border-4 border-indigo-100 dark:border-indigo-800">
                      {padUrl && <QRCode value={padUrl} size={160} level="H" />}
                    </div>

                    {/* Session ID */}
                    <div className="text-xs font-mono bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-3 py-1 rounded-full">
                      Session: {sessionId}
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      <span>Waiting for device to connect…</span>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="connected"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-3 py-4"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
                    >
                      <CheckCircle2 className="w-12 h-12 text-green-500" />
                    </motion.div>
                    <p className="font-bold text-xl text-slate-800 dark:text-white">Device Connected!</p>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Opening board…</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {connectionStatus === 'waiting' && (
                <button
                  onClick={cancelConnect}
                  className="mt-6 w-full py-3 rounded-full border border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
