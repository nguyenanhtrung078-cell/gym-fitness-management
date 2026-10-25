const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const port = Number(process.env.PORT || 3000);
const startedAt = Date.now();
const httpMetrics = new Map();
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'gym_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gym_fitness',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 20000
});

app.use(express.json());
app.use((req, res, next) => {
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    if (req.path === '/metrics') return;

    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path;
    const key = `${req.method}|${route}|${res.statusCode}`;
    const previous = httpMetrics.get(key) || { count: 0, duration: 0 };
    previous.count += 1;
    previous.duration += Number(process.hrtime.bigint() - started) / 1e9;
    httpMetrics.set(key, previous);
  });

  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const authSecret = process.env.AUTH_SECRET || 'development-only-change-me';
const otpSecret = process.env.OTP_SECRET || authSecret;
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
const mailer = smtpConfigured ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }) : null;
const otpHash = (email, code) => crypto.createHmac('sha256', otpSecret).update(`${email}:${code}`).digest('hex');
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
};
const encode = (value) => Buffer.from(value).toString('base64url');
const signToken = (user) => {
  const payload = encode(JSON.stringify({ id: user.id, email: user.email, role: user.role, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};
const readToken = (token) => {
  try {
    const [payload, signature] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return user.exp > Date.now() ? user : null;
  } catch { return null; }
};

const initializeAuth = async () => {
  // ── 1. Tạo các bảng auth (idempotent) ──────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    member_id INT UNSIGNED NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS login_otps (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_otp_user (user_id),
    CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS registration_otps (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(120) NOT NULL UNIQUE,
    payload JSON NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Core tables are also ensured here so authentication can recover safely
  // if an earlier database initialization was interrupted.
  await pool.query(`CREATE TABLE IF NOT EXISTS trainers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    specialty VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(120) UNIQUE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS plans (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    duration_months INT UNSIGNED NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    description VARCHAR(255)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS member_preferences (
    member_id INT UNSIGNED PRIMARY KEY,
    trainer_id INT UNSIGNED NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_preference_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    CONSTRAINT fk_preference_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE SET NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // ── 2. Seed trainers (dùng INSERT IGNORE thay vì SELECT...WHERE NOT EXISTS
  //        vì MySQL không hỗ trợ SELECT literals không có FROM) ───────────────
  const starterTrainers = [
    ['Lê Hoàng Nam',   'Giảm mỡ và sức bền',  '0901000003', 'nam@gym.local'],
    ['Phạm Thảo Vy',   'Pilates và dáng vóc',  '0901000004', 'vy@gym.local'],
    ['Đỗ Gia Linh',    'Dinh dưỡng thể hình',  '0901000005', 'linh@gym.local'],
    ['Võ Thành Long',  'Boxing và thể lực',     '0901000006', 'long@gym.local']
  ];
  for (const [full_name, specialty, phone, email] of starterTrainers) {
    await pool.execute(
      'INSERT INTO trainers (full_name, specialty, phone, email) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE specialty = VALUES(specialty)',
      [full_name, specialty, phone, email]
    );
  }

  // ── 3. Seed plans ───────────────────────────────────────────────────────────
  const starterPlans = [
    ['Combo Khởi động',          1, 450000,   'Tập tự do, 1 buổi định hướng cùng huấn luyện viên'],
    ['Combo Tăng cơ 12 tuần',    3, 1350000,  'Tập tự do, 6 buổi PT và theo dõi chỉ số cơ thể'],
    ['Combo Yoga cân bằng',      3, 1100000,  '12 lớp Yoga, tư vấn phục hồi và hướng dẫn giãn cơ'],
    ['Combo Toàn diện 6 tháng',  6, 2400000,  'Tập tự do, 12 buổi PT và tư vấn dinh dưỡng']
  ];
  for (const [name, duration_months, price, description] of starterPlans) {
    await pool.execute(
      'INSERT INTO plans (name, duration_months, price, description) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE price = VALUES(price)',
      [name, duration_months, price, description]
    );
  }

  // ── 4. Tạo tài khoản admin từ biến môi trường ───────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@gym.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminGym_2026!';
  const [adminRows] = await pool.execute('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!adminRows.length) {
    await pool.execute(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Quản trị viên', adminEmail, hashPassword(adminPassword), 'admin']
    );
    console.log(`[auth] Admin account created: ${adminEmail}`);
  }

  // ── 5. Đồng bộ hội viên → users (mật khẩu mặc định: 123456) ────────────────
  const [allMembers] = await pool.query('SELECT id, full_name, email FROM members WHERE email IS NOT NULL');
  for (const m of allMembers) {
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [m.email]);
    if (!existing.length) {
      await pool.execute(
        'INSERT INTO users (member_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [m.id, m.full_name, m.email, hashPassword('123456'), 'member']
      );
    } else {
      await pool.execute(
        'UPDATE users SET member_id = ? WHERE id = ? AND member_id IS NULL',
        [m.id, existing[0].id]
      );
    }
  }
  console.log('[auth] initializeAuth completed successfully.');
};
// authReady resolves to true on success, or rejects (propagates error) on failure.
// We store the rejection so that routes can detect init failure and return 503.
let authInitError = null;
const authReady = initializeAuth().catch((error) => {
  authInitError = error;
  console.error('Cannot initialize authentication:', error.message || error);
});
const currentUser = (req) => readToken(req.headers.authorization?.replace(/^Bearer\s+/i, ''));
const requireAdmin = async (req, res, next) => {
  await authReady;
  if (authInitError) return res.status(503).json({ error: 'Hệ thống đang khởi động, vui lòng thử lại sau.' });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Chỉ quản trị viên được phép thao tác.' });
  req.user = user;
  next();
};
const requireUser = async (req, res, next) => {
  await authReady;
  if (authInitError) return res.status(503).json({ error: 'Hệ thống đang khởi động, vui lòng thử lại sau.' });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
  req.user = user;
  next();
};

app.get('/api/public/plans', async (_req, res, next) => {
  try {
    const [plans] = await pool.query('SELECT id, name, duration_months, price, description FROM plans ORDER BY price');
    res.json(plans);
  } catch (error) { next(error); }
});

app.post('/api/auth/register', async (req, res, next) => {
  await authReady;
  const { full_name, email, phone, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!full_name || !normalizedEmail || !phone || !password || String(password).length < 6) return res.status(400).json({ error: 'Vui lòng nhập đủ thông tin và đặt mật khẩu từ 6 ký tự.' });
  try {
    const [duplicate] = await pool.execute('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (duplicate.length) return res.status(409).json({ error: 'Email này đã có tài khoản. Hãy đăng nhập.' });
    const code = String(crypto.randomInt(100000, 1000000));
    const payload = JSON.stringify({ full_name, email: normalizedEmail, phone, password_hash: hashPassword(password) });
    await pool.execute(`INSERT INTO registration_otps (email, payload, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
      ON DUPLICATE KEY UPDATE payload = VALUES(payload), code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0`, [normalizedEmail, payload, otpHash(normalizedEmail, code)]);
    if (process.env.OTP_DELIVERY === 'demo') {
      console.log(`Demo registration OTP for ${normalizedEmail}: ${code}`);
      return res.status(202).json({ message: 'Mã xác thực demo đã được tạo. Nhập mã bên dưới để hoàn tất đăng ký.', demo_code: code });
    }
    if (!mailer) return res.status(503).json({ error: 'Chức năng email chưa được cấu hình. Hãy thêm SMTP vào file .env hoặc bật OTP_DELIVERY=demo.' });
    await mailer.sendMail({ from: process.env.SMTP_FROM, to: normalizedEmail, subject: 'Xác thực đăng ký GymFit', text: `Mã xác thực đăng ký GymFit của bạn là: ${code}. Mã có hiệu lực trong 10 phút.` });
    res.status(202).json({ message: 'Mã xác thực đã được gửi. Hãy kiểm tra email để hoàn tất đăng ký.' });
  } catch (error) {
    if (error.code === 'EAUTH') return res.status(502).json({ error: 'Không gửi được email. Kiểm tra lại SMTP_PASSWORD (Gmail App Password) trong file .env.' });
    next(error);
  }
});

app.post('/api/auth/verify-registration', async (req, res, next) => {
  await authReady;
  const email = String(req.body.email || '').trim().toLowerCase(), code = String(req.body.code || '');
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Nhập email và mã gồm 6 chữ số.' });
  const connection = await pool.getConnection();
  try {
    const [records] = await connection.execute('SELECT * FROM registration_otps WHERE email = ? AND expires_at > NOW() LIMIT 1', [email]);
    const record = records[0];
    if (!record || record.attempts >= 5 || record.code_hash !== otpHash(email, code)) {
      if (record) await connection.execute('UPDATE registration_otps SET attempts = attempts + 1 WHERE id = ?', [record.id]);
      return res.status(401).json({ error: 'Mã xác thực không đúng hoặc đã hết hạn.' });
    }
    const data = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
    await connection.beginTransaction();
    const [member] = await connection.execute('INSERT INTO members (full_name, phone, email, registered_at, status) VALUES (?, ?, ?, CURDATE(), ?)', [data.full_name, data.phone, data.email, 'active']);
    const [user] = await connection.execute('INSERT INTO users (member_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [member.insertId, data.full_name, data.email, data.password_hash, 'member']);
    await connection.execute('DELETE FROM registration_otps WHERE id = ?', [record.id]);
    await connection.commit();
    const account = { id: user.insertId, full_name: data.full_name, email: data.email, role: 'member' };
    res.status(201).json({ token: signToken(account), user: account });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email hoặc số điện thoại đã được sử dụng.' });
    next(error);
  } finally { connection.release(); }
});

app.post('/api/auth/login', async (req, res, next) => {
  await authReady;
  // If auth tables failed to initialize, return a clear 503 instead of a cryptic DB error
  if (authInitError) {
    console.error('[login] Auth init failed:', authInitError.message);
    return res.status(503).json({ error: 'Hệ thống đang khởi động hoặc gặp sự cố kết nối CSDL. Vui lòng thử lại sau vài giây.' });
  }
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?',
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
    }
    const account = { id: user.id, full_name: user.full_name, email: user.email, role: user.role };
    res.json({ token: signToken(account), user: account });
  } catch (error) {
    console.error('[login] DB error:', error.message);
    // Return a descriptive message instead of the generic "Database operation failed"
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ error: 'CSDL chưa sẵn sàng (bảng users chưa tồn tại). Vui lòng đợi container khởi động xong rồi thử lại.' });
    }
    next(error);
  }
});

app.post('/api/auth/request-otp', async (req, res, next) => {
  await authReady;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Vui lòng nhập email.' });
  if (!mailer) return res.status(503).json({ error: 'Chức năng email chưa được cấu hình. Hãy thêm SMTP vào file .env.' });
  try {
    const [rows] = await pool.execute('SELECT id, full_name, email FROM users WHERE email = ?', [email]);
    if (!rows.length) return res.json({ message: 'Nếu email tồn tại, mã xác nhận đã được gửi.' });
    const account = rows[0], code = String(crypto.randomInt(100000, 1000000));
    await pool.execute('DELETE FROM login_otps WHERE user_id = ?', [account.id]);
    await pool.execute('INSERT INTO login_otps (user_id, code_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [account.id, otpHash(email, code)]);
    await mailer.sendMail({ from: process.env.SMTP_FROM, to: account.email, subject: 'Mã đăng nhập GymFit', text: `Xin chào ${account.full_name}, mã đăng nhập GymFit của bạn là: ${code}. Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.` });
    res.json({ message: 'Mã xác nhận đã được gửi. Kiểm tra hộp thư email của bạn.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/verify-otp', async (req, res, next) => {
  await authReady;
  const email = String(req.body.email || '').trim().toLowerCase(), code = String(req.body.code || '');
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Nhập email và mã gồm 6 chữ số.' });
  try {
    const [rows] = await pool.execute(`SELECT u.id, u.full_name, u.email, u.role, o.id AS otp_id, o.code_hash, o.attempts
      FROM users u JOIN login_otps o ON o.user_id = u.id WHERE u.email = ? AND o.expires_at > NOW() ORDER BY o.id DESC LIMIT 1`, [email]);
    const row = rows[0];
    if (!row || row.attempts >= 5 || row.code_hash !== otpHash(email, code)) {
      if (row) await pool.execute('UPDATE login_otps SET attempts = attempts + 1 WHERE id = ?', [row.otp_id]);
      return res.status(401).json({ error: 'Mã xác nhận không đúng hoặc đã hết hạn.' });
    }
    await pool.execute('DELETE FROM login_otps WHERE user_id = ?', [row.id]);
    const account = { id: row.id, full_name: row.full_name, email: row.email, role: row.role };
    res.json({ token: signToken(account), user: account });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
  res.json({ user });
});

app.get('/api/member/catalog', requireUser, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return res.status(403).json({ error: 'Chức năng này dành cho hội viên.' });
    const [plans] = await pool.query('SELECT id, name, duration_months, price, description FROM plans ORDER BY price');
    const [trainers] = await pool.query('SELECT id, full_name, specialty FROM trainers ORDER BY full_name');
    const [current] = await pool.execute(`SELECT mp.plan_id, pref.trainer_id FROM users u
      LEFT JOIN member_plans mp ON mp.member_id = u.member_id
      LEFT JOIN member_preferences pref ON pref.member_id = u.member_id
      WHERE u.id = ? ORDER BY mp.id DESC LIMIT 1`, [req.user.id]);
    res.json({ plans, trainers, selection: current[0] || {} });
  } catch (error) { next(error); }
});

app.post('/api/member/selection', requireUser, async (req, res, next) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Chức năng này dành cho hội viên.' });
  const { plan_id, trainer_id } = req.body;
  const connection = await pool.getConnection();
  try {
    const [accounts] = await connection.execute('SELECT member_id FROM users WHERE id = ?', [req.user.id]);
    const memberId = accounts[0]?.member_id;
    const [plans] = await connection.execute('SELECT id, duration_months FROM plans WHERE id = ?', [plan_id]);
    const [trainers] = await connection.execute('SELECT id FROM trainers WHERE id = ?', [trainer_id]);
    if (!memberId || !plans.length || !trainers.length) return res.status(400).json({ error: 'Gói tập hoặc huấn luyện viên không hợp lệ.' });
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM member_plans WHERE member_id = ? ORDER BY id DESC LIMIT 1', [memberId]);
    if (existing.length) await connection.execute('UPDATE member_plans SET plan_id = ?, starts_at = CURDATE(), expires_at = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE id = ?', [plan_id, plans[0].duration_months, existing[0].id]);
    else await connection.execute('INSERT INTO member_plans (member_id, plan_id, starts_at, expires_at) VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? MONTH))', [memberId, plan_id, plans[0].duration_months]);
    await connection.execute('INSERT INTO member_preferences (member_id, trainer_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE trainer_id = VALUES(trainer_id)', [memberId, trainer_id]);
    await connection.commit();
    res.json({ message: 'Đã lưu gói tập và huấn luyện viên của bạn.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

app.get('/api/member/community', requireUser, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return res.status(403).json({ error: 'Chức năng này dành cho hội viên.' });
    const [accounts] = await pool.execute('SELECT member_id FROM users WHERE id = ?', [req.user.id]);
    const ownMemberId = accounts[0]?.member_id || 0;
    const [totals] = await pool.query(`SELECT
      SUM(status = 'active') AS active_count,
      SUM(status = 'Tạm ngưng') AS inactive_count
      FROM members`);
    const [members] = await pool.execute(`SELECT full_name,
      DATE_FORMAT(registered_at, '%d/%m/%Y') AS registered_at
      FROM members WHERE status = 'active' AND id <> ?
      ORDER BY registered_at DESC, full_name ASC`, [ownMemberId]);
    res.json({
      active_count: Number(totals[0].active_count || 0),
      inactive_count: Number(totals[0].inactive_count || 0),
      members
    });
  } catch (error) { next(error); }
});

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch (_error) { res.status(503).json({ status: 'database unavailable' }); }
});

function prometheusLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

app.get('/metrics', (_req, res) => {
  const lines = [
    '# HELP gym_app_uptime_seconds Seconds since the Gym Fitness app started.',
    '# TYPE gym_app_uptime_seconds gauge',
    `gym_app_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    '# HELP gym_http_requests_total Total HTTP requests processed by the Gym Fitness app.',
    '# TYPE gym_http_requests_total counter',
    '# HELP gym_http_request_duration_seconds Total request duration in seconds.',
    '# TYPE gym_http_request_duration_seconds summary'
  ];

  for (const [key, metric] of httpMetrics) {
    const [method, route, status] = key.split('|');
    const labels = `method="${prometheusLabel(method)}",route="${prometheusLabel(route)}",status="${prometheusLabel(status)}"`;
    lines.push(`gym_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`gym_http_request_duration_seconds_sum{${labels}} ${metric.duration}`);
    lines.push(`gym_http_request_duration_seconds_count{${labels}} ${metric.count}`);
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(`${lines.join('\n')}\n`);
});

const resources = {
  members: {
    columns: ['full_name', 'phone', 'email', 'registered_at', 'status'],
    select: 'id, full_name, phone, email, DATE_FORMAT(registered_at, "%Y-%m-%d") AS registered_at, status'
  },
  plans: { columns: ['name', 'duration_months', 'price', 'description'], select: 'id, name, duration_months, price, description' },
  trainers: { columns: ['full_name', 'specialty', 'phone', 'email'], select: 'id, full_name, specialty, phone, email' },
  schedules: {
    columns: ['class_name', 'starts_at', 'trainer_id', 'max_capacity'],
    select: 's.id, s.class_name, DATE_FORMAT(s.starts_at, "%Y-%m-%d %H:%i") AS starts_at, s.trainer_id, s.max_capacity, t.full_name AS trainer_name',
    join: ' LEFT JOIN trainers t ON t.id = s.trainer_id'
  },
  member_plans: {
    table: 'member_plans mp',
    columns: ['member_id', 'plan_id', 'starts_at', 'expires_at'],
    select: 'mp.id, mp.member_id, m.full_name AS member_name, mp.plan_id, p.name AS plan_name, DATE_FORMAT(mp.starts_at, "%Y-%m-%d") AS starts_at, DATE_FORMAT(mp.expires_at, "%Y-%m-%d") AS expires_at',
    join: ' LEFT JOIN members m ON m.id = mp.member_id LEFT JOIN plans p ON p.id = mp.plan_id',
    orderBy: 'mp.id DESC'
  }
};

function resourceOr404(name, res) {
  const resource = resources[name];
  if (!resource) { res.status(404).json({ error: 'Unknown resource' }); return null; }
  return resource;
}

app.get('/api/:resource', requireAdmin, async (req, res, next) => {
  const resource = resourceOr404(req.params.resource, res); if (!resource) return;
  const fromTable = resource.table || req.params.resource;
  const orderClause = resource.orderBy ? `ORDER BY ${resource.orderBy}` : `ORDER BY ${req.params.resource}.id DESC`;
  try {
    const [rows] = await pool.query(`SELECT ${resource.select} FROM ${fromTable}${resource.join || ''} ${orderClause}`);
    res.json(rows);
  } catch (error) { next(error); }
});

app.post('/api/:resource', requireAdmin, async (req, res, next) => {
  const resource = resourceOr404(req.params.resource, res); if (!resource) return;
  const values = resource.columns.map((column) => req.body[column] ?? null);
  try {
    const [result] = await pool.execute(`INSERT INTO ${req.params.resource} (${resource.columns.join(', ')}) VALUES (${resource.columns.map(() => '?').join(', ')})`, values);
    if (req.params.resource === 'members' && req.body.email) {
      try {
        await pool.execute('INSERT INTO users (member_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
          [result.insertId, req.body.full_name, req.body.email, hashPassword('123456'), 'member']);
      } catch (e) { /* ignore duplicate */ }
    }
    res.status(201).json({ id: result.insertId });
  } catch (error) { next(error); }
});

app.put('/api/:resource/:id', requireAdmin, async (req, res, next) => {
  const resource = resourceOr404(req.params.resource, res); if (!resource) return;
  const values = resource.columns.map((column) => req.body[column] ?? null);
  try {
    const [result] = await pool.execute(`UPDATE ${req.params.resource} SET ${resource.columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`, [...values, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.json({ updated: true });
  } catch (error) { next(error); }
});

app.delete('/api/:resource/:id', requireAdmin, async (req, res, next) => {
  if (!resourceOr404(req.params.resource, res)) return;
  try {
    const [result] = await pool.execute(`DELETE FROM ${req.params.resource} WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error) { next(error); }
});

// Route điều hướng trang cho Admin và Member trên cùng 1 server
app.get(['/', '/admin', '/member', '/dashboard'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[unhandled]', error.code || '', error.message || error);
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return res.status(503).json({ error: 'CSDL chưa sẵn sàng. Vui lòng đợi và thử lại.' });
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
    return res.status(503).json({ error: 'Không thể kết nối CSDL. Vui lòng thử lại sau.' });
  }
  res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại.' });
});

app.listen(port, () => console.log(`Gym Fitness app listening on ${port}`));

