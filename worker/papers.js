export const MAX_PAPER_BYTES = 5 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), {status:400});

export function validatePaper({studentId, filename, data, uploadId}) {
  if (!/^\d{8}$/.test(studentId || '')) throw fail('請選擇自己的學號與姓名。');
  if (!/^[a-f0-9-]{36}$/.test(uploadId || '')) throw fail('上傳識別碼有誤，請重新選取檔案。');
  if (typeof filename !== 'string' || filename.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(filename)) {
    throw fail('文章檔名需為「年份_篇名.pdf」，例：2024_綠色行銷對品牌權益的影響.pdf。');
  }
  const match = filename.match(/^(\d{4})_(.+)\.pdf$/i);
  if (!match) throw fail('文章檔名需為「年份_篇名.pdf」，例：2024_綠色行銷對品牌權益的影響.pdf。');
  const title = match[2].trim();
  if (!title || title.length > 150) throw fail('文章篇名需為 1 至 150 字。');
  if (typeof data !== 'string' || !data.length) throw fail('文章檔案不可為空，請重新選擇 PDF。');
  if (data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail('文章檔案格式有誤，請重新選擇 PDF。');
  if (data.length > Math.ceil(MAX_PAPER_BYTES / 3) * 4) throw fail('檔案大小超過 5MB！請選擇 5MB 以內的 PDF。');
  let binary;
  try { binary = atob(data); } catch { throw fail('文章檔案讀取失敗，請重新選取。'); }
  if (!binary.length) throw fail('文章檔案不可為空，請重新選擇 PDF。');
  if (binary.length > MAX_PAPER_BYTES) throw fail('檔案大小超過 5MB！請選擇 5MB 以內的 PDF。');
  if (!binary.startsWith('%PDF-')) throw fail('文章檔案需為 PDF。');
  return {studentId, filename:`${match[1]}_${title}.pdf`, mimeType:'application/pdf', byteSize:binary.length, data, uploadId};
}
