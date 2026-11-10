/* ==========================================================================
   ỨNG DỤNG QUẢN LÝ HỒ SƠ & THƯ VIỆN SỐ (PHONG CÁCH ĐH MỞ TP.HCM)
   HỖ TRỢ ĐỒNG BỘ CLOUD (GOOGLE DRIVE DB & FIREBASE) CHO WEB CÔNG KHAI
   ========================================================================== */

const STORAGE_KEYS = {
  COLLECTIONS: 'ou_lib_collections_v1',
  DOCUMENTS: 'ou_lib_documents_v1',
  USERS: 'ou_lib_users_v1',
  CURRENT_USER: 'ou_lib_current_user_v1',
  SECURITY_CONFIG: 'ou_lib_security_v1'
};

const AppState = {
  collections: [],
  documents: [],
  users: [],
  currentUser: null,
  security: {
    requireLoginToView: false,
    requireLoginToDownload: false
  },
  selectedCollectionId: 'all',
  searchQuery: '',
  filterYear: 'all',
  filterType: 'all',
  filterAuthor: '',
  sortBy: 'newest',
  viewMode: 'grid',
  activeDocId: null,
  pendingUploadFile: null,
  pendingCoverDataUrl: ''
};

// ==========================================================================
// KHỞI TẠO DỮ LIỆU & ĐỒNG BỘ ĐÁM MÂY (CLOUD SYNC)
// ==========================================================================
async function initApp() {
  loadStateFromStorage();
  bindEvents();
  renderTopBar();
  renderCollectionsSidebar();
  populateFilterDropdowns();
  renderCatalog();
  updateSidebarQuickStats();

  // Tự động đồng bộ dữ liệu chung từ Cloud (Firebase / Google Drive) nếu đã kết nối
  if (DriveService.hasCloudDatabase()) {
    await syncFromCloudSilent();
  }
}

function loadStateFromStorage() {
  try {
    const savedCols = localStorage.getItem(STORAGE_KEYS.COLLECTIONS);
    AppState.collections = savedCols ? JSON.parse(savedCols) : [...DEFAULT_COLLECTIONS];

    const savedDocs = localStorage.getItem(STORAGE_KEYS.DOCUMENTS);
    AppState.documents = savedDocs ? JSON.parse(savedDocs) : [...DEFAULT_DOCUMENTS];

    const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
    AppState.users = savedUsers ? JSON.parse(savedUsers) : [...DEFAULT_USERS];

    const savedCurrentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (savedCurrentUser) {
      AppState.currentUser = JSON.parse(savedCurrentUser);
    } else {
      // Nếu chạy trên tên miền web công khai (.github.io, .web.app, .firebaseapp.com)
      // và chế độ mặc định là public_viewer -> vào với quyền Độc giả để an toàn dữ liệu
      const isPublicDomain =
        location.hostname.endsWith('.github.io') ||
        location.hostname.endsWith('.web.app') ||
        location.hostname.endsWith('.firebaseapp.com');
      const pubCfg = window.PUBLIC_CLOUD_CONFIG || {};
      if (isPublicDomain && pubCfg.defaultVisitorMode === 'public_viewer') {
        AppState.currentUser = null; // Khách / Độc giả công khai
      } else {
        AppState.currentUser = AppState.users[0]; // Admin khi chạy cục bộ
      }
    }

    const savedSec = localStorage.getItem(STORAGE_KEYS.SECURITY_CONFIG);
    if (savedSec) {
      AppState.security = JSON.parse(savedSec);
    }
  } catch (e) {
    console.error('Lỗi đọc dữ liệu localStorage:', e);
    AppState.collections = [...DEFAULT_COLLECTIONS];
    AppState.documents = [...DEFAULT_DOCUMENTS];
    AppState.users = [...DEFAULT_USERS];
    AppState.currentUser = AppState.users[0];
  }
}

async function syncFromCloudSilent() {
  try {
    const res = await DriveService.fetchCloudCatalog();
    if (res && res.catalog) {
      if (Array.isArray(res.catalog.collections) && res.catalog.collections.length > 0) {
        AppState.collections = res.catalog.collections;
        localStorage.setItem(STORAGE_KEYS.COLLECTIONS, JSON.stringify(AppState.collections));
      }
      if (Array.isArray(res.catalog.documents)) {
        AppState.documents = res.catalog.documents;
        localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(AppState.documents));
      }
      if (res.catalog.security) {
        AppState.security = res.catalog.security;
        localStorage.setItem(STORAGE_KEYS.SECURITY_CONFIG, JSON.stringify(AppState.security));
      }
      renderTopBar();
      renderCollectionsSidebar();
      populateFilterDropdowns();
      renderCatalog();
      updateSidebarQuickStats();
    }
  } catch (e) {
    console.warn('Không thể tải dữ liệu Cloud:', e);
  }
}

async function pushStateToCloud() {
  if (!DriveService.hasCloudDatabase()) return;
  try {
    await DriveService.pushCloudCatalog({
      collections: AppState.collections,
      documents: AppState.documents,
      security: AppState.security
    });
  } catch (e) {
    console.warn('Lỗi đẩy dữ liệu lên Cloud:', e);
  }
}

function saveCollections() {
  localStorage.setItem(STORAGE_KEYS.COLLECTIONS, JSON.stringify(AppState.collections));
  pushStateToCloud();
}

function saveDocuments() {
  localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(AppState.documents));
  updateSidebarQuickStats();
  pushStateToCloud();
}

function saveUsers() {
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(AppState.users));
}

function saveSecurity() {
  localStorage.setItem(STORAGE_KEYS.SECURITY_CONFIG, JSON.stringify(AppState.security));
  pushStateToCloud();
}

function canManageDocs() {
  return AppState.currentUser && ['admin', 'editor'].includes(AppState.currentUser.role);
}

function canViewDocument(doc) {
  if (AppState.security.requireLoginToView && !AppState.currentUser) {
    return false;
  }
  if (doc.accessLevel === 'internal' && !AppState.currentUser) {
    return false;
  }
  if (doc.accessLevel === 'admin' && !canManageDocs()) {
    return false;
  }
  return true;
}

// ==========================================================================
// HIỂN THỊ THANH TIỆN ÍCH TRÊN CÙNG (TOP BAR)
// ==========================================================================
function renderTopBar() {
  const driveCfg = DriveService.getConfig();
  const statusEl = document.getElementById('driveStatusPill');
  if (driveCfg.firebaseDbUrl && driveCfg.gasWebAppUrl) {
    statusEl.className = 'drive-status-pill';
    statusEl.innerHTML = `<i class="fa-solid fa-cloud"></i> Đã nối Google Drive + Firebase Cloud`;
  } else if (driveCfg.gasWebAppUrl) {
    statusEl.className = 'drive-status-pill';
    statusEl.innerHTML = `<i class="fa-brands fa-google-drive"></i> Đã nối Cloud Google Drive`;
  } else if (driveCfg.firebaseDbUrl) {
    statusEl.className = 'drive-status-pill';
    statusEl.innerHTML = `<i class="fa-solid fa-fire"></i> Đã nối Firebase Cloud DB`;
  } else {
    statusEl.className = 'drive-status-pill';
    statusEl.innerHTML = `<i class="fa-brands fa-google-drive"></i> Kho Google Drive (Nhấn để cấu hình Cloud)`;
  }

  const userBadge = document.getElementById('currentUserBadge');
  const btnUploadTop = document.getElementById('btnOpenUploadTop');
  const btnToolbarAdd = document.getElementById('btnToolbarAddDoc');
  const btnManageCols = document.getElementById('btnManageCollections');

  if (AppState.currentUser) {
    userBadge.innerHTML = `<i class="fa-solid fa-user-shield"></i> ${escapeHtml(AppState.currentUser.fullName)} (${escapeHtml(AppState.currentUser.roleLabel)})`;
  } else {
    userBadge.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Độc giả công khai (Nhấn để Đăng nhập Quản trị)`;
  }

  const hasEditPerm = canManageDocs();
  if (btnUploadTop) btnUploadTop.style.display = hasEditPerm ? 'inline-flex' : 'none';
  if (btnToolbarAdd) btnToolbarAdd.style.display = hasEditPerm ? 'inline-flex' : 'none';
  if (btnManageCols) btnManageCols.style.display = hasEditPerm ? 'inline-flex' : 'none';
}

// ==========================================================================
// HIỂN THỊ CỘT TRÁI: BỘ SƯU TẬP
// ==========================================================================
function renderCollectionsSidebar() {
  const listEl = document.getElementById('collectionsList');
  if (!listEl) return;

  const visibleDocs = AppState.documents.filter(canViewDocument);

  listEl.innerHTML = AppState.collections
    .map((col) => {
      const count =
        col.id === 'all'
          ? visibleDocs.length
          : visibleDocs.filter((d) => d.collectionId === col.id).length;
      const activeClass = AppState.selectedCollectionId === col.id ? 'active' : '';
      return `
        <li class="collection-item ${activeClass}" data-collection-id="${escapeHtml(col.id)}" title="${escapeHtml(col.description || col.name)}">
          <span>${escapeHtml(col.name)}</span>
          <span class="collection-count">${count}</span>
        </li>
      `;
    })
    .join('');

  listEl.querySelectorAll('.collection-item').forEach((item) => {
    item.addEventListener('click', () => {
      AppState.selectedCollectionId = item.getAttribute('data-collection-id');
      renderCollectionsSidebar();
      renderCatalog();
    });
  });
}

function updateSidebarQuickStats() {
  const totalDocs = AppState.documents.length;
  const totalViews = AppState.documents.reduce((sum, d) => sum + (Number(d.views) || 0), 0);
  const totalDownloads = AppState.documents.reduce((sum, d) => sum + (Number(d.downloads) || 0), 0);
  const driveLinked = AppState.documents.filter((d) => d.driveFileId || d.driveUrl).length;

  const elTotal = document.getElementById('quickStatTotal');
  const elViews = document.getElementById('quickStatViews');
  const elDownloads = document.getElementById('quickStatDownloads');
  const elDrive = document.getElementById('quickStatDrive');

  if (elTotal) elTotal.textContent = totalDocs;
  if (elViews) elViews.textContent = totalViews.toLocaleString('vi-VN');
  if (elDownloads) elDownloads.textContent = totalDownloads.toLocaleString('vi-VN');
  if (elDrive) elDrive.textContent = `${driveLinked}/${totalDocs}`;
}

// ==========================================================================
// LỌC, TÌM KIẾM & HIỂN THỊ DANH MỤC TÀI LIỆU SỐ
// ==========================================================================
function populateFilterDropdowns() {
  const yearSelect = document.getElementById('filterYearSelect');
  if (!yearSelect) return;

  const years = Array.from(
    new Set(AppState.documents.map((d) => Number(d.year)).filter(Boolean))
  ).sort((a, b) => b - a);

  yearSelect.innerHTML =
    `<option value="all">Tất cả năm</option>` +
    years.map((y) => `<option value="${y}">Năm ${y}</option>`).join('');
  yearSelect.value = AppState.filterYear;
}

function getFilteredDocuments() {
  const q = AppState.searchQuery.trim().toLowerCase();
  const authorQ = AppState.filterAuthor.trim().toLowerCase();

  let list = AppState.documents.filter((doc) => {
    if (!canViewDocument(doc)) return false;

    if (AppState.selectedCollectionId !== 'all' && doc.collectionId !== AppState.selectedCollectionId) {
      return false;
    }

    if (AppState.filterYear !== 'all' && String(doc.year) !== String(AppState.filterYear)) {
      return false;
    }

    if (AppState.filterType !== 'all' && (doc.fileType || '').toUpperCase() !== AppState.filterType) {
      return false;
    }

    if (authorQ && !(doc.author || '').toLowerCase().includes(authorQ)) {
      return false;
    }

    if (q) {
      const haystack = [
        doc.title,
        doc.code,
        doc.author,
        doc.description,
        ...(doc.tags || [])
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  list.sort((a, b) => {
    if (AppState.sortBy === 'views') return (b.views || 0) - (a.views || 0);
    if (AppState.sortBy === 'downloads') return (b.downloads || 0) - (a.downloads || 0);
    if (AppState.sortBy === 'title_asc') return (a.title || '').localeCompare(b.title || '', 'vi');
    if (AppState.sortBy === 'year_desc') return (b.year || 0) - (a.year || 0);
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return list;
}

function renderCatalog() {
  const container = document.getElementById('documentsContainer');
  const countEl = document.getElementById('resultsCountNumber');
  const currentColTitleEl = document.getElementById('currentCollectionSubtitle');

  if (AppState.security.requireLoginToView && !AppState.currentUser) {
    countEl.textContent = '0';
    container.className = '';
    container.innerHTML = `
      <div style="background:#fff;padding:40px;text-align:center;border:1px solid #e5e7eb;border-radius:6px;">
        <i class="fa-solid fa-lock" style="font-size:38px;color:var(--ou-navy);margin-bottom:12px;"></i>
        <h3 style="color:var(--ou-navy);margin-bottom:8px;">Yêu cầu đăng nhập để tra cứu hồ sơ</h3>
        <p style="color:#6b7280;margin-bottom:16px;">Hệ thống đang bật chế độ bảo mật nội bộ. Vui lòng đăng nhập để xem danh mục tài liệu số.</p>
        <button class="btn btn-primary" onclick="openAuthModal()"><i class="fa-solid fa-right-to-bracket"></i> Đăng nhập ngay</button>
      </div>
    `;
    return;
  }

  const filtered = getFilteredDocuments();
  countEl.textContent = filtered.length;

  const activeCol = AppState.collections.find((c) => c.id === AppState.selectedCollectionId);
  if (currentColTitleEl && activeCol) {
    currentColTitleEl.textContent =
      activeCol.id === 'all' ? 'DANH MỤC TÀI LIỆU SỐ' : `DANH MỤC: ${activeCol.name.toUpperCase()}`;
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div style="background:#fff;padding:42px 20px;text-align:center;border:1px solid #e5e7eb;border-radius:4px;color:#6b7280;">
        <i class="fa-regular fa-folder-open" style="font-size:36px;color:#9ca3af;margin-bottom:10px;"></i>
        <p style="font-size:15px;">Không tìm thấy hồ sơ / tài liệu nào phù hợp với điều kiện lọc.</p>
      </div>
    `;
    return;
  }

  if (AppState.viewMode === 'grid') {
    container.className = 'documents-grid';
    container.innerHTML = filtered.map((doc) => renderGridCard(doc)).join('');
  } else {
    container.className = 'documents-list';
    container.innerHTML = filtered.map((doc) => renderListRow(doc)).join('');
  }
}

const ICON_BOOK_STAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>`;
const ICON_DL_STAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;

function renderGridCard(doc) {
  const fType = (doc.fileType || 'PDF').toLowerCase();
  const coverContent = doc.coverUrl
    ? `<img class="custom-cover" src="${escapeHtml(doc.coverUrl)}" alt="${escapeHtml(doc.title)}" />`
    : OU_BOOK_EMBLEM_SVG;

  const hasDrive = Boolean(doc.driveFileId || doc.driveUrl || doc.localBlobId || doc.localFileUrl);

  return `
    <article class="doc-card">
      <div class="doc-cover-wrapper" onclick="openDocumentDetail('${escapeHtml(doc.id)}')" title="Nhấn để xem chi tiết & đọc tài liệu">
        <div class="book-3d-frame">
          ${coverContent}
          <span class="doc-filetype-badge ${escapeHtml(fType)}">${escapeHtml(doc.fileType || 'PDF')}</span>
          ${hasDrive ? `<span class="doc-drive-badge" title="Liên kết Google Drive"><i class="fa-brands fa-google-drive"></i></span>` : ''}
        </div>
      </div>
      <div class="doc-title" onclick="openDocumentDetail('${escapeHtml(doc.id)}')" title="${escapeHtml(doc.title)}">
        ${escapeHtml(doc.title)}
      </div>
      <div class="doc-meta-stats">
        <span class="doc-stat-item" title="Lượt xem / Số trang">
          ${ICON_BOOK_STAT} ${Number(doc.views) || 0}
        </span>
        <span class="doc-stat-item" title="Lượt tải xuống">
          ${ICON_DL_STAT} ${Number(doc.downloads) || 0}
        </span>
      </div>
      <button class="btn-detail" onclick="openDocumentDetail('${escapeHtml(doc.id)}')">Chi tiết</button>
    </article>
  `;
}

function renderListRow(doc) {
  const col = AppState.collections.find((c) => c.id === doc.collectionId);
  const colName = col ? col.name : 'Chưa phân loại';
  const coverContent = doc.coverUrl
    ? `<img class="custom-cover" src="${escapeHtml(doc.coverUrl)}" alt="${escapeHtml(doc.title)}" />`
    : OU_BOOK_EMBLEM_SVG;

  return `
    <div class="doc-list-item">
      <div class="doc-list-thumb" onclick="openDocumentDetail('${escapeHtml(doc.id)}')" style="cursor:pointer;">
        <div class="book-3d-frame">
          ${coverContent}
        </div>
      </div>
      <div class="doc-list-info">
        <h3 onclick="openDocumentDetail('${escapeHtml(doc.id)}')">
          [${escapeHtml(doc.code || doc.id)}] ${escapeHtml(doc.title)}
        </h3>
        <div class="doc-list-meta">
          <span><i class="fa-regular fa-folder"></i> ${escapeHtml(colName)}</span>
          <span><i class="fa-regular fa-user"></i> ${escapeHtml(doc.author || 'Đang cập nhật')}</span>
          <span><i class="fa-regular fa-calendar"></i> Năm: ${escapeHtml(String(doc.year || '---'))}</span>
          <span><i class="fa-regular fa-file"></i> ${escapeHtml(doc.fileType || 'PDF')} (${escapeHtml(doc.fileSize || '---')})</span>
          <span><i class="fa-regular fa-eye"></i> ${Number(doc.views) || 0} lượt xem</span>
          <span><i class="fa-solid fa-download"></i> ${Number(doc.downloads) || 0} lượt tải</span>
        </div>
        <p class="doc-list-desc">${escapeHtml(doc.description || 'Không có mô tả.')}</p>
      </div>
      <div class="doc-list-actions">
        <button class="btn-detail" onclick="openDocumentDetail('${escapeHtml(doc.id)}')">Chi tiết & Xem</button>
        ${
          canManageDocs()
            ? `<button class="btn btn-outline" style="justify-content:center;font-size:12px;padding:5px 10px;" onclick="openEditDocumentModal('${escapeHtml(doc.id)}')"><i class="fa-regular fa-pen-to-square"></i> Sửa hồ sơ</button>`
            : ''
        }
      </div>
    </div>
  `;
}

// ==========================================================================
// CHI TIẾT HỒ SƠ & XEM TRƯỚC TRỰC TIẾP (PREVIEW GOOGLE DRIVE / LOCAL PDF)
// ==========================================================================
async function openDocumentDetail(docId) {
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  AppState.activeDocId = docId;

  doc.views = (Number(doc.views) || 0) + 1;
  saveDocuments();
  renderCatalog();

  const col = AppState.collections.find((c) => c.id === doc.collectionId);
  const colName = col ? col.name : doc.collectionId;

  if (doc.localBlobId && !doc.localFileUrl) {
    const blobUrl = await DriveService.getBlobUrlFromIndexedDB(doc.localBlobId);
    if (blobUrl) doc.localFileUrl = blobUrl;
  }

  document.getElementById('detailModalTitle').textContent = doc.title;

  const accessBadge =
    doc.accessLevel === 'internal'
      ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px;">Nội bộ</span>'
      : '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:12px;">Công khai</span>';

  const fileId = DriveService.extractFileId(doc.driveFileId || doc.driveUrl);

  document.getElementById('detailMetaContainer').innerHTML = `
    <div style="display:flex;gap:14px;align-items:flex-start;">
      <div style="width:92px;height:122px;flex-shrink:0;">
        <div class="book-3d-frame">
          ${doc.coverUrl ? `<img class="custom-cover" src="${escapeHtml(doc.coverUrl)}" />` : OU_BOOK_EMBLEM_SVG}
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Mã hồ sơ: <strong>${escapeHtml(doc.code || doc.id)}</strong></div>
        <h4 style="font-size:15px;color:var(--ou-navy);margin-bottom:6px;line-height:1.35;">${escapeHtml(doc.title)}</h4>
        ${accessBadge}
      </div>
    </div>

    <table class="detail-meta-table">
      <tr>
        <th>Bộ sưu tập:</th>
        <td>${escapeHtml(colName)}</td>
      </tr>
      <tr>
        <th>Tác giả / Cơ quan:</th>
        <td>${escapeHtml(doc.author || '---')}</td>
      </tr>
      <tr>
        <th>Năm ban hành:</th>
        <td>${escapeHtml(String(doc.year || '---'))}</td>
      </tr>
      <tr>
        <th>Định dạng / Cỡ:</th>
        <td><span style="font-weight:700;color:var(--ou-blue);">${escapeHtml(doc.fileType || 'PDF')}</span> (${escapeHtml(doc.fileSize || '---')})</td>
      </tr>
      <tr>
        <th>Số trang:</th>
        <td>${escapeHtml(String(doc.pages || '---'))} trang</td>
      </tr>
      <tr>
        <th>Thống kê:</th>
        <td><strong>${doc.views}</strong> lượt xem &bull; <strong>${doc.downloads}</strong> lượt tải</td>
      </tr>
      <tr>
        <th>Google Drive ID:</th>
        <td>${fileId && !fileId.startsWith('1_sample_') ? `<code>${escapeHtml(fileId)}</code>` : '<span style="color:#64748b;">Bản mẫu / Lưu cục bộ</span>'}</td>
      </tr>
      <tr>
        <th>Ngày cập nhật:</th>
        <td>${escapeHtml(doc.createdAt || '---')} (${escapeHtml(doc.uploadedBy || 'Admin')})</td>
      </tr>
      <tr>
        <th>Từ khóa:</th>
        <td>${(doc.tags || []).map((t) => `<span style="display:inline-block;background:#e2e8f0;padding:1px 7px;border-radius:3px;font-size:11.5px;margin:2px;">${escapeHtml(t)}</span>`).join(' ') || '---'}</td>
      </tr>
    </table>

    <div style="margin-top:12px;font-size:13px;color:#334155;background:#fff;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">
      <strong>Tóm tắt nội dung hồ sơ:</strong>
      <p style="margin-top:4px;color:#475569;">${escapeHtml(doc.description || 'Chưa có mô tả chi tiết.')}</p>
    </div>

    <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;">
      <button class="btn btn-primary" onclick="handleDownloadDocument('${escapeHtml(doc.id)}')">
        <i class="fa-solid fa-download"></i> Tải xuống (${doc.downloads})
      </button>
      ${
        fileId && !fileId.startsWith('1_sample_')
          ? `<a class="btn btn-outline" href="${escapeHtml(DriveService.getWebViewUrl(doc))}" target="_blank" rel="noopener">
              <i class="fa-brands fa-google-drive"></i> Mở trên Drive
             </a>`
          : ''
      }
      ${
        canManageDocs()
          ? `<button class="btn btn-outline" onclick="closeModal('detailModal'); openEditDocumentModal('${escapeHtml(doc.id)}')">
              <i class="fa-regular fa-pen-to-square"></i> Sửa / Đổi file Drive
             </button>
             <button class="btn btn-danger" onclick="handleDeleteDocument('${escapeHtml(doc.id)}')">
              <i class="fa-regular fa-trash-can"></i> Xóa
             </button>`
          : ''
      }
    </div>
  `;

  renderDocumentPreviewPane(doc);
  openModal('detailModal');
}

function renderDocumentPreviewPane(doc) {
  const previewContainer = document.getElementById('detailPreviewContainer');
  const embedUrl = DriveService.getEmbedPreviewUrl(doc);

  if (embedUrl) {
    if ((doc.fileType || '').toUpperCase() === 'IMAGE') {
      previewContainer.innerHTML = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:16px;background:#0f172a;">
          <img src="${escapeHtml(embedUrl)}" style="max-width:100%;max-height:480px;object-fit:contain;border-radius:4px;" alt="${escapeHtml(doc.title)}" />
        </div>
      `;
    } else {
      previewContainer.innerHTML = `
        <iframe class="preview-iframe" src="${escapeHtml(embedUrl)}" allow="autoplay"></iframe>
      `;
    }
    return;
  }

  previewContainer.innerHTML = `
    <div style="background:#fff;width:90%;max-width:600px;margin:24px auto;padding:32px;border-radius:4px;box-shadow:0 10px 25px rgba(0,0,0,0.35);color:#1e293b;">
      <div style="border-bottom:2px solid var(--ou-navy);padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;font-weight:700;color:var(--ou-navy);text-transform:uppercase;">TRÌNH ĐỌC HỒ SƠ SỐ &bull; ${escapeHtml(doc.code || doc.id)}</span>
        <span style="background:#e0e7ff;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${escapeHtml(doc.fileType || 'PDF')} PREVIEW</span>
      </div>
      <h3 style="font-size:17px;color:#0f172a;margin-bottom:10px;">${escapeHtml(doc.title)}</h3>
      <p style="font-size:13px;color:#475569;margin-bottom:14px;">
        <strong>Tác giả / Đơn vị:</strong> ${escapeHtml(doc.author || '---')} &nbsp;|&nbsp; <strong>Năm:</strong> ${escapeHtml(String(doc.year || '---'))}
      </p>
      <div style="background:#f8fafc;border-left:3px solid var(--ou-blue);padding:12px 14px;font-size:13.5px;color:#334155;line-height:1.6;margin-bottom:18px;">
        ${escapeHtml(doc.description || '')}
      </div>
      <div style="background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:14px;font-size:13px;color:#1e3a8a;">
        <i class="fa-brands fa-google-drive"></i> <strong>Hướng dẫn xem file thật từ Google Drive:</strong>
        <p style="margin-top:4px;color:#3b82f6;">
          Đây là hồ sơ mẫu. Khi bạn nhấn <strong>"Sửa / Đổi file Drive"</strong> (hoặc <strong>"+ Thêm / Upload Hồ sơ"</strong>) và tải file từ máy tính lên hoặc dán Link chia sẻ Google Drive, khung này sẽ nhúng trực tiếp trình đọc PDF/Word/Excel của Google Drive.
        </p>
        ${
          canManageDocs()
            ? `<button class="btn btn-primary" style="margin-top:10px;font-size:12.5px;padding:6px 12px;" onclick="closeModal('detailModal'); openEditDocumentModal('${escapeHtml(doc.id)}')">
                <i class="fa-solid fa-cloud-arrow-up"></i> Gắn File Google Drive / Tải file lên cho hồ sơ này
               </button>`
            : ''
        }
      </div>
    </div>
  `;
}

function handleDownloadDocument(docId) {
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  if (AppState.security.requireLoginToDownload && !AppState.currentUser) {
    showToast('Vui lòng đăng nhập để tải xuống hồ sơ này!');
    openAuthModal();
    return;
  }

  doc.downloads = (Number(doc.downloads) || 0) + 1;
  saveDocuments();
  renderCatalog();

  const dlUrl = DriveService.getDownloadUrl(doc);
  if (dlUrl && !dlUrl.includes('1_sample_')) {
    const a = document.createElement('a');
    a.href = dlUrl;
    a.target = '_blank';
    a.download = doc.title || 'tai-lieu';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Đang tải xuống hồ sơ: ${doc.title}`);
  } else {
    const content = [
      `HỒ SƠ TÀI LIỆU SỐ - THƯ VIỆN ĐIỆN TỬ`,
      `====================================`,
      `Mã hồ sơ: ${doc.code || doc.id}`,
      `Tiêu đề: ${doc.title}`,
      `Tác giả / Cơ quan: ${doc.author}`,
      `Năm xuất bản: ${doc.year}`,
      `Định dạng: ${doc.fileType} (${doc.fileSize})`,
      `Tóm tắt: ${doc.description}`
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.code || doc.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã tải xuống phiếu thông tin hồ sơ mẫu.');
  }

  if (AppState.activeDocId === docId) {
    openDocumentDetail(docId);
    doc.views = Math.max(1, (Number(doc.views) || 1) - 1);
    saveDocuments();
  }
}

function handleDeleteDocument(docId) {
  if (!canManageDocs()) return;
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  if (!confirm(`Bạn có chắc chắn muốn xóa hồ sơ "${doc.title}" khỏi thư viện?`)) {
    return;
  }

  AppState.documents = AppState.documents.filter((d) => d.id !== docId);
  saveDocuments();
  closeModal('detailModal');
  renderCollectionsSidebar();
  renderCatalog();
  showToast('Đã xóa hồ sơ khỏi danh mục.');
}

// ==========================================================================
// THÊM MỚI / UPLOAD HỒ SƠ LÊN GOOGLE DRIVE & CHỈNH SỬA HỒ SƠ
// ==========================================================================
function openAddDocumentModal() {
  if (!canManageDocs()) {
    showToast('Bạn cần đăng nhập quyền Quản trị viên hoặc Thủ thư để thêm hồ sơ!');
    openAuthModal();
    return;
  }
  AppState.pendingUploadFile = null;
  AppState.pendingCoverDataUrl = '';
  document.getElementById('docFormModalTitle').innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Thêm / Upload Hồ sơ Mới (Lưu Google Drive)`;
  document.getElementById('docFormId').value = '';
  document.getElementById('docFormCode').value = `HS-${new Date().getFullYear()}-${String(AppState.documents.length + 1).padStart(3, '0')}`;
  document.getElementById('docFormTitle').value = '';
  populateDocFormCollections(AppState.selectedCollectionId === 'all' ? 'bao-tap-chi' : AppState.selectedCollectionId);
  document.getElementById('docFormAuthor').value = '';
  document.getElementById('docFormYear').value = new Date().getFullYear();
  document.getElementById('docFormPages').value = '15';
  document.getElementById('docFormType').value = 'PDF';
  document.getElementById('docFormSize').value = '';
  document.getElementById('docFormDriveUrl').value = '';
  document.getElementById('docFormAccess').value = 'public';
  document.getElementById('docFormTags').value = '';
  document.getElementById('docFormDesc').value = '';
  document.getElementById('uploadDropzoneText').innerHTML = `
    <i class="fa-solid fa-cloud-arrow-up" style="font-size:28px;color:var(--ou-blue);margin-bottom:6px;"></i>
    <div><strong>Kéo thả file hồ sơ (PDF, Word, Excel, Ảnh...) vào đây</strong> hoặc nhấn để chọn file từ máy tính</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px;">Hệ thống sẽ tự động tải lên Google Drive và đồng bộ lên Web công khai</div>
  `;
  document.getElementById('uploadStatusText').textContent = '';

  openModal('docFormModal');
}

function openEditDocumentModal(docId) {
  if (!canManageDocs()) return;
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  AppState.pendingUploadFile = null;
  AppState.pendingCoverDataUrl = doc.coverUrl || '';

  document.getElementById('docFormModalTitle').innerHTML = `<i class="fa-regular fa-pen-to-square"></i> Cập nhật Hồ sơ: ${escapeHtml(doc.code || doc.id)}`;
  document.getElementById('docFormId').value = doc.id;
  document.getElementById('docFormCode').value = doc.code || '';
  document.getElementById('docFormTitle').value = doc.title || '';
  populateDocFormCollections(doc.collectionId);
  document.getElementById('docFormAuthor').value = doc.author || '';
  document.getElementById('docFormYear').value = doc.year || new Date().getFullYear();
  document.getElementById('docFormPages').value = doc.pages || 1;
  document.getElementById('docFormType').value = doc.fileType || 'PDF';
  document.getElementById('docFormSize').value = doc.fileSize || '';
  document.getElementById('docFormDriveUrl').value = doc.driveUrl || doc.driveFileId || '';
  document.getElementById('docFormAccess').value = doc.accessLevel || 'public';
  document.getElementById('docFormTags').value = (doc.tags || []).join(', ');
  document.getElementById('docFormDesc').value = doc.description || '';
  document.getElementById('uploadDropzoneText').innerHTML = `
    <i class="fa-solid fa-file-arrow-up" style="font-size:24px;color:var(--ou-blue);margin-bottom:4px;"></i>
    <div>Chọn file mới nếu muốn thay thế file hiện tại của hồ sơ</div>
  `;
  document.getElementById('uploadStatusText').textContent = '';

  openModal('docFormModal');
}

function populateDocFormCollections(selectedId) {
  const select = document.getElementById('docFormCollection');
  const realCols = AppState.collections.filter((c) => c.id !== 'all');
  select.innerHTML = realCols
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
    .join('');
  if (selectedId && realCols.some((c) => c.id === selectedId)) {
    select.value = selectedId;
  }
}

async function handleSaveDocumentForm(e) {
  e.preventDefault();
  if (!canManageDocs()) return;

  const btnSave = document.getElementById('btnSaveDocForm');
  const statusEl = document.getElementById('uploadStatusText');
  btnSave.disabled = true;

  try {
    const existingId = document.getElementById('docFormId').value;
    const colId = document.getElementById('docFormCollection').value;
    const colObj = AppState.collections.find((c) => c.id === colId);

    let driveUrlInput = document.getElementById('docFormDriveUrl').value.trim();
    let driveFileId = DriveService.extractFileId(driveUrlInput);
    let fileType = document.getElementById('docFormType').value;
    let fileSize = document.getElementById('docFormSize').value.trim() || '1.5 MB';
    let localBlobId = '';
    let localFileUrl = '';

    if (AppState.pendingUploadFile) {
      const uploadRes = await DriveService.uploadFile(
        AppState.pendingUploadFile,
        {
          title: document.getElementById('docFormTitle').value.trim(),
          collectionId: colId,
          collectionName: colObj ? colObj.name : 'Chung',
          collectionFolderId: colObj ? colObj.driveFolderId : '',
          description: document.getElementById('docFormDesc').value.trim()
        },
        (msg) => {
          statusEl.textContent = msg;
        }
      );

      if (uploadRes.driveFileId) driveFileId = uploadRes.driveFileId;
      if (uploadRes.driveUrl) driveUrlInput = uploadRes.driveUrl;
      if (uploadRes.localBlobId) localBlobId = uploadRes.localBlobId;
      if (uploadRes.localFileUrl) localFileUrl = uploadRes.localFileUrl;
      if (uploadRes.fileType) fileType = uploadRes.fileType;
      if (uploadRes.fileSize) fileSize = uploadRes.fileSize;
    }

    const tagsRaw = document.getElementById('docFormTags').value;
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (existingId) {
      const idx = AppState.documents.findIndex((d) => d.id === existingId);
      if (idx !== -1) {
        const old = AppState.documents[idx];
        AppState.documents[idx] = {
          ...old,
          code: document.getElementById('docFormCode').value.trim(),
          title: document.getElementById('docFormTitle').value.trim(),
          collectionId: colId,
          author: document.getElementById('docFormAuthor').value.trim() || 'Đang cập nhật',
          year: Number(document.getElementById('docFormYear').value) || new Date().getFullYear(),
          pages: Number(document.getElementById('docFormPages').value) || 1,
          fileType,
          fileSize,
          driveFileId: driveFileId || old.driveFileId,
          driveUrl: driveUrlInput || old.driveUrl,
          localBlobId: localBlobId || old.localBlobId,
          localFileUrl: localFileUrl || old.localFileUrl,
          coverUrl: AppState.pendingCoverDataUrl || old.coverUrl || '',
          accessLevel: document.getElementById('docFormAccess').value,
          tags,
          description: document.getElementById('docFormDesc').value.trim()
        };
        showToast('Đã cập nhật thông tin hồ sơ & đồng bộ Cloud!');
      }
    } else {
      const newDoc = {
        id: 'doc-' + Date.now(),
        code: document.getElementById('docFormCode').value.trim() || `HS-${Date.now()}`,
        title: document.getElementById('docFormTitle').value.trim(),
        collectionId: colId,
        author: document.getElementById('docFormAuthor').value.trim() || 'Đang cập nhật',
        year: Number(document.getElementById('docFormYear').value) || new Date().getFullYear(),
        pages: Number(document.getElementById('docFormPages').value) || 1,
        views: 1,
        downloads: 0,
        fileType,
        fileSize,
        driveFileId,
        driveUrl: driveUrlInput,
        localBlobId,
        localFileUrl,
        coverUrl: AppState.pendingCoverDataUrl || '',
        accessLevel: document.getElementById('docFormAccess').value,
        tags,
        description: document.getElementById('docFormDesc').value.trim(),
        createdAt: new Date().toISOString().slice(0, 10),
        uploadedBy: AppState.currentUser ? AppState.currentUser.fullName : 'Admin'
      };
      AppState.documents.unshift(newDoc);
      showToast('Đã thêm hồ sơ mới vào thư viện số!');
    }

    saveDocuments();
    populateFilterDropdowns();
    renderCollectionsSidebar();
    renderCatalog();
    closeModal('docFormModal');
  } catch (err) {
    alert('Lỗi khi lưu / tải lên hồ sơ: ' + err.message);
  } finally {
    btnSave.disabled = false;
  }
}

// ==========================================================================
// QUẢN LÝ BỘ SƯU TẬP (DANH MỤC BÊN TRÁI)
// ==========================================================================
function openCollectionsManagerModal() {
  if (!canManageDocs()) return;
  renderCollectionsManagerTable();
  openModal('collectionsModal');
}

function renderCollectionsManagerTable() {
  const tbody = document.getElementById('collectionsManagerBody');
  const realCols = AppState.collections.filter((c) => c.id !== 'all');

  tbody.innerHTML = realCols
    .map((c) => {
      const docCount = AppState.documents.filter((d) => d.collectionId === c.id).length;
      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px;"><strong>${escapeHtml(c.name)}</strong><br/><span style="font-size:11.5px;color:#64748b;">Mã: ${escapeHtml(c.id)}</span></td>
          <td style="padding:8px;font-size:13px;">${escapeHtml(c.description || '')}</td>
          <td style="padding:8px;font-size:12px;"><code>${escapeHtml(c.driveFolderId || 'Tự động')}</code></td>
          <td style="padding:8px;text-align:center;font-weight:600;">${docCount}</td>
          <td style="padding:8px;text-align:right;">
            <button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="deleteCollection('${escapeHtml(c.id)}')">Xóa</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function handleAddCollection(e) {
  e.preventDefault();
  const name = document.getElementById('newColName').value.trim();
  const desc = document.getElementById('newColDesc').value.trim();
  const folderId = DriveService.extractFileId(document.getElementById('newColFolderId').value.trim());

  if (!name) return;
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const id = slug || 'col-' + Date.now();
  if (AppState.collections.some((c) => c.id === id)) {
    alert('Bộ sưu tập này đã tồn tại!');
    return;
  }

  AppState.collections.push({
    id,
    name,
    description: desc,
    driveFolderId: folderId
  });

  saveCollections();
  document.getElementById('newColName').value = '';
  document.getElementById('newColDesc').value = '';
  document.getElementById('newColFolderId').value = '';

  renderCollectionsManagerTable();
  renderCollectionsSidebar();
  showToast(`Đã thêm bộ sưu tập "${name}"`);
}

function deleteCollection(colId) {
  const count = AppState.documents.filter((d) => d.collectionId === colId).length;
  if (count > 0) {
    alert(`Bộ sưu tập này đang chứa ${count} hồ sơ. Vui lòng chuyển hoặc xóa hồ sơ trước.`);
    return;
  }
  AppState.collections = AppState.collections.filter((c) => c.id !== colId);
  if (AppState.selectedCollectionId === colId) {
    AppState.selectedCollectionId = 'all';
  }
  saveCollections();
  renderCollectionsManagerTable();
  renderCollectionsSidebar();
  renderCatalog();
  showToast('Đã xóa bộ sưu tập.');
}

// ==========================================================================
// CẤU HÌNH KẾT NỐI GOOGLE DRIVE / FIREBASE CLOUD & QUÉT THƯ MỤC TỰ ĐỘNG
// ==========================================================================
function openDriveConfigModal() {
  const cfg = DriveService.getConfig();
  document.getElementById('cfgRootFolderId').value = cfg.rootFolderId || '';
  document.getElementById('cfgGasUrl').value = cfg.gasWebAppUrl || '';
  document.getElementById('cfgFirebaseUrl').value = cfg.firebaseDbUrl || '';
  document.getElementById('cfgAccessToken').value = cfg.accessToken || '';
  openModal('driveConfigModal');
}

async function handleSaveDriveConfig(e) {
  e.preventDefault();
  const cfg = DriveService.getConfig();
  cfg.rootFolderId = document.getElementById('cfgRootFolderId').value.trim();
  cfg.gasWebAppUrl = document.getElementById('cfgGasUrl').value.trim();
  cfg.firebaseDbUrl = document.getElementById('cfgFirebaseUrl').value.trim();
  cfg.accessToken = document.getElementById('cfgAccessToken').value.trim();
  DriveService.saveConfig(cfg);
  renderTopBar();

  // Nếu vừa kết nối Cloud DB, đồng bộ dữ liệu hiện tại lên Cloud
  if (DriveService.hasCloudDatabase()) {
    await pushStateToCloud();
  }

  closeModal('driveConfigModal');
  showToast('Đã lưu cấu hình kết nối Google Drive & Cloud Database!');
}

async function handleScanDriveFolderNow() {
  const cfg = DriveService.getConfig();
  cfg.rootFolderId = document.getElementById('cfgRootFolderId').value.trim();
  cfg.gasWebAppUrl = document.getElementById('cfgGasUrl').value.trim();
  DriveService.saveConfig(cfg);

  const btn = document.getElementById('btnScanDriveFolder');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang quét thư mục Google Drive...`;

  try {
    const res = await DriveService.scanGoogleDriveFolder();
    if (res.collections && res.collections.length > 1) {
      AppState.collections = res.collections;
    }
    if (res.documents && res.documents.length > 0) {
      AppState.documents = res.documents;
    }
    saveCollections();
    saveDocuments();
    renderCollectionsSidebar();
    populateFilterDropdowns();
    renderCatalog();
    showToast(`Đã đồng bộ ${res.documents.length} hồ sơ từ Google Drive!`);
    closeModal('driveConfigModal');
  } catch (err) {
    alert('Lỗi khi quét thư mục Google Drive: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-folder-tree"></i> Quét tự động các File có sẵn từ Drive`;
  }
}

function downloadCloudConfigFile() {
  const rootFolderId = document.getElementById('cfgRootFolderId').value.trim();
  const gasWebAppUrl = document.getElementById('cfgGasUrl').value.trim();
  const firebaseDbUrl = document.getElementById('cfgFirebaseUrl').value.trim();

  const content = `/**
 * FILE CẤU HÌNH ĐỒNG BỘ ĐÁM MÂY CHO WEB CÔNG KHAI (GITHUB PAGES / FIREBASE)
 * Đặt file này tại thư mục: js/cloud-config.js
 */
window.PUBLIC_CLOUD_CONFIG = {
  gasWebAppUrl: ${JSON.stringify(gasWebAppUrl)},
  rootFolderId: ${JSON.stringify(rootFolderId)},
  firebaseDbUrl: ${JSON.stringify(firebaseDbUrl)},
  defaultVisitorMode: "public_viewer",
  defaultAdminPassword: "123"
};
`;
  const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cloud-config.js';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã tải xuống file cloud-config.js để đưa lên GitHub / Firebase!');
}

// ==========================================================================
// BẢNG ĐIỀU KHIỂN THỐNG KÊ & XUẤT BÁO CÁO
// ==========================================================================
function openStatsModal() {
  const totalDocs = AppState.documents.length;
  const totalCols = AppState.collections.length - 1;
  const totalViews = AppState.documents.reduce((s, d) => s + (Number(d.views) || 0), 0);
  const totalDownloads = AppState.documents.reduce((s, d) => s + (Number(d.downloads) || 0), 0);

  document.getElementById('statBoxDocs').textContent = totalDocs;
  document.getElementById('statBoxCols').textContent = totalCols;
  document.getElementById('statBoxViews').textContent = totalViews.toLocaleString('vi-VN');
  document.getElementById('statBoxDownloads').textContent = totalDownloads.toLocaleString('vi-VN');

  const topDocs = [...AppState.documents]
    .sort((a, b) => (b.views || 0) + (b.downloads || 0) - ((a.views || 0) + (a.downloads || 0)))
    .slice(0, 8);

  document.getElementById('topDocsTableBody').innerHTML = topDocs
    .map((d, idx) => {
      const col = AppState.collections.find((c) => c.id === d.collectionId);
      return `
        <tr style="border-bottom:1px solid #e2e8f0;font-size:13px;">
          <td style="padding:8px;">${idx + 1}</td>
          <td style="padding:8px;"><strong>${escapeHtml(d.code || d.id)}</strong> - ${escapeHtml(d.title)}</td>
          <td style="padding:8px;">${escapeHtml(col ? col.name : d.collectionId)}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:var(--ou-navy);">${d.views || 0}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:#10b981;">${d.downloads || 0}</td>
        </tr>
      `;
    })
    .join('');

  openModal('statsModal');
}

function exportCatalogCSV() {
  const headers = ['Mã hồ sơ', 'Tiêu đề', 'Bộ sưu tập', 'Tác giả', 'Năm', 'Định dạng', 'Dung lượng', 'Lượt xem', 'Lượt tải', 'Google Drive Link'];
  const rows = AppState.documents.map((d) => {
    const col = AppState.collections.find((c) => c.id === d.collectionId);
    return [
      d.code || d.id,
      d.title,
      col ? col.name : d.collectionId,
      d.author,
      d.year,
      d.fileType,
      d.fileSize,
      d.views || 0,
      d.downloads || 0,
      d.driveUrl || d.driveFileId || ''
    ].map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Danh-muc-ho-so-thu-vien-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất danh mục hồ sơ ra file Excel (CSV)!');
}

function exportBackupJSON() {
  const backup = {
    exportedAt: new Date().toISOString(),
    collections: AppState.collections,
    documents: AppState.documents
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-thu-vien-so-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã tải xuống bản sao lưu dữ liệu JSON.');
}

// ==========================================================================
// ĐĂNG NHẬP & QUẢN LÝ PHÂN QUYỀN (RBAC - AN TOÀN CHO WEB CÔNG KHAI)
// ==========================================================================
function openAuthModal() {
  document.getElementById('chkRequireLoginView').checked = AppState.security.requireLoginToView;
  document.getElementById('chkRequireLoginDownload').checked = AppState.security.requireLoginToDownload;

  const listEl = document.getElementById('roleSwitchList');
  listEl.innerHTML = AppState.users
    .map((u) => {
      const isCurrent = AppState.currentUser && AppState.currentUser.username === u.username;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid ${isCurrent ? 'var(--ou-navy)' : '#e2e8f0'};background:${isCurrent ? '#eff6ff' : '#fff'};border-radius:6px;margin-bottom:8px;">
          <div>
            <strong>${escapeHtml(u.fullName)}</strong> <span style="font-size:12px;color:var(--ou-blue);">(${escapeHtml(u.roleLabel)})</span>
            <div style="font-size:12px;color:#64748b;">Tài khoản: <code>${escapeHtml(u.username)}</code> &bull; Mật khẩu mặc định: <code>123</code></div>
          </div>
          ${
            isCurrent
              ? `<span style="font-size:12px;font-weight:700;color:#10b981;"><i class="fa-solid fa-circle-check"></i> Đang sử dụng</span>`
              : `<button class="btn btn-primary" style="padding:5px 12px;font-size:12px;" onclick="switchUserRole('${escapeHtml(u.username)}')">Đăng nhập</button>`
          }
        </div>
      `;
    })
    .join('');

  openModal('authModal');
}

function switchUserRole(username) {
  if (!username) {
    AppState.currentUser = null;
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    showToast('Đã chuyển sang chế độ Độc giả công khai (Guest).');
  } else {
    const user = AppState.users.find((u) => u.username === username);
    if (user) {
      // Nếu chưa đăng nhập Admin và muốn chuyển sang Admin/Thủ thư trên web công khai -> hỏi mật khẩu
      if (['admin', 'editor'].includes(user.role) && (!AppState.currentUser || AppState.currentUser.role === 'viewer')) {
        const expectedPass = (window.PUBLIC_CLOUD_CONFIG && window.PUBLIC_CLOUD_CONFIG.defaultAdminPassword) || user.password || '123';
        const entered = prompt(`Nhập mật khẩu cho tài khoản "${user.username}" (Mặc định: ${expectedPass}):`, expectedPass);
        if (entered === null) return;
        if (entered !== expectedPass && entered !== user.password) {
          alert('Mật khẩu không chính xác!');
          return;
        }
      }
      AppState.currentUser = user;
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
      showToast(`Đã đăng nhập quyền: ${user.fullName}`);
    }
  }
  renderTopBar();
  renderCollectionsSidebar();
  renderCatalog();
  openAuthModal();
}

// ==========================================================================
// SỰ KIỆN GIAO DIỆN & TIỆN ÍCH CHUNG
// ==========================================================================
function bindEvents() {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchSubmitBtn');

  searchBtn.addEventListener('click', () => {
    AppState.searchQuery = searchInput.value;
    renderCatalog();
  });

  searchInput.addEventListener('keyup', () => {
    AppState.searchQuery = searchInput.value;
    renderCatalog();
  });

  document.getElementById('filterYearSelect').addEventListener('change', (e) => {
    AppState.filterYear = e.target.value;
    renderCatalog();
  });

  document.getElementById('filterTypeSelect').addEventListener('change', (e) => {
    AppState.filterType = e.target.value;
    renderCatalog();
  });

  document.getElementById('filterAuthorInput').addEventListener('input', (e) => {
    AppState.filterAuthor = e.target.value;
    renderCatalog();
  });

  document.getElementById('sortBySelect').addEventListener('change', (e) => {
    AppState.sortBy = e.target.value;
    renderCatalog();
  });

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    AppState.searchQuery = '';
    AppState.filterYear = 'all';
    AppState.filterType = 'all';
    AppState.filterAuthor = '';
    AppState.sortBy = 'newest';
    searchInput.value = '';
    document.getElementById('filterYearSelect').value = 'all';
    document.getElementById('filterTypeSelect').value = 'all';
    document.getElementById('filterAuthorInput').value = '';
    document.getElementById('sortBySelect').value = 'newest';
    renderCatalog();
  });

  const btnList = document.getElementById('btnViewList');
  const btnGrid = document.getElementById('btnViewGrid');

  btnList.addEventListener('click', () => {
    AppState.viewMode = 'list';
    btnList.classList.add('active');
    btnGrid.classList.remove('active');
    renderCatalog();
  });

  btnGrid.addEventListener('click', () => {
    AppState.viewMode = 'grid';
    btnGrid.classList.add('active');
    btnList.classList.remove('active');
    renderCatalog();
  });

  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('docFileInput');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  const coverInput = document.getElementById('docCoverInput');
  if (coverInput) {
    coverInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        AppState.pendingCoverDataUrl = reader.result;
        showToast('Đã chọn ảnh bìa cho hồ sơ.');
      };
      reader.readAsDataURL(f);
    });
  }

  document.getElementById('docForm').addEventListener('submit', handleSaveDocumentForm);
  document.getElementById('addCollectionForm').addEventListener('submit', handleAddCollection);
  document.getElementById('driveConfigForm').addEventListener('submit', handleSaveDriveConfig);

  document.getElementById('chkRequireLoginView').addEventListener('change', (e) => {
    AppState.security.requireLoginToView = e.target.checked;
    saveSecurity();
    renderCatalog();
  });

  document.getElementById('chkRequireLoginDownload').addEventListener('change', (e) => {
    AppState.security.requireLoginToDownload = e.target.checked;
    saveSecurity();
  });

  document.getElementById('btnResetDefaultData').addEventListener('click', () => {
    if (confirm('Khôi phục lại 19 tài liệu mẫu và danh mục mặc định ban đầu?')) {
      localStorage.removeItem(STORAGE_KEYS.COLLECTIONS);
      localStorage.removeItem(STORAGE_KEYS.DOCUMENTS);
      loadStateFromStorage();
      renderCollectionsSidebar();
      populateFilterDropdowns();
      renderCatalog();
      showToast('Đã khôi phục dữ liệu mẫu mặc định.');
    }
  });
}

function handleFileSelected(file) {
  AppState.pendingUploadFile = file;
  const titleInput = document.getElementById('docFormTitle');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, '');
  }
  const detectedType = DriveService.detectFileType(file.name, file.type);
  const typeSelect = document.getElementById('docFormType');
  if ([...typeSelect.options].some((o) => o.value === detectedType)) {
    typeSelect.value = detectedType;
  }
  document.getElementById('docFormSize').value = DriveService.formatBytes(file.size);
  document.getElementById('uploadDropzoneText').innerHTML = `
    <i class="fa-solid fa-circle-check" style="font-size:26px;color:#10b981;margin-bottom:4px;"></i>
    <div>Đã chọn file: <strong>${escapeHtml(file.name)}</strong> (${DriveService.formatBytes(file.size)})</div>
    <div style="font-size:12px;color:#059669;">Nhấn "Lưu Hồ sơ & Đồng bộ Google Drive" bên dưới để hoàn tất</div>
  `;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3400);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', initApp);
