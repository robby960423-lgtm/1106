# Firebase 設定與 Google 登入

此靜態網站會在 Firebase Authentication 驗證成功前隱藏行事曆；行程與待辦儲存在 Cloud Firestore，並以 Firebase UID 隔離。

## 設定步驟

1. 在 Firebase Console 建立專案，新增 Web app，複製 Firebase web config。
2. Authentication → Sign-in method：啟用 Google provider。
3. Authentication → Settings → Authorized domains：加入 `robby960423-lgtm.github.io`（本機預覽再加入 `localhost`）。
4. 建立 Cloud Firestore database。將本專案的 `firestore.rules` 套用並發布；規則只允許登入者讀寫自己的 `users/{uid}/plannerItems`。
5. 複製 `firebase-config.example.js` 為 `firebase-config.js`，填入 Web app config。`firebase-config.js` 已列入 `.gitignore`，不會推送至 GitHub。
6. 本機以靜態 HTTP server 預覽（例如 `python -m http.server 8000`），不要直接以 `file://` 開啟。
7. 將 `firebase-config.js` 私下部署至網站根目錄（例如用有權限的部署流程或私有 Actions secret 生成該檔），再重新部署 Pages。沒有此檔案時，登入入口會顯示未設定狀態，應用內容維持隱藏。

Firebase web config 的 apiKey/appId 是用戶端識別值，不是管理員密鑰；實際資料保護由登入驗證與 Firestore Security Rules 負責。切勿把服務帳戶私鑰放進前端。
