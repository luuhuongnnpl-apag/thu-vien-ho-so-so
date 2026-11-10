/**
 * ============================================================================
 * GOOGLE APPS SCRIPT BRIDGE & CLOUD DATABASE CHO WEB CÔNG KHAI
 * ============================================================================
 * File này giúp trang web (trên GitHub Pages / Firebase) thực hiện 3 việc:
 * 1. Lưu & tải danh mục hồ sơ chung (Cloud Database) cho mọi người truy cập.
 * 2. Tự động Upload file từ giao diện Web vào đúng thư mục Bộ sưu tập trên Google Drive.
 * 3. Quét (Scan) các thư mục & file có sẵn trên Google Drive để đưa lên thư viện web.
 *
 * HƯỚNG DẪN CÀI ĐẶT (CHỈ MẤT 1 PHÚT):
 * 1. Truy cập https://script.google.com -> Nhấn "Dự án mới" (New Project)
 * 2. Xóa mã mặc định và dán toàn bộ nội dung file Code.gs này vào.
 * 3. Nhấn "Triển khai" (Deploy) -> "Tùy chọn triển khai mới" (New deployment)
 * 4. Chọn loại: "Ứng dụng web" (Web app)
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me)
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone)
 * 5. Nhấn Triển khai -> Copy URL Web App (https://script.google.com/macros/s/.../exec)
 * 6. Dán URL đó vào mục "Kết nối Google Drive / Cloud" trên Web (hoặc vào file js/cloud-config.js).
 */

var DB_FILE_NAME = 'ou_library_catalog_db.json';

// GET: Trả về dữ liệu danh mục hồ sơ chung cho mọi người truy cập web công khai
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'get_catalog';
    var rootFolderId = (e && e.parameter && e.parameter.rootFolderId) ? e.parameter.rootFolderId : '';
    var rootFolder = getRootFolderSafe(rootFolderId);

    if (action === 'scan_folder') {
      var scanned = scanDriveFolderCatalog(rootFolder);
      return jsonResponse({
        success: true,
        collections: scanned.collections,
        documents: scanned.documents
      });
    }

    var dbFile = findFileInFolder(rootFolder, DB_FILE_NAME);
    if (!dbFile) {
      return jsonResponse({
        success: true,
        empty: true,
        message: 'Chưa có file CSDL trên Drive, dùng dữ liệu mặc định.'
      });
    }

    var content = dbFile.getBlob().getDataAsString('UTF-8');
    var parsed = JSON.parse(content);
    return jsonResponse({
      success: true,
      empty: false,
      catalog: parsed
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

// POST: Upload file mới lên Google Drive HOẶC Lưu cập nhật CSDL danh mục hồ sơ
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'upload';
    var rootFolder = getRootFolderSafe(data.rootFolderId);

    // 1. Lưu toàn bộ danh mục (Bộ sưu tập + Hồ sơ + Lượt xem/tải) lên Google Drive
    if (action === 'save_catalog') {
      var jsonStr = JSON.stringify(data.catalog, null, 2);
      var existing = findFileInFolder(rootFolder, DB_FILE_NAME);
      if (existing) {
        existing.setContent(jsonStr);
      } else {
        rootFolder.createFile(DB_FILE_NAME, jsonStr, MimeType.PLAIN_TEXT);
      }
      return jsonResponse({
        success: true,
        updatedAt: new Date().toISOString()
      });
    }

    // 2. Quét thư mục Google Drive để đồng bộ tự động các file có sẵn
    if (action === 'scan_folder') {
      var scanned = scanDriveFolderCatalog(rootFolder);
      return jsonResponse({
        success: true,
        collections: scanned.collections,
        documents: scanned.documents
      });
    }

    // 3. Upload file hồ sơ lên thư mục Bộ sưu tập trên Google Drive
    if (action === 'upload') {
      var targetFolder = rootFolder;
      if (data.collectionFolderId) {
        try {
          targetFolder = DriveApp.getFolderById(data.collectionFolderId);
        } catch (err) {
          targetFolder = getOrCreateSubFolder(rootFolder, data.collectionName || 'HoSoThuVien');
        }
      } else if (data.collectionName) {
        targetFolder = getOrCreateSubFolder(rootFolder, data.collectionName);
      }

      var decoded = Utilities.base64Decode(data.base64Data);
      var blob = Utilities.newBlob(decoded, data.mimeType || 'application/pdf', data.fileName);
      var file = targetFolder.createFile(blob);

      if (data.title) {
        file.setDescription(data.title);
      }

      // Cấp quyền xem qua link để nhúng Preview trực tiếp trên Web công khai
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      return jsonResponse({
        success: true,
        fileId: file.getId(),
        fileName: file.getName(),
        webViewLink: file.getUrl(),
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
      });
    }

    return jsonResponse({ success: false, error: 'Action không hợp lệ' });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.toString()
    });
  }
}

function getRootFolderSafe(folderId) {
  if (folderId && folderId.trim() !== '') {
    try {
      return DriveApp.getFolderById(folderId.trim());
    } catch (e) {}
  }
  return DriveApp.getRootFolder();
}

function findFileInFolder(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    return files.next();
  }
  return null;
}

function getOrCreateSubFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

// Quét các thư mục con (làm Bộ sưu tập) và các file bên trong (làm Hồ sơ tài liệu)
function scanDriveFolderCatalog(rootFolder) {
  var collections = [
    { id: 'all', name: 'Tất cả bộ sưu tập', description: 'Toàn bộ hồ sơ trong kho Google Drive', driveFolderId: rootFolder.getId() }
  ];
  var documents = [];

  // Quét các file nằm trực tiếp ở thư mục gốc
  var rootFiles = rootFolder.getFiles();
  var rootColId = 'ho-so-chung';
  var hasRootFiles = false;
  while (rootFiles.hasNext()) {
    var rf = rootFiles.next();
    if (rf.getName() === DB_FILE_NAME) continue;
    hasRootFiles = true;
    documents.push(mapDriveFileToDoc(rf, rootColId));
  }
  if (hasRootFiles) {
    collections.push({
      id: rootColId,
      name: 'Hồ sơ chung',
      description: 'Tài liệu tại thư mục gốc Google Drive',
      driveFolderId: rootFolder.getId()
    });
  }

  // Quét từng thư mục con -> mỗi thư mục con là 1 Bộ sưu tập
  var subFolders = rootFolder.getFolders();
  while (subFolders.hasNext()) {
    var sf = subFolders.next();
    var colId = 'col-' + sf.getId().slice(0, 8);
    collections.push({
      id: colId,
      name: sf.getName(),
      description: sf.getDescription() || ('Thư mục Google Drive: ' + sf.getName()),
      driveFolderId: sf.getId()
    });

    var files = sf.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.getName() === DB_FILE_NAME) continue;
      documents.push(mapDriveFileToDoc(f, colId));
    }
  }

  return { collections: collections, documents: documents };
}

function mapDriveFileToDoc(file, collectionId) {
  var name = file.getName();
  var ext = name.indexOf('.') !== -1 ? name.split('.').pop().toUpperCase() : 'PDF';
  var sizeBytes = file.getSize() || 0;
  var sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB';
  var createdDate = Utilities.formatDate(file.getDateCreated(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var year = Number(createdDate.slice(0, 4)) || new Date().getFullYear();

  return {
    id: 'drive-' + file.getId(),
    code: 'GD-' + file.getId().slice(0, 6).toUpperCase(),
    title: name.replace(/\.[^/.]+$/, ''),
    collectionId: collectionId,
    author: (file.getOwner() && file.getOwner().getName()) ? file.getOwner().getName() : 'Google Drive',
    year: year,
    pages: 1,
    views: 1,
    downloads: 0,
    fileType: ext,
    fileSize: sizeMB,
    driveFileId: file.getId(),
    driveUrl: file.getUrl(),
    accessLevel: 'public',
    tags: [ext, 'Google Drive'],
    description: file.getDescription() || ('Tài liệu đồng bộ từ Google Drive: ' + name),
    createdAt: createdDate,
    uploadedBy: 'Google Drive Sync'
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
