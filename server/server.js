require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const User = require('./models/User');
const Match = require('./models/Match');
const { bindSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ludogame';

app.use(express.json());
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ludogame', at: new Date().toISOString() });
});

app.get('/api/leaderboard', async (_req, res) => {
  const users = await User.find().sort({ wins: -1, coins: -1 }).limit(10).select('username wins coins -_id');
  res.json(users);
});

app.get('/api/matches', async (_req, res) => {
  const matches = await Match.find().sort({ createdAt: -1 }).limit(10).select('-__v');
  res.json(matches);
});

bindSocket(io);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
