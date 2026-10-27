# 專題討論（1）網站交接

## 2026-10-27｜學習入口、文章與簡報上傳頁（本機完成，尚未部署）

狀態：`LOCAL_IMPLEMENTED_PENDING_REMOTE`。`HANDOFF_READY=true`。本輪只完成本機程式、遷移與測試，**尚未**部署 Google 橋接、正式 D1 遷移、Worker 或 Pages，也尚未做正式 Drive 文章上傳端到端驗收。

- 登入後第一個畫面改為學習入口，提供兩個超連結：「上傳報告文章與簡報」與「閱讀文章與填寫建議」。原有「01 選擇報告者／02 確認填寫身分／03 儲存我的建議」移至獨立檢視；該檢視右上角舊的上傳簡報區塊已移除。
- 新增上傳檢視：先選「請選擇自己的學號與姓名」，選好後實際呼叫 `/api/sync` 更新雲端資料，並分別列出該生已上傳的文章檔名與簡報檔名。文章與簡報可只傳一項或同時送出。
- 文章限 PDF、5 MB；檔名強制為「年份_篇名.pdf」，前端、Worker 與 Apps Script 三層驗證。簡報維持 PPT／PPTX／PDF、5 MB，伺服器以選取學號命名。兩者都存入「學號 姓名」資料夾，原檔保留。
- 後端新增 `POST /api/papers`、`worker/papers.js`、Drive 橋接 `upload-paper` op；`papers` 表新增 nullable `filename`（migration `0004_paper_filename.sql`），供上傳頁顯示實際檔名。既有文章與建議不受影響。
- 版本已升為 `1.2.0`：`package.json`、Worker `/api/health`、前端資源查詢參數同步更新。

### 本輪已驗證

- `npm run check`：通過（含新增 `worker/papers.js`）。
- `SEMINAR_TEST_SKIP_SYNC=1 npm test`：**27／27 通過**；新增文章命名、5 MB 邊界、非 PDF 拒絕、Drive 建夾／重試去重、文章與簡報分流、簽章防竄改、未通關拒絕。
- 本機 D1 已套用 `0001`～`0004`；以實際 SQL 插入／讀回／刪除假文章驗證 `filename` 欄位與 `source_kind='drive'`。
- 以 Node 假 D1／假 fetch 驗證 `uploadPaper`：索引成功、8 個綁定值、含 `filename`、同步鎖清理。
- 以本機預覽＋假 API 實測：學習入口兩個連結、上傳頁身分選擇後更新並列出既有文章／簡報、文章＋簡報同時送出、只送文章、只送簡報、非法文章檔名拒絕、未儲存檔案切換確認、建議頁切換與儲存／讀回、登入後固定回學習入口。桌機 1440 與 CSS 390 寬度均無水平溢位。
- 截圖只使用假學生與假檔名，存放於 ignored `output/design-*.png`；未讀取正式名單、PDF、通關碼或 `.dev.vars`。

### 尚未完成／待部署（不可宣稱已上線）

1. Google Apps Script `Code.gs` 尚未重新部署；`upload-paper` op 需先上線。
2. 正式 D1 尚未套用 `0004_paper_filename.sql`；未套用前新 Worker 的 catalog 查詢會失敗。
3. Worker `1.2.0` 尚未部署；Pages 尚未發布。
4. 正式 Drive 文章上傳、資料夾建立、重試去重、下載雜湊與正式 UI 尚未端到端驗收。
5. 正式手機截圖與原生另存完成仍未驗；CSS 幾何檢核不等於視覺或原生下載通過。

### 部署順序（必須逐段確認 exit code）

1. 更新並部署 Google 橋接（保留 Script Properties 與原網址），確認 catalog 仍可用。
2. `npx wrangler d1 migrations apply DB --remote`，確認 `0004` 成功。
3. `npm run deploy` 部署 Worker，確認 `/api/health` 回 `1.2.0`。
4. 提交並推送 `public/`，確認 Pages workflow 成功與正式檔案雜湊。
5. 以正式站假資料或可精確清理的測試物件驗證文章／簡報上傳，結束後精確清理並重新同步。

以下保留先前版本歷史，不代表本輪已部署或已驗收。

## 2026-10-27｜簡報功能續作中

狀態：DELIVERED。`HANDOFF_READY=true`。使用者已明確同意 Google Drive 讀寫並親自完成 Google 安全提示與授權。頁首選檔＋身分選單＋送出、5 MB 三層限制、學號命名、學生資料夾建立、簡報索引／下載／尚未上傳已上線。

- 橋接第 2 版沿原網址部署，D1 0003 遷移完成；Worker 1.1.0 版本 `865b0573-4d9e-44df-be5c-9bd5b4bb0f78` 已部署。
- 21 項本機測試再次通過，這次包含真實雲端同步；正式 API 完整核對 35 位名單、6 份文章原始雜湊。
- 真正雲端 API：一般 PDF、精確 5,242,880 bytes PDF、PPTX，上傳／強制學號命名／同識別碼重試去重／下載雜湊均 PASS。瀏覽器另以唯一測試檔按送出，成功存入 Drive 並自動更新清單；按更新雲端文章取得四份測試簡報。原文章仍為 6 份，PDF 簡報未混入文章。
- 以原先不存在的正式學生資料夾驗證自動建夾；未在正式名單新增假學生。依上傳識別碼／唯一內容雜湊清除四份測試檔、清理後確實為空的測試資料夾一個；正式重新同步確認 students=35、papers=6、presentations=0。原學生 PDF／表單／已存建議保留。
- 桌機及 CSS 390 手機畫面已檢視、超限 UI 拒絕已讀回。瀏覽器下載按鈕完成準備且無 UI 錯誤，但 download 事件等待逾時，Downloads 無匹配檔；原生另存完成為 NOT_PERFORMED，四份內容完整性由正式 API 位元組／SHA-256 驗證。
- 已移除 Google 編輯器暫時診斷／清理函式，讀回與正式原始碼一致；正式第 2 版從未包含測試入口。發布稽核 72 個實際私有值、34 份來源檔，0 發現。
- 前端功能提交 `a08c0271dd70a772112fa35d187019d00fcee6a2` 已推送 main；Pages workflow `40515307809` 成功。正式五份資源 HTTP 200／SHA-256 與提交來源相同；正式通關成功、三份選單各 35 位、上傳區位於標題右側、命名／格式／5 MB 提醒及文章／簡報「尚未上傳」且無下載連結均已讀回。
- 正式桌機截圖已保存及檢視；正式手機 CSS 390 幾何檢核無水平溢位，手機正式截圖因 Page.captureScreenshot 兩次逾時標為 NOT_PERFORMED。本機同版 CSS 390 手機截圖已成功保存及檢視，不把其描述為正式手機截圖。暫時尺寸已恢復。
- 可重用方法寫回既有 Obsidian Google 表單 SOP 的「自建網站直接上傳簡報至 Drive」節，frontmatter 2026-10-27、舊節保留及新節讀回均確認；沒有更新外部 Project、可攜包或永久 Codex 記憶。CURRENT_MODEL／CURRENT_EFFORT=UNVERIFIED；必要判斷及發布已完成，短交接讀回無實質切換收益。
- 本輪證據：ignored `output/upload-verification.json`、`output/upload-cleanup-log.txt`、`output/published-verification.json`、`output/playwright/published-upload-desktop.png`、本機手機截圖及 `.private/api-verification-remote.json`。必要實際流程已完成；原生另存及正式手機截圖的未驗範圍如上，不宣稱全部瀏覽器／原生工具測試通過。

以下為 2026-10-26 已交付版本歷史，唯讀權限描述不代表本次新版本已授權。

更新日期：2026-10-26。狀態：DELIVERED。`HANDOFF_READY=true`。

正式網站：<https://fricachai.github.io/seminar-feedback-1151/>

## 來源、範圍與 instruction lock

- 正式來源為使用者指定課程 Google Drive 資料夾中的修課名單、學生子資料夾及 PDF；目前已核對 35 位學生、6 份 PDF。學生姓名、學號、檔案 ID 與密鑰不寫入本交接檔。
- 使用者確認：GitHub 儲存庫／Pages＋Cloudflare Worker／D1；不使用 ChatGPT Sites。
- 單一學生頁面、共同課程通關碼、報告者與填寫者選單、文章篇名與下載、可更新與讀回的「我的建議」。
- 單一「更新雲端文章」按鈕，所有已通關學生皆可使用，真正讀取 Google Drive；不分教師／學生管理頁。
- 原始表單、歸檔流程、PDF 內容及共享權限保留。ChatGPT-Project-external：NOT_APPLICABLE。

## 已確認的實作與驗證

- Cloudflare Worker 已部署：`https://seminar-feedback-1151.fricachai.workers.dev`。
- D1 使用專用 `seminar-feedback-1151`，不混用其他課程。
- Google 端獨立唯讀橋接已部署與授權，只有 `drive.readonly`；只允許 HMAC 簽章、時效及 nonce 驗證通過的 Worker 請求。
- 真正雲端讀取取得 35 位學生、6 份 PDF；正式名單與本機 xlsx 一致，6 份 PDF 的 SHA-256 與本機原始檔一致。
- 本機及正式 API 各 14 項整合測試已通過；涵蓋配對隔離、儲存讀回、更新衝突、通關、CORS、內容限制、PDF、登出及到期。測試使用假學生，結束後清除。
- PDF 網頁按鈕曾成功開啟 Chrome 另存新檔視窗；該次 UI 存檔流程未完成。瀏覽器原生操作因無法確認網址而停止，不等於 API 或 PDF 內容失敗。

## 發布與最後驗收

- GitHub 儲存庫：`https://github.com/fricachai/seminar-feedback-1151`。
- 程式已推送至 main。GitHub Pages workflow `40299535048` 成功，功能版本 commit `e4857470dbbbf057d6ee9481d6a48ac7fedf8b27`。
- 已逐一比對正式網站 `index.html`、`app.js`、`styles.css`、`config.js`、`favicon.svg`：HTTP 200、SHA-256 與提交來源一致。讀回證據在 ignored `output/published-verification.json`。
- 正式瀏覽器實測：錯誤通關碼拒絕、正確通關載入、單一更新按鈕實讀雲端、建議儲存／不同配對隔離／帶回、禁止自填、未上傳顯示且無下載連結、取消切換保留身分與文字、確認放棄後切換並清空：PASS。
- 確認流程使用頁面內視窗，由按鈕明確回傳決策，避免原生 confirm 阻塞瀏覽器驗收。前端資源已加版本參數 `1.0.2`。
- 正式與本機驗收用假學生及其建議均已清除；正式唯讀查詢確認 `active_students=35`、`test_students=0`、`test_feedback=0`；瀏覽器選單再次確認 35 位且無假學生。
- 桌機畫面已保存及檢視；CSS 寬度 390 的手機版檢核無水平溢位。手機截圖因瀏覽器擷取逾時為 NOT_PERFORMED，不宣稱手機截圖視覺驗收通過。已恢復瀏覽器原尺寸。
- 本機私有檔及通關碼、密鑰、PDF、截圖均不得提交。`scripts/audit-release.mjs` 以實際私有基準掃描待提交檔案，只輸出計數。
- 正式前端只發布 `public/`；Worker 變更另由 Wrangler 部署，密鑰保存在 Cloudflare secret。
- 課程同學自行選身分，不能宣稱個別帳號身分認證。沒有成績計算、教師後台或建議公開列表。

## 來源至成果驗收

| 需求 | 成果及驗證 |
|---|---|
| 與修課名單一致的兩份選單 | 雲端名單與原 xlsx 核對；35 位；已讀回正式頁面 |
| 篇名及 PDF | 6 份文章首頁核對；雲端下載雜湊與原始檔一致；網頁啟動瀏覽器下載 |
| 未上傳提示 | 正式頁面顯示「尚未上傳」，連結數為 0 |
| 建議新增、更新、帶回 | D1 配對主鍵及版本檢核；本機／正式各 14 項測試；正式 UI 實測 |
| 單頁、單一雲端更新 | 正式按鈕讀回 6 位／6 份 PDF，保留建議 |
| 質感及可讀版面 | 暖白／墨綠／霧金；桌機視覺與手機 DOM 排版檢核 |
| GitHub 推送及實際發布 | main、Actions 成功、5 份正式檔案逐一比對 |
| 個資與密鑰邊界 | 發布稽核 72 個實際私有值，0 發現；來源資料、PDF、通關碼與截圖未提交 |

## 日常維護

- 學生新增文章：按正式網站「更新雲端文章」，不需本機同步或電腦保持開機。
- 前端變更：修改 `public/` 後依檢查流程提交、推送；Actions 自動發布。
- Worker 變更：另外執行 Wrangler 部署；不要把 Cloudflare secret 值寫回檔案。
- 課程通關碼只在本機 ignored `.private/classroom-access.txt` 供老師查看。共享碼不是學生獨立帳號。
- 可重用的實作與維護知識已寫入本專案 README／交接；不把課程資料或測試帳號寫入跨專案 Obsidian。

## 檢索

本次完整檢索與更正紀錄見 `task_retrieval.md`。續作已重新讀取 Obsidian「股票即時報價Dashboard設計與部署踩坑SOP」之 commit／push 與正式網站檔案確認段落；只採用通用發布驗證，不採用股票業務規則。來源權威以當次使用者更正與現行實作為準。
