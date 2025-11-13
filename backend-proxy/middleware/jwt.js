const jwt = require('jsonwebtoken')
function requireAuth(req, res, next) {
  try {
    const auth = req.headers['authorization'] || ''
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente' })
    const token = auth.slice(7)
    const secret = process.env.JWT_SECRET || 'change_me'
    const payload = jwt.verify(token, secret)
    req.user = payload
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' })
  }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' })
  next()
}
module.exports = { requireAuth, requireAdmin }