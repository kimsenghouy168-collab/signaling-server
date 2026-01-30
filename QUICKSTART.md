# Quick Start Guide - Signaling Server + Android SDK

## 🚀 Test Locally (5 minutes)

### 1. Start Signaling Server

```bash
cd /Users/kimsenghouy/streaming/signaling-server
npm start
```

Server will run on `http://localhost:3000`

### 2. Test Server

Open browser: `http://localhost:3000`

You should see:

```json
{
  "status": "ok",
  "service": "IDIC Cambodia Signaling Server",
  "rooms": 0,
  "users": 0
}
```

### 3. Test TURN Config

Open: `http://localhost:3000/api/turn`

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

✅ Server is working!

---

## 🌐 Deploy to Render (10 minutes)

### Step 1: Push to GitHub

```bash
cd /Users/kimsenghouy/streaming
git add signaling-server/
git commit -m "Add standalone signaling server"
git push
```

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name:** `streaming-signaling`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Root Directory:** `signaling-server` ⚠️ IMPORTANT!

5. **Add Environment Variables:**

   ```
   TURN_URL=turn:openrelay.metered.ca:80
   TURN_USERNAME=openrelayproject
   TURN_CREDENTIAL=openrelayproject
   ```

6. Click **"Create Web Service"**

### Step 3: Get Your URL

Render will give you a URL like:

```
https://streaming-signaling.onrender.com
```

Test it: `https://streaming-signaling.onrender.com/`

---

## 📱 Use with Android SDK

### Option 1: Simple (No TURN Config Needed)

```kotlin
// In Application.onCreate()
StreamingSDK.initialize(
    this,
    StreamConfig(
        serverUrl = "https://streaming-signaling.onrender.com",
        enableLogs = true
    )
)

// Automatically gets TURN config from server!
```

### Option 2: Custom TURN Servers

```kotlin
StreamingSDK.initialize(
    this,
    StreamConfig(
        serverUrl = "https://streaming-signaling.onrender.com",
        enableLogs = true,
        turnServers = listOf(
            TurnServer(
                url = "turn:your-turn-server.com:3478",
                username = "your-username",
                credential = "your-password"
            )
        ),
        autoFetchTurnConfig = false  // Don't fetch from server
    )
)
```

### Option 3: Mix Both

```kotlin
StreamConfig(
    serverUrl = "https://streaming-signaling.onrender.com",
    turnServers = listOf(
        TurnServer("turn:backup-server.com:3478", "user", "pass")
    ),
    autoFetchTurnConfig = true  // Also fetch from server
)
```

---

## 🧪 Test Android ↔ Web

### 1. Update Web App

Edit `/Users/kimsenghouy/streaming/src/services/socket.ts`:

```typescript
const serverUrl = 'https://streaming-signaling.onrender.com'
```

### 2. Start Web App

```bash
cd /Users/kimsenghouy/streaming
pnpm dev
```

### 3. Join Room from Android

```kotlin
val client = StreamingSDK.getInstance().createClient()
client.joinRoom("test-room", "android-1", "Android User", RoomRole.PARTICIPANT)
```

### 4. Join Same Room from Web

Open browser: `http://localhost:5173`
Join room: `test-room`

✅ You should see each other!

---

## 🎯 What You Have Now

### ✅ Signaling Server

- Standalone Node.js server
- Socket.IO signaling
- TURN server support
- Render deployment ready
- `/api/turn` endpoint for ICE config

### ✅ Android SDK with TURN

- Auto-fetch TURN from server
- Custom TURN server support
- Mutable ICE server list
- Works with Render deployment

### ✅ Cross-Platform

- Android ↔ Web communication
- Android ↔ Android communication
- Shared signaling server

---

## 📊 Monitoring

### Check Server Health

```bash
curl https://streaming-signaling.onrender.com/
```

### Check TURN Config

```bash
curl https://streaming-signaling.onrender.com/api/turn
```

### View Render Logs

Go to Render dashboard → Your service → Logs tab

---

## 💡 Pro Tips

### 1. Free TURN Servers

**Metered Open Relay** (Current config):

- No signup needed
- Shared, may be slower
- Good for testing

**Numb Viagenie**:

- Free with signup at https://numb.viagenie.ca/
- More stable
- Update `.env`:
  ```
  TURN_URL=turn:numb.viagenie.ca
  TURN_USERNAME=your-email@domain.com
  TURN_CREDENTIAL=your-password
  ```

### 2. Render Free Tier

- Server sleeps after 15 min inactivity
- First request may be slow (wakes up server)
- Upgrade to $7/month for always-on

### 3. TURN is Optional

- Only needed if users are behind strict firewalls/NAT
- STUN servers (Google) work for most cases
- Android SDK works fine without TURN

---

## 🔥 Next Steps

1. **Deploy signaling server to Render** ✅
2. **Update Android SDK server URL** ✅
3. **Test with real devices** 📱
4. **Add chat functionality** 💬
5. **Build example Android app with UI** 🎨
6. **Test cross-platform** (Android ↔ Web) 🌐

---

## 🆘 Troubleshooting

**Server won't start:**

```bash
# Check Node version
node --version  # Should be 18+

# Install dependencies again
rm -rf node_modules
npm install
```

**Can't connect from Android:**

- Make sure to use `https://` for Render URLs
- Check server is running in Render dashboard
- Verify Socket.IO connection in Android logs

**TURN not working:**

- Test TURN server: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
- Try different TURN server (Numb Viagenie)
- Check environment variables in Render
