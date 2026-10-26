# 本次檢索與 instruction lock

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
