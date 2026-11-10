# Hệ Thống Lưu Trữ Hồ Sơ & Thư Viện Số (Kết nối Google Drive & Cloud)

Hệ thống quản lý hồ sơ, tài liệu số theo giao diện mẫu **Thư viện số Trường Đại học Mở TP.HCM (`TÀI LIỆU SỐ`)**, tích hợp lưu trữ và xem trước trực tiếp từ **Google Drive**, sẵn sàng ban hành thành **Web công khai trên GitHub Pages hoặc Firebase**.

---

## 1. Cấu trúc các file đã chuẩn bị để Ban hành Web Công khai
- [index.html](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/index.html): Giao diện chính chuẩn Thư viện số ĐH Mở TP.HCM.
- [js/cloud-config.js](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/js/cloud-config.js): File cấu hình kết nối đám mây cố định cho Web công khai (`gasWebAppUrl`, `rootFolderId`, `firebaseDbUrl`).
- [.github/workflows/deploy.yml](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/.github/workflows/deploy.yml): Cấu hình GitHub Actions tự động xuất bản trang web lên **GitHub Pages**.
- [firebase.json](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/firebase.json): Cấu hình triển khai lên **Firebase Hosting**.
- [google-apps-script/Code.gs](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/google-apps-script/Code.gs): Mã nguồn Google Apps Script đóng vai trò vừa là **Cổng Upload file lên Google Drive**, vừa là **Cơ sở dữ liệu đám mây (Cloud Database)** lưu danh mục hồ sơ chung ngay trên Google Drive.

---

## 2. Hướng dẫn ban hành thành Web công khai (Chỉ mất 2 phút)

### Bước 1: Thiết lập Cơ sở dữ liệu Đám mây (Để mọi người truy cập web đều thấy chung danh sách hồ sơ)
Bạn có thể chọn **1 trong 2 cách** (hoặc dùng cả hai):

#### Lựa chọn A: Dùng chính Google Drive làm CSDL + Kho chứa File (Khuyên dùng - Miễn phí 100%)
1. Mở [script.google.com](https://script.google.com) -> Nhấn **Dự án mới (New project)**.
2. Xóa mã mặc định, copy toàn bộ nội dung trong file [google-apps-script/Code.gs](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/google-apps-script/Code.gs) dán vào và nhấn Lưu.
3. Nhấn nút **Triển khai (Deploy)** -> **Tùy chọn triển khai mới (New deployment)** -> Chọn loại **Ứng dụng web (Web app)**:
   - *Thực thi dưới dạng (Execute as)*: **Tôi (Me)**
   - *Ai có quyền truy cập (Who has access)*: **Bất kỳ ai (Anyone)**
4. Nhấn **Triển khai**, cấp quyền Google Drive và copy đường link `https://script.google.com/macros/s/.../exec`.
5. Mở file [js/cloud-config.js](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/js/cloud-config.js) và dán đường link vừa copy vào dòng `gasWebAppUrl: "..."` (kèm ID thư mục gốc Google Drive vào `rootFolderId`).

#### Lựa chọn B: Dùng Firebase Realtime Database làm CSDL thời gian thực
1. Truy cập [console.firebase.google.com](https://console.firebase.google.com) -> Tạo một Project mới.
2. Vào menu **Build -> Realtime Database** -> Nhấn **Create Database** -> Chọn **Start in test mode**.
3. Copy đường link Database (có dạng `https://ten-project-default-rtdb.asia-southeast1.firebasedatabase.app`).
4. Dán đường link đó vào dòng `firebaseDbUrl: "..."` trong file [js/cloud-config.js](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/js/cloud-config.js).

---

### Bước 2: Đưa Web lên mạng công khai bằng tài khoản GitHub (Không cần cài đặt phần mềm)
1. Đăng nhập tài khoản GitHub và truy cập [github.com/new](https://github.com/new).
2. Đặt tên Repository (ví dụ: `thu-vien-so`) -> Chọn chế độ **Public** -> Nhấn **Create repository**.
3. Ở trang tiếp theo, nhấn vào dòng chữ **"uploading an existing file"**.
4. Mở thư mục `h:\Drive của tôi\12. ANTIGRAV`, bôi đen và kéo thả các thành phần sau vào trình duyệt GitHub:
   - File `index.html`
   - Thư mục `css`
   - Thư mục `js`
   - Thư mục `.github`
5. Nhấn nút **Commit changes** màu xanh ở dưới cùng.
6. Trên thanh menu của Repository trên GitHub, vào **Settings** -> chọn **Pages** (cột bên trái):
   - Tại mục **Build and deployment (Source)**, chọn **Deploy from a branch**.
   - Tại mục **Branch**, chọn **main** (thư mục `/ (root)`) -> Nhấn **Save**.
7. Đợi khoảng 30–60 giây và tải lại trang, GitHub sẽ cấp cho bạn đường link Web công khai vĩnh viễn:
   `https://<tên-tài-khoản-github>.github.io/thu-vien-so/`

---

## 3. Cơ chế phân quyền tự động khi chạy trên tên miền công khai
- Khi độc giả mở đường link công khai (`*.github.io` hoặc `*.web.app`), hệ thống **tự động vào ở chế độ Độc giả công khai** (chỉ được tra cứu, xem trước tài liệu và tải xuống, ẩn các nút sửa/xóa để bảo vệ dữ liệu).
- Khi bạn (Quản trị viên) muốn thêm/sửa/upload hồ sơ ngay trên trang web công khai, chỉ cần nhấn nút **Đăng nhập Quản trị** ở góc trên bên phải và nhập mật khẩu quản trị (mặc định `123`, có thể đổi trong [js/cloud-config.js](file:///h:/Drive%20của%20tôi/12.%20ANTIGRAV/js/cloud-config.js)).
