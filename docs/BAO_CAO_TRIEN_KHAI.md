# BÁO CÁO TRIỂN KHAI HỆ THỐNG GYM FITNESS

## 1. Thông tin đề tài

**Tên đề tài:** Xây dựng website quản lý Gym Fitness kết hợp Docker Compose, giám sát Prometheus Grafana, log tập trung Loki Promtail và hardening cơ bản.

**Mục tiêu:** Triển khai một hệ thống quản lý hội viên, gói tập, huấn luyện viên và lịch tập theo mô hình nhiều container. Hệ thống phải chạy được bằng một lệnh Docker Compose, có dữ liệu MySQL mẫu, có giám sát tập trung, có log tập trung và áp dụng các biện pháp bảo mật cơ bản.

**Kết luận triển khai:** Hệ thống đã đáp ứng các thành phần kỹ thuật chính của đề tài. Website đi qua Nginx, dữ liệu lưu trong MySQL, Prometheus thu được metrics từ app, MySQL và container; Grafana có dashboard được provision sẵn; Loki nhận log từ Promtail. Các kiểm thử cuối cùng xác nhận toàn bộ target Prometheus ở trạng thái UP.

\newpage

## 2. Kiến trúc hệ thống

Hệ thống dùng Docker Compose để điều phối các service sau:

| Thành phần | Chức năng | Cổng public |
| --- | --- | --- |
| Nginx | Cổng truy cập duy nhất của website, reverse proxy đến app | 80 |
| App Express | API, giao diện web, đăng nhập và endpoint metrics | Không publish |
| MySQL 8.4 | Cơ sở dữ liệu nghiệp vụ | Không publish |
| phpMyAdmin | Kiểm tra cơ sở dữ liệu khi demo | 8081 |
| Prometheus | Thu thập metrics | 9090 |
| Grafana | Dashboard và Explore logs | 3000 |
| cAdvisor | CPU, RAM, network của container | Không publish |
| mysqld exporter | Metrics MySQL | Không publish |
| Loki và Promtail | Lưu trữ và thu thập log Docker | Không publish |

Luồng truy cập chính là: người dùng → Nginx → App Express → MySQL. Luồng giám sát là Prometheus thu thập từ app, cAdvisor và mysqld exporter; Grafana hiển thị dữ liệu Prometheus. Luồng log là Docker container → Promtail → Loki → Grafana Explore.

**Hình 1.** Chèn ảnh lệnh `docker compose ps` hiển thị toàn bộ container đang Up.

\newpage

## 3. Chức năng website

Website có giao diện Gym Fitness, ảnh nền thể thao, các khu vực chức năng rõ ràng và tương thích với vai trò quản trị viên hoặc hội viên.

Các chức năng chính:

1. Đăng ký tài khoản hội viên qua email và mã OTP demo/email.
2. Đăng nhập, đăng xuất và lưu phiên đăng nhập bằng token.
3. Quản trị viên CRUD hội viên, gói tập, huấn luyện viên và lịch tập.
4. Hội viên xem danh mục gói tập, lựa chọn gói tập và chọn huấn luyện viên.
5. Hiển thị lịch tập, trạng thái thành viên và dữ liệu đã tạo từ MySQL.
6. Endpoint `/health` kiểm tra khả dụng của app và database.
7. Endpoint `/metrics` theo định dạng Prometheus để theo dõi uptime, số request và thời lượng request.

**Hình 2.** Chèn ảnh trang đăng nhập hoặc đăng ký.

**Hình 3.** Chèn ảnh giao diện quản trị sau khi đăng nhập.

\newpage

## 4. Cơ sở dữ liệu MySQL

Script `mysql/init/01-schema.sql` tự tạo database `gym_fitness` trong lần khởi động đầu tiên. Các bảng nghiệp vụ chính gồm `members`, `plans`, `trainers`, `schedules` và `member_plans`. Ngoài ra hệ thống có bảng `users`, `login_otps`, `registration_otps` và `member_preferences` để hỗ trợ tài khoản và chức năng hội viên.

Dữ liệu mẫu được tạo cho hội viên, gói tập, huấn luyện viên, lịch tập và đăng ký gói. Khóa ngoại được đặt đúng thứ tự để MySQL có thể khởi tạo từ volume trống. Kiểm thử với container MySQL độc lập xác nhận tạo được đầy đủ bảng và dữ liệu mẫu: 9 hội viên, 6 gói tập, 6 huấn luyện viên, 4 lịch tập và 5 đăng ký gói.

MySQL lưu dữ liệu bằng named volume `mysql_data`, do đó dữ liệu vẫn giữ sau `docker compose down`. Không dùng `docker compose down -v` nếu không muốn xóa toàn bộ dữ liệu.

**Hình 4.** Chèn ảnh phpMyAdmin hiển thị các bảng và dữ liệu mẫu.

\newpage

## 5. Reverse proxy và healthcheck

Nginx là service duy nhất mở cổng website ra host. Nó chuyển tiếp request đến `app:3000` trong Docker network, vì vậy cổng app không bị lộ trực tiếp.

Hai healthcheck quan trọng được cấu hình:

- MySQL dùng `mysqladmin ping` để xác định database đã sẵn sàng.
- App gọi `/health`; endpoint này chạy truy vấn `SELECT 1` để xác nhận kết nối MySQL.

Nginx chỉ khởi động sau khi app ở trạng thái healthy. Khi kiểm thử, request `http://localhost/health` trả về HTTP 200 với nội dung `{"status":"ok"}`.

Các header an toàn tại Nginx gồm `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP và `Permissions-Policy`.

**Hình 5.** Chèn ảnh kiểm tra header bằng DevTools hoặc `Invoke-WebRequest`.

\newpage

## 6. Giám sát Prometheus và Grafana

Prometheus được cấu hình để scrape bốn job: `prometheus`, `cadvisor`, `gym-app` và `mysql`.

- `gym-app` thu thập uptime, tổng request và thời lượng request từ `/metrics`.
- `cadvisor` thu thập CPU, RAM và network của các container.
- `mysql` thu thập kết nối và trạng thái MySQL qua mysqld exporter.
- `prometheus` theo dõi chính Prometheus.

Kết quả kiểm thử cuối: cả bốn target đều **UP**. Grafana tự tạo hai datasource Prometheus/Loki và dashboard `Gym Fitness Overview` từ các tệp JSON trong repository.

Dashboard có các panel: trạng thái target, CPU container, bộ nhớ container, request rate của app, số kết nối MySQL và trạng thái exporter MySQL.

**Hình 6.** Chèn ảnh trang Prometheus Targets với toàn bộ target UP.

**Hình 7.** Chèn ảnh dashboard Grafana Gym Fitness Overview.

\newpage

## 7. Logging tập trung với Loki Promtail

Promtail kết nối Docker socket ở chế độ chỉ đọc, tự phát hiện container và gắn các nhãn `compose_service`, `container` và `stream`. Log được gửi sang Loki bằng network nội bộ. Grafana dùng datasource Loki để xem log và lọc bằng LogQL.

Các truy vấn dùng khi demo:

```logql
{compose_service="app"}
{compose_service="nginx"}
count_over_time({compose_service="app"}[5m])
```

Kiểm thử đã xác nhận Loki ở trạng thái ready và có stream/entry cho cả `app` lẫn `nginx`. Nhờ đó có thể kiểm tra request, lỗi ứng dụng và hoạt động của reverse proxy ở một giao diện tập trung.

**Hình 8.** Chèn ảnh Grafana Explore với truy vấn log của app.

**Hình 9.** Chèn ảnh Grafana Explore với truy vấn log của Nginx.

\newpage

## 8. Hardening cơ bản

Các biện pháp bảo mật đã áp dụng:

| Biện pháp | Cách thực hiện |
| --- | --- |
| Không chạy app bằng root | Dockerfile tạo user `appuser` và chạy Node.js bằng user này |
| Không public MySQL | Service `db` không có khai báo `ports` |
| Network nội bộ | `internal-net` dùng `internal: true`; MySQL, Loki và exporter không lộ ra host |
| Tách secret | `.env` được ignore; chỉ `.env.example` được commit |
| Giảm đặc quyền | App, Nginx và mysqld exporter dùng `no-new-privileges:true` |
| HTTP security headers | Nginx thêm nosniff, frame policy, referrer policy, CSP và permissions policy |

Để chạy ở môi trường mới, người dùng phải sao chép `.env.example` thành `.env` và thay toàn bộ mật khẩu/secret mẫu bằng giá trị riêng.

**Hình 10.** Chèn ảnh `docker compose ps` chứng minh MySQL không mở cổng 3306.

\newpage

## 9. Kiểm thử và cách chạy

### Khởi động hệ thống

```powershell
Copy-Item .env.example .env
# Chỉnh toàn bộ password và secret trong .env
docker compose up -d --build
docker compose ps
```

### Kiểm tra nhanh

```powershell
Invoke-WebRequest http://localhost/health -UseBasicParsing
Invoke-WebRequest http://localhost/metrics -UseBasicParsing
```

Các URL demo:

- Website: `http://localhost`
- phpMyAdmin: `http://localhost:8081`
- Prometheus Targets: `http://localhost:9090/targets`
- Grafana: `http://localhost:3000`

Các kiểm thử đã đạt: kiểm tra cú pháp Node.js, kiểm tra JSON dashboard, kiểm tra Docker Compose config, khởi động stack, HTTP healthcheck, endpoint metrics, target Prometheus, Grafana health, truy vấn Loki và khởi tạo schema MySQL trên database trống.

\newpage

## 10. Mã nguồn và kết luận

Repository cục bộ đã được khởi tạo với các commit có ý nghĩa:

1. `feat: add gym fitness application and database schema`
2. `feat: add secure observability stack`
3. `docs: add deployment and verification guide`
4. `fix: order schema foreign keys for fresh database setup`

Để hoàn tất yêu cầu nộp GitHub, tạo repository trống trên GitHub, sau đó chạy:

```powershell
git remote add origin https://github.com/<tai-khoan>/<ten-repository>.git
git push -u origin main
```

Kết luận: hệ thống đã có website quản lý Gym Fitness, database MySQL với dữ liệu mẫu, reverse proxy, giám sát metrics, dashboard, log tập trung và hardening cơ bản. Các thành phần kỹ thuật cốt lõi đã được kiểm chứng chạy thành công trong Docker Compose.
