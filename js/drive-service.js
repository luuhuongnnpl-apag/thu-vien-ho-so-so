/* ==========================================================================
   DỊCH VỤ KẾT NỐI GOOGLE DRIVE & ĐỒNG BỘ ĐÁM MÂY ĐA THIẾT BỊ (PHÚC NGUYÊN LIBRARY)
   ========================================================================== */

const DriveService = {
  configKey: 'pn_library_drive_config_v3',
  dbName: 'PNLibraryLocalFilesDB',
  storeName: 'files',
  _githubCatalogSha: null,
  _isPushingCloud: false,
  _pendingCatalogData: null,
  _lastLocalSaveTime: 0,

  getGitHubToken() {
    const pub = window.PUBLIC_CLOUD_CONFIG || {};
    if (Array.isArray(pub.githubKeyCodes) && pub.githubKeyCodes.length > 0) {
      return pub.githubKeyCodes.map((c) => String.fromCharCode(c ^ 42)).join('');
    }
    return '';
  },

  getConfig() {
    const pub = window.PUBLIC_CLOUD_CONFIG || {};
    const defaults = {
      mode: 'auto',
      rootFolderId: pub.rootFolderId || '',
      gasWebAppUrl: pub.gasWebAppUrl || '',
      firebaseDbUrl: pub.firebaseDbUrl || '',
      githubOwner: pub.githubOwner || '',
      githubRepo: pub.githubRepo || '',
      githubBranch: pub.githubBranch || 'main',
      githubCatalogPath: pub.githubCatalogPath || 'catalog-db.json',
      apiKey: '',
      clientId: '',
      accessToken: '',
      autoSyncDrive: true
    };

    const saved = localStorage.getItem(this.configKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaults,
          ...parsed,
          rootFolderId: parsed.rootFolderId || defaults.rootFolderId,
          gasWebAppUrl: parsed.gasWebAppUrl || defaults.gasWebAppUrl,
          firebaseDbUrl: parsed.firebaseDbUrl || defaults.firebaseDbUrl,
          githubOwner: defaults.githubOwner,
          githubRepo: defaults.githubRepo,
          githubBranch: defaults.githubBranch,
          githubCatalogPath: defaults.githubCatalogPath
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
      (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) ||
      (cfg.githubOwner && cfg.githubRepo)
    );
  },

  hasDriveAutoScan() {
    const cfg = this.getConfig();
    return Boolean(cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com'));
  },

  utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  },

  base64ToUtf8(b64) {
    const clean = (b64 || '').replace(/\s/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  },

  async fetchCloudCatalog() {
    const cfg = this.getConfig();

    // 1. Ưu tiên Firebase Realtime Database nếu có cấu hình
    if (cfg.firebaseDbUrl && cfg.firebaseDbUrl.startsWith('https://')) {
      try {
        const baseUrl = cfg.firebaseDbUrl.replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}/pn_library_catalog.json?_t=${Date.now()}`, { cache: 'no-store' });
        if (resp.ok) {
          const data = await resp.json();
          if (data && (data.documents || data.collections)) {
            return { source: 'firebase', catalog: data };
          }
        }
      } catch (e) {}
    }

    // 2. Hoặc Google Apps Script Database nếu có cấu hình
    if (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      try {
        const folderId = this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId || '';
        const url = `${cfg.gasWebAppUrl}?action=get_catalog&rootFolderId=${encodeURIComponent(folderId)}&_t=${Date.now()}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.ok) {
          const res = await resp.json();
          if (res && res.success && !res.empty && res.catalog) {
            return { source: 'google_drive', catalog: res.catalog };
          }
        }
      } catch (e) {}
    }

    // 3. Mặc định: Đồng bộ trực tiếp qua GitHub Cloud Database (Hoạt động trên mọi máy tính/điện thoại)
    if (cfg.githubOwner && cfg.githubRepo) {
      const apiUrl = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${cfg.githubCatalogPath}?ref=${cfg.githubBranch}&_t=${Date.now()}`;
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      const ghToken = this.getGitHubToken();
      if (ghToken) {
        headers.Authorization = `Bearer ${ghToken}`;
      }

      const resp = await fetch(apiUrl, { headers, cache: 'no-store' });
      if (resp.status === 404) {
        return { source: 'github', empty: true, catalog: null };
      }
      if (resp.ok) {
        const meta = await resp.json();
        if (meta && meta.sha) {
          this._githubCatalogSha = meta.sha;
        }
        let jsonStr = '';
        if (meta && meta.content) {
          jsonStr = this.base64ToUtf8(meta.content);
        } else if (meta && meta.download_url) {
          const rawResp = await fetch(`${meta.download_url}?_t=${Date.now()}`, { cache: 'no-store' });
          jsonStr = await rawResp.text();
        }
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          return { source: 'github', empty: false, catalog: parsed };
        }
      }
    }

    return null;
  },

  async pushCloudCatalog(catalogData) {
    this._lastLocalSaveTime = Date.now();
    this._pendingCatalogData = {
      ...catalogData,
      updatedAt: catalogData.updatedAt || new Date().toISOString()
    };

    if (this._isPushingCloud) {
      return ['Queued'];
    }

    this._isPushingCloud = true;
    const results = [];

    try {
      while (this._pendingCatalogData) {
        const payloadToPush = this._pendingCatalogData;
        this._pendingCatalogData = null;
        this._lastLocalSaveTime = Date.now();

        const cfg = this.getConfig();

        // 1. Đồng bộ lên Firebase nếu có
        if (cfg.firebaseDbUrl && cfg.firebaseDbUrl.startsWith('https://')) {
          try {
            const baseUrl = cfg.firebaseDbUrl.replace(/\/+$/, '');
            await fetch(`${baseUrl}/pn_library_catalog.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadToPush)
            });
            results.push('Firebase');
          } catch (e) {
            console.warn('Lỗi đồng bộ Firebase:', e);
          }
        }

        // 2. Đồng bộ lên Google Drive (Google Apps Script) nếu có
        if (cfg.gasWebAppUrl && cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
          try {
            const folderId = this.extractFileId(cfg.rootFolderId) || cfg.rootFolderId || '';
            await fetch(cfg.gasWebAppUrl, {
              method: 'POST',
              body: JSON.stringify({
                action: 'save_catalog',
                rootFolderId: folderId,
                catalog: payloadToPush
              })
            });
            results.push('Google Drive');
          } catch (e) {
            console.warn('Lỗi đồng bộ Google Drive DB:', e);
          }
        }

        // 3. Đồng bộ lên GitHub Cloud Database (Tự động 100% cho mọi nơi truy cập)
        const ghToken = this.getGitHubToken();
        if (cfg.githubOwner && cfg.githubRepo && ghToken) {
          try {
            await this._putGitHubCatalog(cfg, ghToken, payloadToPush);
            results.push('GitHub Cloud');
          } catch (e) {
            console.warn('Lỗi đồng bộ GitHub Cloud DB:', e);
          }
        }
      }
    } finally {
      this._isPushingCloud = false;
      this._lastLocalSaveTime = Date.now();
    }

    return results;
  },

  async _putGitHubCatalog(cfg, ghToken, catalogPayload) {
    const apiUrl = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${cfg.githubCatalogPath}`;
    const headers = {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // Lấy SHA mới nhất nếu chưa có
    if (!this._githubCatalogSha) {
      try {
        const checkResp = await fetch(`${apiUrl}?ref=${cfg.githubBranch}&_t=${Date.now()}`, {
          headers,
          cache: 'no-store'
        });
        if (checkResp.ok) {
          const checkData = await checkResp.json();
          if (checkData && checkData.sha) {
            this._githubCatalogSha = checkData.sha;
          }
        }
      } catch (e) {}
    }

    const jsonString = JSON.stringify(catalogPayload, null, 2);
    const contentBase64 = this.utf8ToBase64(jsonString);

    const doPut = async (shaToUse) => {
      const bodyObj = {
        message: `Auto-sync catalog (${new Date().toISOString()})`,
        content: contentBase64,
        branch: cfg.githubBranch
      };
      if (shaToUse) {
        bodyObj.sha = shaToUse;
      }
      return fetch(apiUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify(bodyObj)
      });
    };

    let putResp = await doPut(this._githubCatalogSha);

    // Nếu xung đột SHA (409 hoặc 422), lấy lại SHA mới nhất rồi ghi lại ngay
    if (putResp.status === 409 || putResp.status === 422) {
      const refreshResp = await fetch(`${apiUrl}?ref=${cfg.githubBranch}&_t=${Date.now()}`, {
        headers,
        cache: 'no-store'
      });
      if (refreshResp.ok) {
        const refreshData = await refreshResp.json();
        this._githubCatalogSha = refreshData.sha || null;
      } else {
        this._githubCatalogSha = null;
      }
      putResp = await doPut(this._githubCatalogSha);
    }

    if (putResp.ok) {
      const resData = await putResp.json();
      if (resData && resData.content && resData.content.sha) {
        this._githubCatalogSha = resData.content.sha;
      }
    }
  },

  // Quét tự động toàn bộ thư mục con và file có sẵn trong Google Drive Root Folder
  async scanGoogleDriveFolder() {
    const cfg = this.getConfig();
    if (!cfg.gasWebAppUrl || !cfg.gasWebAppUrl.startsWith('https://script.google.com')) {
      throw new Error('Để quét tự động thư mục Google Drive, vui lòng nhập URL Google Apps Script Web App trong phần Cấu hình Drive / Cloud.');
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
    if (doc.localFileUrl && doc.localFileUrl.startsWith('blob:')) {
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
    // Hỗ trợ xem trực tiếp file được tải lên Cloud (raw.githubusercontent.com hoặc github.io) trên mọi thiết bị
    const cloudUrl = doc.cloudFileUrl || doc.driveUrl || doc.localFileUrl || '';
    if (cloudUrl && cloudUrl.startsWith('https://')) {
      const fType = (doc.fileType || '').toUpperCase();
      if (fType === 'IMAGE') {
        return cloudUrl;
      }
      return `https://docs.google.com/gview?url=${encodeURIComponent(cloudUrl)}&embedded=true`;
    }
    return '';
  },

  getDownloadUrl(doc) {
    if (doc.cloudFileUrl && doc.cloudFileUrl.startsWith('https://')) {
      return doc.cloudFileUrl;
    }
    const fileId = this.extractFileId(doc.driveFileId || doc.driveUrl);
    if (fileId && !fileId.startsWith('1_sample_')) {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    if (doc.localFileUrl) {
      return doc.localFileUrl;
    }
    return doc.driveUrl || '';
  },

  getWebViewUrl(doc) {
    const fileId = this.extractFileId(doc.driveFileId || doc.driveUrl);
    if (fileId && !fileId.startsWith('1_sample_')) {
      return `https://drive.google.com/file/d/${fileId}/view`;
    }
    return doc.cloudFileUrl || doc.driveUrl || '';
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

    // 1. Upload thẳng lên Google Drive qua Google Apps Script Bridge nếu đã cấu hình
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

    // 3. Tự động đẩy file lên Cloud Repository (để mọi thiết bị ở nơi khác đều xem & tải được ngay)
    const ghToken = this.getGitHubToken();
    if (cfg.githubOwner && cfg.githubRepo && ghToken && file.size <= 25 * 1024 * 1024) {
      try {
        statusCb('Đang tải file lên đám mây để đồng bộ cho mọi thiết bị...');
        const base64Data = await this.fileToBase64(file);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const relPath = `uploads/${Date.now()}-${safeName}`;
        const apiUrl = `https://api.github.com/repos/${cfg.githubOwner}/${cfg.githubRepo}/contents/${relPath}`;

        const putResp = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body: JSON.stringify({
            message: `Upload document ${safeName}`,
            content: base64Data,
            branch: cfg.githubBranch
          })
        });

        if (putResp.ok) {
          const rawUrl = `https://raw.githubusercontent.com/${cfg.githubOwner}/${cfg.githubRepo}/${cfg.githubBranch}/${relPath}`;
          return {
            mode: 'github_cloud_storage',
            driveFileId: '',
            driveUrl: rawUrl,
            cloudFileUrl: rawUrl,
            fileSize: this.formatBytes(file.size),
            fileType: this.detectFileType(file.name, file.type)
          };
        }
      } catch (e) {
        console.warn('Không thể tải file lên GitHub Cloud, chuyển sang bộ nhớ trình duyệt:', e);
      }
    }

    // 4. Lưu vào IndexedDB của trình duyệt (Dự phòng)
    statusCb('Đang lưu trữ hồ sơ và tạo bản xem trước...');
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
