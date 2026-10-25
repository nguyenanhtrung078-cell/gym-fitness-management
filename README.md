# Gym Fitness Manager

Hệ thống quản lý phòng Gym Fitness triển khai bằng Docker Compose. Website cung cấp đăng ký, đăng nhập, quản lý hội viên, gói tập, huấn luyện viên, lịch tập và đăng ký gói tập. Hệ thống có Nginx reverse proxy, MySQL/phpMyAdmin, Prometheus/Grafana và Loki/Promtail.

## Thành phần

| Service | Vai trò |
| --- | --- |
| `app` | Express API, website và endpoint `/health`, `/metrics` |
| `db` | MySQL 8.4, lưu dữ liệu trong named volume |
| `nginx` | Cổng truy cập website và reverse proxy đến `app` |
| `phpmyadmin` | Kiểm tra dữ liệu MySQL trong lúc demo |
| `cadvisor` | Thu thập CPU, RAM và network của container |
| `mysqld-exporter` | Xuất metrics MySQL cho Prometheus |
| `prometheus` | Thu thập metrics của Prometheus, cAdvisor, app và MySQL |
| `grafana` | Dashboard và Explore logs; tự provision datasource/dashboard |
| `loki`, `promtail` | Thu thập, lưu trữ và truy vấn log container |

## Yêu cầu

- Docker Desktop đang chạy.
- Git và Visual Studio Code (khuyến nghị).

## Cấu hình lần đầu

Tạo tệp môi trường từ tệp mẫu:

```powershell
Copy-Item .env.example .env
```

Mở `.env` và thay toàn bộ mật khẩu mẫu trước khi chạy. Đặc biệt cần đặt các biến `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `AUTH_SECRET`, `ADMIN_PASSWORD` và `OTP_SECRET` thành giá trị riêng. Tệp `.env` đã được bỏ qua bởi Git và không được đưa lên GitHub.

## Khởi động

```powershell
docker compose up -d --build
docker compose ps
```

Truy cập các dịch vụ:

- Website qua Nginx: http://localhost
- phpMyAdmin: http://localhost:8081
- Prometheus Targets: http://localhost:9090/targets
- Grafana: http://localhost:3000

Đăng nhập quản trị bằng email/mật khẩu khai báo qua `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env`. Lần khởi động đầu tiên ứng dụng tự tạo tài khoản đó. Hội viên có thể đăng ký trên giao diện, nhận mã xác thực và chọn gói tập cùng huấn luyện viên.

## Kiểm tra monitoring và logging

1. Mở Prometheus Targets; các job `prometheus`, `cadvisor`, `gym-app` và `mysql` phải ở trạng thái **UP**.
2. Mở Grafana; datasource Prometheus, Loki và dashboard **Gym Fitness Overview** được cấu hình sẵn từ `monitoring/grafana/`.
3. Trong Grafana Explore, chọn datasource Loki và thử các LogQL sau:

```logql
{compose_service="app"}
{compose_service="nginx"}
count_over_time({compose_service="app"}[5m])
```

## Hardening đã áp dụng

- Ứng dụng chạy bằng user `appuser`, không chạy bằng root.
- MySQL không publish cổng 3306 và chỉ thuộc `internal-net`.
- `internal-net` là Docker network `internal: true`.
- Secrets được tách vào `.env`; chỉ `.env.example` không có secret thật được commit.
- App, Nginx và MySQL exporter dùng `no-new-privileges:true`.
- Nginx thêm các headers `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP và `Permissions-Policy`.

## Lệnh hữu ích

```powershell
Invoke-WebRequest http://localhost/health -UseBasicParsing
Invoke-WebRequest http://localhost/metrics -UseBasicParsing
docker compose logs -f app
docker compose down
```

Không dùng `docker compose down -v` trừ khi bạn chủ động muốn xóa dữ liệu MySQL, Grafana, Prometheus và Loki.
