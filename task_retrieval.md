# 本次檢索與 instruction lock

## 2026-10-28｜建議／心得雙欄、03 查看建議、教師管理、上傳覆蓋

狀態：`DELIVERED`。`CURRENT_MODEL=UNVERIFIED`、`CURRENT_EFFORT=UNVERIFIED`，未自行切換。

- 使用者需求：回饋頁建議改為「我對報告同學的建議」與「我對此份報告的心得」，各 3,000 字；首頁新增 03 查看給自己的建議（不顯示填寫者資訊）；上傳頁下方新增填寫進度；文章／簡報再次上傳覆蓋舊檔；回饋頁新增教師管理登入與管理頁；用字適當美化。
- 教師帳密：使用者明確表示由本人設定，且已完成設定並登入教師管理。本輪未產生、未讀取、未記錄任何教師帳密；實作使用 Cloudflare secrets `TEACHER_USERNAME`／`TEACHER_PASSWORD_HASH`，並提供 `scripts/set-teacher-credentials.mjs` 供日後更換。未設定時教師登入回 `503 TEACHER_NOT_CONFIGURED`。
- 覆蓋規則：同一位學生的文章只保留一份、簡報只保留一份；Apps Script 採「先建立新檔，成功後把舊檔移至垃圾桶」，Worker 上傳後停用該生其他舊索引。再次輸入建議／心得更新同一組主鍵，以最後一次儲存為準。正式橋接已更新至版本 7；版本 6 曾使用 `File.setContent()`，造成 Drive 檔案 MIME／大小不完整與 Worker 回報「雲端文章／簡報資訊不完整」，已改為建立新檔。
- 隱私邊界：選取報告者後不讀取、不顯示先前建議／心得，兩欄一律空白開始；公開 `GET /api/feedback` 只回傳是否存在與版本時間，不回傳文字；離開回饋頁清空草稿。`/api/presenter-feedback` 只回傳建議字串，不查詢或回傳 reviewer 欄位；教師端 `/api/teacher/feedback` 才回傳 reviewer 學號姓名，且必須通過獨立教師工作階段。
- CORS：教師 API 使用 `X-Teacher-Token`，Worker 的 `Access-Control-Allow-Headers` 必須包含此標頭；已補上並以正式 OPTIONS 預檢驗證。
- 進度邊界：`/api/student-progress` 只回傳已完成建議或心得的 presenter 與兩個完成旗標，不回傳建議／心得文字；依 presenter 學號排序。
- 教師刪除：教師管理每個區塊提供「刪除這筆」，使用頁面內確認視窗；`DELETE /api/teacher/feedback` 僅接受教師工作階段，刪除單一 presenter／reviewer 的建議與心得。學生端沒有刪除端點。
- 雙欄必填：前端「儲存建議與心得」必須建議與心得都有非空白內容才啟用；Worker 對只填一欄或未帶欄位的 `PUT /api/feedback` 一律回 400。資料庫 `0006` 的重建表仍允許至少一欄，實際寫入防線由 Worker 統一管制。
- 資料庫：`0005_feedback_takeaway_teacher.sql` 新增 takeaway 與 teacher_sessions；`0006_feedback_relax_content.sql` 重建 feedback 檢查，各限 3,000 字。兩欄皆必填由 Worker 驗證，資料庫保留「至少一欄」的寬鬆條件以避免舊資料遷移失敗。
- 實讀：根目錄與 `seminar-feedback/OPENCODE_HANDOFF.md`、`README.md`、`task_retrieval.md`；`worker/`、`public/`、`migrations/`、`tests/`、`google-apps-script/`；Obsidian Google 表單 SOP 的課程網站串接與上傳節。
- 介面修正：上傳頁切換學號姓名時清空文章／簡報的已選檔案、檔名與狀態訊息，避免上一位的「已儲存…」殘留；清單標題為「目前上傳文章的狀態：」與「目前上傳簡報的狀態：」，字級與「已更新雲端資料：…」同為 12px。空檔與超過 5MB 分開提示，超限顯示「檔案大小超過 5MB！」；「← 返回學習入口」改為 14px、600 字重。
- 驗證：`npm run check`；36 項本機測試（含雙欄、只填心得、3,000 字邊界、公開讀取不含內容、匿名查看、填寫進度、教師登入／登出、CORS 教師標頭、上傳覆蓋）；假資料瀏覽器流程；正式 D1 `0005`／`0006`、Worker `1.4.0`、Pages `40621661887`、正式站五份資源比對與 CORS 預檢。390 新畫面視覺與正式再次上傳覆蓋未另做端到端，不宣稱通過。

## 2026-10-27｜學習入口與文章／簡報上傳頁

狀態：`DELIVERED`。`CURRENT_MODEL=UNVERIFIED`、`CURRENT_EFFORT=UNVERIFIED`，未自行切換。

- 使用者需求：登入後第一個畫面提供兩個超連結，分別前往「上傳報告 paper 與簡報」及既有「01 選擇報告者／02 確認填寫身分／03 儲存我的建議」頁；後者不再保留舊的上傳簡報區塊。
- 上傳頁順序：先選自己的學號與姓名；選好後啟動雲端文章／簡報更新，並列出該生已上傳的文章名稱與簡報檔名。
- 文章：PDF、5 MB 以內、檔名「年份_篇名」；簡報：PPT／PPTX／PDF、5 MB 以內、伺服器以學號命名；可只傳一項或兩項一起送出；沿用「學號 姓名」資料夾與原檔保留原則。
- 設計沿用原站暖白／墨綠／霧金、Noto Serif TC 標題、既有 panel、journey、primary button 與「尚未上傳」「更新雲端文章」等用詞；回饋頁保留左上標題與說明，只移除右上上傳區塊。
- 權威來源：當次使用者指示 > 現行原始碼與交接 > Obsidian 已寫回 Google 表單 SOP 的 2026-10-26／2026-10-27 工程節 > 一般背景知識。採用作業邊界：固定課程根資料夾、正式名單、三層格式／容量檢查、HMAC＋nonce、上傳識別碼去重、雲端已存但索引失敗需明示、測試資料精確清理。
- 實讀：根目錄與 `seminar-feedback/OPENCODE_HANDOFF.md`、`README.md`、`task_retrieval.md`；`worker/`、`public/`、`migrations/`、`tests/`、`google-apps-script/`；Obsidian `Codex操作累積/Google表單-AppsScript建立與跳題SOP.md` 的課程網站串接與自建上傳節。
- 明確排除：不改原 Google 表單、不改來源 PDF、不做成績或教師後台、不使用 ChatGPT Sites、不把學生名單／通關碼／密鑰寫入公開 Git 或日誌。
- 設計決策：文章檔名由前端與伺服器雙重驗證，不提供任意檔名覆寫；`papers` 新增 nullable `filename` 以顯示實際上傳檔名；既有文章仍以 `title` 顯示篇名。上傳頁的「年_篇名」使用全形／半形底線皆可，伺服器正規化為半形 `_` 與小寫 `.pdf`。
- 驗證：`npm run check`、27 項本機測試（雲端同步跳過）、本機 D1 `0004`、假資料瀏覽器流程、桌機與 390 CSS 幾何。正式上線後已完成 Google 橋接版本 3、正式 D1 `0004`、Worker `1.2.0`、Pages workflow `40537587194`、正式文章上傳／下載雜湊與精確清理；正式手機截圖與原生另存仍未核驗，不宣稱通過。

## 2026-10-27｜簡報上傳與下載

狀態：RETRIEVAL_PASS；CURRENT_MODEL=UNVERIFIED、CURRENT_EFFORT=UNVERIFIED，無明確切換收益，維持當前設定。

授權續作：使用者當次明確同意既有橋接程式由 Drive 唯讀擴充至讀寫，以供學生上傳簡報。既有 5 MB、學號命名、資料夾、個資與發布範圍鎖定延續。前輪已通過 21 項本機測試（其中雲端同步明確跳過，非正式上傳驗收）；Google 編輯器原始碼與 manifest 已更新保存，正式部署尚未切換。續作須完成 Google 授權、版本部署、真實雲端驗收與測試檔精確清理、Worker／Pages 發布及交接讀回。

續作已核驗：Google manifest 的 drive scope 不等於實際已授予寫入；讀取成功也不能證明建夾權限。實測 createFolder 回報缺少 drive 權限後，使用者親自完成 Google 未驗證應用程式安全提示／授權，並提供成功畫面；之後三份 API 簡報與一份瀏覽器送出均實際成功。橋接沿原網址部署至第 2 版；D1 0003 遷移完成，Worker 1.1.0 已部署。一次 D1 授權錯誤後重試成功；初次部署先於遷移完成的順序已修復，後續發布須確認相依步驟 exit code 才繼續。21 項本機測試重新執行，這次包含真實雲端同步；正式 API 35 位名單／6 份文章原始雜湊通過，新增簡報包括精確 5,242,880 bytes 邊界與 PPTX，四份下載內容雜湊均吻合。原生瀏覽器另存完成未核驗；不可把下載事件等待逾時寫成已存至 Downloads。保留 API 位元組與 UI 送出／更新分層證據。

最終範圍內狀態：DELIVERED。四份測試檔與原先不存在且清理後為空的測試資料夾已精確移至垃圾桶；正式再同步確認 35 位／6 份文章／0 份簡報。Google 編輯器暫時驗收函式已移除並比對正式原始碼。功能 commit a08c027 已推送 main，Pages 40515307809 成功，五份正式檔案雜湊一致。正式 UI 上傳提醒、選單、空狀態及桌機視覺已驗；正式 CSS 390 無溢位，但手機正式截圖逾時為 NOT_PERFORMED。本機同版 CSS 390 視覺成功。Obsidian 原 SOP 新增已驗證工程節並讀回；其餘系統維護 NOT_APPLICABLE。

2026-10-27 使用者補充命名規則：重新查核上述 Google SOP metadata，沿用已讀歸檔段落。新增 instruction lock：上傳區明確提醒以學號命名；伺服器存檔強制為「選取學號.原副檔名」，不以任意上傳檔名覆蓋本次指示。同名重傳保存既有檔案，以最新修改時間優先列出。

2026-10-27 使用者補充容量：重新查核同一 Google SOP metadata，沿用已讀「精準 5MB 上限」限制。當前是自建網站，不套用 Google Forms 預設上限；instruction lock 更新為每檔最多 5 MB（5 × 1024 × 1024 bytes），前端、Worker、Apps Script 三層強制檢查，取代先前暫定 20 MB。邊界值與超限必測。

- In scope：既有 Pages／Worker／D1／Apps Script 的簡報上傳、正式名單選擇、學生資料夾建立、下載及發布驗收。
- Out of scope：原表單重建、文章改寫、評分、ChatGPT-Project-external（NOT_APPLICABLE）。
- Authority：當次使用者指示 > 現行原始碼與正式雲端名單 > Google 官方文件 > 專案交接 > SOP。
- 搜尋詞：專題討論、中文路徑；記憶搜尋未命中，不以舊記憶當來源。
- 實讀：根目錄與子專案 OPENCODE_HANDOFF.md；Obsidian「Google表單-AppsScript建立與跳題SOP」之歸檔、權限與課程網站串接節；「MarkItDown自動轉換規則與全域工具」之中文路徑節。
- 採用 current-task rule：固定根資料夾、正式名單、伺服器驗證、私有資料不入公開 Git、下載與內容雜湊分別驗收、測試物件清除。
- 排除 historical case：舊唯讀限制由本次明確寫入需求取代；不改原表單，不帶入舊的外部 Project 維護狀態。
- 已知失敗模式：PDF 簡報誤列文章；上傳成功但索引失敗被誤報上傳失敗；重試重複檔案；中文路徑與 inline quoting；OAuth 授權不等於部署成功。
- selected workflow：UTF-8 檔案與相對路徑；既有獨立橋接增加受簽章保護寫入；簡報帶類別標記；使用穩定上傳 ID 防重試；先本機隔離測試，再更新橋接、Worker／D1、Pages；逐層讀回。
- instruction lock：標題右邊依序「上傳報告簡報」選檔、學號姓名下拉、送出；接受 .ppt／.pptx／.pdf；存於既有課程根目錄下「學號 姓名」資料夾，不存在才建；原檔保留，不覆寫文章；選報告同學後在文章下載下面列簡報下載，缺檔顯示「尚未上傳」；既有建議保留。
- Verification：格式／容量／名單／簽章／資料夾歸屬、防重送、文章簡報分流、下載位元組、桌機手機版、正式發布與測試資料零殘留。正式文件／統計／Word QA：NOT_APPLICABLE。

| source / requirement | output | verification |
|---|---|---|
| 當次頁首位置與順序 | public/index.html、styles.css | 桌機／手機畫面與操作 |
| 正式修課名單 | 第三個獨立身分選單、伺服器再核對 | 未知身分拒絕、選單一致 |
| Drive 學生子資料夾 | 橋接上傳與必要建夾 | 模擬建夾＋正式雲端回讀 |
| PPT／PPTX／PDF | 格式、大小、內容特徵驗證 | 合法與非法檔案測試 |
| 簡報下載／尚未上傳 | presentations 索引與獨立區塊 | 分流、空狀態、下載雜湊 |
| 原文章與建議保留 | 最小資料庫擴充 | 既有整合測試與來源雜湊 |

日期：2026-10-26。狀態：PASS。正式發布與適用功能驗收已完成，證據見 `OPENCODE_HANDOFF.md` 與 ignored `output/` 驗收檔。

## 範圍

Codex-local：課程網站程式、同步工具、交接及測試。
Obsidian-local：只讀適用 SOP，符合條件後才回寫可重用且不敏感知識。
Web/official-source：Cloudflare Worker／D1 官方介面查核。
SmartPLS/native：NOT_APPLICABLE。ChatGPT-Project-external：NOT_APPLICABLE。

## 檢索證據

搜尋詞：專題討論、Cloudflare、D1、中文路徑；記憶補查 GitHub、部署、編碼。

實讀：

1. Drive 來源根目錄 `OPENCODE_HANDOFF.md`：原表單、35 筆選單、歸檔與不可改寫學生 PDF。
2. Obsidian `Codex操作累積/Google表單-AppsScript建立與跳題SOP.md`：檔案上傳及自動歸檔、名單保護。project rule／historical case；不採用歷史表單修改待辦。
3. Obsidian `Codex操作累積/MarkItDown自動轉換規則與全域工具.md`：中文路徑／PowerShell 編碼、抽取不等於原頁。current-task rule（適用技術原則）；只檢核篇名，不進行全文研究分析。
4. Obsidian `Codex操作累積/OpenCode全域資料邊界與外部模型安全SOP.md`：資料最小化與憑證、學生資料不進一般 Git／紀錄。OpenCode 特定 provider 程序不適用本次 Codex。
5. Obsidian `Codex操作累積/Test Data專案-Codex操作累積.md`：2026-09-20 Cloudflare Wrangler／OAuth 小節。historical case；需重新核對可用性。
6. Obsidian `Codex操作累積/跨專案長期記憶中樞.md`：確認 active、路由及適用範圍，不把其他專案舊待辦帶入。
7. 本機記憶 `MEMORY.md` 之 GitHub 部署小節：通過適用檢查後提交、推送及線上驗證；historical preference。

已讀 Skill：Playwright、PDF、Spreadsheets（Excel 只讀；不修改來源）。

## 已知失敗模式與所選流程

- 未登入無法讀原上傳表單；不得因此以現有 6 個資料夾當成完整修課名單。選擇正式 xlsx 作完整來源，表單名單另核對。
- Windows Python stdout 編碼可能亂碼；腳本及 JSON 明確 UTF-8，個資僅寫 ignored 私有資料檔，終端只輸出計數。
- Worker 無法直接讀 G 槽；採用明確同步流程，不虛構自動即時連線。
- OAuth 舊紀錄不代表目前 CLI 可寫；先唯讀檢查，再在本次授權範圍內建立專用資源。
- GitHub 不存個資／文章 PDF／通關碼；Worker PDF 全路徑先驗證，並測試猜網址不能下載。
- 切換報告者／填寫者時舊請求可能蓋到新欄位；採取消／序號核對、固定儲存對象及未儲存確認。

## Instruction lock

- 台灣繁體中文；依正式名單呈現「學號 姓名」。
- 報告者與填寫者選單；篇名、PDF 下載；尚未上傳顯示「尚未上傳」且不建立下載連結。
- 一組（報告者、填寫者）一份建議；帶回先前內容並可更新。
- 採「儲存我的建議」；共同課程通關碼；禁止以自己為報告者填寫自己的同儕建議。
- 暖白、深墨綠、少量霧金；桌機與手機皆可用，文字可讀、錯誤及儲存狀態明確。
- 不使用 ChatGPT Sites；不改原表單與來源 PDF；不做外部 ChatGPT Project 操作。
- 全部必要驗收後才能宣稱完成；任何尚未完成的同步／部署／線上測試須如實標示。

## 編碼／命令錯誤後的更新

- 本次一次 PowerShell inline Python 因雙引號逸出方式不適用而在啟動前語法失敗；未修改來源或資料庫。
- 已重新讀取上述 MarkItDown SOP「中文路徑與 PowerShell inline Python」相關段落。
- Instruction lock 更新：含中文或混合引號的實質程式一律存成獨立 UTF-8 腳本，不再重跑該 inline 指令；先語法檢查再執行。

## 使用者更正後的 instruction lock（優先於前文方案）

- 單一版面、單一「更新雲端文章」按鈕；所有已通關的同學都能使用，不設教師專用頁或額外管理碼。
- 按鈕必須真正讀取 Google Drive 雲端最新資料；本機手動同步不能替代此功能。
- 新檢索：Obsidian「網頁應用程式」「Apps Script」；重新套用 Google 表單 SOP 的唯讀、原表單保護與 UI 焦點防錯規則。最近筆記無現成 Cloudflare→Google 私有資料夾串接實作。
- 已透過 Drive MCP 確認指定根資料夾的雲端實體及其 private sharing；不得開放原始檔案共享權限。
- 新方案：獨立 Google Apps Script 唯讀橋接程式，由 Worker 驗證共享密鑰後讀取目錄／PDF；正式資料仍留在 Google Drive，D1 存名單、篇名索引與建議。既有表單、上傳歸檔程式及權限不變。
- 原教師／學生兩個整理按鈕的方案作廢。網站更新索引不得修改已儲存的建議。

## 本輪完成發布的範圍鎖定

- 使用者明確要求完成推送並交付最後成果；沿用已確認的單頁、單一雲端更新按鈕與共同通關碼。
- 先讀專案根交接，核對已完成測試，再搜尋「GitHub Pages」，實讀 Obsidian「股票即時報價Dashboard設計與部署踩坑SOP」之提交、推送與正式檔案驗證段落。
- 採用規則：只提交本次程式、發布後檢查實際線上檔案與瀏覽器流程。分類 current-task rule；排除股票領域規則 historical case。
- 依官方 GitHub Pages REST 文件啟用 workflow 發布；正式公開成果僅包含網站程式與無個資維護文件。
- 範圍與原始來源不變；不重新改原表單、不修改 PDF、不增加後台或額外通關機制。

## 正式 UI 邊界情況修正

- 正式網站的儲存、不同報告者隔離與重新帶回皆已實測通過。
- 切換確認驗收時，原生 confirm 使瀏覽器工具逾時；取消後觀察到選單與保留文字不一致。不能把工具逾時直接當成後端寫錯，需分開核驗。
- 最小修正：切換前立即恢復原選擇，用頁面內可存取的確認視窗等待選擇，只有明確放棄後才套用新身分。後端配對鍵與既有建議保持不變。
- 本輪 instruction lock：取消時原身分及未儲存文字必須同時保留；確認放棄時才清空並讀取新配對。
- 發布後的驗收分頁曾繼續執行舊版原生 confirm 文字；新增前端資源版本參數，確保更新後取得相符的樣式及程式，重新開啟分頁驗收。
