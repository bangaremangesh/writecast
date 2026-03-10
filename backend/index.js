import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const sessions = new Map();

function getSessionSnapshot(sessionId) {
  const participants = sessions.get(sessionId);
  if (!participants) {
    return { sessionId, participants: [] };
  }

  return {
    sessionId,
    participants: Array.from(participants.entries()).map(([socketId, role]) => ({
      socketId,
      role
    }))
  };
}

function updateSessionMembership(sessionId, socketId, role) {
  let participants = sessions.get(sessionId);
  if (!participants) {
    participants = new Map();
    sessions.set(sessionId, participants);
  }
  participants.set(socketId, role);
}

function removeSessionMembership(sessionId, socketId) {
  const participants = sessions.get(sessionId);
  if (!participants) return;

  participants.delete(socketId);
  if (participants.size === 0) {
    sessions.delete(sessionId);
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
  socket.on('join-session', ({ sessionId, role }) => {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') return;

    const roomId = sessionId.trim();
    const participantRole = role === 'pad' ? 'pad' : 'board';

    socket.join(roomId);
    socket.data.sessionId = roomId;
    socket.data.role = participantRole;
    updateSessionMembership(roomId, socket.id, participantRole);

    console.log(`Socket ${socket.id} joined session ${roomId} as ${participantRole}`);
    io.to(roomId).emit('session-state', getSessionSnapshot(roomId));
    
    // Notify room that someone joined
    socket.to(roomId).emit('participant-joined', { role: participantRole, socketId: socket.id });
  });

  // List of events to simply relay to others in the room
  const relayEvents = [
    'draw-start',
    'draw',
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
      if (data && typeof data.sessionId === 'string' && data.sessionId.trim() !== '') {
        // Broadcast to everyone in the room except the sender
        const roomId = data.sessionId.trim();
        socket.to(roomId).emit(event, data);
      }
    });
  });

  socket.on('disconnect', () => {
    const { sessionId, role } = socket.data;
    if (typeof sessionId === 'string' && sessionId.trim() !== '') {
      const roomId = sessionId.trim();
      removeSessionMembership(roomId, socket.id);
      io.to(roomId).emit('session-state', getSessionSnapshot(roomId));
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
