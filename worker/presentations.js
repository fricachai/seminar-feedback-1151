export const MAX_PRESENTATION_BYTES = 5 * 1024 * 1024;
export const PRESENTATION_TYPES = {
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};
const fail = message => Object.assign(new Error(message), {status:400});

export function validatePresentation({studentId, filename, data, uploadId}) {
  if (!/^\d{8}$/.test(studentId || '')) throw fail('請選擇自己的學號與姓名。');
  if (!/^[a-f0-9-]{36}$/.test(uploadId || '')) throw fail('上傳識別碼有誤，請重新選取檔案。');
  const extension = typeof filename === 'string' && filename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  if (!Object.hasOwn(PRESENTATION_TYPES,extension)) throw fail('請上傳 PPT、PPTX 或 PDF 簡報檔。');
  if (typeof data !== 'string' || !data.length || data.length % 4 || data.length > Math.ceil(MAX_PRESENTATION_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail('簡報檔案格式有誤或超過 5 MB。');
  let binary;
  try { binary = atob(data); } catch { throw fail('簡報檔案讀取失敗，請重新選取。'); }
  if (!binary.length || binary.length > MAX_PRESENTATION_BYTES) throw fail('簡報檔案不可為空，且須在 5 MB 以內。');
  const signature = extension === 'pdf' ? '%PDF-' : extension === 'pptx' ? 'PK\x03\x04' : '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1';
  if (!binary.startsWith(signature)) throw fail('檔案內容與副檔名不符，請選擇正確的簡報檔。');
  return {studentId, filename:`${studentId}.${extension}`, mimeType:PRESENTATION_TYPES[extension], byteSize:binary.length, data, uploadId};
}
