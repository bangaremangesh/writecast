import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import msgpackParser from 'socket.io-msgpack-parser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

const httpServer = createServer(app);

// Use messagepack parser for bandwidth optimization
const io = new Server(httpServer, {
  parser: msgpackParser,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Setup Redis adapter for multi-instance scaling if REDIS_URL is provided
if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis adapter connected and configured');
  }).catch((err) => {
    console.error('Redis connection failed, falling back to in-memory adapter:', err);
  });
} else {
  console.log('No REDIS_URL found, using native in-memory adapter');
}

// Generate session state snapshot directly from Socket.IO rooms
async function getSessionSnapshot(roomId) {
  try {
    const sockets = await io.in(roomId).fetchSockets();
    const participants = sockets.map(s => ({
      socketId: s.id,
      role: s.data.role
    }));
    return { sessionId: roomId, participants };
  } catch (error) {
    console.error('Error fetching session snapshot:', error);
    return { sessionId: roomId, participants: [] };
  }
}

function getLanIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  Object.values(interfaces).forEach((iface = []) => {
    iface.forEach((details) => {
      const family = typeof details.family === 'string' ? details.family : String(details.family);
      if (family !== 'IPv4' || details.internal) return;
      addresses.push(details.address);
    });
  });

  return [...new Set(addresses)];
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join a specific session room
  socket.on('join-session', async ({ sessionId, role }) => {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') return;

    const roomId = sessionId.trim();
    const participantRole = role === 'pad' ? 'pad' : 'board';

    socket.join(roomId);
    socket.data.sessionId = roomId;
    socket.data.role = participantRole;

    console.log(`Socket ${socket.id} joined session ${roomId} as ${participantRole}`);
    
    // Broadcast state update
    const sessionState = await getSessionSnapshot(roomId);
    io.to(roomId).emit('session-state', sessionState);
    
    // Notify room that someone joined
    socket.to(roomId).emit('participant-joined', { role: participantRole, socketId: socket.id });

    // Snapshot Sync: if pad joins, request current board state from a board in the room
    if (participantRole === 'pad') {
      const sockets = await io.in(roomId).fetchSockets();
      const boardSocket = sockets.find(s => s.data.role === 'board');
      if (boardSocket) {
        // Ask this specific board directy
        io.to(boardSocket.id).emit('request-snapshot', socket.id);
      }
    }
  });

  // Handle board providing snapshot to a specific pad
  socket.on('provide-snapshot', ({ targetSocketId, boardState }) => {
    if (targetSocketId && boardState) {
      io.to(targetSocketId).emit('snapshot', boardState);
    }
  });

  // Relay generic events to others in the room
  const relayEvents = [
    'draw-batch',    // New batched optimized event
    'draw-start',
    'draw',          // Kept for backward compatibility
    'draw-end',
    'shape-start',
    'shape-preview',
    'shape-end',
    'shape-drawn',
    'clear-board',
    'undo',
    'redo',
    'change-color',
    'change-bg',
    'change-size',
    'laser-move',
    'laser-toggle',
    'laser-start',
    'laser-end',
    'add-sticky',
    'remove-sticky',
    'add-text',
    'set-tool',
    'zoom-in',
    'zoom-out',
    'zoom-reset',
    'add-image',
    'object:added',
    'object:modified',
    'text-move-start',
    'text-move',
    'text-move-end'
  ];

  relayEvents.forEach(event => {
    socket.on(event, (data) => {
      let roomId = data?.sessionId || data?.roomId;
      // Fallback to socket.data.sessionId if not provided in payload
      if (!roomId && socket.data.sessionId) roomId = socket.data.sessionId;

      if (roomId && typeof roomId === 'string' && roomId.trim() !== '') {
        // Broadcast to everyone in the room except the sender
        socket.to(roomId.trim()).emit(event, data);
      }
    });
  });

  socket.on('disconnect', async () => {
    const { sessionId, role } = socket.data;
    if (typeof sessionId === 'string' && sessionId.trim() !== '') {
      const roomId = sessionId.trim();
      
      const sessionState = await getSessionSnapshot(roomId);
      io.to(roomId).emit('session-state', sessionState);
      socket.to(roomId).emit('participant-left', { role, socketId: socket.id });
    }

    console.log('Client disconnected:', socket.id);
  });
});

app.get('/api/network-info', (req, res) => {
  res.json({ addresses: getLanIPv4Addresses() });
});

// Serve frontend static files in production
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

// Catch-all route to serve React app for client-side routing (Express 5 compatible)
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
