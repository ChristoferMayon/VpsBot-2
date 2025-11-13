const mongoose = require('mongoose')
const OtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  otp: { type: String },
  expiresAt: { type: Date, index: true }
}, { timestamps: true })
module.exports = mongoose.model('Otp', OtpSchema)