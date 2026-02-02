const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const rooms = new Map();
const users = new Map();

app.get('/api/turn', (req, res) => {
  const turnConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };
  
  if (process.env.TURN_URL) {
    turnConfig.iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  
  res.json(turnConfig);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size, 
    users: users.size,
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on('join-room', ({ roomId, userId, userName, role }) => {
    console.log(`[JOIN-ROOM] ${userName} (${role}) -> Room ${roomId}`);
    
    // Leave previous rooms
    socket.rooms.forEach(room => { 
      if(room !== socket.id) socket.leave(room); 
    });
    
    // Join new room
    socket.join(roomId);
    
    // Store user data
    users.set(socket.id, { userId, userName, role, roomId });

    // Initialize room if needed
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, users: new Map() });
    }
    
    const room = rooms.get(roomId);
    room.users.set(userId, { userId, userName, role, socketId: socket.id });

    // Notify others
    socket.to(roomId).emit('user-joined', { userId, userName, role });
    
    // Send existing users to new joiner
    const existingUsers = Array.from(room.users.values())
      .filter(u => u.userId !== userId)
      .map(u => ({ userId: u.userId, userName: u.userName, role: u.role }));
        
    socket.emit('room-users', existingUsers);
    
    console.log(`[ROOM-${roomId}] Users: ${room.users.size}`);
  });

  socket.on('offer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
      console.log(`[OFFER] ${fromUser.userId} -> room ${data.roomId}`);
      socket.to(data.roomId).emit('offer', { 
        from: fromUser.userId, 
        offer: data.offer 
      });
    }
  });

  socket.on('answer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser && data.to) {
      console.log(`[ANSWER] ${fromUser.userId} -> ${data.to}`);
      const room = rooms.get(data.roomId);
      const target = room?.users.get(data.to);
      if (target) {
        io.to(target.socketId).emit('answer', { 
          from: fromUser.userId, 
          answer: data.answer 
        });
      }
    }
  });

  socket.on('ice-candidate', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
      socket.to(data.roomId).emit('ice-candidate', { 
        from: fromUser.userId, 
        candidate: data.candidate 
      });
    }
  });

  socket.on('chat-message', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
      console.log(`[CHAT] ${data.fromUserName}: ${data.message}`);
      socket.to(data.roomId).emit('chat-message', {
        fromUserId: data.fromUserId,
        fromUserName: data.fromUserName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  socket.on('leave-room', (data) => {
    handleUserLeave(socket, data.userId, data.roomId);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`[DISCONNECT] ${user.userName} from room ${user.roomId}`);
      handleUserLeave(socket, user.userId, user.roomId);
    }
  });

  function handleUserLeave(socket, userId, roomId) {
    socket.to(roomId).emit('user-left', { userId });
    
    const room = rooms.get(roomId);
    if (room) {
      room.users.delete(userId);
      if (room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`[ROOM-${roomId}] Deleted (empty)`);
      } else {
        console.log(`[ROOM-${roomId}] Users remaining: ${room.users.size}`);
      }
    }
    
    users.delete(socket.id);
    socket.leave(roomId);
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Signaling Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   TURN Config: http://localhost:${PORT}/api/turn`);
});
