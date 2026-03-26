const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    winner: {
      username: { type: String, required: true },
      color: { type: String, required: true },
    },
    players: [
      {
        username: String,
        color: String,
      },
    ],
    movesCount: { type: Number, default: 0 },
    endedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', matchSchema);
