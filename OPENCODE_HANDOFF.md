# 專題討論（1）網站交接

更新日期：2026-10-26。狀態：RELEASE_IN_PROGRESS。

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

## 目前發布工作

- GitHub 儲存庫：`https://github.com/fricachai/seminar-feedback-1151`。
- 待本輪推送、啟用 Pages、確認 Actions、比對線上檔案與完成線上 UI 驗收後更新狀態。
- 本機私有檔及通關碼、密鑰、PDF、截圖均不得提交。`scripts/audit-release.mjs` 以實際私有基準掃描待提交檔案，只輸出計數。
- 正式前端只發布 `public/`；Worker 變更另由 Wrangler 部署，密鑰保存在 Cloudflare secret。
- 課程同學自行選身分，不能宣稱個別帳號身分認證。沒有成績計算、教師後台或建議公開列表。

## 檢索

本次完整檢索與更正紀錄見 `task_retrieval.md`。續作已重新讀取 Obsidian「股票即時報價Dashboard設計與部署踩坑SOP」之 commit／push 與正式網站檔案確認段落；只採用通用發布驗證，不採用股票業務規則。來源權威以當次使用者更正與現行實作為準。
