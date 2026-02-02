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
    console.log(`[JOIN] ${userName} (${role}) -> Room ${roomId}`);
    
    socket.rooms.forEach(room => { 
      if(room !== socket.id) socket.leave(room); 
    });
    
    socket.join(roomId);
    users.set(socket.id, { userId, userName, role, roomId });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, users: new Map() });
    }
    
    const room = rooms.get(roomId);
    room.users.set(userId, { userId, userName, role, socketId: socket.id });

    socket.to(roomId).emit('user-joined', { userId, userName, role });
    
    const existingUsers = Array.from(room.users.values())
      .filter(u => u.userId !== userId)
      .map(u => ({ userId: u.userId, userName: u.userName, role: u.role }));
        
    socket.emit('room-users', existingUsers);
  });

  socket.on('call-request', (data) => {
    const room = rooms.get(data.roomId);
    const target = room?.users.get(data.toUserId);
    if (target) {
      console.log(`[CALL-REQUEST] ${data.fromUserName} -> ${data.toUserId}`);
      io.to(target.socketId).emit('call-request', {
        fromUserId: data.fromUserId,
        fromUserName: data.fromUserName
      });
    }
  });

  socket.on('call-accepted', (data) => {
    const room = rooms.get(data.roomId);
    const target = room?.users.get(data.toUserId);
    if (target) {
      console.log(`[CALL-ACCEPTED] ${data.userId} accepted call from ${data.toUserId}`);
      io.to(target.socketId).emit('call-accepted', {
        userId: data.userId
      });
    }
  });

  socket.on('call-declined', (data) => {
    const room = rooms.get(data.roomId);
    const target = room?.users.get(data.toUserId);
    if (target) {
      console.log(`[CALL-DECLINED] ${data.userId} declined call from ${data.toUserId}`);
      io.to(target.socketId).emit('call-declined', {
        userId: data.userId
      });
    }
  });

  socket.on('offer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser) {
      socket.to(data.roomId).emit('offer', { 
        from: fromUser.userId, 
        offer: data.offer 
      });
    }
  });

  socket.on('answer', (data) => {
    const fromUser = users.get(socket.id);
    if (fromUser && data.to) {
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
    socket.to(data.roomId).emit('chat-message', {
      fromUserId: data.fromUserId,
      fromUserName: data.fromUserName,
      message: data.message,
      timestamp: Date.now()
    });
  });

  socket.on('leave-room', (data) => {
    handleUserLeave(socket, data.userId, data.roomId);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`[DISCONNECT] ${user.userName}`);
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
      }
    }
    
    users.delete(socket.id);
    socket.leave(roomId);
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
