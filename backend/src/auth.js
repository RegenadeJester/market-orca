import crypto from 'node:crypto'
import { db } from './db.js'

export const TEST_ACCOUNTS = [
  { email: 'admin@example.test', password: 'admin12345', role: 'admin', name: 'Admin Test' },
  { email: 'user@example.test', password: 'user12345', role: 'user', name: 'User Test' },
]

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex')
}

export function seedTestAccounts() {
  const stmt = db.prepare(`INSERT INTO users (email,password_hash,role,name,created_at)
    VALUES (@email,@password_hash,@role,@name,datetime('now'))
    ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, name=excluded.name`)
  for (const a of TEST_ACCOUNTS) stmt.run({ ...a, password_hash: hashPassword(a.password) })
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashPassword(token)
  db.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,datetime('now','+7 days'),datetime('now'))`).run(tokenHash, userId)
  return token
}

export function getUserFromReq(req) {
  const auth = String(req.headers.authorization || '')
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const cookie = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('mo_session='))?.split('=')[1]
  const token = bearer || cookie
  if (!token) return null
  const row = db.prepare(`SELECT u.id,u.email,u.role,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > datetime('now')`).get(hashPassword(token))
  return row || null
}

export function requireUser(req, res) {
  const user = getUserFromReq(req)
  if (!user) {
    res.status(401).json({ ok:false, error:'login_required' })
    return null
  }
  return user
}
