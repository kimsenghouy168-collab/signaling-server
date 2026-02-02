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
const onlineUsers = new Map(); // For call lobby
const activeGroups = new Map(); // For group calls

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    rooms: rooms.size, 
    users: users.size,
    onlineUsers: onlineUsers.size,
    activeGroups: activeGroups.size,
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  // Register user as online
  socket.on('register-user', (data) => {
    onlineUsers.set(data.userId, {
      userId: data.userId,
      userName: data.userName,
      socketId: socket.id,
      status: 'online'
    });
    console.log(`[ONLINE] ${data.userName}`);
    broadcastOnlineUsers();
  });

  // Request online users
  socket.on('request-online-users', () => {
    const usersList = Array.from(onlineUsers.values()).map(u => ({
      userId: u.userId,
      userName: u.userName
    }));
    socket.emit('online-users', usersList);
  });

  // Request active groups
  socket.on('request-active-groups', () => {
    const groupsList = Array.from(activeGroups.values()).map(g => ({
      groupId: g.groupId,
      groupName: g.groupName,
      participantCount: g.participants.size
    }));
    socket.emit('active-groups', groupsList);
  });

  // Initiate 1-to-1 call
  socket.on('initiate-call', (data) => {
    const targetUser = onlineUsers.get(data.toUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('call-request', {
        fromUserId: data.fromUserId,
        fromUserName: data.fromUserName,
        callId: data.callId
      });
      console.log(`[CALL] ${data.fromUserName} -> ${data.toUserId}`);
    }
  });

  // Accept call
  socket.on('accept-call', (data) => {
    const targetUser = onlineUsers.get(data.toUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('call-accepted', {
        callId: data.callId
      });
    }
  });

  // Decline call
  socket.on('decline-call', (data) => {
    const targetUser = onlineUsers.get(data.toUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('call-declined', {
        callId: data.callId
      });
    }
  });

  // Create group call
  socket.on('create-group', (data) => {
    activeGroups.set(data.groupId, {
      groupId: data.groupId,
      groupName: data.groupName,
      creatorId: data.creatorId,
      participants: new Set([data.creatorId])
    });
    console.log(`[GROUP CREATED] ${data.groupName}`);
    broadcastActiveGroups();
  });

  // Join room (for WebRTC)
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

    // Add to group participants if it's a group
    if (activeGroups.has(roomId)) {
      activeGroups.get(roomId).participants.add(userId);
      broadcastActiveGroups();
    }

    socket.to(roomId).emit('user-joined', { userId, userName, role });
    
    const existingUsers = Array.from(room.users.values())
      .filter(u => u.userId !== userId)
      .map(u => ({ userId: u.userId, userName: u.userName, role: u.role }));
        
    socket.emit('room-users', existingUsers);
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

  socket.on('user-offline', (data) => {
    onlineUsers.delete(data.userId);
    broadcastOnlineUsers();
  });

  socket.on('leave-room', (data) => {
    handleUserLeave(socket, data.userId, data.roomId);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      console.log(`[DISCONNECT] ${user.userName}`);
      handleUserLeave(socket, user.userId, user.roomId);
      onlineUsers.delete(user.userId);
      broadcastOnlineUsers();
    }
  });

  function handleUserLeave(socket, userId, roomId) {
    socket.to(roomId).emit('user-left', { userId });
    
    const room = rooms.get(roomId);
    if (room) {
      room.users.delete(userId);
      if (room.users.size === 0) {
        rooms.delete(roomId);
        if (activeGroups.has(roomId)) {
          activeGroups.delete(roomId);
          broadcastActiveGroups();
        }
      }
    }
    
    if (activeGroups.has(roomId)) {
      activeGroups.get(roomId).participants.delete(userId);
      broadcastActiveGroups();
    }
    
    users.delete(socket.id);
    socket.leave(roomId);
  }

  function broadcastOnlineUsers() {
    const usersList = Array.from(onlineUsers.values()).map(u => ({
      userId: u.userId,
      userName: u.userName
    }));
    io.emit('online-users', usersList);
  }

  function broadcastActiveGroups() {
    const groupsList = Array.from(activeGroups.values()).map(g => ({
      groupId: g.groupId,
      groupName: g.groupName,
      participantCount: g.participants.size
    }));
    io.emit('active-groups', groupsList);
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
