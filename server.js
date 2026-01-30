const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));

// Socket.IO with CORS
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Store room information
const rooms = new Map();
const users = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'IDIC Cambodia Signaling Server',
    version: '1.0.0',
    rooms: rooms.size,
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

// Get TURN server configuration
app.get('/api/turn', (req, res) => {
  const turnConfig = {
    iceServers: [
      // Google STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  };

  // Add TURN servers if configured
  if (process.env.TURN_URL) {
    turnConfig.iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json(turnConfig);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);

  // Join room
  socket.on('join-room', (data) => {
    const { roomId, userId, userName, role } = data;
    
    console.log(`[JOIN] ${userName} (${userId}) joining room ${roomId} as ${role}`);

    // Leave any existing rooms
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });

    // Join the new room
    socket.join(roomId);

    // Store user info
    users.set(socket.id, {
      userId,
      userName,
      role,
      roomId
    });

    // Update room info
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: new Map()
      });
    }

    const room = rooms.get(roomId);
    room.users.set(userId, {
      userId,
      userName,
      role,
      socketId: socket.id
    });

    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId,
      userName,
      role
    });

    // Send current room users to the new joiner
    const roomUsers = Array.from(room.users.values()).map(u => ({
      userId: u.userId,
      userName: u.userName,
      role: u.role
    }));

    socket.emit('room-users', roomUsers);

    console.log(`[ROOM ${roomId}] Now has ${room.users.size} users`);
  });

  // Leave room
  socket.on('leave-room', (data) => {
    const { roomId } = data;
    const user = users.get(socket.id);

    if (user) {
      console.log(`[LEAVE] ${user.userName} leaving room ${roomId}`);

      socket.to(roomId).emit('user-left', {
        userId: user.userId
      });

      socket.leave(roomId);

      // Clean up room data
      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(user.userId);
        if (room.users.size === 0) {
          rooms.delete(roomId);
          console.log(`[ROOM ${roomId}] Empty, deleted`);
        }
      }

      users.delete(socket.id);
    }
  });

  // WebRTC signaling: offer
  socket.on('offer', (data) => {
    const { roomId, to, offer } = data;
    const fromUser = users.get(socket.id);

    if (fromUser) {
      console.log(`[OFFER] ${fromUser.userId} → ${to || 'broadcast'}`);

      if (to) {
        // Send to specific user
        const room = rooms.get(roomId);
        if (room) {
          const targetUser = room.users.get(to);
          if (targetUser) {
            io.to(targetUser.socketId).emit('offer', {
              from: fromUser.userId,
              offer
            });
          }
        }
      } else {
        // Broadcast to all in room
        socket.to(roomId).emit('offer', {
          from: fromUser.userId,
          offer
        });
      }
    }
  });

  // WebRTC signaling: answer
  socket.on('answer', (data) => {
    const { roomId, to, answer } = data;
    const fromUser = users.get(socket.id);

    if (fromUser) {
      console.log(`[ANSWER] ${fromUser.userId} → ${to}`);

      const room = rooms.get(roomId);
      if (room) {
        const targetUser = room.users.get(to);
        if (targetUser) {
          io.to(targetUser.socketId).emit('answer', {
            from: fromUser.userId,
            answer
          });
        }
      }
    }
  });

  // WebRTC signaling: ICE candidate
  socket.on('ice-candidate', (data) => {
    const { roomId, to, candidate } = data;
    const fromUser = users.get(socket.id);

    if (fromUser) {
      if (to) {
        // Send to specific user
        const room = rooms.get(roomId);
        if (room) {
          const targetUser = room.users.get(to);
          if (targetUser) {
            io.to(targetUser.socketId).emit('ice-candidate', {
              from: fromUser.userId,
              candidate
            });
          }
        }
      } else {
        // Broadcast to all in room
        socket.to(roomId).emit('ice-candidate', {
          from: fromUser.userId,
          candidate
        });
      }
    }
  });

  // Chat message
  socket.on('send-message', (data) => {
    const { roomId, content } = data;
    const fromUser = users.get(socket.id);

    if (fromUser) {
      const message = {
        userId: fromUser.userId,
        userName: fromUser.userName,
        content,
        timestamp: new Date().toISOString()
      };

      // Broadcast to room including sender
      io.to(roomId).emit('new-message', message);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);

    if (user) {
      console.log(`[DISCONNECT] ${user.userName} (${user.userId})`);

      // Notify room
      socket.to(user.roomId).emit('user-left', {
        userId: user.userId
      });

      // Clean up
      const room = rooms.get(user.roomId);
      if (room) {
        room.users.delete(user.userId);
        if (room.users.size === 0) {
          rooms.delete(user.roomId);
        }
      }

      users.delete(socket.id);
    }

    console.log(`[${new Date().toISOString()}] Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   IDIC Cambodia Signaling Server                     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║   Server running on port: ${PORT.toString().padEnd(25)} ║`);
  console.log(`║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(36)} ║`);
  console.log(`║   TURN configured: ${(process.env.TURN_URL ? 'Yes' : 'No').padEnd(33)} ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
});
