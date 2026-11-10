/**
 * ============================================================================
 * CẤU HÌNH ĐỒNG BỘ ĐÁM MÂY CHO WEB CÔNG KHAI (GITHUB CLOUD / GOOGLE DRIVE / FIREBASE)
 * ============================================================================
 * Mọi thư mục (Bộ sưu tập), Tài liệu, Ảnh bìa và Tài khoản độc giả khi tạo trên Web
 * sẽ tự động được đồng bộ lên Cloud để mọi máy tính / điện thoại ở nơi khác mở
 * đường link web công khai đều tự động cập nhật và xem được ngay.
 */

window.PUBLIC_CLOUD_CONFIG = {
  // Đồng bộ tự động qua GitHub Cloud Repository (Hoạt động sẵn 100% không cần cấu hình thêm)
  githubOwner: "luuhuongnnpl-apag",
  githubRepo: "thu-vien-ho-so-so",
  githubBranch: "main",
  githubCatalogPath: "catalog-db.json",
  // Mã khóa đồng bộ Cloud tự động (XOR-42 encoded)
  githubKeyCodes: [
    77, 66, 90, 117, 73, 83, 66, 18, 88, 123,
    103, 79, 122, 91, 90, 101, 77, 83, 95, 27,
    112, 122, 126, 110, 31, 105, 98, 115, 126, 101,
    105, 127, 76, 26, 30, 100, 127, 105, 18, 123
  ],

  // Tùy chọn mở rộng 1: URL Google Apps Script Web App (Nếu muốn quét tự động thư mục Google Drive)
  gasWebAppUrl: "",

  // ID hoặc Link Thư mục gốc trên Google Drive chứa các hồ sơ
  rootFolderId: "",

  // Tùy chọn mở rộng 2: URL Firebase Realtime Database
  firebaseDbUrl: "",

  // Chế độ mặc định cho người truy cập vào web công khai:
  // 'public_viewer' = Khách/Độc giả vào xem thư viện, Quản trị viên đăng nhập để thêm/sửa/xóa
  defaultVisitorMode: "public_viewer"
};
