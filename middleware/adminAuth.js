const jwt = require('jsonwebtoken');

function adminAuth(req, res, next) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing Bearer token' });
  }

  const token = header.slice('Bearer '.length).trim();
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ message: 'JWT secret not configured' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = adminAuth;
