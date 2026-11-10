/* ==========================================================================
   DỊCH VỤ KẾT NỐI GOOGLE DRIVE & ĐỒNG BỘ CLOUD (GITHUB PAGES / FIREBASE)
   ========================================================================== */

const DriveService = {
  configKey: 'ou_library_drive_config',
  dbName: 'OULibraryLocalFilesDB',
  storeName: 'files',

  getConfig() {
    const pub = window.PUBLIC_CLOUD_CONFIG || {};
    const defaults = {
      mode: 'auto',
      rootFolderId: pub.rootFolderId || '',
      gasWebAppUrl: pub.gasWebAppUrl || '',
      firebaseDbUrl: pub.firebaseDbUrl || '',
      apiKey: '',
      clientId: '',
      accessToken: '',
      autoCreateCollectionFolder: true
    };

    const saved = localStorage.getItem(this.configKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaults,
          ...parsed,
          // Ưu tiên cấu hình cứng trong cloud-config.js nếu localStorage đang trống
          rootFolderId: parsed.rootFolderId || defaults.rootFolderId,
          gasWebAppUrl: parsed.gasWebAppUrl || defaults.gasWebAppUrl,
          firebaseDbUrl: parsed.firebaseDbUrl || defaults.firebaseDbUrl
        };
      } catch (e) {}
    }
    return defaults;
  },

  saveConfig(cfg) {
    localStorage.setItem(this.configKey, JSON.stringify(cfg));
  },

  hasCloudDatabase() {
    const cfg = this.getConfig();
    return Boolean(
      (cfg.firebaseDbUrl && cfg.firebaseDbUrl.startsWith('https://')) ||
      (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com'))
    );
  },

  // Tải danh mục Hồ sơ & Bộ sưu tập chung từ Cloud (Firebase Realtime DB hoặc Google Drive DB)
  async fetchCloudCatalog() {
    const cfg = this.getConfig();

    // 1. Ưu tiên Firebase Realtime Database nếu người dùng cấu hình Firebase URL
    if (cfg.firebaseDbUrl && cfg.firebaseDbUrl.startsWith('https://')) {
      const baseUrl = cfg.firebaseDbUrl.replace(/\/+$/, '');
      const resp = await fetch(`${baseUrl}/ou_library_catalog.json`, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && (data.documents || data.collections)) {
          return { source: 'firebase', catalog: data };
        }
      }
    }

    // 2. Hoặc tải từ Google Drive thông qua Google Apps Script Web App
    if (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      const folderId = this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId || '';
      const url = `${cfg.gasWebAppUrl}?action=get_catalog&rootFolderId=${encodeURIComponent(folderId)}&_t=${Date.now()}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const res = await resp.json();
        if (res && res.success && !res.empty && res.catalog) {
          return { source: 'google_drive', catalog: res.catalog };
        }
      }
    }

    return null;
  },

  // Lưu danh mục Hồ sơ & Bộ sưu tập lên Cloud để mọi người truy cập web công khai đều thấy
  async pushCloudCatalog(catalogData) {
    const cfg = this.getConfig();
    const results = [];

    // 1. Lưu lên Firebase Realtime Database (nếu có)
    if (cfg.firebaseDbUrl && cfg.firebaseDbUrl.startsWith('https://')) {
      try {
        const baseUrl = cfg.firebaseDbUrl.replace(/\/+$/, '');
        await fetch(`${baseUrl}/ou_library_catalog.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...catalogData,
            updatedAt: new Date().toISOString()
          })
        });
        results.push('Firebase');
      } catch (e) {
        console.warn('Lỗi đồng bộ Firebase:', e);
      }
    }

    // 2. Lưu lên Google Drive thông qua Google Apps Script Bridge (nếu có)
    if (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      try {
        const folderId = this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId || '';
        await fetch(cfg.gasWebAppUrl, {
          method: 'POST',
          body: JSON.stringify({
            action: 'save_catalog',
            rootFolderId: folderId,
            catalog: {
              ...catalogData,
              updatedAt: new Date().toISOString()
            }
          })
        });
        results.push('Google Drive');
      } catch (e) {
        console.warn('Lỗi đồng bộ Google Drive DB:', e);
      }
    }

    return results;
  },

  // Quét tự động toàn bộ thư mục con và file có sẵn trong Google Drive Root Folder
  async scanGoogleDriveFolder() {
    const cfg = this.getConfig();
    if (!cfg.gasWebAppUrl || !cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      throw new Error('Vui lòng nhập URL Google Apps Script Web App trong phần Cấu hình trước khi quét thư mục Drive.');
    }
    const folderId = this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId || '';
    const resp = await fetch(cfg.gasWebAppUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'scan_folder',
        rootFolderId: folderId
      })
    });
    const data = await resp.json();
    if (!data || !data.success) {
      throw new Error((data && data.error) || 'Không thể quét thư mục Google Drive');
    }
    return data;
  },

  // Trích xuất Google Drive File ID từ bất kỳ định dạng link Google Drive / Docs / Sheets / Slides nào
  extractFileId(input) {
    if (!input) return '';
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{18,65}$/.test(trimmed)) {
      return trimmed;
    }
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /\/document\/d\/([a-zA-Z0-9_-]+)/,
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
      /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
      /\/folders\/([a-zA-Z0-9_-]+)/,
      /[?&]id=([a-zA-Z0-9_-]+)/
    ];
    for (const regex of patterns) {
      const match = trimmed.match(regex);
      if (match && match[1]) return match[1];
    }
    return '';
  },

  getEmbedPreviewUrl(doc) {
    if (doc.localFileUrl) {
      return doc.localFileUrl;
    }
    const fileId = this.extractFileId(doc.driveFileId || doc.driveUrl);
    if (fileId && !fileId.startsWith('1_sample_')) {
      if (doc.driveUrl && doc.driveUrl.includes('docs.google.com/document')) {
        return `https://docs.google.com/document/d/${fileId}/preview`;
      }
      if (doc.driveUrl && doc.driveUrl.includes('docs.google.com/spreadsheets')) {
        return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
      }
      if (doc.driveUrl && doc.driveUrl.includes('docs.google.com/presentation')) {
        return `https://docs.google.com/presentation/d/${fileId}/preview`;
      }
      return `https://drive.google.com/file/d/${fileId}/preview`;
    }
    return '';
  },

  getDownloadUrl(doc) {
    if (doc.localFileUrl) {
      return doc.localFileUrl;
    }
    const fileId = this.extractFileId(doc.driveFileId || doc.driveUrl);
    if (fileId && !fileId.startsWith('1_sample_')) {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    return doc.driveUrl || '';
  },

  getWebViewUrl(doc) {
    const fileId = this.extractFileId(doc.driveFileId || doc.driveUrl);
    if (fileId && !fileId.startsWith('1_sample_')) {
      return `https://drive.google.com/file/d/${fileId}/view`;
    }
    return doc.driveUrl || '';
  },

  openLocalDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async saveBlobToIndexedDB(id, file) {
    const db = await this.openLocalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put({
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: file,
        savedAt: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getBlobUrlFromIndexedDB(id) {
    try {
      const db = await this.openLocalDB();
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).get(id);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            resolve(URL.createObjectURL(req.result.blob));
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  async uploadFile(file, metadata, onStatus) {
    const cfg = this.getConfig();
    const statusCb = onStatus || (() => {});

    // 1. Upload thẳng lên Google Drive qua Google Apps Script Bridge
    if (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      statusCb('Đang tải file lên Google Drive qua Google Apps Script Bridge...');
      const base64Data = await this.fileToBase64(file);
      const payload = {
        action: 'upload',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
        rootFolderId: this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId,
        collectionName: metadata.collectionName || 'Chung',
        collectionFolderId: metadata.collectionFolderId || '',
        title: metadata.title || file.name
      };

      const resp = await fetch(cfg.gasWebAppUrl, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const result = await resp.json();
      if (result && result.success && result.fileId) {
        return {
          mode: 'google_drive_gas',
          driveFileId: result.fileId,
          driveUrl: result.webViewLink || `https://drive.google.com/file/d/${result.fileId}/view`,
          fileSize: this.formatBytes(file.size),
          fileType: this.detectFileType(file.name, file.type)
        };
      } else {
        throw new Error(result.error || 'Không thể tải lên qua Google Apps Script');
      }
    }

    // 2. Nếu có Access Token của Google Drive API v3 (OAuth 2.0)
    if (cfg.accessToken) {
      statusCb('Đang tải file trực tiếp lên Google Drive API v3...');
      const folderId = this.extractFileId(metadata.collectionFolderId || cfg.rootFolderId);
      const driveMeta = {
        name: file.name,
        description: metadata.description || ''
      };
      if (folderId) {
        driveMeta.parents = [folderId];
      }

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(driveMeta)], { type: 'application/json' }));
      form.append('file', file);

      const resp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,size',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
          body: form
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Google Drive API lỗi (${resp.status}): ${errText}`);
      }
      const data = await resp.json();
      return {
        mode: 'google_drive_api',
        driveFileId: data.id,
        driveUrl: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
        fileSize: this.formatBytes(file.size),
        fileType: this.detectFileType(file.name, file.type)
      };
    }

    // 3. Thử lưu vào thư mục Google Drive Desktop qua Local Server (node server.js)
    try {
      statusCb('Đang kiểm tra kết nối ổ đĩa Google Drive Desktop...');
      const base64Data = await this.fileToBase64(file);
      const resp = await fetch('/api/upload-drive-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          collectionId: metadata.collectionId || 'chung',
          base64Data
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.success) {
          return {
            mode: 'local_drive_folder',
            driveFileId: '',
            driveUrl: data.fileUrl,
            localFileUrl: data.fileUrl,
            savedPath: data.savedPath,
            fileSize: this.formatBytes(file.size),
            fileType: this.detectFileType(file.name, file.type)
          };
        }
      }
    } catch (e) {}

    // 4. Lưu vào IndexedDB của trình duyệt
    statusCb('Đang lưu trữ hồ sơ vào bộ nhớ trình duyệt & tạo bản xem trước...');
    const localId = 'local-file-' + Date.now();
    await this.saveBlobToIndexedDB(localId, file);
    const blobUrl = URL.createObjectURL(file);
    return {
      mode: 'browser_indexeddb',
      driveFileId: '',
      driveUrl: '',
      localBlobId: localId,
      localFileUrl: blobUrl,
      fileSize: this.formatBytes(file.size),
      fileType: this.detectFileType(file.name, file.type)
    };
  },

  detectFileType(fileName, mimeType) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || (mimeType && mimeType.includes('pdf'))) return 'PDF';
    if (['doc', 'docx'].includes(ext)) return 'DOCX';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLSX';
    if (['ppt', 'pptx'].includes(ext)) return 'PPTX';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'IMAGE';
    if (['mp4', 'mp3', 'wav', 'avi'].includes(ext)) return 'MEDIA';
    return (ext || 'FILE').toUpperCase();
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
};
