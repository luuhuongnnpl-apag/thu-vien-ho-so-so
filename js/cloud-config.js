/**
 * ============================================================================
 * CẤU HÌNH ĐỒNG BỘ ĐÁM MÂY CHO WEB CÔNG KHAI (GITHUB PAGES / FIREBASE)
 * ============================================================================
 * Khi ban hành thành Web công khai trên GitHub Pages hoặc Firebase Hosting,
 * bạn có thể điền trực tiếp URL tại đây (hoặc nhấn nút "Xuất file cloud-config.js"
 * trong mục "Kết nối Cloud / Google Drive" trên web) để TẤT CẢ độc giả truy cập
 * vào đường link web công khai đều tự động tải chung một kho dữ liệu hồ sơ.
 */

window.PUBLIC_CLOUD_CONFIG = {
  // Cách 1: Dán URL Google Apps Script Web App (Lưu cả File + Cơ sở dữ liệu trên Google Drive)
  // Ví dụ: "https://script.google.com/macros/s/AKfycbx.../exec"
  gasWebAppUrl: "",

  // ID hoặc Link Thư mục gốc trên Google Drive chứa các hồ sơ
  rootFolderId: "",

  // Cách 2: Hoặc dán URL Firebase Realtime Database (Nếu dùng Firebase làm CSDL)
  // Ví dụ: "https://ten-project-default-rtdb.asia-southeast1.firebasedatabase.app"
  firebaseDbUrl: "",

  // Chế độ mặc định cho người truy cập vào web công khai:
  // 'public_viewer' = Khách/Độc giả chỉ được xem & tải, muốn thêm/xóa phải nhập mật khẩu Admin
  // 'demo_admin'    = Mở sẵn quyền Admin để cấu hình thử nghiệm
  defaultVisitorMode: "public_viewer",

  // Mật khẩu mặc định cho Quản trị viên (admin) và Thủ thư (thuthu) trên web công khai
  defaultAdminPassword: "123"
};
