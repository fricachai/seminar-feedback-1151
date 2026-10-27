# 專題討論（1）・共學筆記

115 學年度第 1 學期的文章閱讀與同儕回饋網站。

[開啟課程網站](https://fricachai.github.io/seminar-feedback-1151/)

## 使用方式

1. 開啟課程網站，輸入老師提供的共同課程通關碼。
2. 頁首右側可選取 PPT、PPTX 或 PDF 簡報，再選自己的學號與姓名並按「送出」。檔案以學號命名，每檔最多 5 MB（5,242,880 bytes）；會存到課程雲端下「學號 姓名」資料夾，沒有該資料夾時自動建立。
3. 選擇報告同學，查看文章篇名並下載 PDF；下方另列簡報檔案與下載按鈕。文章與簡報各自缺檔時顯示「尚未上傳」。多次上傳保留原檔，最新上傳列在最前。
4. 選擇自己的學號與姓名，填寫「我的建議」，按「儲存我的建議」。
5. 再次選回同一組報告者、填寫者，會帶回已儲存內容，可以修改後再次儲存。
6. 有同學新增上傳檔案時，按同一頁的「更新雲端文章」。按鈕會實際讀取 Google 雲端硬碟，更新名單、文章與簡報索引，保留既有建議。

共同通關碼是課堂存取限制；填寫身分由學生自行選擇，並非個別帳號認證。

## 架構與資料邊界

- GitHub Pages：`public/` 的網頁、樣式及前端程式。
- Cloudflare Worker：通關、課程資料、建議讀寫、雲端更新、簡報上傳及受保護下載 API。
- Cloudflare D1：學生名單、文章與簡報索引、建議及短期工作階段。
- Google Drive：原有名單、學生子資料夾與 PDF，保留原共享權限。
- 獨立 Google Apps Script：使用 Drive 讀寫權限，須由擁有者核准；程式固定課程根資料夾、核對正式名單與檔案父層，驗證 Worker 的 HMAC 簽章後讀寫。OAuth 本身不是單一資料夾權限。不是原本的表單歸檔程式。

PDF 從 Google Drive 經受保護的 API 下載，不放進公開 GitHub 程式庫。網站不依賴教師電腦或 G 槽保持開機。

同一組「課程、報告者、填寫者」只有一份建議。後端以版本號防止不同頁面靜默覆蓋；前端在切換同學或離開頁面前提醒未儲存的修改。共同工作階段最長 12 小時，登出會撤銷該工作階段。

## 開發與部署

目前已以 Node.js 24、Wrangler 4.152.0 驗證。

```powershell
npm ci
npm run check
npm run dev
```

另一個終端機啟動前端預覽：

```powershell
node scripts/preview.mjs
```

預覽位址為 `http://127.0.0.1:8788`。本機需要已設定且不提交的 `.dev.vars`。

前端推送到 `main` 後，GitHub Actions 只發布 `public/`。Worker 程式變更則另外執行：

```powershell
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Worker 必要設定：`DB`、`CLASS_ID`、`ALLOWED_ORIGIN`。密鑰由 Cloudflare secret 管理：`CLASS_CODE_HASH`、`DRIVE_BRIDGE_URL`、`DRIVE_BRIDGE_SECRET`。不要把值貼入程式、提交紀錄或日誌。

Google 橋接程式位於 `google-apps-script/`；部署時以擁有課程資料的帳號執行，Script Properties 保存 `SOURCE_FOLDER_ID`、`ROSTER_FILE_ID`、`BRIDGE_SECRET`。程式會自行驗證簽章、時效、nonce、檔案父資料夾與名單身分。更新橋接程式時，保留現有 Script Properties 與部署網址。

簡報上傳會在前端、Worker、Apps Script 三層檢查格式／5 MB 上限，後端強制用選取學號命名。PDF 簡報使用 description 標記與文章分流；原有 PPT／PPTX 可由目錄辨識，無標記的 PDF 仍當作原文章。每次上傳有固定識別碼及內容雜湊，連線中斷重試沿用相同檔案；不同上傳保留各次原檔，不覆寫文章。上傳完成但資料庫索引失敗時，畫面會明示已存雲端並提示更新清單。

## 驗證

`npm test` 會對本機服務執行通關、跨來源、配對隔離、儲存讀回、並行修改衝突、輸入限制、工作階段到期、PDF 與登出測試；使用獨立假學生資料，結束後清除。測試需要 `.private/` 中的本機來源基準與通關碼，不會在沒有基準時假裝通過。來源更新後，需先重新建立正確的來源基準。

`tests/presentations.test.mjs` 另檢查簡報命名、容量邊界、內容特徵、簽章防竄改、防重送與模擬 Drive 建夾／分流；模擬測試不能代替正式雲端端到端驗收。若橋接尚待授權，可在本機設定 `SEMINAR_TEST_SKIP_SYNC=1` 測既有功能，但不得用於正式環境或宣稱雲端更新通過。不要在已交付正式站加入可見假學生。

`scripts/check-bridge.mjs` 與 `scripts/check-api.mjs` 供發布時核對雲端名單及 PDF 雜湊；日常更新文章直接使用網頁按鈕。

發布前執行 `node scripts/audit-release.mjs`，檢查待提交檔案未包含來源名單、PDF 或實際密鑰。

## 本機私有資料

`.private/`、`.private-assets/`、`.dev.vars`、`.wrangler/`、`output/` 及 `node_modules/` 均不提交。通關碼供老師在本機查看並告知修課學生；網站程式不包含通關碼明文。

目前工作狀態、驗收與接續方式見 `OPENCODE_HANDOFF.md`。
