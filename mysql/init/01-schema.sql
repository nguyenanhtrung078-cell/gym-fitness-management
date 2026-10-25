SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS gym_fitness CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gym_fitness;

CREATE TABLE IF NOT EXISTS members (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120) UNIQUE,
  registered_at DATE NOT NULL,
  status ENUM('active','Tạm ngưng') NOT NULL DEFAULT 'active'
);

-- Bảng users: tách biệt auth khỏi bảng members
-- password_hash lưu dạng "salt:hash" (scrypt) do server.js tạo khi init.
-- Với seed data ta lưu plain-text marker '__PLAIN__:123456' –
-- server.js sẽ phát hiện và tự hash lại ở lần đăng nhập đầu tiên.
-- Tuy nhiên cách đơn giản nhất: để server.js tự upsert hash đúng khi initializeAuth chạy.
-- Ở đây ta tạo bảng trước để tránh ER_NO_SUCH_TABLE khi container vừa start.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_id INT UNSIGNED NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','member') NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_otps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_user (user_id),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registration_otps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(120) NOT NULL UNIQUE,
  payload JSON NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  duration_months INT UNSIGNED NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS trainers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  specialty VARCHAR(150) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(120)
);

CREATE TABLE IF NOT EXISTS member_preferences (
  member_id INT UNSIGNED PRIMARY KEY,
  trainer_id INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_preference_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT fk_preference_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_name VARCHAR(100) NOT NULL,
  starts_at DATETIME NOT NULL,
  trainer_id INT UNSIGNED NULL,
  max_capacity INT UNSIGNED NOT NULL,
  CONSTRAINT fk_schedule_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS member_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  member_id INT UNSIGNED NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  starts_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  CONSTRAINT fk_member_plan_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT fk_member_plan_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
);

-- Seed Data: Trainers
INSERT INTO trainers (id, full_name, specialty, phone, email) VALUES
(1, 'Nguyễn Minh Anh', 'Fitness và tăng cơ', '0901000001', 'anh@gym.local'),
(2, 'Trần Quốc Huy', 'Yoga và phục hồi', '0901000002', 'huy@gym.local'),
(3, 'Lê Hoàng Nam', 'Giảm mỡ và sức bền', '0901000003', 'nam@gym.local'),
(4, 'Phạm Thảo Vy', 'Pilates và dáng vóc', '0901000004', 'vy@gym.local'),
(5, 'Đỗ Gia Linh', 'Dinh dưỡng thể hình', '0901000005', 'linh@gym.local'),
(6, 'Võ Thành Long', 'Boxing và thể lực', '0901000006', 'long@gym.local')
ON DUPLICATE KEY UPDATE specialty = VALUES(specialty);

-- Seed Data: Plans
INSERT INTO plans (id, name, duration_months, price, description) VALUES
(1, 'Gói Cơ bản', 1, 350000, 'Tập tự do không giới hạn khung giờ'),
(2, 'Gói Premium', 3, 900000, 'Tập tự do và 4 buổi PT định hướng'),
(3, 'Combo Khởi động', 1, 450000, 'Tập tự do, 1 buổi định hướng cùng huấn luyện viên'),
(4, 'Combo Tăng cơ 12 tuần', 3, 1350000, 'Tập tự do, 6 buổi PT và theo dõi chỉ số cơ thể'),
(5, 'Combo Yoga cân bằng', 3, 1100000, '12 lớp Yoga, tư vấn phục hồi và hướng dẫn giãn cơ'),
(6, 'Combo Toàn diện 6 tháng', 6, 2400000, 'Tập tự do, 12 buổi PT và tư vấn dinh dưỡng')
ON DUPLICATE KEY UPDATE price = VALUES(price);

-- Seed Data: Members
INSERT INTO members (id, full_name, phone, email, registered_at, status) VALUES
(1,  'Nguyen Van An',     '0901234567', 'an@example.com',               '2026-10-01', 'active'),
(2,  'Tran Thi Binh',    '0912345678', 'binh@example.com',             '2026-10-05', 'active'),
(3,  'Le Minh Chau',     '0987654321', 'chau@example.com',             '2026-10-10', 'Tạm ngưng'),
(4,  'Hoang Minh Duc',   '0909998888', 'duc@example.com',              '2026-10-22', 'active'),
(5,  'Nguyễn Anh Trung', '0902000001', 'nguyenanhtrung078@gmail.com',  CURDATE(),    'active'),
(6,  'Bế Văn Hiếu',      '0902000002', 'behieudz@gmail.com',           CURDATE(),    'active'),
(7,  'Lê Thu Hà',        '0902000003', 'ha@example.com',               CURDATE(),    'active'),
(8,  'Phạm Gia Bảo',     '0902000004', 'bao@example.com',              CURDATE(),    'active'),
(9,  'Nguyễn Văn Demo',  '0909000009', 'efootball99989@gmail.com',     CURDATE(),    'active')
ON DUPLICATE KEY UPDATE status = VALUES(status), email = VALUES(email);

-- Seed Data: Schedules
INSERT INTO schedules (id, class_name, starts_at, trainer_id, max_capacity) VALUES
(1, 'Yoga buổi sáng',  DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 7  HOUR, 2, 20),
(2, 'Body Pump',       DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 18 HOUR, 1, 16),
(3, 'Boxing thể lực',  DATE_ADD(CURDATE(), INTERVAL 2 DAY) + INTERVAL 17 HOUR, 6, 15),
(4, 'Pilates tạo dáng',DATE_ADD(CURDATE(), INTERVAL 2 DAY) + INTERVAL 9  HOUR, 4, 12)
ON DUPLICATE KEY UPDATE class_name = VALUES(class_name);

-- Seed Data: Member Plans
INSERT INTO member_plans (id, member_id, plan_id, starts_at, expires_at) VALUES
(1, 1, 1, '2026-10-01', '2026-11-01'),
(2, 2, 2, '2026-10-05', '2027-01-05'),
(3, 4, 4, '2026-10-22', '2027-01-22'),
(4, 5, 5, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 MONTH)),
(5, 6, 6, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 6 MONTH))
ON DUPLICATE KEY UPDATE plan_id = VALUES(plan_id);

-- NOTE: Bảng users KHÔNG seed password ở đây vì password_hash dùng scrypt (salt ngẫu nhiên).
-- server.js / initializeAuth() sẽ tự động:
--   1. Tạo tài khoản admin từ biến môi trường ADMIN_EMAIL / ADMIN_PASSWORD.
--   2. Đồng bộ tất cả hội viên trong bảng members sang bảng users với mật khẩu mặc định '123456'.
-- Các bảng đã được tạo sẵn ở trên để tránh lỗi ER_NO_SUCH_TABLE khi container vừa khởi động.
