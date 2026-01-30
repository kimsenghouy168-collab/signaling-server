# Signaling Server for WebRTC Streaming

A lightweight, standalone signaling server for WebRTC video streaming. Designed to be deployed on Render.com or any Node.js hosting platform.

## 🚀 Features

- ✅ WebRTC signaling via Socket.IO
- ✅ TURN server support (bypass firewalls/NAT)
- ✅ Multi-room support
- ✅ User management
- ✅ Chat messaging
- ✅ Easy Render deployment
- ✅ Health check endpoint

## 📋 Local Development

### 1. Install Dependencies

```bash
cd signaling-server
npm install
```

### 2. Configure Environment

Edit `.env` file:

```env
PORT=3000

# Optional: Add TURN server for better connectivity
TURN_URL=turn:openrelay.metered.ca:80
TURN_USERNAME=openrelayproject
TURN_CREDENTIAL=openrelayproject
```

### 3. Run Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server will start on `http://localhost:3000`

## 🌐 Deploy to Render

### Quick Deploy (Recommended)

1. **Push to GitHub:**

   ```bash
   git add signaling-server/
   git commit -m "Add signaling server"
   git push
   ```

2. **Deploy on Render:**
   - Go to [render.com](https://render.com)
   - Click **"New +"** → **"Web Service"**
   - Connect your GitHub repository
   - Configure:
     - **Name:** `streaming-signaling-server`
     - **Environment:** `Node`
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Root Directory:** `signaling-server`

3. **Add Environment Variables** (in Render dashboard):

   ```
   TURN_URL=turn:openrelay.metered.ca:80
   TURN_USERNAME=openrelayproject
   TURN_CREDENTIAL=openrelayproject
   ```

4. **Deploy!** Render will give you a URL like:
   ```
   https://streaming-signaling-server.onrender.com
   ```

### Manual Configuration

If deploying manually, create a `render.yaml` file:

```yaml
services:
  - type: web
    name: signaling-server
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: TURN_URL
        value: turn:openrelay.metered.ca:80
      - key: TURN_USERNAME
        value: openrelayproject
      - key: TURN_CREDENTIAL
        value: openrelayproject
```

## 🔧 API Endpoints

### `GET /`

Health check endpoint

**Response:**

```json
{
  "status": "ok",
  "service": "IDIC Cambodia Signaling Server",
  "version": "1.0.0",
  "rooms": 2,
  "users": 5,
  "timestamp": "2026-01-30T07:52:00.000Z"
}
```

### `GET /api/turn`

Get TURN server configuration

**Response:**

```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": "turn:openrelay.metered.ca:80",
      "username": "openrelayproject",
      "credential": "openrelayproject"
    }
  ]
}
```

## 📡 Socket.IO Events

### Client → Server

| Event           | Data                                 | Description           |
| --------------- | ------------------------------------ | --------------------- |
| `join-room`     | `{ roomId, userId, userName, role }` | Join a streaming room |
| `leave-room`    | `{ roomId }`                         | Leave a room          |
| `offer`         | `{ roomId, to, offer }`              | Send WebRTC offer     |
| `answer`        | `{ roomId, to, answer }`             | Send WebRTC answer    |
| `ice-candidate` | `{ roomId, to, candidate }`          | Send ICE candidate    |
| `send-message`  | `{ roomId, content }`                | Send chat message     |

### Server → Client

| Event           | Data                                       | Description            |
| --------------- | ------------------------------------------ | ---------------------- |
| `user-joined`   | `{ userId, userName, role }`               | User joined room       |
| `user-left`     | `{ userId }`                               | User left room         |
| `room-users`    | `[{ userId, userName, role }]`             | List of users in room  |
| `offer`         | `{ from, offer }`                          | Received WebRTC offer  |
| `answer`        | `{ from, answer }`                         | Received WebRTC answer |
| `ice-candidate` | `{ from, candidate }`                      | Received ICE candidate |
| `new-message`   | `{ userId, userName, content, timestamp }` | New chat message       |

## 🧊 TURN Server Options

### Free TURN Servers

#### 1. Open Relay (Metered.ca) - **Recommended**

```env
TURN_URL=turn:openrelay.metered.ca:80
TURN_USERNAME=openrelayproject
TURN_CREDENTIAL=openrelayproject
```

- ✅ Free, no signup
- ✅ Reliable
- ⚠️ Shared, may be slower

#### 2. Numb (Viagenie)

```env
TURN_URL=turn:numb.viagenie.ca
TURN_USERNAME=your-email@domain.com
TURN_CREDENTIAL=your-password
```

- ✅ Free with signup
- Signup: https://numb.viagenie.ca/

### Paid TURN Servers

#### 1. Twilio TURN

```env
TURN_URL=turn:global.turn.twilio.com:3478?transport=udp
TURN_USERNAME=your-twilio-username
TURN_CREDENTIAL=your-twilio-credential
```

- Professional grade
- Pay per usage

#### 2. Xirsys

- Specialized WebRTC infrastructure
- Global presence

### Self-Hosted TURN

See `TURN_SETUP.md` in the main project for self-hosted options using Coturn.

## 🧪 Testing

### Test with curl

```bash
# Health check
curl https://your-server.onrender.com/

# Get TURN config
curl https://your-server.onrender.com/api/turn
```

### Test with web client

```bash
cd ..
pnpm dev

# Update serverUrl in your web app to use Render URL
```

### Test with Android

Update `StreamConfig` in your Android app:

```kotlin
StreamConfig(
    serverUrl = "https://your-server.onrender.com"
)
```

## 📊 Monitoring

### Render Dashboard

- View logs in real-time
- Monitor CPU/memory usage
- Check request statistics

### Custom Logging

Server logs include:

- Connection/disconnection events
- Room join/leave events
- WebRTC signaling events
- User counts

## 🔒 Security (Optional)

For production, consider adding:

1. **Authentication:**

   ```javascript
   io.use((socket, next) => {
     const token = socket.handshake.auth.token
     // Verify token
     next()
   })
   ```

2. **Rate Limiting:**

   ```bash
   npm install express-rate-limit
   ```

3. **HTTPS Only:**
   Render provides HTTPS automatically!

## 💰 Cost

**Render Free Tier:**

- ✅ 750 hours/month free
- ✅ Auto-sleep after 15 min inactivity
- ✅ Perfect for testing

**Render Paid:**

- $7/month for always-on
- Better performance

## 🐛 Troubleshooting

### Server won't start on Render

- Check build logs
- Verify `package.json` has correct `start` script
- Ensure Node.js version is compatible

### Clients can't connect

- Check Render URL is correct (use HTTPS)
- Verify CORS is enabled (it is by default)
- Check browser console for errors

### TURN not working

- Verify environment variables are set in Render
- Test TURN server with: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
- Try different TURN server

## 📄 License

MIT
