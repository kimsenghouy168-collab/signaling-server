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

// Data structures
const rooms = new Map();
const users = new Map();
const onlineUsers = new Map();
const activeGroups = new Map();
const waitingRooms = new Map(); // roomId -> [waiting users]
const polls = new Map(); // pollId -> poll data
const breakoutRooms = new Map(); // roomId -> breakout rooms
const whiteboardStates = new Map(); // roomId -> drawing paths
const recordings = new Map(); // roomId -> recording status
const meetingSettings = new Map(); // roomId -> settings

// ==================== HEALTH CHECK ====================
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

  // ==================== USER MANAGEMENT ====================
  
  socket.on('register-user', (data) => {
    const existingEntry = Array.from(onlineUsers.entries()).find(
      ([_, user]) => user.userId === data.userId
    );
    if (existingEntry) {
      onlineUsers.delete(existingEntry[0]);
    }

    onlineUsers.set(data.userId, {
      userId: data.userId,
      userName: data.userName,
      socketId: socket.id,
      status: data.status || 'online'
    });
    
    console.log(`[ONLINE] ${data.userName} (${data.userId})`);
    broadcastOnlineUsers();
  });

  socket.on('update-status', (data) => {
    const user = onlineUsers.get(data.userId);
    if (user) {
      user.status = data.status;
      broadcastOnlineUsers();
    }
  });

  socket.on('request-online-users', () => {
    const usersList = Array.from(onlineUsers.values()).map(u => ({
      userId: u.userId,
      userName: u.userName,
      status: u.status
    }));
    socket.emit('online-users', usersList);
  });

  socket.on('request-active-groups', () => {
    const groupsList = Array.from(activeGroups.values()).map(g => ({
      groupId: g.groupId,
      groupName: g.groupName,
      participantCount: g.participants.size
    }));
    socket.emit('active-groups', groupsList);
  });

  // ==================== CALLING ====================
  
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

  socket.on('accept-call', (data) => {
    const targetUser = onlineUsers.get(data.toUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('call-accepted', {
        callId: data.callId
      });
    }
  });

  socket.on('decline-call', (data) => {
    const targetUser = onlineUsers.get(data.toUserId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('call-declined', {
        callId: data.callId
      });
    }
  });

  socket.on('create-group', (data) => {
    activeGroups.set(data.groupId, {
      groupId: data.groupId,
      groupName: data.groupName,
      creatorId: data.creatorId,
      participants: new Set([data.creatorId])
    });
    
    // Initialize meeting settings
    meetingSettings.set(data.groupId, {
      allowParticipantsToUnmute: true,
      allowParticipantsToShare: false,
      allowChat: true,
      allowPrivateChat: true,
      allowRaiseHand: true,
      allowReactions: true,
      enableWaitingRoom: false,
      lockMeeting: false
    });
    
    console.log(`[GROUP CREATED] ${data.groupName}`);
    broadcastActiveGroups();
  });

  // ==================== ROOM MANAGEMENT ====================
  
  socket.on('join-room', ({ roomId, userId, userName, role }) => {
    console.log(`[JOIN] ${userName} (${role}) -> Room ${roomId}`);
    
    // Check if meeting is locked
    const settings = meetingSettings.get(roomId);
    if (settings && settings.lockMeeting && role !== 'HOST') {
      socket.emit('error', { message: 'Meeting is locked' });
      return;
    }
    
    // Check waiting room
    if (settings && settings.enableWaitingRoom && role !== 'HOST') {
      addToWaitingRoom(roomId, { userId, userName, socketId: socket.id });
      socket.emit('waiting-room-joined', { roomId });
      
      // Notify host
      const room = rooms.get(roomId);
      if (room) {
        const host = Array.from(room.users.values()).find(u => u.role === 'HOST');
        if (host) {
          io.to(host.socketId).emit('waiting-room-participant', { userId, userName });
        }
      }
      return;
    }
    
    socket.rooms.forEach(room => { 
      if(room !== socket.id) socket.leave(room); 
    });
    
    socket.join(roomId);
    users.set(socket.id, { userId, userName, role, roomId });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, users: new Map() });
    }
    
    const room = rooms.get(roomId);
    room.users.set(userId, { 
      userId, 
      userName, 
      role, 
      socketId: socket.id,
      isAudioMuted: false,
      isVideoEnabled: true,
      isHandRaised: false,
      isScreenSharing: false
    });

    if (activeGroups.has(roomId)) {
      activeGroups.get(roomId).participants.add(userId);
      broadcastActiveGroups();
    }

    socket.to(roomId).emit('user-joined', { userId, userName, role });
    
    const existingUsers = Array.from(room.users.values())
      .filter(u => u.userId !== userId)
      .map(u => ({ 
        userId: u.userId, 
        userName: u.userName, 
        role: u.role,
        isAudioMuted: u.isAudioMuted,
        isVideoEnabled: u.isVideoEnabled,
        isHandRaised: u.isHandRaised,
        isScreenSharing: u.isScreenSharing
      }));
        
    socket.emit('room-users', existingUsers);
    
    // Send meeting settings
    if (settings) {
      socket.emit('meeting-settings', settings);
    }
  });

  // ==================== WEBRTC SIGNALING ====================
  
 socket.on('offer', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;

    // ✅ FIX: Support both targetId and to (backward compatibility)
    const targetId = data.targetId || data.to;

    if (targetId) {
      const room = rooms.get(data.roomId);
      // Optional chaining (?.) prevents crash if room is undefined
      const targetUser = room?.users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('offer', { 
          from: fromUser.userId, 
          offer: data.offer 
        });
      }
    } else {
      // Broadcast offer (Mesh topology fallback)
      socket.to(data.roomId).emit('offer', { 
        from: fromUser.userId, 
        offer: data.offer 
      });
    }
  });

  socket.on('answer', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;

    // ✅ FIX: The critical fix for the "Stuck Video" issue
    const targetId = data.targetId || data.to;

    if (targetId) {
      const room = rooms.get(data.roomId);
      const targetUser = room?.users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('answer', { 
          from: fromUser.userId, 
          answer: data.answer 
        });
        console.log(`[ANSWER] ${fromUser.userId} -> ${targetId}`);
      } else {
        console.log(`[ANSWER] Failed: Target ${targetId} not found`);
      }
    }
  });

  socket.on('ice-candidate', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;

    const targetId = data.targetId || data.to;

    if (targetId) {
      const room = rooms.get(data.roomId);
      const targetUser = room?.users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('ice-candidate', { 
          from: fromUser.userId, 
          candidate: data.candidate 
        });
      }
    } else {
      socket.to(data.roomId).emit('ice-candidate', { 
        from: fromUser.userId, 
        candidate: data.candidate 
      });
    }
  });

  // ==================== CHAT ====================
  
  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    
    const settings = meetingSettings.get(data.roomId);
    if (settings && !settings.allowChat) {
      socket.emit('error', { message: 'Chat is disabled' });
      return;
    }
    
    if (data.toUserId) {
      // Private message
      if (settings && !settings.allowPrivateChat) {
        socket.emit('error', { message: 'Private chat is disabled' });
        return;
      }
      
      const room = rooms.get(data.roomId);
      const targetUser = room?.users.get(data.toUserId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('chat-message', {
          fromUserId: user.userId,
          fromUserName: user.userName,
          message: data.message,
          isPrivate: true,
          timestamp: Date.now()
        });
        socket.emit('chat-message', {
          fromUserId: user.userId,
          fromUserName: user.userName,
          toUserId: data.toUserId,
          message: data.message,
          isPrivate: true,
          timestamp: Date.now()
        });
      }
    } else {
      // Public message
      io.to(data.roomId).emit('chat-message', {
        fromUserId: user.userId,
        fromUserName: user.userName,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // ==================== HOST CONTROLS ====================
  
  socket.on('host-control', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || (fromUser.role !== 'HOST' && fromUser.role !== 'CO_HOST')) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }
    
    const room = rooms.get(data.roomId);
    if (!room) return;
    
    const targetUser = room.users.get(data.targetUserId);
    if (!targetUser) return;
    
    switch(data.action) {
      case 'mute_participant':
        targetUser.isAudioMuted = data.params.muted;
        io.to(targetUser.socketId).emit('host-control-received', {
          action: 'force_mute',
          muted: data.params.muted
        });
        io.to(data.roomId).emit('participant-muted', {
          userId: data.targetUserId,
          muted: data.params.muted,
          byHost: true
        });
        console.log(`[HOST] Muted ${data.targetUserId}: ${data.params.muted}`);
        break;
        
      case 'disable_video':
        targetUser.isVideoEnabled = !data.params.disabled;
        io.to(targetUser.socketId).emit('host-control-received', {
          action: 'force_video_disable',
          disabled: data.params.disabled
        });
        io.to(data.roomId).emit('participant-video-disabled', {
          userId: data.targetUserId,
          disabled: data.params.disabled
        });
        break;
        
      case 'remove_participant':
        io.to(targetUser.socketId).emit('host-control-received', {
          action: 'removed',
          reason: data.params.reason
        });
        handleUserLeave(socket, data.targetUserId, data.roomId);
        io.to(data.roomId).emit('participant-removed', {
          userId: data.targetUserId,
          reason: data.params.reason
        });
        console.log(`[HOST] Removed ${data.targetUserId}`);
        break;
        
      case 'make_co_host':
        targetUser.role = 'CO_HOST';
        io.to(targetUser.socketId).emit('role-changed', { role: 'CO_HOST' });
        io.to(data.roomId).emit('participant-role-changed', {
          userId: data.targetUserId,
          role: 'CO_HOST'
        });
        break;
    }
  });

  socket.on('meeting-control', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || fromUser.role !== 'HOST') {
      socket.emit('error', { message: 'Only host can control meeting' });
      return;
    }
    
    switch(data.action) {
      case 'lock_meeting':
        const settings = meetingSettings.get(data.roomId) || {};
        settings.lockMeeting = data.params.locked;
        meetingSettings.set(data.roomId, settings);
        io.to(data.roomId).emit('meeting-locked', { locked: data.params.locked });
        console.log(`[HOST] Meeting ${data.roomId} locked: ${data.params.locked}`);
        break;
        
      case 'update_settings':
        meetingSettings.set(data.roomId, data.params);
        io.to(data.roomId).emit('meeting-settings-changed', data.params);
        break;
        
      case 'mute_all':
        const room = rooms.get(data.roomId);
        if (room) {
          room.users.forEach((user, userId) => {
            if (user.role !== 'HOST' && user.role !== 'CO_HOST') {
              user.isAudioMuted = true;
              io.to(user.socketId).emit('host-control-received', {
                action: 'force_mute',
                muted: true
              });
            }
          });
          io.to(data.roomId).emit('all-muted');
        }
        break;
    }
  });

  // ==================== ENGAGEMENT (RAISE HAND, REACTIONS) ====================
  
  socket.on('engagement', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    const room = rooms.get(data.roomId);
    if (!room) return;
    
    const user = room.users.get(fromUser.userId);
    if (!user) return;
    
    switch(data.action) {
      case 'raise_hand':
        user.isHandRaised = data.params.raised;
        io.to(data.roomId).emit('hand-raised', {
          userId: fromUser.userId,
          userName: fromUser.userName,
          raised: data.params.raised
        });
        console.log(`[HAND] ${fromUser.userName}: ${data.params.raised}`);
        break;
        
      case 'reaction':
        io.to(data.roomId).emit('reaction', {
          userId: fromUser.userId,
          userName: fromUser.userName,
          reaction: data.params.reaction,
          timestamp: Date.now()
        });
        console.log(`[REACTION] ${fromUser.userName}: ${data.params.reaction}`);
        break;
        
      case 'lower_all_hands':
  if (fromUser.role === 'HOST' || fromUser.role === 'CO_HOST') {
    console.log('========================================');
    console.log(`🚀 LOWERING ALL HANDS in room ${data.roomId}`);
    console.log(`   Requested by: ${fromUser.userName} (${fromUser.userId})`);
    
    room.users.forEach(u => {
      console.log(`   - Lowering hand for: ${u.userName} (was: ${u.isHandRaised})`);
      u.isHandRaised = false;
    });
    
    // Broadcast to ALL users in room (including host)
    io.to(data.roomId).emit('all-hands-lowered', {
      byHost: fromUser.userId,
      timestamp: Date.now()
    });
    
    console.log(`   ✅ Broadcasted to room ${data.roomId}`);
    console.log(`   Total users in room: ${room.users.size}`);
    console.log('========================================');
  } else {
    console.log(`⚠️ Unauthorized lower_all_hands attempt by ${fromUser.userName}`);
  }
  break;

    }
  });

  // ==================== SCREEN SHARING ====================
  
  socket.on('screen-share', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    const room = rooms.get(data.roomId);
    if (!room) return;
    
    const settings = meetingSettings.get(data.roomId);
    if (settings && !settings.allowParticipantsToShare && 
        fromUser.role !== 'HOST' && fromUser.role !== 'CO_HOST') {
      socket.emit('error', { message: 'Screen sharing not allowed' });
      return;
    }
    
    const user = room.users.get(fromUser.userId);
    
    if (data.action === 'start') {
      user.isScreenSharing = true;
      io.to(data.roomId).emit('screen-share-started', {
        userId: fromUser.userId,
        userName: fromUser.userName
      });
      console.log(`[SCREEN SHARE] Started by ${fromUser.userName}`);
    } else if (data.action === 'stop') {
      user.isScreenSharing = false;
      io.to(data.roomId).emit('screen-share-stopped', {
        userId: fromUser.userId
      });
      console.log(`[SCREEN SHARE] Stopped by ${fromUser.userName}`);
    }
  });

  // ==================== WHITEBOARD ====================
  
  socket.on('whiteboard', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    switch(data.action) {
      case 'open':
        if (fromUser.role === 'HOST' || fromUser.role === 'CO_HOST') {
          whiteboardStates.set(data.roomId, []);
          io.to(data.roomId).emit('whiteboard-opened');
          console.log(`[WHITEBOARD] Opened in ${data.roomId}`);
        }
        break;
        
      case 'close':
        whiteboardStates.delete(data.roomId);
        io.to(data.roomId).emit('whiteboard-closed');
        break;
        
      case 'draw':
        const paths = whiteboardStates.get(data.roomId) || [];
        paths.push(data.path);
        whiteboardStates.set(data.roomId, paths);
        socket.to(data.roomId).emit('whiteboard-drawing', {
          path: data.path,
          userId: fromUser.userId
        });
        break;
        
      case 'clear':
        whiteboardStates.set(data.roomId, []);
        io.to(data.roomId).emit('whiteboard-cleared');
        break;
    }
  });

  // ==================== FILE SHARING ====================
  
  socket.on('file-share', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    io.to(data.roomId).emit('file-shared', {
      fromUserId: fromUser.userId,
      fromUserName: fromUser.userName,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      fileSize: data.fileSize,
      timestamp: Date.now()
    });
    console.log(`[FILE] ${fromUser.userName} shared ${data.fileName}`);
  });

  // ==================== POLLS ====================
  
  socket.on('poll', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    switch(data.action) {
      case 'create':
        if (fromUser.role === 'HOST' || fromUser.role === 'CO_HOST') {
          const poll = {
            ...data.poll,
            responses: new Map()
          };
          polls.set(data.poll.pollId, poll);
          io.to(data.roomId).emit('poll-created', data.poll);
          console.log(`[POLL] Created: ${data.poll.question}`);
        }
        break;
        
      case 'respond':
        const poll = polls.get(data.params.pollId);
        if (poll) {
          poll.responses.set(fromUser.userId, data.params.optionIndex);
          io.to(data.roomId).emit('poll-response', {
            pollId: data.params.pollId,
            userId: fromUser.userId,
            optionIndex: data.params.optionIndex
          });
        }
        break;
        
      case 'end':
        const endedPoll = polls.get(data.params.pollId);
        if (endedPoll && (fromUser.role === 'HOST' || fromUser.role === 'CO_HOST')) {
          const results = {};
          endedPoll.responses.forEach(optionIndex => {
            results[optionIndex] = (results[optionIndex] || 0) + 1;
          });
          io.to(data.roomId).emit('poll-ended', {
            pollId: data.params.pollId,
            results
          });
          polls.delete(data.params.pollId);
        }
        break;
    }
  });

  // ==================== BREAKOUT ROOMS ====================
  
  socket.on('breakout-rooms', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || fromUser.role !== 'HOST') {
      socket.emit('error', { message: 'Only host can manage breakout rooms' });
      return;
    }
    
    switch(data.action) {
      case 'create':
        const rooms = [];
        for (let i = 0; i < data.params.roomCount; i++) {
          rooms.push({
            roomId: `${data.roomId}_breakout_${i}`,
            roomName: `Breakout Room ${i + 1}`,
            participantIds: []
          });
        }
        breakoutRooms.set(data.roomId, rooms);
        io.to(data.roomId).emit('breakout-rooms-created', { rooms });
        console.log(`[BREAKOUT] Created ${data.params.roomCount} rooms`);
        break;
        
      case 'assign':
        const allRooms = breakoutRooms.get(data.roomId);
        if (allRooms) {
          const room = allRooms.find(r => r.roomId === data.params.roomId);
          if (room) {
            room.participantIds.push(data.params.userId);
            const targetUser = rooms.get(data.roomId)?.users.get(data.params.userId);
            if (targetUser) {
              io.to(targetUser.socketId).emit('assigned-to-breakout', {
                roomId: room.roomId,
                roomName: room.roomName
              });
            }
          }
        }
        break;
        
      case 'close':
        breakoutRooms.delete(data.roomId);
        io.to(data.roomId).emit('breakout-rooms-closed');
        break;
    }
  });

  // ==================== RECORDING ====================
  
  socket.on('recording', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || fromUser.role !== 'HOST') {
      socket.emit('error', { message: 'Only host can control recording' });
      return;
    }
    
    if (data.action === 'start') {
      recordings.set(data.roomId, {
        isRecording: true,
        startTime: Date.now()
      });
      io.to(data.roomId).emit('recording-started');
      console.log(`[RECORDING] Started in ${data.roomId}`);
    } else if (data.action === 'stop') {
      const recordingData = recordings.get(data.roomId);
      recordings.delete(data.roomId);
      io.to(data.roomId).emit('recording-stopped', {
        recordingUrl: data.recordingUrl || null
      });
      console.log(`[RECORDING] Stopped in ${data.roomId}`);
    }
  });

  // ==================== WAITING ROOM ====================
  
  socket.on('waiting-room', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser || fromUser.role !== 'HOST') {
      socket.emit('error', { message: 'Only host can manage waiting room' });
      return;
    }
    
    const waitingList = waitingRooms.get(data.roomId) || [];
    const userIndex = waitingList.findIndex(u => u.userId === data.userId);
    
    if (userIndex === -1) return;
    
    const waitingUser = waitingList[userIndex];
    
    if (data.action === 'approve') {
      waitingList.splice(userIndex, 1);
      waitingRooms.set(data.roomId, waitingList);
      
      io.to(waitingUser.socketId).emit('waiting-room-approved');
      
      // Now actually join the room
      const approvedSocket = io.sockets.sockets.get(waitingUser.socketId);
      if (approvedSocket) {
        approvedSocket.join(data.roomId);
        users.set(waitingUser.socketId, { 
          userId: waitingUser.userId, 
          userName: waitingUser.userName, 
          role: 'PARTICIPANT', 
          roomId: data.roomId 
        });
        
        const room = rooms.get(data.roomId);
        if (room) {
          room.users.set(waitingUser.userId, {
            userId: waitingUser.userId,
            userName: waitingUser.userName,
            role: 'PARTICIPANT',
            socketId: waitingUser.socketId,
            isAudioMuted: false,
            isVideoEnabled: true
          });
        }
        
        io.to(data.roomId).emit('user-joined', { 
          userId: waitingUser.userId, 
          userName: waitingUser.userName, 
          role: 'PARTICIPANT' 
        });
      }
      
      console.log(`[WAITING] Approved ${waitingUser.userName}`);
    } else if (data.action === 'deny') {
      waitingList.splice(userIndex, 1);
      waitingRooms.set(data.roomId, waitingList);
      
      io.to(waitingUser.socketId).emit('waiting-room-denied');
      console.log(`[WAITING] Denied ${waitingUser.userName}`);
    }
  });

  // ==================== AUDIO LEVEL (SPEAKING DETECTION) ====================
  
  socket.on('audio-level', (data) => {
    const fromUser = users.get(socket.id);
    if (!fromUser) return;
    
    // Broadcast speaking status if level above threshold
    const isSpeaking = data.level > 0.1;
    socket.to(data.roomId).emit('participant-speaking', {
      userId: fromUser.userId,
      isSpeaking
    });
  });

  // ==================== DISCONNECT ====================
  
  socket.on('user-offline', (data) => {
    console.log(`[OFFLINE] ${data.userId}`);
    onlineUsers.delete(data.userId);
    io.emit('user-offline', { userId: data.userId });
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
      io.emit('user-offline', { userId: user.userId });
      broadcastOnlineUsers();
    }
  });

  // ==================== HELPER FUNCTIONS ====================
  
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
        // Cleanup
        meetingSettings.delete(roomId);
        whiteboardStates.delete(roomId);
        recordings.delete(roomId);
        breakoutRooms.delete(roomId);
        waitingRooms.delete(roomId);
      }
    }
    
    if (activeGroups.has(roomId)) {
      activeGroups.get(roomId).participants.delete(userId);
      broadcastActiveGroups();
    }
    
    users.delete(socket.id);
    socket.leave(roomId);
  }

  function addToWaitingRoom(roomId, user) {
    const waitingList = waitingRooms.get(roomId) || [];
    waitingList.push(user);
    waitingRooms.set(roomId, waitingList);
  }

  function broadcastOnlineUsers() {
    const usersList = Array.from(onlineUsers.values()).map(u => ({
      userId: u.userId,
      userName: u.userName,
      status: u.status || 'online'
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
  console.log(`🚀 Enhanced Signaling Server running on port ${PORT}`);
  console.log(`✅ Features: Host Controls, Reactions, Screen Share, Whiteboard, Polls, Breakout Rooms, Recording, Waiting Room`);
});
