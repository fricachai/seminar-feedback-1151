/** Read-only Google Drive bridge. Configure Script Properties before deployment.
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
    if (request.op === 'pdf') {
      var file = DriveApp.getFileById(request.fileId);
      var parents = file.getParents(), permitted = false;
      while (parents.hasNext()) {
        var parent = parents.next();
        var identity = parent.getName().match(/^(\d{8})\s+(.+)$/);
        if (!identity || !students.some(function(s) { return s.id === identity[1] && s.name === identity[2].trim(); })) continue;
        var grandParents = parent.getParents();
        while (grandParents.hasNext()) if (grandParents.next().getId() === root.getId()) permitted = true;
      }
      if (!permitted || file.isTrashed() || file.getMimeType() !== MimeType.PDF || file.getSize() > 10485760) throw new Error('PDF not permitted.');
      var bytes = file.getBlob().getBytes();
      if (bytes.length < 5 || String.fromCharCode.apply(null, bytes.slice(0,5)) !== '%PDF-') throw new Error('Invalid PDF.');
      return output_({ok: true, data: Utilities.base64Encode(bytes), byteSize: bytes.length,
        sha256: hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes))});
    }
    return output_({ok: false, error: 'Unsupported operation.'});
  } catch (error) {
    // No student identities, source paths, credentials, or PDF data in logs/errors.
    return output_({ok: false, error: 'Read-only source is temporarily unavailable.'});
  }
}

function verifyRequest_(r, secret) {
  if (!Number.isFinite(r.timestamp) || Math.abs(Date.now() - r.timestamp) > 120000 || !/^[a-f0-9]{32}$/.test(r.nonce || '') || !/^[a-f0-9]{64}$/.test(r.signature || '')) return false;
  var expected = hex_(Utilities.computeHmacSha256Signature([r.timestamp,r.op,r.fileId || '',r.nonce].join(':'), secret));
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

function roster_(fileId, rootId) {
  var file = DriveApp.getFileById(fileId), parents = file.getParents(), inRoot = false;
  while (parents.hasNext()) if (parents.next().getId() === rootId) inRoot = true;
  if (!inRoot) throw new Error('Roster must be inside the course folder.');
  // Parse the original small XLSX locally in Apps Script. No write permissions are needed.
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
  var folders = root.getFolders(), papers = [];
  while (folders.hasNext()) {
    var folder = folders.next(), identity = folder.getName().match(/^(\d{8})\s+(.+)$/);
    if (!identity) continue;
    var student = students.find(function(s) { return s.id === identity[1]; });
    if (!student || student.name !== identity[2].trim()) throw new Error('Folder identity mismatch.');
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      var file = files.next();
      if (file.isTrashed()) continue;
      if (file.getSize() <= 0 || file.getSize() > 10485760) throw new Error('Invalid file size.');
      var title = articleTitle_(file.getName(), student);
      papers.push({driveFileId:file.getId(), studentId:student.id, title:title.title,
        titleSource:title.source, byteSize:file.getSize(), modifiedAt:file.getLastUpdated().toISOString()});
    }
  }
  return {ok:true, complete:true, students:students, papers:papers, fetchedAt:new Date().toISOString()};
}

function authorizeBridge() {
  var props = PropertiesService.getScriptProperties();
  var root = DriveApp.getFolderById(props.getProperty('SOURCE_FOLDER_ID'));
  var students = roster_(props.getProperty('ROSTER_FILE_ID'), root.getId());
  var result = catalog_(root, students);
  console.log(JSON.stringify({ok:result.ok, students:result.students.length, papers:result.papers.length}));
}
