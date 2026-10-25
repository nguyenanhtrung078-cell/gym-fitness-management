SET NAMES utf8mb4;
USE gym_fitness;

ALTER TABLE members
  MODIFY status ENUM('active', 'Tạm ngưng') NOT NULL DEFAULT 'active';

UPDATE members SET full_name = 'Lê Thu Hà' WHERE phone = '0902000001';
UPDATE members SET full_name = 'Phạm Gia Bảo' WHERE phone = '0902000002';

UPDATE trainers
  SET full_name = 'Nguyễn Minh Anh', specialty = 'Fitness và tăng cơ'
  WHERE phone = '0901000001';
UPDATE trainers
  SET full_name = 'Trần Quốc Huy', specialty = 'Yoga và phục hồi'
  WHERE phone = '0901000002';

UPDATE plans SET name = 'Gói Cơ bản', description = 'Tập tự do' WHERE id = 1;
UPDATE plans SET name = 'Gói Premium', description = 'Tập tự do và 4 buổi PT' WHERE id = 2;
UPDATE schedules SET class_name = 'Yoga buổi sáng' WHERE id = 1;
