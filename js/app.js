/* ==========================================================================
   PHÚC NGUYÊN LIBRARY - HỆ THỐNG LƯU TRỮ HỒ SƠ & THƯ VIỆN SỐ (GOOGLE DRIVE)
   ========================================================================== */

const STORAGE_KEYS = {
  BRANDING: 'pn_lib_branding_v4',
  COLLECTIONS: 'pn_lib_collections_v4',
  DOCUMENTS: 'pn_lib_documents_v4',
  USERS: 'pn_lib_users_v4',
  CURRENT_USER: 'pn_lib_current_user_v4',
  SECURITY_CONFIG: 'pn_lib_security_v4'
};

const AppState = {
  branding: { ...DEFAULT_BRANDING },
  collections: [],
  documents: [],
  users: [],
  currentUser: null,
  security: {
    requireLoginToView: false,
    requireLoginToDownload: false
  },
  selectedCollectionId: 'all',
  collapsedCollectionIds: {},
  searchQuery: '',
  filterYear: 'all',
  filterType: 'all',
  filterAuthor: '',
  sortBy: 'newest',
  viewMode: 'grid',
  activeDocId: null,
  docSourceMode: 'drive_link', // 'drive_link' | 'upload_file' | 'bulk_drive'
  pendingUploadFile: null,
  pendingCoverDataUrl: '',
  editingCollectionId: null
};

// ==========================================================================
// KHỞI TẠO HỆ THỐNG & ĐỒNG BỘ TỰ ĐỘNG (CLOUD + GOOGLE DRIVE)
// ==========================================================================
async function initApp() {
  cleanupLegacyStorage();
  loadStateFromStorage();
  applyBrandingToDOM();
  bindEvents();
  renderTopBar();
  renderCollectionsSidebar();
  populateFilterDropdowns();
  renderCatalog();
  updateSidebarQuickStats();

  // Tự động tải CSDL chung trên Cloud và tự động quét file mới trên Google Drive
  if (DriveService.hasCloudDatabase()) {
    await syncFromCloudSilent();
  }
  if (DriveService.hasDriveAutoScan()) {
    await autoMergeDriveFolderSilent();
    // Tự động kiểm tra file mới đẩy lên Google Drive mỗi 35 giây
    setInterval(() => {
      autoMergeDriveFolderSilent();
    }, 35000);
  }
}

function cleanupLegacyStorage() {
  const oldKeys = [
    'ou_lib_collections_v1', 'ou_lib_documents_v1',
    'pn_lib_branding_v2', 'pn_lib_collections_v2', 'pn_lib_documents_v2',
    'pn_lib_branding_v3', 'pn_lib_collections_v3', 'pn_lib_documents_v3'
  ];
  oldKeys.forEach((k) => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

function loadStateFromStorage() {
  try {
    const savedBrand = localStorage.getItem(STORAGE_KEYS.BRANDING);
    if (savedBrand) {
      AppState.branding = { ...DEFAULT_BRANDING, ...JSON.parse(savedBrand) };
    } else {
      AppState.branding = { ...DEFAULT_BRANDING };
    }

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
      const isPublicDomain =
        location.hostname.endsWith('.github.io') ||
        location.hostname.endsWith('.web.app') ||
        location.hostname.endsWith('.firebaseapp.com');
      const pubCfg = window.PUBLIC_CLOUD_CONFIG || {};
      if (isPublicDomain && pubCfg.defaultVisitorMode === 'public_viewer') {
        AppState.currentUser = null;
      } else {
        AppState.currentUser = AppState.users[0];
      }
    }

    const savedSec = localStorage.getItem(STORAGE_KEYS.SECURITY_CONFIG);
    if (savedSec) {
      AppState.security = JSON.parse(savedSec);
    }
  } catch (e) {
    console.error('Lỗi đọc dữ liệu localStorage:', e);
    AppState.branding = { ...DEFAULT_BRANDING };
    AppState.collections = [...DEFAULT_COLLECTIONS];
    AppState.documents = [...DEFAULT_DOCUMENTS];
    AppState.users = [...DEFAULT_USERS];
    AppState.currentUser = null;
  }
}

async function syncFromCloudSilent() {
  try {
    const res = await DriveService.fetchCloudCatalog();
    if (res && res.catalog) {
      if (res.catalog.branding) {
        AppState.branding = { ...DEFAULT_BRANDING, ...res.catalog.branding };
        safeSetLocalStorage(STORAGE_KEYS.BRANDING, AppState.branding);
        applyBrandingToDOM();
      }
      if (Array.isArray(res.catalog.collections) && res.catalog.collections.length > 0) {
        AppState.collections = res.catalog.collections;
        safeSetLocalStorage(STORAGE_KEYS.COLLECTIONS, AppState.collections);
      }
      if (Array.isArray(res.catalog.documents)) {
        AppState.documents = res.catalog.documents;
        safeSetLocalStorage(STORAGE_KEYS.DOCUMENTS, AppState.documents);
      }
      if (Array.isArray(res.catalog.users) && res.catalog.users.length > 0) {
        AppState.users = res.catalog.users;
        safeSetLocalStorage(STORAGE_KEYS.USERS, AppState.users);
      }
      if (res.catalog.security) {
        AppState.security = res.catalog.security;
        safeSetLocalStorage(STORAGE_KEYS.SECURITY_CONFIG, AppState.security);
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

// Tự động gộp (Smart Merge) các thư mục & file mới đẩy lên Google Drive vào thư viện web
async function autoMergeDriveFolderSilent(showNotification = false) {
  if (!DriveService.hasDriveAutoScan()) return;
  try {
    const scanned = await DriveService.scanGoogleDriveFolder();
    let newColsAdded = 0;
    let newDocsAdded = 0;

    if (Array.isArray(scanned.collections)) {
      for (const sc of scanned.collections) {
        if (sc.id === 'all') continue;
        const exists = AppState.collections.some(
          (c) => c.id === sc.id || (sc.driveFolderId && c.driveFolderId === sc.driveFolderId)
        );
        if (!exists) {
          AppState.collections.push(sc);
          newColsAdded++;
        }
      }
    }

    if (Array.isArray(scanned.documents)) {
      for (const sd of scanned.documents) {
        const exists = AppState.documents.some(
          (d) => d.id === sd.id || (sd.driveFileId && d.driveFileId === sd.driveFileId)
        );
        if (!exists) {
          AppState.documents.unshift(sd);
          newDocsAdded++;
        }
      }
    }

    if (newColsAdded > 0 || newDocsAdded > 0) {
      saveCollections();
      saveDocuments();
      renderCollectionsSidebar();
      populateFilterDropdowns();
      renderCatalog();
      if (showNotification) {
        showToast(`Đã tự động cập nhật ${newDocsAdded} tài liệu và ${newColsAdded} thư mục mới từ Google Drive!`);
      }
    } else if (showNotification) {
      showToast('Kho thư viện đã đồng bộ mới nhất với Google Drive.');
    }
  } catch (e) {
    if (showNotification) {
      alert('Không thể đồng bộ từ Google Drive: ' + e.message);
    }
  }
}

async function pushStateToCloud() {
  if (!DriveService.hasCloudDatabase()) return;
  try {
    await DriveService.pushCloudCatalog({
      branding: AppState.branding,
      collections: AppState.collections,
      documents: AppState.documents,
      users: AppState.users,
      security: AppState.security
    });
  } catch (e) {
    console.warn('Lỗi đẩy dữ liệu lên Cloud:', e);
  }
}

function safeSetLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Bộ nhớ localStorage đầy, đang tối ưu hóa dung lượng:', e);
  }
}

function saveBranding() {
  safeSetLocalStorage(STORAGE_KEYS.BRANDING, AppState.branding);
  applyBrandingToDOM();
  pushStateToCloud();
}

function saveCollections() {
  safeSetLocalStorage(STORAGE_KEYS.COLLECTIONS, AppState.collections);
  pushStateToCloud();
}

function saveDocuments() {
  safeSetLocalStorage(STORAGE_KEYS.DOCUMENTS, AppState.documents);
  updateSidebarQuickStats();
  pushStateToCloud();
}

function saveUsers() {
  safeSetLocalStorage(STORAGE_KEYS.USERS, AppState.users);
  pushStateToCloud();
}

function saveSecurity() {
  safeSetLocalStorage(STORAGE_KEYS.SECURITY_CONFIG, AppState.security);
  pushStateToCloud();
}

function canManageDocs() {
  return AppState.currentUser && ['admin', 'editor'].includes(AppState.currentUser.role);
}

function isAdmin() {
  return AppState.currentUser && AppState.currentUser.role === 'admin';
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
// 1. GIAO DIỆN & LOGO CHÍNH THỨC PHÚC NGUYÊN LIBRARY
// ==========================================================================
function applyBrandingToDOM() {
  const b = AppState.branding || DEFAULT_BRANDING;
  const root = document.documentElement;

  root.style.setProperty('--pn-primary', b.primaryColor || '#254b73');
  root.style.setProperty('--pn-gold', b.goldColor || '#214b2f');
  if (b.fontFamily) {
    root.style.setProperty('--font-main', b.fontFamily);
  }

  const topBrandText = document.getElementById('topBrandNameText');
  if (topBrandText) topBrandText.textContent = b.libraryName || 'PHÚC NGUYÊN LIBRARY';

  const heroTitle = document.getElementById('heroBannerTitle');
  if (heroTitle) heroTitle.textContent = b.bannerTitle || 'PHÚC NGUYÊN LIBRARY';

  const heroSub = document.getElementById('heroBannerSubtitle');
  if (heroSub) heroSub.textContent = b.bannerSubtitle || 'RESEARCH LAW FOR BETTER LIFE • TÀI LIỆU SỐ';

  const footerBrand = document.getElementById('footerBrandName');
  if (footerBrand) footerBrand.textContent = b.libraryName || 'PHÚC NGUYÊN LIBRARY';

  const logoSrc = b.logoDataUrl || 'logo.png';
  const logoHtml = `<img src="${escapeHtml(logoSrc)}" alt="Phúc Nguyên Library" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;

  const topLogoWrap = document.getElementById('topBrandLogoWrap');
  if (topLogoWrap) topLogoWrap.innerHTML = logoHtml;

  const heroLogoWrap = document.getElementById('heroLogoBadge');
  if (heroLogoWrap) heroLogoWrap.innerHTML = logoHtml;
}

function openBrandingModal() {
  if (!isAdmin()) return;
  const b = AppState.branding || DEFAULT_BRANDING;
  document.getElementById('brandLibraryName').value = b.libraryName || '';
  document.getElementById('brandBannerTitle').value = b.bannerTitle || '';
  document.getElementById('brandBannerSubtitle').value = b.bannerSubtitle || '';
  document.getElementById('brandPrimaryColor').value = b.primaryColor || '#254b73';
  document.getElementById('brandGoldColor').value = b.goldColor || '#214b2f';
  document.getElementById('brandFontSelect').value = b.fontFamily || "'Be Vietnam Pro', 'Roboto', sans-serif";

  const logoSrc = b.logoDataUrl || 'logo.png';
  const previewEl = document.getElementById('brandLogoPreviewBox');
  previewEl.innerHTML = `<img src="${escapeHtml(logoSrc)}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;

  openModal('brandingModal');
}

function handleSaveBranding(e) {
  e.preventDefault();
  AppState.branding = {
    ...AppState.branding,
    libraryName: document.getElementById('brandLibraryName').value.trim() || 'PHÚC NGUYÊN LIBRARY',
    bannerTitle: document.getElementById('brandBannerTitle').value.trim() || 'PHÚC NGUYÊN LIBRARY',
    bannerSubtitle: document.getElementById('brandBannerSubtitle').value.trim() || 'RESEARCH LAW FOR BETTER LIFE • TÀI LIỆU SỐ',
    primaryColor: document.getElementById('brandPrimaryColor').value,
    goldColor: document.getElementById('brandGoldColor').value,
    fontFamily: document.getElementById('brandFontSelect').value
  };
  saveBranding();
  closeModal('brandingModal');
  showToast('Đã cập nhật giao diện & thương hiệu Phúc Nguyên Library!');
}

// ==========================================================================
// HIỂN THỊ THANH TIỆN ÍCH TRÊN CÙNG (TOP BAR)
// ==========================================================================
function renderTopBar() {
  const driveCfg = DriveService.getConfig();
  const statusEl = document.getElementById('driveStatusPill');
  if (driveCfg.firebaseDbUrl && driveCfg.gasWebAppUrl) {
    statusEl.innerHTML = `<i class="fa-solid fa-cloud"></i> Đã nối Google Drive + Firebase`;
  } else if (driveCfg.gasWebAppUrl) {
    statusEl.innerHTML = `<i class="fa-brands fa-google-drive"></i> Đã nối Tự động Google Drive`;
  } else if (driveCfg.firebaseDbUrl) {
    statusEl.innerHTML = `<i class="fa-solid fa-fire"></i> Đã nối Firebase Cloud`;
  } else {
    statusEl.innerHTML = `<i class="fa-brands fa-google-drive"></i> Cấu hình Tự động Đồng bộ Drive`;
  }

  const hasEditPerm = canManageDocs();
  const adminOnly = isAdmin();

  const showEl = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'inline-flex' : 'none';
  };

  showEl('btnOpenUploadTop', hasEditPerm);
  showEl('btnToolbarAddDoc', hasEditPerm);
  showEl('btnToolbarLinkDrive', hasEditPerm);
  showEl('btnToolbarSyncDrive', hasEditPerm);
  showEl('btnManageCollections', hasEditPerm);
  showEl('btnOpenDriveConfigTop', adminOnly);
  showEl('btnOpenUsersTop', adminOnly);
  showEl('btnOpenBrandingTop', adminOnly);
  showEl('btnOpenStatsTop', hasEditPerm);
  showEl('driveStatusPill', hasEditPerm);

  const userBadge = document.getElementById('currentUserBadge');
  if (AppState.currentUser) {
    userBadge.innerHTML = `<i class="fa-solid fa-user-check"></i> ${escapeHtml(AppState.currentUser.fullName)} <span style="opacity:0.8;font-size:11.5px;">(Đăng xuất)</span>`;
  } else {
    userBadge.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Đăng nhập`;
  }
}

// ==========================================================================
// 2. BỘ SƯU TẬP ĐA CẤP (THƯ MỤC TRONG THƯ MỤC & SỬA TÊN BỘ SƯU TẬP)
// ==========================================================================
function getDescendantCollectionIds(parentId) {
  const result = new Set([parentId]);
  let added = true;
  while (added) {
    added = false;
    for (const col of AppState.collections) {
      if (col.parentId && result.has(col.parentId) && !result.has(col.id)) {
        result.add(col.id);
        added = true;
      }
    }
  }
  return Array.from(result);
}

function getCollectionPath(colId) {
  if (!colId || colId === 'all') return [];
  const path = [];
  let current = AppState.collections.find((c) => c.id === colId);
  const visited = new Set();
  while (current && current.id !== 'all' && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId
      ? AppState.collections.find((c) => c.id === current.parentId)
      : null;
  }
  return path;
}

function getFlattenedCollectionsTree() {
  const realCols = AppState.collections.filter((c) => c.id !== 'all');
  const colMap = new Map(realCols.map((c) => [c.id, c]));
  const childrenMap = new Map();

  for (const col of realCols) {
    const pId = col.parentId && colMap.has(col.parentId) ? col.parentId : null;
    if (!childrenMap.has(pId)) childrenMap.set(pId, []);
    childrenMap.get(pId).push(col);
  }

  const result = [];
  function traverse(parentId, level) {
    const list = childrenMap.get(parentId) || [];
    for (const item of list) {
      const children = childrenMap.get(item.id) || [];
      result.push({
        ...item,
        level,
        hasChildren: children.length > 0
      });
      if (!AppState.collapsedCollectionIds[item.id]) {
        traverse(item.id, level + 1);
      }
    }
  }
  traverse(null, 0);
  return result;
}

function getAllCollectionsTreeForSelect(excludeId = null) {
  const realCols = AppState.collections.filter((c) => c.id !== 'all');
  const excludedSet = excludeId ? new Set(getDescendantCollectionIds(excludeId)) : new Set();
  const colMap = new Map(realCols.map((c) => [c.id, c]));
  const childrenMap = new Map();

  for (const col of realCols) {
    if (excludedSet.has(col.id)) continue;
    const pId = col.parentId && colMap.has(col.parentId) ? col.parentId : null;
    if (!childrenMap.has(pId)) childrenMap.set(pId, []);
    childrenMap.get(pId).push(col);
  }

  const out = [];
  function walk(parentId, level) {
    const list = childrenMap.get(parentId) || [];
    for (const item of list) {
      out.push({ ...item, level });
      walk(item.id, level + 1);
    }
  }
  walk(null, 0);
  return out;
}

function renderCollectionsSidebar() {
  const listEl = document.getElementById('collectionsList');
  if (!listEl) return;

  const visibleDocs = AppState.documents.filter(canViewDocument);
  const allCol = AppState.collections.find((c) => c.id === 'all') || DEFAULT_COLLECTIONS[0];
  const treeItems = getFlattenedCollectionsTree();
  const hasEdit = canManageDocs();

  let html = `
    <li class="collection-item ${AppState.selectedCollectionId === 'all' ? 'active' : ''}" data-collection-id="all">
      <div class="collection-item-left">
        <i class="fa-solid fa-layer-group" style="font-size:12.5px;opacity:0.85;"></i>
        <span class="collection-name-text">${escapeHtml(allCol.name)}</span>
      </div>
      <div class="collection-item-right">
        <span class="collection-count">${visibleDocs.length}</span>
      </div>
    </li>
  `;

  for (const col of treeItems) {
    const descendantIds = getDescendantCollectionIds(col.id);
    const count = visibleDocs.filter((d) => descendantIds.includes(d.collectionId)).length;
    const isActive = AppState.selectedCollectionId === col.id;
    const isCollapsed = Boolean(AppState.collapsedCollectionIds[col.id]);
    const indentPx = col.level * 16;

    const caretHtml = col.hasChildren
      ? `<span class="tree-caret" data-toggle-id="${escapeHtml(col.id)}" title="Đóng/Mở thư mục con">
           <i class="fa-solid ${isCollapsed ? 'fa-caret-right' : 'fa-caret-down'}"></i>
         </span>`
      : `<span style="width:18px;display:inline-block;text-align:center;opacity:0.55;font-size:11px;">
           ${col.level > 0 ? '└' : '<i class="fa-regular fa-folder"></i>'}
         </span>`;

    const quickAdminBtns = hasEdit
      ? `<button class="btn-quick-subfolder" data-add-sub="${escapeHtml(col.id)}" title="Thêm thư mục con vào trong '${escapeHtml(col.name)}'">
           <i class="fa-solid fa-folder-plus"></i>
         </button>
         <button class="btn-quick-subfolder" data-edit-col="${escapeHtml(col.id)}" title="Sửa tên bộ sưu tập '${escapeHtml(col.name)}'">
           <i class="fa-solid fa-pen"></i>
         </button>`
      : '';

    html += `
      <li class="collection-item ${isActive ? 'active' : ''}" data-collection-id="${escapeHtml(col.id)}" style="padding-left:${10 + indentPx}px;" title="${escapeHtml(col.description || col.name)}">
        <div class="collection-item-left">
          ${caretHtml}
          <span class="collection-name-text">${escapeHtml(col.name)}</span>
        </div>
        <div class="collection-item-right">
          ${quickAdminBtns}
          <span class="collection-count">${count}</span>
        </div>
      </li>
    `;
  }

  if (treeItems.length === 0 && hasEdit) {
    html += `
      <li style="padding:14px 10px;text-align:center;border-top:1px dashed #cbd5e1;margin-top:6px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:8px;">Kho thư mục đang trống để bạn thiết kế từ đầu.</div>
        <button type="button" class="btn btn-primary" style="width:100%;justify-content:center;font-size:12.5px;padding:7px 10px;" onclick="openCollectionsManagerModal()">
          <i class="fa-solid fa-folder-plus"></i> + Tạo Thư mục đầu tiên
        </button>
      </li>
    `;
  }

  listEl.innerHTML = html;

  listEl.querySelectorAll('.tree-caret').forEach((caret) => {
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = caret.getAttribute('data-toggle-id');
      AppState.collapsedCollectionIds[id] = !AppState.collapsedCollectionIds[id];
      renderCollectionsSidebar();
    });
  });

  listEl.querySelectorAll('[data-add-sub]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentId = btn.getAttribute('data-add-sub');
      openCollectionsManagerModal(null, parentId);
    });
  });

  listEl.querySelectorAll('[data-edit-col]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const colId = btn.getAttribute('data-edit-col');
      openCollectionsManagerModal(colId, null);
    });
  });

  listEl.querySelectorAll('.collection-item').forEach((item) => {
    item.addEventListener('click', () => {
      AppState.selectedCollectionId = item.getAttribute('data-collection-id');
      renderCollectionsSidebar();
      renderCatalog();
    });
  });
}

function openCollectionsManagerModal(editColId = null, presetParentId = null) {
  if (!canManageDocs()) {
    showToast('Vui lòng đăng nhập quyền Quản trị để quản lý Bộ sưu tập!');
    openLoginModal();
    return;
  }
  resetCollectionForm(editColId, presetParentId);
  renderCollectionsManagerTable();
  openModal('collectionsModal');
}

function resetCollectionForm(editColId = null, presetParentId = null) {
  AppState.editingCollectionId = editColId;
  const parentSelect = document.getElementById('colFormParentId');
  const treeOpts = getAllCollectionsTreeForSelect(editColId);

  parentSelect.innerHTML =
    `<option value="">-- Thư mục gốc (Cấp cao nhất) --</option>` +
    treeOpts
      .map((c) => {
        const prefix = '— '.repeat(c.level);
        return `<option value="${escapeHtml(c.id)}">${prefix}${escapeHtml(c.name)}</option>`;
      })
      .join('');

  const formHeading = document.getElementById('colFormHeading');
  const submitBtn = document.getElementById('btnSubmitColForm');
  const cancelEditBtn = document.getElementById('btnCancelEditCol');

  if (editColId) {
    const col = AppState.collections.find((c) => c.id === editColId);
    if (col) {
      formHeading.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Sửa Bộ sưu tập / Thư mục: <span style="color:var(--pn-accent);">${escapeHtml(col.name)}</span>`;
      document.getElementById('colFormName').value = col.name || '';
      parentSelect.value = col.parentId || '';
      document.getElementById('colFormFolderId').value = col.driveFolderId || '';
      document.getElementById('colFormDesc').value = col.description || '';
      submitBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi`;
      cancelEditBtn.style.display = 'inline-flex';
      return;
    }
  }

  formHeading.innerHTML = `<i class="fa-solid fa-folder-plus"></i> Thêm Bộ sưu tập / Thư mục mới`;
  document.getElementById('colFormName').value = '';
  parentSelect.value = presetParentId || '';
  document.getElementById('colFormFolderId').value = '';
  document.getElementById('colFormDesc').value = '';
  submitBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Thêm vào danh mục`;
  cancelEditBtn.style.display = 'none';
}

function renderCollectionsManagerTable() {
  const tbody = document.getElementById('collectionsManagerBody');
  const allTree = getAllCollectionsTreeForSelect(null);

  if (allTree.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:20px;text-align:center;color:#64748b;">
          Chưa có thư mục nào. Hãy nhập tên thư mục ở khung phía trên và nhấn <strong>"Thêm vào danh mục"</strong> để bắt đầu thiết kế cây thư mục.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allTree
    .map((c) => {
      const directCount = AppState.documents.filter((d) => d.collectionId === c.id).length;
      const parentObj = c.parentId ? AppState.collections.find((p) => p.id === c.parentId) : null;
      const indent = c.level > 0 ? `<span style="color:#94a3b8;margin-left:${c.level * 14}px;">└── </span>` : '';

      return `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px;">
            ${indent}<strong>${escapeHtml(c.name)}</strong>
          </td>
          <td style="padding:8px;font-size:12.5px;color:#475569;">
            ${parentObj ? `<span style="background:#f1f5f9;padding:2px 7px;border-radius:4px;">${escapeHtml(parentObj.name)}</span>` : '<span style="color:#94a3b8;">Thư mục gốc</span>'}
          </td>
          <td style="padding:8px;font-size:12.5px;color:#64748b;">${escapeHtml(c.description || '')}</td>
          <td style="padding:8px;text-align:center;font-weight:600;">${directCount}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap;">
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;" onclick="resetCollectionForm(null, '${escapeHtml(c.id)}')" title="Thêm thư mục con vào mục này">
              <i class="fa-solid fa-folder-plus"></i> +Con
            </button>
            <button class="btn btn-primary" style="padding:4px 8px;font-size:12px;" onclick="resetCollectionForm('${escapeHtml(c.id)}', null)">
              <i class="fa-solid fa-pen"></i> Sửa tên
            </button>
            <button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="deleteCollection('${escapeHtml(c.id)}')">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function handleSaveCollectionForm(e) {
  e.preventDefault();
  const name = document.getElementById('colFormName').value.trim();
  const parentId = document.getElementById('colFormParentId').value || null;
  const desc = document.getElementById('colFormDesc').value.trim();
  const folderId = DriveService.extractFileId(document.getElementById('colFormFolderId').value.trim());

  if (!name) return;

  if (AppState.editingCollectionId) {
    const idx = AppState.collections.findIndex((c) => c.id === AppState.editingCollectionId);
    if (idx !== -1) {
      AppState.collections[idx] = {
        ...AppState.collections[idx],
        name,
        parentId,
        description: desc,
        driveFolderId: folderId
      };
      showToast(`Đã đổi tên / cập nhật bộ sưu tập thành "${name}"!`);
    }
  } else {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    let id = slug || 'col-' + Date.now();
    if (AppState.collections.some((c) => c.id === id)) {
      id = `${id}-${Date.now().toString().slice(-4)}`;
    }

    AppState.collections.push({
      id,
      name,
      parentId,
      description: desc,
      driveFolderId: folderId
    });
    showToast(`Đã thêm bộ sưu tập "${name}"!`);
  }

  saveCollections();
  resetCollectionForm(null, null);
  renderCollectionsManagerTable();
  renderCollectionsSidebar();
  renderCatalog();
}

function deleteCollection(colId) {
  const childCols = AppState.collections.filter((c) => c.parentId === colId);
  if (childCols.length > 0) {
    alert(`Bộ sưu tập này đang có ${childCols.length} thư mục con bên trong. Vui lòng xóa hoặc chuyển các thư mục con trước!`);
    return;
  }
  const count = AppState.documents.filter((d) => d.collectionId === colId).length;
  if (count > 0) {
    alert(`Bộ sưu tập này đang chứa ${count} hồ sơ. Vui lòng chuyển hoặc xóa hồ sơ trước.`);
    return;
  }
  if (!confirm('Bạn có chắc chắn muốn xóa bộ sưu tập này?')) return;

  AppState.collections = AppState.collections.filter((c) => c.id !== colId);
  if (AppState.selectedCollectionId === colId) {
    AppState.selectedCollectionId = 'all';
  }
  saveCollections();
  resetCollectionForm(null, null);
  renderCollectionsManagerTable();
  renderCollectionsSidebar();
  renderCatalog();
  showToast('Đã xóa bộ sưu tập.');
}

function handleClearAllLibraryData() {
  if (!canManageDocs()) return;
  if (!confirm('Bạn có chắc chắn muốn XÓA TẤT CẢ thư mục và tài liệu hiện có để làm mới hoàn toàn từ đầu không?')) {
    return;
  }
  AppState.collections = [{ id: 'all', name: 'Tất cả bộ sưu tập', parentId: null, description: 'Toàn bộ hồ sơ và tài liệu số trong kho lưu trữ', driveFolderId: '' }];
  AppState.documents = [];
  AppState.selectedCollectionId = 'all';
  saveCollections();
  saveDocuments();
  resetCollectionForm(null, null);
  renderCollectionsManagerTable();
  renderCollectionsSidebar();
  populateFilterDropdowns();
  renderCatalog();
  showToast('Đã xóa sạch toàn bộ Thư mục & Tài liệu!');
}

// ==========================================================================
// 3. ĐĂNG NHẬP BẢO MẬT (KHÔNG GỢI Ý MẬT KHẨU) & CẤP TÀI KHOẢN ĐỘC GIẢ
// ==========================================================================
function handleUserButtonClick() {
  if (AppState.currentUser) {
    if (confirm(`Bạn đang đăng nhập với tài khoản "${AppState.currentUser.fullName}".\nBạn có muốn Đăng xuất không?`)) {
      AppState.currentUser = null;
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
      renderTopBar();
      renderCollectionsSidebar();
      renderCatalog();
      showToast('Đã đăng xuất khỏi hệ thống.');
    }
  } else {
    openLoginModal();
  }
}

function openLoginModal() {
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginErrorMsg').textContent = '';
  openModal('loginModal');
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const uInput = document.getElementById('loginUsername').value.trim();
  const pInput = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginErrorMsg');

  const found = AppState.users.find(
    (u) => u.username.toLowerCase() === uInput.toLowerCase() && u.password === pInput
  );

  if (!found) {
    errEl.textContent = 'Tên đăng nhập hoặc mật khẩu không chính xác.';
    return;
  }

  if (found.status === 'locked') {
    errEl.textContent = 'Tài khoản này đã bị tạm khóa bởi Quản trị viên.';
    return;
  }

  AppState.currentUser = found;
  safeSetLocalStorage(STORAGE_KEYS.CURRENT_USER, found);
  closeModal('loginModal');
  renderTopBar();
  renderCollectionsSidebar();
  renderCatalog();
  showToast(`Xin chào, ${found.fullName}!`);
}

function openUserManagementModal() {
  if (!isAdmin()) return;
  document.getElementById('chkRequireLoginView').checked = AppState.security.requireLoginToView;
  document.getElementById('chkRequireLoginDownload').checked = AppState.security.requireLoginToDownload;
  renderUsersTable();
  openModal('userManagementModal');
}

function renderUsersTable() {
  const tbody = document.getElementById('usersManagerTableBody');
  tbody.innerHTML = AppState.users
    .map((u) => {
      const roleBadge =
        u.role === 'admin'
          ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:4px;font-size:11.5px;font-weight:600;">Quản trị viên</span>'
          : u.role === 'editor'
          ? '<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:11.5px;font-weight:600;">Thủ thư / Biên mục</span>'
          : '<span style="background:#d1fae5;color:#065f46;padding:2px 7px;border-radius:4px;font-size:11.5px;font-weight:600;">Độc giả xem thư viện</span>';

      return `
        <tr style="border-bottom:1px solid #e2e8f0;font-size:13px;">
          <td style="padding:8px;"><strong>${escapeHtml(u.username)}</strong></td>
          <td style="padding:8px;">${escapeHtml(u.fullName)}<br/><span style="font-size:11.5px;color:#64748b;">${escapeHtml(u.department || '')}</span></td>
          <td style="padding:8px;">${roleBadge}</td>
          <td style="padding:8px;text-align:right;white-space:nowrap;">
            <button class="btn btn-outline" style="padding:4px 8px;font-size:12px;" onclick="handleResetUserPassword('${escapeHtml(u.username)}')">
              <i class="fa-solid fa-key"></i> Đổi MK
            </button>
            ${
              u.username !== 'admin'
                ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="handleDeleteUser('${escapeHtml(u.username)}')">
                     <i class="fa-regular fa-trash-can"></i> Xóa
                   </button>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');
}

function handleProvisionUser(e) {
  e.preventDefault();
  if (!isAdmin()) return;

  const username = document.getElementById('newUserUsername').value.trim();
  const password = document.getElementById('newUserPassword').value.trim();
  const fullName = document.getElementById('newUserFullName').value.trim();
  const department = document.getElementById('newUserDept').value.trim();
  const role = document.getElementById('newUserRole').value;

  if (!username || !password || !fullName) return;

  if (AppState.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    alert('Tên đăng nhập này đã tồn tại! Vui lòng chọn tên đăng nhập khác.');
    return;
  }

  const roleLabels = {
    viewer: 'Độc giả Thư viện',
    editor: 'Thủ thư / Biên mục',
    admin: 'Quản trị viên'
  };

  AppState.users.push({
    username,
    password,
    fullName,
    department,
    role,
    roleLabel: roleLabels[role] || 'Độc giả Thư viện',
    status: 'active',
    createdAt: new Date().toISOString().slice(0, 10)
  });

  saveUsers();
  document.getElementById('newUserUsername').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserFullName').value = '';
  document.getElementById('newUserDept').value = '';

  renderUsersTable();
  showToast(`Đã cấp tài khoản "${username}" cho ${fullName}!`);
}

function handleResetUserPassword(username) {
  const user = AppState.users.find((u) => u.username === username);
  if (!user) return;
  const newPass = prompt(`Nhập mật khẩu mới cho tài khoản "${user.username}" (${user.fullName}):`, '');
  if (!newPass || !newPass.trim()) return;
  user.password = newPass.trim();
  saveUsers();
  showToast(`Đã cập nhật mật khẩu cho tài khoản "${user.username}".`);
}

function handleDeleteUser(username) {
  if (username === 'admin') return;
  if (!confirm(`Xóa tài khoản "${username}"? Người này sẽ không thể đăng nhập nữa.`)) return;
  AppState.users = AppState.users.filter((u) => u.username !== username);
  saveUsers();
  renderUsersTable();
  showToast(`Đã thu hồi tài khoản "${username}".`);
}

// ==========================================================================
// 4 & 5. KÉO THẢ ẢNH BÌA & GẮN / UPLOAD TÀI LIỆU GOOGLE DRIVE TỨC THÌ
// ==========================================================================
function setDocSourceMode(mode) {
  AppState.docSourceMode = mode;
  document.querySelectorAll('.source-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-source-mode') === mode);
  });

  document.getElementById('paneSourceDriveLink').style.display = mode === 'drive_link' ? 'block' : 'none';
  document.getElementById('paneSourceUploadFile').style.display = mode === 'upload_file' ? 'block' : 'none';
  document.getElementById('paneSourceBulkDrive').style.display = mode === 'bulk_drive' ? 'block' : 'none';
  document.getElementById('singleDocMetadataFields').style.display = mode === 'bulk_drive' ? 'none' : 'grid';
}

function updateCoverPreviewInForm() {
  const previewBox = document.getElementById('formCoverPreviewBox');
  const btnRemove = document.getElementById('btnRemoveCustomCover');
  if (!previewBox) return;

  if (AppState.pendingCoverDataUrl) {
    previewBox.innerHTML = `<img class="custom-cover" src="${escapeHtml(AppState.pendingCoverDataUrl)}" alt="Cover" />`;
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    previewBox.innerHTML = OU_BOOK_EMBLEM_SVG;
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function processCoverImageFile(file, callback) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Vui lòng kéo thả hoặc chọn file hình ảnh (JPG, PNG, WebP...)!');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 360;
      const maxH = 480;
      let w = img.width;
      let h = img.height;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
      callback(dataUrl);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function openAddDocumentModal(defaultMode = 'drive_link') {
  if (!canManageDocs()) {
    showToast('Vui lòng đăng nhập quyền Quản trị để thêm/gắn hồ sơ!');
    openLoginModal();
    return;
  }

  AppState.pendingUploadFile = null;
  AppState.pendingCoverDataUrl = '';
  setDocSourceMode(defaultMode);

  document.getElementById('docFormModalTitle').innerHTML = `<i class="fa-brands fa-google-drive"></i> Gắn Tài liệu từ Google Drive / Tải Hồ sơ Mới`;
  document.getElementById('docFormId').value = '';
  document.getElementById('docFormCode').value = `PN-${new Date().getFullYear()}-${String(AppState.documents.length + 1).padStart(3, '0')}`;
  document.getElementById('docFormTitle').value = '';
  populateDocFormCollections(AppState.selectedCollectionId);
  document.getElementById('docFormAuthor').value = '';
  document.getElementById('docFormYear').value = new Date().getFullYear();
  document.getElementById('docFormPages').value = '15';
  document.getElementById('docFormType').value = 'PDF';
  document.getElementById('docFormSize').value = '';
  document.getElementById('docFormDriveUrl').value = '';
  document.getElementById('driveLinkCheckStatus').textContent = '';
  document.getElementById('bulkDriveLinksInput').value = '';
  document.getElementById('docFormAccess').value = 'public';
  document.getElementById('docFormTags').value = '';
  document.getElementById('docFormDesc').value = '';
  document.getElementById('uploadDropzoneText').innerHTML = `
    <i class="fa-solid fa-cloud-arrow-up" style="font-size:26px;color:var(--pn-accent);margin-bottom:4px;"></i>
    <div><strong>Kéo thả file hồ sơ (PDF, Word, Excel, Ảnh...) vào đây</strong> hoặc nhấn để chọn file từ máy tính</div>
  `;
  document.getElementById('uploadStatusText').textContent = '';

  updateCoverPreviewInForm();
  openModal('docFormModal');
}

function openEditDocumentModal(docId) {
  if (!canManageDocs()) return;
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  AppState.pendingUploadFile = null;
  AppState.pendingCoverDataUrl = doc.coverUrl || '';
  setDocSourceMode('drive_link');

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
  document.getElementById('driveLinkCheckStatus').textContent = '';
  document.getElementById('docFormAccess').value = doc.accessLevel || 'public';
  document.getElementById('docFormTags').value = (doc.tags || []).join(', ');
  document.getElementById('docFormDesc').value = doc.description || '';
  document.getElementById('uploadStatusText').textContent = '';

  updateCoverPreviewInForm();
  openModal('docFormModal');
}

function populateDocFormCollections(selectedId) {
  const select = document.getElementById('docFormCollection');
  const bulkSelect = document.getElementById('bulkDocCollection');
  const treeOpts = getAllCollectionsTreeForSelect(null);

  const html =
    `<option value="all">-- Tất cả bộ sưu tập (Thư mục chung) --</option>` +
    treeOpts
      .map((c) => {
        const prefix = '— '.repeat(c.level);
        return `<option value="${escapeHtml(c.id)}">${prefix}${escapeHtml(c.name)}</option>`;
      })
      .join('');

  select.innerHTML = html;
  if (bulkSelect) bulkSelect.innerHTML = html;

  if (selectedId && (selectedId === 'all' || treeOpts.some((c) => c.id === selectedId))) {
    select.value = selectedId;
    if (bulkSelect) bulkSelect.value = selectedId;
  } else if (treeOpts.length > 0) {
    select.value = treeOpts[0].id;
    if (bulkSelect) bulkSelect.value = treeOpts[0].id;
  } else {
    select.value = 'all';
    if (bulkSelect) bulkSelect.value = 'all';
  }
}

async function handleSaveDocumentForm(e) {
  e.preventDefault();
  if (!canManageDocs()) return;

  // Chế độ Gắn hàng loạt nhiều tài liệu có sẵn trên Google Drive
  if (AppState.docSourceMode === 'bulk_drive') {
    const rawLines = document
      .getElementById('bulkDriveLinksInput')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      alert('Vui lòng nhập ít nhất 1 đường link Google Drive!');
      return;
    }

    const targetColId = document.getElementById('bulkDocCollection').value || 'all';
    let addedCount = 0;

    rawLines.forEach((line, idx) => {
      let titlePart = '';
      let linkPart = line;
      if (line.includes('|')) {
        const parts = line.split('|');
        titlePart = parts[0].trim();
        linkPart = parts.slice(1).join('|').trim();
      }
      const fileId = DriveService.extractFileId(linkPart);
      if (!fileId) return;

      let detectedType = 'PDF';
      if (linkPart.includes('docs.google.com/document')) detectedType = 'DOCX';
      if (linkPart.includes('docs.google.com/spreadsheets')) detectedType = 'XLSX';
      if (linkPart.includes('docs.google.com/presentation')) detectedType = 'PPTX';

      AppState.documents.unshift({
        id: `doc-${Date.now()}-${idx}`,
        code: `PN-${new Date().getFullYear()}-${String(AppState.documents.length + 1).padStart(3, '0')}`,
        title: titlePart || `Tài liệu Google Drive (#${fileId.slice(0, 6)})`,
        collectionId: targetColId,
        author: AppState.currentUser ? AppState.currentUser.fullName : 'Phúc Nguyên Library',
        year: new Date().getFullYear(),
        pages: 1,
        views: 1,
        downloads: 0,
        fileType: detectedType,
        fileSize: 'Google Drive',
        driveFileId: fileId,
        driveUrl: linkPart,
        coverUrl: AppState.pendingCoverDataUrl || '',
        accessLevel: 'public',
        tags: ['Google Drive'],
        description: 'Tài liệu được gắn trực tiếp từ kho lưu trữ Google Drive.',
        createdAt: new Date().toISOString().slice(0, 10),
        uploadedBy: AppState.currentUser ? AppState.currentUser.fullName : 'Admin'
      });
      addedCount++;
    });

    if (addedCount === 0) {
      alert('Không nhận diện được File ID hợp lệ từ các đường link đã nhập.');
      return;
    }

    // Tự động chuyển sang thư mục vừa gắn và xóa bộ lọc để hiển thị ngay
    AppState.selectedCollectionId = targetColId;
    AppState.searchQuery = '';
    document.getElementById('searchInput').value = '';

    saveDocuments();
    populateFilterDropdowns();
    renderCollectionsSidebar();
    renderCatalog();
    closeModal('docFormModal');
    showToast(`Đã gắn trực tiếp ${addedCount} tài liệu lên thư viện!`);
    return;
  }

  // Chế độ Gắn 1 tài liệu Drive có sẵn hoặc Tải file mới
  let driveUrlInput = document.getElementById('docFormDriveUrl').value.trim();
  let driveFileId = DriveService.extractFileId(driveUrlInput);
  let titleVal = document.getElementById('docFormTitle').value.trim();

  // Tự động tạo tiêu đề nếu người dùng chỉ dán link Drive hoặc chọn file mà quên gõ tiêu đề
  if (!titleVal) {
    if (AppState.pendingUploadFile) {
      titleVal = AppState.pendingUploadFile.name.replace(/\.[^/.]+$/, '');
    } else if (driveFileId) {
      titleVal = `Tài liệu Google Drive (#${driveFileId.slice(0, 6)})`;
    } else {
      alert('Vui lòng nhập Tên hồ sơ / Tiêu đề tài liệu (hoặc dán Link Google Drive / chọn File tải lên)!');
      return;
    }
  }

  const btnSave = document.getElementById('btnSaveDocForm');
  const statusEl = document.getElementById('uploadStatusText');
  btnSave.disabled = true;

  try {
    const existingId = document.getElementById('docFormId').value;
    const colId = document.getElementById('docFormCollection').value || 'all';
    const colObj = AppState.collections.find((c) => c.id === colId);

    let fileType = document.getElementById('docFormType').value;
    let fileSize = document.getElementById('docFormSize').value.trim() || 'Google Drive';
    let localBlobId = '';
    let localFileUrl = '';

    // Nếu người dùng có chọn file từ máy tính (dù đang ở tab nào cũng tự động xử lý)
    if (AppState.pendingUploadFile) {
      const uploadRes = await DriveService.uploadFile(
        AppState.pendingUploadFile,
        {
          title: titleVal,
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
          title: titleVal,
          collectionId: colId,
          author: document.getElementById('docFormAuthor').value.trim() || 'Phúc Nguyên Library',
          year: Number(document.getElementById('docFormYear').value) || new Date().getFullYear(),
          pages: Number(document.getElementById('docFormPages').value) || 1,
          fileType,
          fileSize,
          driveFileId: driveFileId || old.driveFileId,
          driveUrl: driveUrlInput || old.driveUrl,
          localBlobId: localBlobId || old.localBlobId,
          localFileUrl: localFileUrl || old.localFileUrl,
          coverUrl: AppState.pendingCoverDataUrl,
          accessLevel: document.getElementById('docFormAccess').value,
          tags,
          description: document.getElementById('docFormDesc').value.trim()
        };
        showToast('Đã cập nhật hồ sơ thành công!');
      }
    } else {
      const newDoc = {
        id: 'doc-' + Date.now(),
        code: document.getElementById('docFormCode').value.trim() || `PN-${Date.now()}`,
        title: titleVal,
        collectionId: colId,
        author: document.getElementById('docFormAuthor').value.trim() || 'Phúc Nguyên Library',
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
      showToast('Đã đẩy hồ sơ lên thư viện thành công!');
    }

    // Tự động chuyển sang đúng Bộ sưu tập vừa thêm và xóa bộ lọc để hiển thị ngay lập tức
    AppState.selectedCollectionId = colId;
    AppState.searchQuery = '';
    AppState.filterYear = 'all';
    AppState.filterType = 'all';
    AppState.filterAuthor = '';
    document.getElementById('searchInput').value = '';

    saveDocuments();
    populateFilterDropdowns();
    renderCollectionsSidebar();
    renderCatalog();
    closeModal('docFormModal');
  } catch (err) {
    alert('Lỗi khi lưu hồ sơ: ' + err.message);
  } finally {
    btnSave.disabled = false;
  }
}

// ==========================================================================
// LỌC, TÌM KIẾM & HIỂN THỊ DANH MỤC TÀI LIỆU SỐ
// ==========================================================================
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
  const allowedColIds =
    AppState.selectedCollectionId === 'all'
      ? null
      : new Set(getDescendantCollectionIds(AppState.selectedCollectionId));

  let list = AppState.documents.filter((doc) => {
    if (!canViewDocument(doc)) return false;

    if (allowedColIds && !allowedColIds.has(doc.collectionId)) {
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
  const breadcrumbEl = document.getElementById('collectionBreadcrumbBar');

  if (AppState.security.requireLoginToView && !AppState.currentUser) {
    countEl.textContent = '0';
    container.className = '';
    container.innerHTML = `
      <div style="background:#fff;padding:42px;text-align:center;border:1px solid #e5e7eb;border-radius:6px;">
        <i class="fa-solid fa-lock" style="font-size:38px;color:var(--pn-primary);margin-bottom:12px;"></i>
        <h3 style="color:var(--pn-primary);margin-bottom:8px;">Thư viện yêu cầu Đăng nhập</h3>
        <p style="color:#6b7280;margin-bottom:16px;">Vui lòng đăng nhập bằng tài khoản được cấp để xem danh mục tài liệu số.</p>
        <button class="btn btn-primary" onclick="openLoginModal()"><i class="fa-solid fa-right-to-bracket"></i> Đăng nhập</button>
      </div>
    `;
    return;
  }

  const filtered = getFilteredDocuments();
  countEl.textContent = filtered.length;

  const path = getCollectionPath(AppState.selectedCollectionId);
  if (currentColTitleEl) {
    currentColTitleEl.textContent =
      path.length === 0
        ? 'DANH MỤC TÀI LIỆU SỐ'
        : `BỘ SƯU TẬP: ${path[path.length - 1].name.toUpperCase()}`;
  }

  if (breadcrumbEl) {
    if (path.length === 0) {
      breadcrumbEl.style.display = 'none';
    } else {
      breadcrumbEl.style.display = 'flex';
      breadcrumbEl.innerHTML =
        `<span class="breadcrumb-link" onclick="selectCollectionById('all')"><i class="fa-solid fa-house"></i> Tất cả bộ sưu tập</span>` +
        path
          .map(
            (p) =>
              `<span>/</span><span class="breadcrumb-link" onclick="selectCollectionById('${escapeHtml(p.id)}')">${escapeHtml(p.name)}</span>`
          )
          .join('');
    }
  }

  if (filtered.length === 0) {
    container.className = '';
    container.innerHTML = `
      <div style="background:#fff;padding:44px 20px;text-align:center;border:1px solid #e5e7eb;border-radius:6px;color:#6b7280;">
        <i class="fa-regular fa-folder-open" style="font-size:38px;color:var(--pn-primary);opacity:0.65;margin-bottom:12px;"></i>
        <h4 style="color:var(--pn-primary);font-size:16px;margin-bottom:6px;">Chưa có tài liệu nào trong mục này</h4>
        <p style="font-size:13.5px;margin-bottom:16px;">Hãy tạo Thư mục Bộ sưu tập hoặc gắn/tải tài liệu từ Google Drive lên thư viện.</p>
        ${
          canManageDocs()
            ? `<div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                 <button class="btn btn-outline" onclick="openCollectionsManagerModal()">
                   <i class="fa-solid fa-folder-plus"></i> 1. Thiết kế Thư mục Bộ sưu tập
                 </button>
                 <button class="btn btn-primary" onclick="openAddDocumentModal('drive_link')">
                   <i class="fa-brands fa-google-drive"></i> 2. Gắn / Tải Tài liệu lên
                 </button>
               </div>`
            : ''
        }
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

function selectCollectionById(colId) {
  AppState.selectedCollectionId = colId;
  renderCollectionsSidebar();
  renderCatalog();
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
          ${hasDrive ? `<span class="doc-drive-badge" title="Đã kết nối Google Drive"><i class="fa-brands fa-google-drive"></i></span>` : ''}
        </div>
      </div>
      <div class="doc-title" onclick="openDocumentDetail('${escapeHtml(doc.id)}')" title="${escapeHtml(doc.title)}">
        ${escapeHtml(doc.title)}
      </div>
      <div class="doc-meta-stats">
        <span class="doc-stat-item" title="Lượt xem">
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
  const colName = col ? col.name : 'Thư mục chung';
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
// CHI TIẾT HỒ SƠ & XEM TRƯỚC TRỰC TIẾP
// ==========================================================================
async function openDocumentDetail(docId) {
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  AppState.activeDocId = docId;

  doc.views = (Number(doc.views) || 0) + 1;
  saveDocuments();
  renderCatalog();

  const colPath = getCollectionPath(doc.collectionId);
  const colName = colPath.length > 0 ? colPath.map((c) => c.name).join(' / ') : 'Thư mục chung';

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
        <h4 style="font-size:15px;color:var(--pn-primary);margin-bottom:6px;line-height:1.35;">${escapeHtml(doc.title)}</h4>
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
        <td><span style="font-weight:700;color:var(--pn-accent);">${escapeHtml(doc.fileType || 'PDF')}</span> (${escapeHtml(doc.fileSize || '---')})</td>
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
        <td>${fileId ? `<code>${escapeHtml(fileId)}</code>` : '<span style="color:#64748b;">Lưu cục bộ trên trình duyệt</span>'}</td>
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
        fileId
          ? `<a class="btn btn-outline" href="${escapeHtml(DriveService.getWebViewUrl(doc))}" target="_blank" rel="noopener">
              <i class="fa-brands fa-google-drive"></i> Mở trên Drive
             </a>`
          : ''
      }
      ${
        canManageDocs()
          ? `<button class="btn btn-outline" onclick="closeModal('detailModal'); openEditDocumentModal('${escapeHtml(doc.id)}')">
              <i class="fa-regular fa-pen-to-square"></i> Sửa / Gắn link Drive
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
      <div style="border-bottom:2px solid var(--pn-primary);padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;font-weight:700;color:var(--pn-primary);text-transform:uppercase;">PHÚC NGUYÊN LIBRARY &bull; ${escapeHtml(doc.code || doc.id)}</span>
        <span style="background:#e0e7ff;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${escapeHtml(doc.fileType || 'PDF')}</span>
      </div>
      <h3 style="font-size:17px;color:#0f172a;margin-bottom:10px;">${escapeHtml(doc.title)}</h3>
      <p style="font-size:13px;color:#475569;margin-bottom:14px;">
        <strong>Tác giả / Đơn vị:</strong> ${escapeHtml(doc.author || '---')} &nbsp;|&nbsp; <strong>Năm:</strong> ${escapeHtml(String(doc.year || '---'))}
      </p>
      <div style="background:#f8fafc;border-left:3px solid var(--pn-gold);padding:12px 14px;font-size:13.5px;color:#334155;line-height:1.6;margin-bottom:18px;">
        ${escapeHtml(doc.description || '')}
      </div>
      ${
        canManageDocs()
          ? `<div style="background:#eff6ff;border:1px dashed #93c5fd;border-radius:6px;padding:12px;font-size:13px;color:#1e3a8a;">
               <button class="btn btn-primary" style="font-size:12.5px;padding:6px 12px;" onclick="closeModal('detailModal'); openEditDocumentModal('${escapeHtml(doc.id)}')">
                 <i class="fa-brands fa-google-drive"></i> Gắn Link Google Drive cho tài liệu này
               </button>
             </div>`
          : ''
      }
    </div>
  `;
}

function handleDownloadDocument(docId) {
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;

  if (AppState.security.requireLoginToDownload && !AppState.currentUser) {
    showToast('Vui lòng đăng nhập để tải xuống tài liệu!');
    openLoginModal();
    return;
  }

  doc.downloads = (Number(doc.downloads) || 0) + 1;
  saveDocuments();
  renderCatalog();

  const dlUrl = DriveService.getDownloadUrl(doc);
  if (dlUrl) {
    const a = document.createElement('a');
    a.href = dlUrl;
    a.target = '_blank';
    a.download = doc.title || 'tai-lieu';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Đang tải xuống: ${doc.title}`);
  }
}

function handleDeleteDocument(docId) {
  if (!canManageDocs()) return;
  const doc = AppState.documents.find((d) => d.id === docId);
  if (!doc) return;
  if (!confirm(`Xóa hồ sơ "${doc.title}" khỏi thư viện?`)) return;

  AppState.documents = AppState.documents.filter((d) => d.id !== docId);
  saveDocuments();
  closeModal('detailModal');
  renderCollectionsSidebar();
  renderCatalog();
  showToast('Đã xóa hồ sơ khỏi danh mục.');
}

// ==========================================================================
// CẤU HÌNH GOOGLE DRIVE & ĐỒNG BỘ TỰ ĐỘNG
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

  if (DriveService.hasDriveAutoScan()) {
    await autoMergeDriveFolderSilent(true);
  } else if (DriveService.hasCloudDatabase()) {
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
    await autoMergeDriveFolderSilent(true);
    closeModal('driveConfigModal');
  } catch (err) {
    alert('Lỗi khi quét thư mục Google Drive: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-folder-tree"></i> Quét tự động các File có sẵn từ Drive`;
  }
}

async function handleManualSyncButton() {
  if (DriveService.hasDriveAutoScan()) {
    showToast('Đang kiểm tra và đồng bộ tài liệu mới từ Google Drive...');
    await autoMergeDriveFolderSilent(true);
  } else {
    openDriveConfigModal();
  }
}

function downloadCloudConfigFile() {
  const rootFolderId = document.getElementById('cfgRootFolderId').value.trim();
  const gasWebAppUrl = document.getElementById('cfgGasUrl').value.trim();
  const firebaseDbUrl = document.getElementById('cfgFirebaseUrl').value.trim();

  const content = `window.PUBLIC_CLOUD_CONFIG = {
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
  showToast('Đã tải xuống file cloud-config.js!');
}

function openStatsModal() {
  const totalDocs = AppState.documents.length;
  const totalCols = Math.max(0, AppState.collections.length - 1);
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
          <td style="padding:8px;text-align:center;font-weight:600;color:var(--pn-primary);">${d.views || 0}</td>
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
  a.download = `Danh-muc-Phuc-Nguyen-Library-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất danh mục hồ sơ ra file Excel (CSV)!');
}

function exportBackupJSON() {
  const backup = {
    exportedAt: new Date().toISOString(),
    branding: AppState.branding,
    collections: AppState.collections,
    documents: AppState.documents,
    users: AppState.users
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-phuc-nguyen-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã tải xuống bản sao lưu JSON.');
}

// ==========================================================================
// SỰ KIỆN GIAO DIỆN & KÉO THẢ (DRAG & DROP)
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

  const driveUrlInput = document.getElementById('docFormDriveUrl');
  driveUrlInput.addEventListener('input', () => {
    const val = driveUrlInput.value.trim();
    const statusEl = document.getElementById('driveLinkCheckStatus');
    if (!val) {
      statusEl.textContent = '';
      return;
    }
    const fId = DriveService.extractFileId(val);
    if (fId) {
      statusEl.style.color = '#059669';
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã nhận diện Google Drive File ID: <code>${escapeHtml(fId)}</code>`;
    } else {
      statusEl.style.color = '#d97706';
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Chưa nhận diện được ID chuẩn từ đường link này.`;
    }
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

  const coverDropzone = document.getElementById('coverDropzone');
  const coverInput = document.getElementById('docCoverInput');

  coverDropzone.addEventListener('click', () => coverInput.click());
  coverDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    coverDropzone.classList.add('dragover');
  });
  coverDropzone.addEventListener('dragleave', () => coverDropzone.classList.remove('dragover'));
  coverDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    coverDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processCoverImageFile(e.dataTransfer.files[0], (dataUrl) => {
        AppState.pendingCoverDataUrl = dataUrl;
        updateCoverPreviewInForm();
        showToast('Đã cập nhật ảnh bìa bằng kéo thả!');
      });
    }
  });

  coverInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processCoverImageFile(e.target.files[0], (dataUrl) => {
        AppState.pendingCoverDataUrl = dataUrl;
        updateCoverPreviewInForm();
        showToast('Đã chọn ảnh bìa cho tài liệu!');
      });
    }
  });

  document.getElementById('btnRemoveCustomCover').addEventListener('click', () => {
    AppState.pendingCoverDataUrl = '';
    updateCoverPreviewInForm();
  });

  const logoDropzone = document.getElementById('brandLogoDropzone');
  const logoInput = document.getElementById('brandLogoFileInput');
  if (logoDropzone && logoInput) {
    logoDropzone.addEventListener('click', () => logoInput.click());
    logoDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      logoDropzone.classList.add('dragover');
    });
    logoDropzone.addEventListener('dragleave', () => logoDropzone.classList.remove('dragover'));
    logoDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      logoDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processCoverImageFile(e.dataTransfer.files[0], (dataUrl) => {
          AppState.branding.logoDataUrl = dataUrl;
          document.getElementById('brandLogoPreviewBox').innerHTML = `<img src="${escapeHtml(dataUrl)}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;
          showToast('Đã nhận diện Logo mới!');
        });
      }
    });
    logoInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        processCoverImageFile(e.target.files[0], (dataUrl) => {
          AppState.branding.logoDataUrl = dataUrl;
          document.getElementById('brandLogoPreviewBox').innerHTML = `<img src="${escapeHtml(dataUrl)}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" />`;
          showToast('Đã nhận diện Logo mới!');
        });
      }
    });
  }

  document.getElementById('docForm').addEventListener('submit', handleSaveDocumentForm);
  document.getElementById('collectionForm').addEventListener('submit', handleSaveCollectionForm);
  document.getElementById('driveConfigForm').addEventListener('submit', handleSaveDriveConfig);
  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('provisionUserForm').addEventListener('submit', handleProvisionUser);
  document.getElementById('brandingForm').addEventListener('submit', handleSaveBranding);

  document.getElementById('chkRequireLoginView').addEventListener('change', (e) => {
    AppState.security.requireLoginToView = e.target.checked;
    saveSecurity();
    renderCatalog();
  });

  document.getElementById('chkRequireLoginDownload').addEventListener('change', (e) => {
    AppState.security.requireLoginToDownload = e.target.checked;
    saveSecurity();
  });

  document.getElementById('btnResetDefaultData').addEventListener('click', handleClearAllLibraryData);
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
    <i class="fa-solid fa-circle-check" style="font-size:24px;color:#10b981;margin-bottom:4px;"></i>
    <div>Đã chọn file: <strong>${escapeHtml(file.name)}</strong> (${DriveService.formatBytes(file.size)})</div>
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
