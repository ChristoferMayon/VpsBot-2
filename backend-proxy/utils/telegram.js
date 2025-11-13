const TelegramBot = require('node-telegram-bot-api')
const axios = require('axios')
let bot
function getBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  if (!bot) bot = new TelegramBot(token, { polling: false })
  return bot
}
function start() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  if (!bot) bot = new TelegramBot(token, { polling: true })
  try {
    bot.onText(/\/(start|id|chatid)/i, (msg) => {
      const chatId = msg.chat && msg.chat.id ? String(msg.chat.id) : ''
      const name = msg.chat && (msg.chat.username || msg.chat.title || msg.chat.first_name) ? String(msg.chat.username || msg.chat.title || msg.chat.first_name) : ''
      const text = `Seu chat ID: ${chatId}`
      bot.sendMessage(msg.chat.id, text)
      const admin = process.env.TELEGRAM_ADMIN_CHAT_ID || ''
      if (admin) {
        const info = name ? ` (${name})` : ''
        bot.sendMessage(admin, `Novo chat ID recebido: ${chatId}${info}`)
      }
    })
    bot.on('message', (msg) => {
      if (!msg.text || /\/(start|id|chatid)/i.test(msg.text)) return
      const chatId = msg.chat && msg.chat.id ? String(msg.chat.id) : ''
      if (chatId) bot.sendMessage(msg.chat.id, `Seu chat ID: ${chatId}`)
    })
  } catch (_) {}
  return bot
}
async function send(chatId, text) {
  const b = getBot()
  if (b) return b.sendMessage(chatId, text)
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  return axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text })
}
module.exports = { send, start }