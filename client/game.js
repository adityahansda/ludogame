const socket = io();

const state = {
  roomId: null,
  username: '',
  myColor: null,
  game: null,
  boardTokens: [],
  playableTokenIds: [],
};

const SAFE_TRACK = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
const TRACK_LENGTH = 52;

const el = {
  username: document.getElementById('username'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  roomIdInput: document.getElementById('roomIdInput'),
  roomLabel: document.getElementById('roomLabel'),
  turnText: document.getElementById('turnText'),
  diceText: document.getElementById('diceText'),
  rollDiceBtn: document.getElementById('rollDiceBtn'),
  restartBtn: document.getElementById('restartBtn'),
  board: document.getElementById('board'),
  playersList: document.getElementById('playersList'),
  chatBox: document.getElementById('chatBox'),
  chatInput: document.getElementById('chatInput'),
  sendChatBtn: document.getElementById('sendChatBtn'),
  leaderboardList: document.getElementById('leaderboardList'),
};

function buildBoard() {
  el.board.innerHTML = '';
  for (let i = 0; i < 225; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = i;
    el.board.appendChild(cell);
  }

  const route = computeRoute();
  route.forEach((gridIndex, trackIndex) => {
    const cell = el.board.children[gridIndex];
    if (!cell) return;
    cell.classList.add('path');
    cell.dataset.track = trackIndex;
    if (SAFE_TRACK.has(trackIndex)) cell.classList.add('safe');
  });
}

function computeRoute() {
  // 15x15 board route, clockwise.
  const pts = [];
  for (let c = 6; c <= 14; c++) pts.push([0, c]);
  for (let r = 1; r <= 5; r++) pts.push([r, 8]);
  for (let c = 9; c <= 14; c++) pts.push([6, c]);
  for (let r = 7; r <= 14; r++) pts.push([r, 14]);
  for (let c = 13; c >= 9; c--) pts.push([8, c]);
  for (let r = 14; r >= 9; r--) pts.push([r, 8]);
  for (let c = 7; c >= 0; c--) pts.push([14, c]);
  for (let r = 13; r >= 9; r--) pts.push([r, 6]);
  for (let c = 5; c >= 0; c--) pts.push([8, c]);
  for (let r = 7; r >= 0; r--) pts.push([r, 0]);
  for (let c = 1; c <= 5; c++) pts.push([6, c]);
  for (let r = 0; r <= 5; r++) pts.push([r, 6]);

  const unique52 = pts.slice(0, TRACK_LENGTH);
  return unique52.map(([r, c]) => r * 15 + c);
}

function colorRelativeToGlobal(color, relPos) {
  if (relPos < 0 || relPos >= TRACK_LENGTH) return null;
  return (START_INDEX[color] + relPos) % TRACK_LENGTH;
}

function renderBoardTokens() {
  // Clear old dots.
  [...el.board.children].forEach((cell) => {
    cell.innerHTML = '';
  });

  const route = computeRoute();
  for (const token of state.boardTokens) {
    if (token.relPos < 0) continue;
    // Show home stretch/final tokens near center by clustering in center cell.
    if (token.relPos >= TRACK_LENGTH) {
      const center = el.board.children[7 * 15 + 7];
      const dot = document.createElement('div');
      dot.className = `dot ${token.color}`;
      center.appendChild(dot);
      continue;
    }

    const g = colorRelativeToGlobal(token.color, token.relPos);
    const boardIndex = route[g];
    const cell = el.board.children[boardIndex];
    if (!cell) continue;

    const dot = document.createElement('div');
    dot.className = `dot ${token.color}`;
    cell.appendChild(dot);
  }
}

function renderPlayers() {
  const game = state.game;
  if (!game) return;
  el.playersList.innerHTML = '';

  game.players.forEach((p) => {
    const li = document.createElement('li');
    const done = p.tokens.filter((t) => t.pos === 58).length;
    li.textContent = `${p.username} (${p.color}) - Home: ${done}/4${p.connected ? '' : ' (offline)'}`;
    el.playersList.appendChild(li);
  });

  const mine = game.players.find((p) => p.color === state.myColor);
  const existing = document.querySelector('.token-buttons');
  if (existing) existing.remove();

  if (mine) {
    const wrap = document.createElement('div');
    wrap.className = 'token-buttons';

    mine.tokens.forEach((token) => {
      const b = document.createElement('button');
      b.className = 'token-btn';
      b.textContent = `Token ${token.id + 1} (${token.pos === -1 ? 'Base' : token.pos})`;
      b.disabled = !state.playableTokenIds.includes(token.id);
      b.onclick = () => socket.emit('moveToken', { tokenId: token.id });
      wrap.appendChild(b);
    });

    el.playersList.parentElement.appendChild(wrap);
  }
}

function renderTurnAndControls() {
  const game = state.game;
  if (!game) return;

  el.turnText.textContent = `Turn: ${game.turnPlayer || '-'} (${game.turnColor || '-'})`;

  const myTurn = game.turnColor === state.myColor;
  el.rollDiceBtn.disabled = !myTurn || !state.roomId || game.status !== 'active' || game.moveWindowOpen;
  el.restartBtn.disabled = !state.roomId;

  if (game.status === 'finished' && game.winner) {
    el.turnText.textContent = `🏆 Winner: ${game.winner.username} (${game.winner.color})`;
  }
}

function renderChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.textContent = `[${new Date(msg.at).toLocaleTimeString()}] ${msg.username}: ${msg.text}`;
  el.chatBox.appendChild(div);
  el.chatBox.scrollTop = el.chatBox.scrollHeight;
}

async function fetchLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();
  el.leaderboardList.innerHTML = '';
  data.forEach((u, i) => {
    const li = document.createElement('li');
    li.textContent = `#${i + 1} ${u.username} | Wins: ${u.wins} | Coins: ${u.coins}`;
    el.leaderboardList.appendChild(li);
  });
}

// --- Socket events ---
socket.on('roomCreated', ({ roomId, color }) => {
  state.roomId = roomId;
  state.myColor = color;
  el.roomLabel.textContent = `Room: ${roomId} | You are ${color}`;
});

socket.on('roomJoined', ({ roomId, color }) => {
  state.roomId = roomId;
  state.myColor = color;
  el.roomLabel.textContent = `Room: ${roomId} | You are ${color}`;
});

socket.on('stateUpdate', ({ game, boardTokens }) => {
  state.game = game;
  state.boardTokens = boardTokens;
  state.playableTokenIds = [];
  renderBoardTokens();
  renderPlayers();
  renderTurnAndControls();
  fetchLeaderboard();
});

socket.on('diceRolled', ({ value, by, playableTokenIds }) => {
  state.playableTokenIds = playableTokenIds || [];
  el.diceText.textContent = `Dice: ${value} by ${by}`;
  el.diceText.classList.add('dice-anim');
  setTimeout(() => el.diceText.classList.remove('dice-anim'), 1000);
  renderPlayers();
});

socket.on('tokenMoved', ({ by, captures, extraTurn }) => {
  let text = `${by} moved a token.`;
  if (captures?.length) text += ` Captured ${captures.length} token(s)!`;
  if (extraTurn) text += ' Extra turn for rolling 6.';
  el.diceText.textContent = text;
});

socket.on('chatMessage', (entry) => renderChatMessage(entry));

socket.on('errorMessage', (message) => {
  alert(message);
});

// --- UI events ---
el.createRoomBtn.onclick = () => {
  const username = el.username.value.trim();
  state.username = username;
  socket.emit('createRoom', { username });
};

el.joinRoomBtn.onclick = () => {
  const username = el.username.value.trim();
  const roomId = el.roomIdInput.value.trim().toUpperCase();
  state.username = username;
  socket.emit('joinRoom', { username, roomId });
};

el.rollDiceBtn.onclick = () => socket.emit('rollDice');
el.restartBtn.onclick = () => socket.emit('restartGame');

el.sendChatBtn.onclick = () => {
  const message = el.chatInput.value.trim();
  if (!message) return;
  socket.emit('chat', { message });
  el.chatInput.value = '';
};

el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.sendChatBtn.click();
});

buildBoard();
fetchLeaderboard();
