const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function hashPassword(password) {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
}

function hashPhone(phone) {
    const normalizedPhone = phone.trim().replace(/[^0-9]/g, '');
    const hashedPhone = crypto.createHash('sha256').update(normalizedPhone).digest('hex');
    return hashedPhone;
}
module.exports = { hashPassword, hashPhone };
