import { useNavigate } from 'react-router-dom';
import { PenTool, Smartphone, Monitor, ChevronRight, Info } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Home() {
  const navigate = useNavigate();

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
      
    </div>
  );
}
