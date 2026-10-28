# 專題討論（1）・共學筆記

115 學年度第 1 學期的文章閱讀與同儕回饋網站。

[開啟課程網站](https://fricachai.github.io/seminar-feedback-1151/)

## 使用方式

1. 開啟課程網站，輸入老師提供的共同課程通關碼。進入後第一個畫面是學習入口，提供三個連結：
   - 「上傳報告文章與簡報」：上傳自己的報告文章與簡報，並查看自己的填寫進度。
   - 「閱讀文章與填寫建議」：下載報告同學的文章與簡報，填寫建議與心得。
   - 「查看給我的建議」：查看其他同學對自己報告的建議，不顯示提供建議的同學資訊。
2. 上傳頁先選擇自己的學號與姓名；選好後會實際更新雲端文章與簡報，並列出這位同學目前已上傳的檔案。頁面最下方另有「我的填寫進度」選單，列出自己已完成建議或心得的報告同學。
3. 報告文章接受 PDF，檔名須為「年份_篇名」，例：`2024_綠色行銷對品牌權益的影響.pdf`，每檔最多 5 MB（5,242,880 bytes）。
4. 報告簡報接受 PPT、PPTX 或 PDF，每檔最多 5 MB；伺服器會以選取學號命名，例：`12345678.pptx`。
5. 文章與簡報可只上傳一項，也可兩項一起送出；送出後會存入課程雲端下「學號 姓名」資料夾，沒有該資料夾時自動建立。**再次上傳會覆蓋同一位同學先前的文章或簡報，不會保留多份同類檔案。**
6. 在「閱讀文章與填寫建議」頁選擇報告同學，查看文章篇名並下載 PDF；下方另列簡報檔案與下載按鈕。文章與簡報各自缺檔時顯示「尚未上傳」。
7. 選擇自己的學號與姓名，填寫「我對報告同學的建議」與「我對此份報告的心得」，各限 3,000 字；按「儲存建議與心得」。為保護隱私，每次選取都顯示空白欄位，不帶出先前儲存的文字；送出後會覆蓋同一組報告者、填寫者的先前內容。
8. 有同學新增上傳檔案時，可按「更新雲端文章」實際讀取 Google 雲端硬碟，更新名單、文章與簡報索引，保留既有建議與心得。
9. 「查看給我的建議」選擇自己的學號與姓名後，會將同學的建議合併呈現；每位同學的建議自成一段，段間空一行，不顯示填寫者姓名或學號。

共同通關碼是課堂存取限制；填寫身分由學生自行選擇，並非個別帳號認證。

## 架構與資料邊界

- GitHub Pages：`public/` 的網頁、樣式及前端程式。登入後以同一頁的五個檢視切換學習入口、上傳、閱讀與回饋、查看給我的建議、教師管理。
- Cloudflare Worker：通關、課程資料、建議與心得讀寫、填寫進度、查看建議、教師登入、雲端更新、文章與簡報上傳及受保護下載 API。
- Cloudflare D1：學生名單、文章（含原始檔名）與簡報索引、建議與心得、課程工作階段及教師工作階段。
- Google Drive：原有名單、學生子資料夾、PDF 文章與簡報，保留原共享權限。
- 獨立 Google Apps Script：使用 Drive 讀寫權限，須由擁有者核准；程式固定課程根資料夾、核對正式名單與檔案父層，驗證 Worker 的 HMAC 簽章後讀寫。OAuth 本身不是單一資料夾權限。不是原本的表單歸檔程式。

PDF 從 Google Drive 經受保護的 API 下載，不放進公開 GitHub 程式庫。網站不依賴教師電腦或 G 槽保持開機。

同一組「課程、報告者、填寫者」只有一份建議與心得；再次儲存會更新同一筆資料，以最後一次儲存內容為準。為保護隱私，公開讀取端點只回傳「是否已填寫」與版本時間，不回傳建議或心得文字；前端每次選取都從空白欄位開始，離開回饋頁時也會清空目前草稿。前端在切換同學或離開頁面前提醒未儲存的修改。共同工作階段最長 12 小時，登出會撤銷該工作階段。

## 教師管理

「閱讀文章與填寫建議」頁右上角有「教師管理」按鈕。教師以獨立帳號、密碼登入後，可選擇報告者，查看每位同學給該報告者的「我的建議」與「我的心得」；列表依提供建議同學的學號排序。教師工作階段最長 12 小時，離開教師管理會撤銷。

教師帳號與密碼由管理者設定，不寫入程式或 Git。設定前教師登入會顯示「教師登入尚未設定」。請先完成 Cloudflare 登入，再在本機執行：

```powershell
$env:TEACHER_USERNAME='你的教師帳號'
$env:TEACHER_PASSWORD='至少 12 字的教師密碼'
npm run set-teacher
Remove-Item Env:TEACHER_USERNAME,Env:TEACHER_PASSWORD
```

腳本只透過標準輸入設定 Cloudflare secrets `TEACHER_USERNAME` 與 `TEACHER_PASSWORD_HASH`，不會把密碼寫入檔案或輸出。已登入的教師工作階段最長 12 小時；如需立即撤銷，可重新部署 Worker 或刪除 D1 的 `teacher_sessions` 資料。

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

前端推送到 `main` 後，GitHub Actions 只發布 `public/`。含資料庫或 Worker 變更時，依相依順序執行；Google 橋接程式先部署並確認可用，再套用遷移、部署 Worker，最後發布前端：

```powershell
# 1. 更新並部署 google-apps-script/Code.gs（保留原 Script Properties 與部署網址）
# 2. 套用資料庫遷移
npx wrangler d1 migrations apply DB --remote
# 3. 部署 Worker
npm run deploy
# 4. 推送 public/，由 GitHub Actions 發布 Pages
```

Worker 必要設定：`DB`、`CLASS_ID`、`ALLOWED_ORIGIN`。密鑰由 Cloudflare secret 管理：`CLASS_CODE_HASH`、`DRIVE_BRIDGE_URL`、`DRIVE_BRIDGE_SECRET`、`TEACHER_USERNAME`、`TEACHER_PASSWORD_HASH`。不要把值貼入程式、提交紀錄或日誌。

Google 橋接程式位於 `google-apps-script/`；部署時以擁有課程資料的帳號執行，Script Properties 保存 `SOURCE_FOLDER_ID`、`ROSTER_FILE_ID`、`BRIDGE_SECRET`。程式會自行驗證簽章、時效、nonce、檔案父資料夾與名單身分。更新橋接程式時，保留現有 Script Properties 與部署網址。

文章與簡報上傳都會在前端、Worker、Apps Script 三層檢查格式／5 MB 上限。文章保留「年份_篇名.pdf」命名並存入學生資料夾；簡報後端強制用選取學號命名。PDF 簡報使用 description 標記與文章分流；原有 PPT／PPTX 可由目錄辨識，無標記的 PDF 仍當作原文章。每次上傳有固定識別碼及內容雜湊，連線中斷重試沿用相同檔案；同一位同學再次上傳同類檔案時，會覆蓋既有文章或簡報，只保留最新一份。上傳完成但資料庫索引失敗時，畫面會明示已存雲端並提示更新清單。

## 驗證

`npm test` 會對本機服務執行通關、跨來源、配對隔離、建議與心得儲存讀回、3,000 字限制、查看建議、填寫進度、並行修改衝突、教師登入／登出、工作階段到期、PDF 與登出測試；使用獨立假學生資料，結束後清除。測試需要 `.private/` 中的本機來源基準與通關碼，不會在沒有基準時假裝通過。來源更新後，需先重新建立正確的來源基準。

教師登入測試需要本機服務設定測試用 `TEACHER_USERNAME`／`TEACHER_PASSWORD_HASH`，並在測試環境提供 `SEMINAR_TEST_TEACHER_PASSWORD`；未提供時教師成功登入測試會跳過，不會偽裝通過。

`tests/presentations.test.mjs` 另檢查文章與簡報命名、容量邊界、內容特徵、簽章防竄改、防重送、模擬 Drive 建夾／分流與再次上傳覆蓋舊檔；模擬測試不能代替正式雲端端到端驗收。若橋接尚待授權，可在本機設定 `SEMINAR_TEST_SKIP_SYNC=1` 測既有功能，但不得用於正式環境或宣稱雲端更新通過。不要在已交付正式站加入可見假學生。

`scripts/check-bridge.mjs` 與 `scripts/check-api.mjs` 供發布時核對雲端名單及 PDF 雜湊；日常更新文章直接使用網頁按鈕。

發布前執行 `node scripts/audit-release.mjs`，檢查待提交檔案未包含來源名單、PDF 或實際密鑰。

## 本機私有資料

`.private/`、`.private-assets/`、`.dev.vars`、`.wrangler/`、`output/` 及 `node_modules/` 均不提交。通關碼供老師在本機查看並告知修課學生；網站程式不包含通關碼明文。

目前工作狀態、驗收與接續方式見 `OPENCODE_HANDOFF.md`。
