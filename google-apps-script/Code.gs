/**
 * ============================================================================
 * GOOGLE APPS SCRIPT BRIDGE & CLOUD DATABASE (PHÚC NGUYÊN LIBRARY)
 * ============================================================================
 * Hỗ trợ:
 * 1. Lưu & tải danh mục hồ sơ chung (Cloud Database) cho Web công khai.
 * 2. Quét đệ quy cây thư mục đa cấp (Thư mục trong thư mục) và toàn bộ file có sẵn
 *    trên Google Drive để gắn lên web mà không cần tải mới.
 * 3. Tự động Upload file mới từ giao diện Web vào đúng thư mục trên Google Drive.
 */

var DB_FILE_NAME = 'ou_library_catalog_db.json';

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'get_catalog';
    var rootFolderId = (e && e.parameter && e.parameter.rootFolderId) ? e.parameter.rootFolderId : '';
    var rootFolder = getRootFolderSafe(rootFolderId);

    if (action === 'scan_folder') {
      var scanned = scanDriveFolderCatalogRecursive(rootFolder);
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

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'upload';
    var rootFolder = getRootFolderSafe(data.rootFolderId);

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

    if (action === 'scan_folder') {
      var scanned = scanDriveFolderCatalogRecursive(rootFolder);
      return jsonResponse({
        success: true,
        collections: scanned.collections,
        documents: scanned.documents
      });
    }

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

// Quét đệ quy các thư mục cha & thư mục con (làm Bộ sưu tập đa cấp) và gắn các file có sẵn
function scanDriveFolderCatalogRecursive(rootFolder) {
  var collections = [
    { id: 'all', name: 'Tất cả bộ sưu tập', parentId: null, description: 'Toàn bộ hồ sơ trong kho Google Drive', driveFolderId: rootFolder.getId() }
  ];
  var documents = [];

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
      parentId: null,
      description: 'Tài liệu tại thư mục gốc Google Drive',
      driveFolderId: rootFolder.getId()
    });
  }

  function scanSubFolders(folder, parentCollectionId, depth) {
    if (depth > 5) return; // Giới hạn độ sâu tránh timeout
    var subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      var sf = subFolders.next();
      var colId = 'col-' + sf.getId().slice(0, 8);
      collections.push({
        id: colId,
        name: sf.getName(),
        parentId: parentCollectionId,
        description: sf.getDescription() || ('Thư mục Google Drive: ' + sf.getName()),
        driveFolderId: sf.getId()
      });

      var files = sf.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        if (f.getName() === DB_FILE_NAME) continue;
        documents.push(mapDriveFileToDoc(f, colId));
      }

      scanSubFolders(sf, colId, depth + 1);
    }
  }

  scanSubFolders(rootFolder, null, 0);

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
    code: 'PN-' + file.getId().slice(0, 6).toUpperCase(),
    title: name.replace(/\.[^/.]+$/, ''),
    collectionId: collectionId,
    author: (file.getOwner() && file.getOwner().getName()) ? file.getOwner().getName() : 'Phúc Nguyên Library',
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
    description: file.getDescription() || ('Tài liệu gắn trực tiếp từ Google Drive: ' + name),
    createdAt: createdDate,
    uploadedBy: 'Google Drive Sync'
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
