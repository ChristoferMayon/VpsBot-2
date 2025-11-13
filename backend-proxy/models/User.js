const mongoose = require('mongoose')
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, index: true },
  passwordHash: { type: String },
  chatId: { type: String },
  messagesSent: { type: Number, default: 0 },
  country: { type: String },
  city: { type: String },
  lastLogin: { type: Date },
  role: { type: String, default: 'user' },
  failedOtpAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date }
}, { timestamps: true })
module.exports = mongoose.model('User', UserSchema)