/** Course-scoped Google Drive bridge. Configure Script Properties before deployment.
 * Required properties: SOURCE_FOLDER_ID, ROSTER_FILE_ID, BRIDGE_SECRET.
 * Do not grant public sharing permissions to source files.
 */
function doGet() {
  return output_({ok: true, service: 'seminar-drive-bridge'});
}

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents || '{}');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('BRIDGE_SECRET');
    if (!secret || !verifyRequest_(request, secret)) return output_({ok: false, error: 'Access denied.'});
    var root = DriveApp.getFolderById(props.getProperty('SOURCE_FOLDER_ID'));
    var students = roster_(props.getProperty('ROSTER_FILE_ID'), root.getId());
    if (request.op === 'catalog') return output_(catalog_(root, students));
    if (request.op === 'upload') return output_(uploadPresentation_(root,students,request.payload));
    if (request.op === 'upload-paper') return output_(uploadPaper_(root,students,request.payload));
    if (request.op === 'pdf' || request.op === 'presentation') {
      var file = DriveApp.getFileById(request.fileId);
      var parents = file.getParents(), permitted = false;
      while (parents.hasNext()) {
        var parent = parents.next();
        var identity = parent.getName().match(/^(\d{8})\s+(.+)$/);
        if (!identity || !students.some(function(s) { return s.id === identity[1] && s.name === identity[2].trim(); })) continue;
        var grandParents = parent.getParents();
        while (grandParents.hasNext()) if (grandParents.next().getId() === root.getId()) permitted = true;
      }
      var presentation = isPresentation_(file);
      var isSlides = request.op === 'presentation';
      if (!permitted || file.isTrashed() || (isSlides ? !presentation : presentation || file.getMimeType() !== MimeType.PDF) || file.getSize() > (isSlides ? 5242880 : 10485760)) throw new Error('File not permitted.');
      var bytes = file.getBlob().getBytes();
      if (!isSlides && (bytes.length < 5 || String.fromCharCode.apply(null, bytes.slice(0,5)) !== '%PDF-')) throw new Error('Invalid PDF.');
      return output_({ok: true, data: Utilities.base64Encode(bytes), byteSize: bytes.length,
        mimeType:file.getMimeType(),
        sha256: hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes))});
    }
    return output_({ok: false, error: 'Unsupported operation.'});
  } catch (error) {
    // No student identities, source paths, credentials, or PDF data in logs/errors.
    return output_({ok: false, error: 'Course source is temporarily unavailable.'});
  }
}

function verifyRequest_(r, secret) {
  if (!Number.isFinite(r.timestamp) || Math.abs(Date.now() - r.timestamp) > 120000 || !/^[a-f0-9]{32}$/.test(r.nonce || '') || !/^[a-f0-9]{64}$/.test(r.signature || '')) return false;
  if ((r.op === 'upload' || r.op === 'upload-paper') && (!r.payload || typeof r.payload !== 'object')) return false;
  var parts = [r.timestamp,r.op,r.fileId || '',r.nonce];
  if (r.payload) parts.push(hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(r.payload),Utilities.Charset.UTF_8)));
  var expected = hex_(Utilities.computeHmacSha256Signature(parts.join(':'), secret));
  var diff = 0;
  for (var i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ r.signature.charCodeAt(i);
  if (diff) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('nonce:' + r.nonce)) return false;
  cache.put('nonce:' + r.nonce, '1', 300);
  return true;
}

function hex_(bytes) { return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function output_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }

var PRESENTATION_PREFIX_ = 'seminar-presentation:v1:';
var PAPER_PREFIX_ = 'seminar-paper:v1:';
var PRESENTATION_TYPES_ = {
  ppt:'application/vnd.ms-powerpoint',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf:'application/pdf'
};
function isPresentation_(file) {
  var ext = file.getName().match(/\.(pptx?|pdf)$/i);
  return !!ext && file.getMimeType() === PRESENTATION_TYPES_[ext[1].toLowerCase()] &&
    (ext[1].toLowerCase() !== 'pdf' || (file.getDescription() || '').indexOf(PRESENTATION_PREFIX_) === 0);
}
function presentationInfo_(file,studentId) {
  return {driveFileId:file.getId(),studentId:studentId,filename:file.getName(),mimeType:file.getMimeType(),byteSize:file.getSize(),modifiedAt:file.getLastUpdated().toISOString()};
}
function paperInfo_(file,student) {
  var title = articleTitle_(file.getName(), student);
  return {driveFileId:file.getId(),studentId:student.id,filename:file.getName(),title:title.title,
    titleSource:title.source,mimeType:file.getMimeType(),byteSize:file.getSize(),modifiedAt:file.getLastUpdated().toISOString()};
}
function studentFolder_(root,student) {
  // Match identity rather than trusting a caller-supplied folder ID. Reuse whitespace variants.
  var folders = root.getFolders(), folder = null;
  while (folders.hasNext()) {
    var candidate = folders.next(), identity = candidate.getName().match(/^(\d{8})\s+(.+)$/);
    if (identity && identity[1] === student.id && identity[2].trim() === student.name) {
      if (folder) throw new Error('Ambiguous student folder.');
      folder = candidate;
    }
  }
  if (!folder) folder = root.createFolder(student.id + ' ' + student.name);
  return folder;
}
function categoryFiles_(folder, category) {
  var files = folder.getFiles(), list = [];
  while (files.hasNext()) {
    var file = files.next();
    if (file.isTrashed()) continue;
    if (category === 'presentation') {
      if (isPresentation_(file)) list.push(file);
    } else if (file.getMimeType() === MimeType.PDF && !isPresentation_(file)) {
      list.push(file);
    }
  }
  list.sort(function(a,b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  return list;
}
function replaceCategoryFile_(folder, category, blob, filename, marker) {
  // Create the new file first so a failed upload never destroys the previous one.
  // The new file keeps a clean Drive MIME type and size; after it exists, retire old files.
  var existing = categoryFiles_(folder, category);
  var created = folder.createFile(blob);
  try { created.setDescription(marker); }
  catch (error) { created.setTrashed(true); throw error; }
  for (var i = 0; i < existing.length; i++) {
    if (!existing[i].isTrashed()) existing[i].setTrashed(true);
  }
  return created;
}
function uploadPresentation_(root,students,p) {
  if (!p || !/^\d{8}$/.test(p.studentId || '') || !/^[a-f0-9-]{36}$/.test(p.uploadId || '')) throw new Error('Invalid identity.');
  var student = students.find(function(s) {return s.id === p.studentId;});
  var ext = String(p.filename || '').match(/\.(pptx?|pdf)$/i);
  if (!student || !ext || p.filename !== student.id + '.' + ext[1].toLowerCase() || p.mimeType !== PRESENTATION_TYPES_[ext[1].toLowerCase()]) throw new Error('Invalid upload.');
  if (typeof p.data !== 'string' || p.data.length > 6990508 || p.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.data)) throw new Error('Invalid size.');
  var bytes = Utilities.base64Decode(p.data);
  if (bytes.length < 5 || bytes.length > 5242880 || bytes.length !== p.byteSize) throw new Error('Invalid size.');
  var signature = bytes.slice(0,8).map(function(b) {return (b+256)%256;});
  var extension = ext[1].toLowerCase();
  if (extension === 'pdf' && String.fromCharCode.apply(null,signature.slice(0,5)) !== '%PDF-') throw new Error('Invalid PDF.');
  if (extension === 'ppt' && JSON.stringify(signature) !== '[208,207,17,224,161,177,26,225]') throw new Error('Invalid PPT.');
  var blob = Utilities.newBlob(bytes,p.mimeType,p.filename);
  if (extension === 'pptx') {
    if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) throw new Error('Invalid PPTX.');
    var entries = Utilities.unzip(blob.copyBlob().setContentType('application/zip'));
    if (!entries.some(function(e){return e.getName() === 'ppt/presentation.xml';}) || !entries.some(function(e){return e.getName() === '[Content_Types].xml';})) throw new Error('Invalid PPTX.');
  }
  var hash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes));
  var marker = PRESENTATION_PREFIX_ + p.uploadId + ':' + hash;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Upload busy.');
  try {
    var folder = studentFolder_(root,student);
    var files = folder.getFiles();
    while (files.hasNext()) {
      var prior = files.next(), description = prior.getDescription() || '';
      if (!prior.isTrashed() && description.indexOf(PRESENTATION_PREFIX_ + p.uploadId + ':') === 0) {
        if (description !== marker || prior.getName() !== p.filename) throw new Error('Upload ID conflict.');
        return {ok:true,presentation:presentationInfo_(prior,student.id)};
      }
    }
    var target = replaceCategoryFile_(folder,'presentation',blob,p.filename,marker);
    return {ok:true,presentation:presentationInfo_(target,student.id)};
  } finally { lock.releaseLock(); }
}
function uploadPaper_(root,students,p) {
  if (!p || !/^\d{8}$/.test(p.studentId || '') || !/^[a-f0-9-]{36}$/.test(p.uploadId || '')) throw new Error('Invalid identity.');
  var student = students.find(function(s) {return s.id === p.studentId;});
  var match = String(p.filename || '').match(/^(\d{4})_(.+)\.pdf$/i);
  if (!student || !match || p.mimeType !== 'application/pdf') throw new Error('Invalid upload.');
  var title = match[2].trim();
  var filename = match[1] + '_' + title + '.pdf';
  if (!title || title.length > 150 || filename.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(filename)) throw new Error('Invalid filename.');
  if (typeof p.data !== 'string' || p.data.length > 6990508 || p.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(p.data)) throw new Error('Invalid size.');
  var bytes = Utilities.base64Decode(p.data);
  if (bytes.length < 5 || bytes.length > 5242880 || bytes.length !== p.byteSize) throw new Error('Invalid size.');
  if (String.fromCharCode.apply(null, bytes.slice(0,5)) !== '%PDF-') throw new Error('Invalid PDF.');
  var hash = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes));
  var marker = PAPER_PREFIX_ + p.uploadId + ':' + hash;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Upload busy.');
  try {
    var folder = studentFolder_(root,student);
    var files = folder.getFiles();
    while (files.hasNext()) {
      var prior = files.next(), description = prior.getDescription() || '';
      if (!prior.isTrashed() && description.indexOf(PAPER_PREFIX_ + p.uploadId + ':') === 0) {
        if (description !== marker || prior.getName() !== filename) throw new Error('Upload ID conflict.');
        return {ok:true,paper:paperInfo_(prior,student)};
      }
    }
    var target = replaceCategoryFile_(folder,'paper',Utilities.newBlob(bytes,p.mimeType,filename),filename,marker);
    return {ok:true,paper:paperInfo_(target,student)};
  } finally { lock.releaseLock(); }
}

function roster_(fileId, rootId) {
  var file = DriveApp.getFileById(fileId), parents = file.getParents(), inRoot = false;
  while (parents.hasNext()) if (parents.next().getId() === rootId) inRoot = true;
  if (!inRoot) throw new Error('Roster must be inside the course folder.');
  // Parse the original small XLSX without changing the workbook.
  var archive = file.getBlob().setContentType('application/zip');
  var entries = Utilities.unzip(archive), shared = [], sheets = [];
  var ns = XmlService.getNamespace('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  entries.forEach(function(entry) {
    if (entry.getName() === 'xl/sharedStrings.xml') {
      shared = XmlService.parse(entry.getDataAsString('UTF-8')).getRootElement().getChildren('si', ns).map(function(si) {
        var plain = si.getChild('t', ns);
        return plain ? plain.getText() : si.getChildren('r', ns).map(function(r) { var t = r.getChild('t', ns); return t ? t.getText() : ''; }).join('');
      });
    }
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.getName())) sheets.push(entry);
  });
  var students = [];
  sheets.forEach(function(sheet) {
    var rows = XmlService.parse(sheet.getDataAsString('UTF-8')).getRootElement().getChild('sheetData', ns).getChildren('row', ns);
    var idColumn = null, nameColumn = null;
    rows.forEach(function(row) {
      var cells = {};
      row.getChildren('c', ns).forEach(function(c) {
        var type = c.getAttribute('t'), reference = c.getAttribute('r').getValue().replace(/[0-9]/g, '');
        var v = c.getChild('v', ns), inline = c.getChild('is', ns);
        cells[reference] = type && type.getValue() === 's' ? shared[Number(v.getText())] : inline ? (inline.getChild('t', ns) ? inline.getChild('t', ns).getText() : '') : v ? v.getText() : '';
      });
      if (!idColumn || !nameColumn) {
        Object.keys(cells).forEach(function(key) { if (cells[key] === '學號') idColumn = key; if (cells[key] === '姓名') nameColumn = key; });
        return;
      }
      var id = String(cells[idColumn] || '').trim(), name = String(cells[nameColumn] || '').trim();
      if (!id && !name) return;
      if (!/^\d{8}$/.test(id) || !name) throw new Error('Invalid roster row.');
      students.push({id: id, name: name});
    });
  });
  if (!students.length || new Set(students.map(function(s) { return s.id; })).size !== students.length) throw new Error('Invalid roster.');
  return students.sort(function(a,b) { return a.id.localeCompare(b.id); });
}

function articleTitle_(filename, student) {
  var known = [
    ['Signaling the green sell', 'Signaling the Green Sell: The Influence of Eco-Label Source, Argument Specificity, and Product Involvement on Consumer Trust'],
    ['Effects of price, brand', 'Effects of Price, Brand, and Store Information on Buyers’ Product Evaluations'],
    ['國中教師海外自助旅遊', '國中教師海外自助旅遊動機與偏好類型之研究'],
    ['Impact of green marketing', 'Impact of green marketing, greenwashing and green confusion on green brand equity'],
    ['募兵行不行', '募兵行不行？國軍招募廣告的效能檢驗：調節焦點與社會距離的觀點'],
    ['Evaluating an Artificial Intelligence', 'Evaluating an Artificial Intelligence Literacy Programme for Developing University Students’ Conceptual Understanding, Literacy, Empowerment and Ethical Awareness']
  ];
  for (var i = 0; i < known.length; i++) if (filename.toLowerCase().indexOf(known[i][0].toLowerCase()) >= 0) return {title:known[i][1], source:'pdf_first_page_verified_2026-10-26'};
  var title = filename.replace(/(?:\.pdf)+$/ig,'').replace(/^\d{4}\s*_\s*/, '');
  var suffix = ' - ' + student.name;
  if (title.slice(-suffix.length) === suffix) title = title.slice(0,-suffix.length);
  return {title:title.trim(), source:'student_filename'};
}

function catalog_(root, students) {
  var folders = root.getFolders(), papers = [], presentations = [];
  while (folders.hasNext()) {
    var folder = folders.next(), identity = folder.getName().match(/^(\d{8})\s+(.+)$/);
    if (!identity) continue;
    var student = students.find(function(s) { return s.id === identity[1]; });
    if (!student || student.name !== identity[2].trim()) throw new Error('Folder identity mismatch.');
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.isTrashed()) continue;
      if (isPresentation_(file)) {
        if (file.getSize() > 0 && file.getSize() <= 5242880) presentations.push(presentationInfo_(file,student.id));
        continue;
      }
      if (file.getMimeType() !== MimeType.PDF) continue;
      if (file.getSize() <= 0 || file.getSize() > 10485760) throw new Error('Invalid file size.');
      papers.push(paperInfo_(file,student));
    }
  }
  return {ok:true, complete:true, students:students, papers:papers, presentations:presentations, fetchedAt:new Date().toISOString()};
}

function authorizeBridge() {
  var props = PropertiesService.getScriptProperties();
  var root = DriveApp.getFolderById(props.getProperty('SOURCE_FOLDER_ID'));
  var students = roster_(props.getProperty('ROSTER_FILE_ID'), root.getId());
  var result = catalog_(root, students);
  console.log(JSON.stringify({ok:result.ok, students:result.students.length, papers:result.papers.length}));
}
