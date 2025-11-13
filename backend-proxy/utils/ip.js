const axios = require('axios')
async function geoByIp(ip) {
  try {
    const url = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/'
    const r = await axios.get(url, { timeout: 5000 })
    return { country: r.data.country_name || '', city: r.data.city || '' }
  } catch (_) {
    return { country: '', city: '' }
  }
}
module.exports = { geoByIp }