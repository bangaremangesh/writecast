import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
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

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join a specific session room
  socket.on('join-session', ({ sessionId, role }) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId} as ${role}`);
    
    // Notify room that someone joined
    socket.to(sessionId).emit('participant-joined', { role, socketId: socket.id });
  });

  // List of events to simply relay to others in the room
  const relayEvents = [
    'draw-start',
    'draw',
    'draw-end',
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
    'remove-sticky'
  ];

  relayEvents.forEach(event => {
    socket.on(event, (data) => {
      if (data && data.sessionId) {
        // Broadcast to everyone in the room except the sender
        socket.to(data.sessionId).emit(event, data);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
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
