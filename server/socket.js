const { nanoid } = require('nanoid');
const User = require('./models/User');
const Match = require('./models/Match');
const {
  createGame,
  addPlayer,
  markDisconnected,
  findPlayerBySocket,
  rollDice,
  moveToken,
  toClientState,
  toGlobalPositions,
  resetGame,
} = require('./game/ludoEngine');

const rooms = new Map();

// Very basic in-memory rate limit per socket + event.
const eventBuckets = new Map();
const RATE_LIMIT = {
  chat: { max: 5, windowMs: 3000 },
  rollDice: { max: 2, windowMs: 1000 },
  moveToken: { max: 5, windowMs: 1000 },
};

function passRateLimit(socketId, eventName) {
  const cfg = RATE_LIMIT[eventName];
  if (!cfg) return true;
  const key = `${socketId}:${eventName}`;
  const now = Date.now();
  const bucket = eventBuckets.get(key) || [];
  const recent = bucket.filter((t) => now - t <= cfg.windowMs);
  if (recent.length >= cfg.max) {
    eventBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  eventBuckets.set(key, recent);
  return true;
}

function generateRoomId() {
  return nanoid(6).toUpperCase();
}

async function upsertUser(username) {
  const safeName = username.trim();
  let user = await User.findOne({ username: safeName });
  if (!user) user = await User.create({ username: safeName });
  return user;
}

function bindSocket(io) {
  io.on('connection', (socket) => {
    socket.data.roomId = null;

    socket.on('createRoom', async ({ username }) => {
      try {
        if (!username || username.trim().length < 2) {
          return socket.emit('errorMessage', 'Username must be at least 2 characters.');
        }
        await upsertUser(username);

        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();

        const game = createGame(roomId);
        const addRes = addPlayer(game, socket.id, username.trim());
        if (!addRes.ok) return socket.emit('errorMessage', addRes.error);

        rooms.set(roomId, { game, movesCount: 0 });
        socket.join(roomId);
        socket.data.roomId = roomId;

        socket.emit('roomCreated', { roomId, color: addRes.player.color });
        io.to(roomId).emit('stateUpdate', {
          game: toClientState(game),
          boardTokens: toGlobalPositions(game),
        });
      } catch (error) {
        socket.emit('errorMessage', 'Unable to create room right now.');
      }
    });

    socket.on('joinRoom', async ({ username, roomId }) => {
      try {
        if (!username || username.trim().length < 2) {
          return socket.emit('errorMessage', 'Username must be at least 2 characters.');
        }
        await upsertUser(username);

        const cleanRoom = (roomId || '').trim().toUpperCase();
        const room = rooms.get(cleanRoom);
        if (!room) return socket.emit('errorMessage', 'Room not found.');

        const addRes = addPlayer(room.game, socket.id, username.trim());
        if (!addRes.ok) return socket.emit('errorMessage', addRes.error);

        socket.join(cleanRoom);
        socket.data.roomId = cleanRoom;
        socket.emit('roomJoined', { roomId: cleanRoom, color: addRes.player.color });

        io.to(cleanRoom).emit('stateUpdate', {
          game: toClientState(room.game),
          boardTokens: toGlobalPositions(room.game),
        });
      } catch (error) {
        socket.emit('errorMessage', 'Unable to join room right now.');
      }
    });

    socket.on('rollDice', () => {
      if (!passRateLimit(socket.id, 'rollDice')) {
        return socket.emit('errorMessage', 'Too many dice roll requests.');
      }
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      const result = rollDice(room.game, socket.id);
      if (!result.ok) return socket.emit('errorMessage', result.error);

      io.to(roomId).emit('diceRolled', {
        value: result.value,
        by: findPlayerBySocket(room.game, socket.id)?.username,
        playableTokenIds: result.playable,
      });

      io.to(roomId).emit('stateUpdate', {
        game: toClientState(room.game),
        boardTokens: toGlobalPositions(room.game),
      });
    });

    socket.on('moveToken', async ({ tokenId }) => {
      if (!passRateLimit(socket.id, 'moveToken')) {
        return socket.emit('errorMessage', 'Too many move requests.');
      }
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      const moveRes = moveToken(room.game, socket.id, Number(tokenId));
      if (!moveRes.ok) return socket.emit('errorMessage', moveRes.error);

      room.movesCount += 1;

      io.to(roomId).emit('tokenMoved', {
        by: findPlayerBySocket(room.game, socket.id)?.username,
        captures: moveRes.captures,
        extraTurn: moveRes.extraTurn,
      });

      io.to(roomId).emit('stateUpdate', {
        game: toClientState(room.game),
        boardTokens: toGlobalPositions(room.game),
      });

      if (moveRes.winner) {
        try {
          await User.updateOne({ username: moveRes.winner.username }, { $inc: { wins: 1, coins: 25 } });
          await Match.create({
            roomId,
            winner: { username: moveRes.winner.username, color: moveRes.winner.color },
            players: room.game.players.map((p) => ({ username: p.username, color: p.color })),
            movesCount: room.movesCount,
          });
        } catch (error) {
          // Keep gameplay alive even if DB write fails.
          console.error('Failed to persist match:', error.message);
        }
      }
    });

    socket.on('chat', ({ message }) => {
      if (!passRateLimit(socket.id, 'chat')) {
        return socket.emit('errorMessage', 'Chat rate limit exceeded.');
      }
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      const player = findPlayerBySocket(room.game, socket.id);
      if (!player) return;

      const cleanMessage = (message || '').trim().slice(0, 160);
      if (!cleanMessage) return;

      const entry = {
        username: player.username,
        text: cleanMessage,
        at: new Date().toISOString(),
      };
      room.game.chat.push(entry);
      io.to(roomId).emit('chatMessage', entry);
    });

    socket.on('restartGame', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      resetGame(room.game);
      room.movesCount = 0;
      io.to(roomId).emit('stateUpdate', {
        game: toClientState(room.game),
        boardTokens: toGlobalPositions(room.game),
      });
    });

    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      markDisconnected(room.game, socket.id);

      io.to(roomId).emit('stateUpdate', {
        game: toClientState(room.game),
        boardTokens: toGlobalPositions(room.game),
      });
    });
  });
}

module.exports = { bindSocket, rooms };
