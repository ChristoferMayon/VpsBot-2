const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const userdb = require('../db')
const { send } = require('../utils/telegram')

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const otpStore = new Map()

async function login(req, res) {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'Informe username e password' })
    const user = userdb.findUserByUsername(String(username))
    if (!user) return res.status(401).json({ error: 'Usuário inválido' })
    if (user.active === 0) return res.status(403).json({ error: 'Conta inativa' })
    if (userdb.isExpired(user)) return res.status(403).json({ error: 'Conta expirada' })
    const ok = bcrypt.compareSync(String(password), String(user.password_hash))
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' })
    const adminEnvChat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.ADMIN_CHAT_ID || ''
    const chatId = user.chat_id || (String(user.role) === 'admin' ? adminEnvChat : '')
    if (!chatId) return res.status(400).json({ error: 'Usuário sem chat_id configurado' })
    const code = genOtp()
    const expiresAt = Date.now() + 5 * 60 * 1000
    otpStore.set(String(user.username), { otp: code, expiresAt, tries: 0 })
    await send(String(chatId), `Seu código OTP: ${code}`)
    return res.json({ success: true, message: 'OTP enviado' })
  } catch (e) {
    return res.status(500).json({ error: 'Falha no login' })
  }
}

async function verifyOtp(req, res) {
  try {
    const { username, otp } = req.body || {}
    if (!username || !otp) return res.status(400).json({ error: 'Informe username e otp' })
    const user = userdb.findUserByUsername(String(username))
    if (!user) return res.status(401).json({ error: 'Usuário inválido' })
    const entry = otpStore.get(String(user.username)) || null
    if (!entry) return res.status(400).json({ error: 'OTP não encontrado' })
    if (Date.now() > Number(entry.expiresAt || 0)) return res.status(400).json({ error: 'OTP expirado' })
    if (String(entry.otp) !== String(otp)) {
      entry.tries = Number(entry.tries || 0) + 1
      otpStore.set(String(user.username), entry)
      return res.status(401).json({ error: 'OTP inválido' })
    }
    otpStore.delete(String(user.username))
    const secret = process.env.JWT_SECRET || 'change_me'
    const token = jwt.sign({ id: Number(user.id), username: user.username, role: user.role }, secret, { expiresIn: '24h' })
    const isHttps = Boolean(req.secure || (req.protocol === 'https'))
    res.cookie('auth_token', token, { httpOnly: true, secure: isHttps, sameSite: 'strict', path: '/' })
    return res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, expires_at: user.expires_at || null, credits: Number(user.credits || 0), instance_name: user.instance_name || null } })
  } catch (e) {
    return res.status(500).json({ error: 'Falha na verificação' })
  }
}

async function adminNotify(req, res) {
  try {
    const { username } = req.body || {}
    if (!username) return res.status(400).json({ error: 'Informe username' })
    const user = userdb.findUserByUsername(String(username))
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || ''
    if (!adminChatId) return res.status(400).json({ error: 'Admin chatId ausente' })
    const msgCount = Number(user.message_count || 0)
    await send(adminChatId, `Login: ${user.username}\nMensagens: ${msgCount}\nLocal: ${user.country || ''} - ${user.city || ''}`)
    return res.json({ success: true })
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao notificar' })
  }
}

module.exports = { login, verifyOtp, adminNotify }