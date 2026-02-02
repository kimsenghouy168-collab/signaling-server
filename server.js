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
  transports: ['websocket', 'polling']
});

const rooms = new Map();
const users = new Map();

// --- TURN SERVER CONFIG ---
app.get('/api/turn', (req, res) => {
  const turnConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }, // Standard STUN
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  };
  // If you have TURN credentials in .env, add them here
  if (process.env.TURN_URL) {
    turnConfig.iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.json(turnConfig);
});

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on('join-room', ({ roomId, userId, userName, role }) => {
    // 1. Leave previous rooms
    socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
    
    // 2. Join New Room
    socket.join(roomId);
    
    // 3. Store Data
    users.set(socket.id, { userId, userName, role, roomId });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, users: new Map() });
    }
    const room = rooms.get(roomId);
    room.users.set(userId, { userId, userName, role, socketId: socket.id });

    console.log(`[JOIN] ${userName} (${role}) -> Room ${roomId}`);

    // 4. Notify Others
    socket.to(roomId).emit('user-joined', { userId, userName, role });
    
    // 5. Send list of existing users to the new person
    // This triggers the connection process from the Client Side
    const existingUsers = Array.from(room.users.values())
        .filter(u => u.userId !== userId)
        .map(u => ({ userId: u.userId, userName: u.userName, role: u.role }));
        
    socket.emit('room-users', existingUsers);
  });

  // Signaling Relays
  socket.on('offer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
        socket.to(data.roomId).emit('offer', { from: fromUser.userId, offer: data.offer });
    }
  });

  socket.on('answer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser && data.to) {
        // Find socket ID of target
        const room = rooms.get(data.roomId);
        const target = room?.users.get(data.to);
        if (target) {
            io.to(target.socketId).emit('answer', { from: fromUser.userId, answer: data.answer });
        }
    }
  });

  socket.on('ice-candidate', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
        // Broadcast to room (simplest for mesh) or target specific user
        socket.to(data.roomId).emit('ice-candidate', { from: fromUser.userId, candidate: data.candidate });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`[DISCONNECT] ${user.userName}`);
      socket.to(user.roomId).emit('user-left', { userId: user.userId });
      
      const room = rooms.get(user.roomId);
      if (room) {
        room.users.delete(user.userId);
        if (room.users.size === 0) rooms.delete(user.roomId);
      }
      users.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
