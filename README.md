# Multiplayer Ludo Web App

A complete, beginner-friendly multiplayer Ludo game using **Node.js + Express + Socket.IO + MongoDB**.

## Folder Structure

```text
ludogame/
├── client/
│   ├── index.html
│   ├── style.css
│   └── game.js
├── server/
│   ├── server.js
│   ├── socket.js
│   ├── game/
│   │   └── ludoEngine.js
│   └── models/
│       ├── User.js
│       └── Match.js
├── .env.example
├── package.json
└── README.md
```

## Features

- Room-based real-time multiplayer (up to 4 players)
- Automatic color assignment: red, green, yellow, blue
- Server-side move validation and turn handling
- Ludo rules implemented on server:
  - Need 6 to move token out of base
  - Extra turn on 6
  - Capturing opponent tokens
  - Safe zones
  - Win condition (all 4 tokens home)
- Room chat
- Leaderboard API
- Restart game button
- Basic HTTP and socket rate-limiting

## Setup Steps

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment:

   ```bash
   cp .env.example .env
   ```

   Update `MONGO_URI` in `.env` with your MongoDB Atlas connection string.

3. Start server:

   ```bash
   npm run dev
   ```

   or

   ```bash
   npm start
   ```

4. Open app in browser:

   ```
   http://localhost:3000
   ```

## How to Play

1. Enter username
2. One player creates a room and shares Room ID
3. Other players join room
4. When 4 players are in, game starts
5. Current player rolls dice and moves only allowed token buttons
6. First player to bring all 4 tokens home wins

## APIs

- `GET /api/health`
- `GET /api/leaderboard`
- `GET /api/matches`

