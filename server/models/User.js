const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 20 },
    wins: { type: Number, default: 0 },
    coins: { type: Number, default: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
