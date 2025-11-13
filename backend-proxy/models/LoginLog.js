const mongoose = require('mongoose')
const LoginLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  ip: { type: String },
  success: { type: Boolean },
  reason: { type: String }
}, { timestamps: true })
module.exports = mongoose.model('LoginLog', LoginLogSchema)