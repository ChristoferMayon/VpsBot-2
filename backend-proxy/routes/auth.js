const express = require('express')
const router = express.Router()
const { login, verifyOtp, adminNotify } = require('../controllers/authController')
const { requireAuth, requireAdmin } = require('../middleware/jwt')

router.post('/login', login)
router.post('/verify-otp', verifyOtp)
router.post('/admin/notify', requireAuth, requireAdmin, adminNotify)

module.exports = router