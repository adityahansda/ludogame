const { randomInt } = require('crypto');

const COLORS = ['red', 'green', 'yellow', 'blue'];
const TOKENS_PER_PLAYER = 4;
const TRACK_LENGTH = 52;
const HOME_STRETCH = 6;
const FINAL_INDEX = TRACK_LENGTH + HOME_STRETCH; // 58
const START_INDEX = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

// Standard Ludo safe squares on main track.
const SAFE_TRACK = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const createToken = (id) => ({ id, pos: -1 }); // -1 = in base, 0..57 = on route, 58 = finished

const relativeToGlobal = (color, relPos) => {
  if (relPos < 0 || relPos >= TRACK_LENGTH) return null;
  return (START_INDEX[color] + relPos) % TRACK_LENGTH;
};

const globalToRelative = (color, globalPos) => {
  const offset = START_INDEX[color];
  return (globalPos - offset + TRACK_LENGTH) % TRACK_LENGTH;
};

const isSafePosition = (token, color) => {
  if (token.pos < 0) return true;
  if (token.pos >= TRACK_LENGTH) return true; // home stretch is always safe
  const global = relativeToGlobal(color, token.pos);
  return SAFE_TRACK.has(global);
};

function createGame(roomId) {
  return {
    roomId,
    status: 'waiting',
    players: [],
    turnIndex: 0,
    lastDice: null,
    winner: null,
    moveWindowOpen: false,
    chat: [],
  };
}

function addPlayer(game, socketId, username) {
  if (game.players.length >= 4) {
    return { ok: false, error: 'Room is full.' };
  }
  if (game.players.find((p) => p.socketId === socketId)) {
    return { ok: true };
  }
  const color = COLORS[game.players.length];
  const player = {
    socketId,
    username,
    color,
    connected: true,
    finished: false,
    tokens: Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => createToken(i)),
  };
  game.players.push(player);
  if (game.players.length === 4) game.status = 'active';
  return { ok: true, player };
}

function markDisconnected(game, socketId) {
  const player = game.players.find((p) => p.socketId === socketId);
  if (player) player.connected = false;
}

function findPlayerBySocket(game, socketId) {
  return game.players.find((p) => p.socketId === socketId);
}

function currentPlayer(game) {
  return game.players[game.turnIndex] || null;
}

function rollDice(game, socketId) {
  if (game.status !== 'active') return { ok: false, error: 'Game not active.' };
  const player = currentPlayer(game);
  if (!player || player.socketId !== socketId) {
    return { ok: false, error: 'Not your turn.' };
  }
  if (game.moveWindowOpen) {
    return { ok: false, error: 'Move a token first.' };
  }

  const value = randomInt(1, 7);
  game.lastDice = value;
  game.moveWindowOpen = true;

  const playable = getPlayableTokenIds(player, value);
  if (playable.length === 0) {
    // Auto pass if no legal move.
    game.moveWindowOpen = false;
    advanceTurn(game, value === 6);
  }

  return { ok: true, value, playable };
}

function getPlayableTokenIds(player, dice) {
  return player.tokens.filter((token) => isMoveLegal(player, token, dice)).map((t) => t.id);
}

function isMoveLegal(player, token, dice) {
  if (token.pos === FINAL_INDEX) return false;
  if (token.pos === -1) {
    return dice === 6;
  }
  const next = token.pos + dice;
  return next <= FINAL_INDEX;
}

function resolveCapture(game, mover, movedToken) {
  if (movedToken.pos < 0 || movedToken.pos >= TRACK_LENGTH) return [];
  if (isSafePosition(movedToken, mover.color)) return [];

  const movedGlobal = relativeToGlobal(mover.color, movedToken.pos);
  const captures = [];

  game.players.forEach((opponent) => {
    if (opponent.socketId === mover.socketId) return;
    opponent.tokens.forEach((token) => {
      if (token.pos < 0 || token.pos >= TRACK_LENGTH) return;
      const global = relativeToGlobal(opponent.color, token.pos);
      if (global === movedGlobal && !isSafePosition(token, opponent.color)) {
        token.pos = -1;
        captures.push({
          against: opponent.username,
          color: opponent.color,
          tokenId: token.id,
        });
      }
    });
  });

  return captures;
}

function moveToken(game, socketId, tokenId) {
  if (game.status !== 'active') return { ok: false, error: 'Game not active.' };
  if (!game.moveWindowOpen || typeof game.lastDice !== 'number') {
    return { ok: false, error: 'Roll dice first.' };
  }

  const player = currentPlayer(game);
  if (!player || player.socketId !== socketId) {
    return { ok: false, error: 'Not your turn.' };
  }

  const token = player.tokens.find((t) => t.id === tokenId);
  if (!token) return { ok: false, error: 'Token not found.' };
  if (!isMoveLegal(player, token, game.lastDice)) {
    return { ok: false, error: 'Illegal token move.' };
  }

  if (token.pos === -1 && game.lastDice === 6) {
    token.pos = 0;
  } else {
    token.pos += game.lastDice;
  }

  const captures = resolveCapture(game, player, token);

  if (player.tokens.every((t) => t.pos === FINAL_INDEX)) {
    player.finished = true;
    game.status = 'finished';
    game.winner = {
      username: player.username,
      color: player.color,
      socketId: player.socketId,
    };
  }

  const dice = game.lastDice;
  game.moveWindowOpen = false;
  game.lastDice = null;

  if (game.status !== 'finished') {
    advanceTurn(game, dice === 6);
  }

  return {
    ok: true,
    captures,
    extraTurn: dice === 6,
    winner: game.winner,
  };
}

function advanceTurn(game, keepTurn) {
  if (game.players.length === 0) return;
  if (keepTurn) return;
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
}

function toClientState(game) {
  return {
    roomId: game.roomId,
    status: game.status,
    players: game.players.map((p) => ({
      username: p.username,
      color: p.color,
      connected: p.connected,
      tokens: p.tokens,
      finished: p.finished,
    })),
    turnColor: game.players[game.turnIndex]?.color || null,
    turnPlayer: game.players[game.turnIndex]?.username || null,
    moveWindowOpen: game.moveWindowOpen,
    winner: game.winner,
    chat: game.chat.slice(-50),
  };
}

function toGlobalPositions(game) {
  const tokens = [];
  game.players.forEach((p) => {
    p.tokens.forEach((t) => {
      let global = null;
      if (t.pos >= 0 && t.pos < TRACK_LENGTH) {
        global = relativeToGlobal(p.color, t.pos);
      }
      tokens.push({
        color: p.color,
        tokenId: t.id,
        relPos: t.pos,
        globalPos: global,
      });
    });
  });
  return tokens;
}

function resetGame(game) {
  game.status = game.players.length === 4 ? 'active' : 'waiting';
  game.turnIndex = 0;
  game.lastDice = null;
  game.moveWindowOpen = false;
  game.winner = null;
  game.players.forEach((p) => {
    p.finished = false;
    p.tokens = Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => createToken(i));
  });
}

module.exports = {
  createGame,
  addPlayer,
  markDisconnected,
  findPlayerBySocket,
  rollDice,
  moveToken,
  toClientState,
  toGlobalPositions,
  globalToRelative,
  resetGame,
};
