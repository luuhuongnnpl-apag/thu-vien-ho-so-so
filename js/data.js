/* ==========================================================================
   DỮ LIỆU KHỞI TẠO TRỐNG & LOGO CHÍNH THỨC PHÚC NGUYÊN LIBRARY
   ========================================================================== */

// Logo chính thức của Phúc Nguyên Library (Cây Tri Thức - RESEARCH LAW FOR BETTER LIFE)
const PHUC_NGUYEN_LOGO_SVG = `<img src="logo.png" alt="Phúc Nguyên Library" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;

// Biểu tượng trên bìa sách 3D mặc định của tài liệu (Sử dụng chính Logo Phúc Nguyên Library)
const OU_BOOK_EMBLEM_SVG = `<img class="ou-book-logo" src="logo.png" alt="Phúc Nguyên Library" style="width:76%;height:auto;max-height:76%;object-fit:contain;border-radius:50%;" />`;

const DEFAULT_BRANDING = {
  libraryName: 'PHÚC NGUYÊN LIBRARY',
  bannerTitle: 'PHÚC NGUYÊN LIBRARY',
  bannerSubtitle: 'RESEARCH LAW FOR BETTER LIFE • TÀI LIỆU SỐ',
  primaryColor: '#254b73', // Màu xanh dương đậm chuẩn nền Logo Phúc Nguyên
  goldColor: '#214b2f',    // Màu xanh rừng cây tri thức chuẩn vòng tròn Logo Phúc Nguyên
  fontFamily: "'Be Vietnam Pro', 'Roboto', sans-serif",
  logoDataUrl: 'logo.png'
};

// Danh sách Bộ sưu tập khởi tạo trống (0 thư mục con để người dùng tự thiết kế từ đầu)
const DEFAULT_COLLECTIONS = [
  { id: 'all', name: 'Tất cả bộ sưu tập', parentId: null, description: 'Toàn bộ hồ sơ và tài liệu số trong kho lưu trữ', driveFolderId: '' }
];

// Danh sách Tài liệu khởi tạo trống (0 tài liệu)
const DEFAULT_DOCUMENTS = [];

const DEFAULT_USERS = [
  {
    username: 'admin',
    password: '123',
    fullName: 'Quản trị viên Phúc Nguyên Library',
    department: 'Ban Quản trị Thư viện',
    role: 'admin',
    roleLabel: 'Quản trị viên',
    status: 'active',
    createdAt: '2026-01-01'
  },
  {
    username: 'thuthu',
    password: '123',
    fullName: 'Cán bộ Thư viện - Văn thư',
    department: 'Phòng Thông tin - Tư liệu',
    role: 'editor',
    roleLabel: 'Thủ thư / Biên mục',
    status: 'active',
    createdAt: '2026-01-10'
  }
];
