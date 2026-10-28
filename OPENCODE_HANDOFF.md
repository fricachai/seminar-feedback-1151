# 專題討論（1）網站交接

## 2026-10-28｜建議／心得雙欄、03 查看建議、教師管理、上傳覆蓋（已上線）

狀態：`DELIVERED`。`HANDOFF_READY=true`。學生功能與教師管理程式均已部署；教師帳號／密碼已由使用者自行設定，本輪未讀取、未記錄任何教師憑證。

- 回饋頁「我的建議」改為「我對報告同學的建議」，新增「我對此份報告的心得」，兩欄各限 3,000 字；同一組報告者／填寫者只保留一筆，再次儲存會覆蓋先前內容。為保護隱私，選取報告者後不再讀取或顯示先前內容，兩欄一律從空白開始；公開讀取端點只回傳是否存在與版本時間，離開回饋頁也會清空目前草稿。
- 首頁新增 03「查看給我的建議」：選自己的學號姓名後，讀取所有同學給自己的建議，每位同學的建議自成一段、段間空一行；只回傳建議文字，不顯示填寫者姓名、學號或其他資訊。
- 上傳頁最下方新增「我的填寫進度」：另一個學號姓名下拉，選後只列出自己已完成「建議」或「心得」的報告同學，依學號排序；顯示「建議已完成／心得已完成」，未完成者不列出。
- 上傳文章或簡報再次上傳時，會覆蓋同一位同學先前的同類檔案，只保留最新一份；Apps Script 端會汰換舊檔，Worker 會停用該生舊索引，避免目錄出現兩三份同類檔案。**正式橋接已更新至版本 6**（先前只部署 Worker／前端，造成正式站仍用舊橋接而產生重複檔）；臨時清理操作已移除。
- 回饋頁標題右側新增「教師管理」按鈕。教師以獨立帳號、密碼登入後，選擇報告者，即可查看每位提供建議同學的學號姓名、「我的建議」與「我的心得」；依提供建議同學學號排序，區塊間留白。
- 教師帳密使用 Cloudflare secrets `TEACHER_USERNAME`、`TEACHER_PASSWORD_HASH`，不寫入程式或 Git。教師帳密已由使用者自行設定完成；本輪**沒有**讀取或記錄任何教師憑證。設定方式見 README 的「教師管理」節與 `scripts/set-teacher-credentials.mjs`。

### 本輪部署與驗證

- D1 已套用 `0005_feedback_takeaway_teacher.sql`、`0006_feedback_relax_content.sql`；正式 `students=35`、`presentations=0`、`feedback=0`、`teacher_sessions=0`；目前 catalog `papers=7`、7 位學生各有 1 篇（1 位新增文章後的正確狀態）。
- Worker `1.4.0` 已部署，版本 ID `ec5fda7c-0e93-437d-a213-49fc3bfdc8d2`；`/api/health` 回 `1.4.0`。
- 前端 commit `51d25a3aec9221e9b4d10a12c31414106a1abb8b` 已推送 `main`；Pages workflow `40621661887` 成功。
- 教師管理 `Failed to fetch` 根因已修正：Worker CORS `Access-Control-Allow-Headers` 加入 `X-Teacher-Token`；正式預檢回 `Content-Type, Authorization, X-Teacher-Token`。
- 正式站 `index.html`、`app.js`、`config.js`、`favicon.svg` SHA-256 與提交一致；`styles.css` 僅結尾 CRLF／LF 差異，內容相同。
- 本機 `npm run check` 通過；`SEMINAR_TEST_SKIP_SYNC=1 npm test` **36／36 通過**，含建議／心得雙欄、只填心得、3,000 字邊界、公開讀取不含內容、查看建議匿名性、填寫進度、教師登入／登出、CORS 教師標頭、上傳覆蓋與格式汰換。
- 以假資料瀏覽器實測：首頁 03、雙欄空白開始／儲存／覆蓋、查看建議空行合併、填寫進度僅完成項目、教師登入／管理／登出；正式站結構讀回 03、雙欄、教師按鈕、進度區塊與教師登入表單，無水平溢位。
- 正式教師登入在未設定 secrets 前回 `503 TEACHER_NOT_CONFIGURED`，符合預期；未使用任何真實教師帳密測試。

### 尚未完成／待設定

1. 教師帳密已由使用者自行設定，登入頁已可使用；本輪未讀取或記錄憑證。若日後要更換密碼，可使用 `npm run set-teacher`，既有教師工作階段最長 12 小時。
2. 正式「再次上傳覆蓋」尚未以真實學生檔案重跑；目前以 Apps Script 模擬、Worker 舊索引停用邏輯與單元測試驗證，正式端到端可另行安排。
3. 新畫面的 390 手機視覺未另存核驗；目前完成 800／1000 寬度結構檢與 CSS 響應式規則，不宣稱手機視覺通過。
4. 瀏覽器原生另存仍以 API 位元組與 SHA-256 分層驗證，未宣稱原生存檔完成。

以下保留先前版本歷史。

## 2026-10-27｜學習入口、文章與簡報上傳頁（已上線）

狀態：`DELIVERED`。`HANDOFF_READY=true`。正式網站已更新，程式、Google 橋接、正式 D1 遷移、Worker 與 Pages 均已上線並完成正式文章上傳／下載與清理。

- 登入後第一個畫面改為學習入口，提供兩個超連結：「上傳報告文章與簡報」與「閱讀文章與填寫建議」。原有「01 選擇報告者／02 確認填寫身分／03 儲存我的建議」移至獨立檢視；該檢視右上角舊的上傳簡報區塊已移除。
- 新增上傳檢視：先選「請選擇自己的學號與姓名」，選好後實際呼叫 `/api/sync` 更新雲端資料，並分別列出該生已上傳的文章檔名與簡報檔名。文章與簡報可只傳一項或同時送出。
- 文章限 PDF、5 MB；檔名強制為「年份_篇名.pdf」，前端、Worker 與 Apps Script 三層驗證。簡報維持 PPT／PPTX／PDF、5 MB，伺服器以選取學號命名。兩者都存入「學號 姓名」資料夾，原檔保留。
- 後端新增 `POST /api/papers`、`worker/papers.js`、Drive 橋接 `upload-paper` op；`papers` 表新增 nullable `filename`（migration `0004_paper_filename.sql`），供上傳頁顯示實際檔名。既有文章與建議不受影響。
- 版本 `1.2.0`：`package.json`、Worker `/api/health`、前端資源查詢參數同步更新。

### 正式上線與驗證

- Google 橋接沿原部署更新至版本 3；catalog 讀回 35 位學生、6 份文章，名單與原始基準一致。Apps Script API 已由使用者帳號啟用。
- 正式 D1 已套用 `0004_paper_filename.sql`；上線後讀回 `students=35`、`papers=6`、`presentations=0`、`feedback=0`、測試學生 0。
- Worker `1.2.0` 已部署，版本 ID `5cf977e1-925f-457c-8ef8-92199611439f`；`/api/health` 回 `1.2.0`。
- 前端 commit `1da1eec6bb5ccb867dede59059f90beecf7d8a31` 已推送 `main`；Pages workflow `40537587194` 成功。
- 正式站 `index.html`、`app.js`、`config.js`、`favicon.svg` 與提交內容 SHA-256 一致；`styles.css` 僅結尾 CRLF／LF 差異，內容相同。
- 正式登入後學習入口、兩個連結、上傳頁身分選擇觸發雲端更新、回饋頁 journey 與「無舊上傳區塊」均已讀回；390 CSS 幾何無水平溢位。
- 正式文章端到端：以 `2099_上線測試文章.pdf`（192 bytes）上傳成功，`papers` 索引出現且下載回 HTTP 200、`application/pdf`、`%PDF-` 開頭、SHA-256 與本機測試檔一致。
- 清理：測試文章已移至 Google Drive 垃圾桶、D1 測試列已刪除、臨時工作階段已刪除；重新同步後 `students=35`、`papers=6`、`presentations=0`、`feedback=0`、測試列 0。若該生原先沒有資料夾，測試可能留下一個空學生資料夾；未刪除以避免誤刪學生資料。
- 本機 `npm run check` 通過；`SEMINAR_TEST_SKIP_SYNC=1 npm test` 27／27 通過；`audit-release` 36 個追蹤檔、72 個私有值、0 發現。
- 截圖只使用假學生與假檔名，存放於 ignored `output/design-*.png`；未讀取或輸出正式學生姓名、通關碼或 `.dev.vars`。

### 尚未完成／限制

1. 正式手機截圖未另存核驗；390 CSS 幾何檢核不等於手機視覺驗收。
2. 瀏覽器原生另存完成仍未核驗；文章下載以 API 位元組與 SHA-256 驗證。
3. 簡報上傳本輪未重新做正式端到端（既有 2026-10-27 已驗紀錄保留）；文章上傳已正式驗證。
4. 測試若原先無學生資料夾，可能留下一個空資料夾；不影響網站與目錄同步。

以下保留先前版本歷史。

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
