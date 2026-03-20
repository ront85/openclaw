/**
 * Inline HTML SPA for the secure-input web form.
 * Eliminates filesystem read fragility (public/secure-input.html path was brittle in Docker/prod).
 */
export function renderSecureInputHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Secure API Key Input - OpenClaw</title>
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
        background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: #333;
      }

      .container {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        max-width: 640px;
        width: 100%;
        padding: 40px;
        position: relative;
        overflow: hidden;
      }

      .container::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #6c63ff, #3f3d56);
      }

      .header {
        text-align: center;
        margin-bottom: 24px;
      }

      .header .icon {
        font-size: 48px;
        margin-bottom: 12px;
      }

      .header h1 {
        font-size: 22px;
        font-weight: 700;
        color: #1a1a2e;
        margin-bottom: 4px;
      }

      .header p {
        font-size: 14px;
        color: #666;
      }

      .info-box {
        background: #f0f0ff;
        border: 1px solid #d4d4ff;
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 20px;
        font-size: 13px;
        color: #444;
        line-height: 1.5;
      }

      .info-box strong {
        color: #333;
      }

      .countdown {
        text-align: center;
        font-size: 13px;
        color: #888;
        margin-bottom: 16px;
      }

      .countdown .time {
        font-weight: 700;
        color: #6c63ff;
        font-variant-numeric: tabular-nums;
      }

      .countdown .time.warning {
        color: #e74c3c;
      }

      /* Stored keys toggle and panel */
      .stored-keys-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 16px;
        cursor: pointer;
        font-size: 13px;
        color: #555;
        transition: background 0.2s;
      }

      .stored-keys-toggle:hover {
        background: #f0f0f0;
      }

      .stored-keys-toggle .arrow {
        transition: transform 0.2s;
        font-size: 12px;
      }

      .stored-keys-toggle .arrow.open {
        transform: rotate(90deg);
      }

      .stored-keys-panel {
        display: none;
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        padding: 14px;
        margin-bottom: 16px;
        max-height: 240px;
        overflow-y: auto;
      }

      .stored-keys-panel.visible {
        display: block;
      }

      .stored-key-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 13px;
        background: #fff;
        border: 1px solid #eee;
        margin-bottom: 6px;
      }

      .stored-key-item:last-child {
        margin-bottom: 0;
      }

      .stored-key-item .key-name {
        font-weight: 600;
        color: #333;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 12px;
      }

      .stored-key-item .key-value {
        font-size: 12px;
        color: #888;
        font-family: "SF Mono", "Fira Code", monospace;
        margin-left: 10px;
        flex: 1;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stored-key-item .delete-key-btn {
        background: none;
        border: none;
        color: #e74c3c;
        cursor: pointer;
        font-size: 16px;
        padding: 2px 6px;
        margin-left: 8px;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .stored-key-item .delete-key-btn:hover {
        background: #fde8e8;
      }

      .stored-keys-empty {
        font-size: 13px;
        color: #999;
        text-align: center;
        padding: 8px;
      }

      /* Phase 1: Input form */
      .form-group {
        margin-bottom: 16px;
      }

      .form-group label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: #444;
        margin-bottom: 6px;
      }

      .form-group .optional {
        font-weight: 400;
        color: #999;
        font-size: 12px;
      }

      textarea {
        width: 100%;
        min-height: 120px;
        border: 2px solid #e0e0e0;
        border-radius: 10px;
        padding: 12px;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 13px;
        resize: vertical;
        transition: border-color 0.2s;
        outline: none;
        background: #fafafa;
      }

      textarea:focus {
        border-color: #6c63ff;
        background: #fff;
      }

      textarea::placeholder {
        color: #bbb;
      }

      input[type="text"] {
        width: 100%;
        border: 2px solid #e0e0e0;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        transition: border-color 0.2s;
        outline: none;
        background: #fafafa;
      }

      input[type="text"]:focus {
        border-color: #6c63ff;
        background: #fff;
      }

      .file-upload {
        border: 2px dashed #d0d0d0;
        border-radius: 10px;
        padding: 20px;
        text-align: center;
        color: #888;
        font-size: 13px;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
        margin-bottom: 10px;
      }

      .file-upload:hover,
      .file-upload.drag-over {
        border-color: #6c63ff;
        background: #f5f5ff;
      }

      .file-upload input[type="file"] {
        display: none;
      }

      .file-upload .upload-icon {
        font-size: 28px;
        margin-bottom: 6px;
      }

      .or-divider {
        text-align: center;
        font-size: 12px;
        color: #aaa;
        margin: 10px 0;
      }

      .submit-btn {
        width: 100%;
        padding: 12px;
        background: linear-gradient(135deg, #6c63ff, #3f3d56);
        color: #fff;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
      }

      .submit-btn:hover {
        opacity: 0.9;
      }

      .submit-btn:active {
        transform: scale(0.98);
      }

      .submit-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Phase 2: Preview */
      .phase-2 {
        display: none;
      }

      .back-btn {
        background: none;
        border: none;
        color: #6c63ff;
        cursor: pointer;
        font-size: 13px;
        padding: 4px 0;
        margin-bottom: 16px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .back-btn:hover {
        text-decoration: underline;
      }

      .key-card {
        background: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 10px;
        padding: 14px;
        margin-bottom: 12px;
        transition: opacity 0.2s;
      }

      .key-card.removed {
        opacity: 0.4;
      }

      .key-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }

      .key-card-header .provider-label {
        font-size: 13px;
        font-weight: 600;
        color: #555;
      }

      .key-card-header .toggle-btn {
        background: none;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
        color: #666;
        transition: all 0.2s;
      }

      .key-card-header .toggle-btn:hover {
        border-color: #999;
        color: #333;
      }

      .key-card-header .toggle-btn.restore {
        border-color: #6c63ff;
        color: #6c63ff;
      }

      .key-card .var-name-input {
        width: 100%;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 7px 10px;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 13px;
        margin-bottom: 8px;
        outline: none;
        transition: border-color 0.2s;
      }

      .key-card .var-name-input:focus {
        border-color: #6c63ff;
      }

      .key-card .var-name-input.invalid {
        border-color: #e74c3c;
      }

      .key-card .redacted-value {
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 12px;
        color: #888;
        background: #f0f0f0;
        border-radius: 6px;
        padding: 8px 10px;
        word-break: break-all;
        position: relative;
      }

      .key-card .redacted-value .copy-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        cursor: pointer;
        color: #666;
      }

      .key-card .redacted-value .copy-btn:hover {
        border-color: #999;
      }

      .pass-remaining {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 16px 0;
        font-size: 13px;
        color: #555;
      }

      .pass-remaining input[type="checkbox"] {
        accent-color: #6c63ff;
      }

      /* Status messages */
      .loading {
        display: none;
        text-align: center;
        padding: 20px;
      }

      .loading .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #e0e0e0;
        border-top-color: #6c63ff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin: 0 auto 12px;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .success-box {
        display: none;
        background: #e8f8f0;
        border: 1px solid #a3e4c1;
        border-radius: 10px;
        padding: 20px;
        text-align: center;
        color: #1a7a4c;
      }

      .success-box .check-icon {
        font-size: 40px;
        margin-bottom: 8px;
      }

      .error-box {
        display: none;
        background: #fde8e8;
        border: 1px solid #f5a3a3;
        border-radius: 10px;
        padding: 14px;
        font-size: 13px;
        color: #c0392b;
        margin-bottom: 16px;
      }

      /* Expired overlay */
      .expired-overlay {
        display: none;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.95);
        z-index: 100;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 40px;
      }

      .expired-overlay.visible {
        display: flex;
      }

      .expired-overlay .expired-icon {
        font-size: 48px;
        margin-bottom: 16px;
      }

      .expired-overlay h2 {
        font-size: 20px;
        color: #333;
        margin-bottom: 8px;
      }

      .expired-overlay p {
        font-size: 14px;
        color: #666;
      }

      /* Animations */
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .fade-in {
        animation: fadeIn 0.3s ease-out;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="expired-overlay" id="expiredOverlay">
        <div class="expired-icon">&#9202;</div>
        <h2>Session Expired</h2>
        <p>
          This secure input session has expired. Please request a new link from
          your agent.
        </p>
      </div>

      <div class="header">
        <div class="icon">&#128274;</div>
        <h1>Secure API Key Input</h1>
        <p>Enter your credentials securely below</p>
      </div>

      <div class="info-box">
        <strong>How it works:</strong> Paste your API key, config file, or JSON
        credentials below. Keys are stored locally in your agent's
        <code>.env</code> file and never transmitted to external servers.
      </div>

      <div class="countdown" id="countdown">
        Session expires in: <span class="time" id="countdownTime">--:--</span>
      </div>

      <!-- Stored keys management -->
      <div class="stored-keys-toggle" id="storedKeysToggle">
        <span>Stored keys (<span id="storedKeysCount">0</span>)</span>
        <span class="arrow" id="storedKeysArrow">&#9654;</span>
      </div>
      <div class="stored-keys-panel" id="storedKeysPanel">
        <div id="storedKeysList"></div>
      </div>

      <div class="error-box" id="errorBox"></div>

      <!-- Phase 1: Paste/upload input -->
      <div class="phase-1" id="phase1">
        <div class="form-group">
          <label for="serviceName">
            Service name <span class="optional">(optional)</span>
          </label>
          <input
            type="text"
            id="serviceName"
            placeholder='e.g., "openai", "anthropic", "github"'
          />
        </div>

        <div class="form-group">
          <label for="keyInput">API key or configuration</label>
          <textarea
            id="keyInput"
            placeholder="Paste your API key, .env file contents, JSON config, or any text containing credentials..."
          ></textarea>
        </div>

        <div class="or-divider">or</div>

        <div class="file-upload" id="fileUpload">
          <div class="upload-icon">&#128196;</div>
          <div>Drop a file here or <strong>click to upload</strong></div>
          <div style="font-size: 11px; color: #aaa; margin-top: 4px">
            .env, .json, .txt, .yaml, .yml, .toml
          </div>
          <input
            type="file"
            id="fileInput"
            accept=".env,.json,.txt,.yaml,.yml,.toml,.cfg,.ini,.conf"
          />
        </div>

        <button class="submit-btn" id="previewBtn" disabled>
          Preview &amp; Detect Keys
        </button>
      </div>

      <!-- Phase 2: Preview detected keys -->
      <div class="phase-2" id="phase2">
        <button class="back-btn" id="backBtn">&#8592; Back to input</button>

        <div id="keyCards"></div>

        <div class="pass-remaining">
          <input type="checkbox" id="passRemaining" />
          <label for="passRemaining">
            Pass remaining configuration as raw text
          </label>
        </div>

        <button class="submit-btn" id="storeBtn">
          Store Selected Keys
        </button>
      </div>

      <!-- Loading spinner -->
      <div class="loading" id="loading">
        <div class="spinner"></div>
        <div>Processing...</div>
      </div>

      <!-- Success -->
      <div class="success-box" id="successBox">
        <div class="check-icon">&#10004;</div>
        <div><strong>Keys stored successfully!</strong></div>
        <div style="font-size: 13px; color: #666; margin-top: 8px">
          You can close this window now.
        </div>
      </div>
    </div>

    <script>
      (function () {
        // DOM refs
        var phase1 = document.getElementById("phase1");
        var phase2 = document.getElementById("phase2");
        var loading = document.getElementById("loading");
        var successBox = document.getElementById("successBox");
        var errorBox = document.getElementById("errorBox");
        var keyInput = document.getElementById("keyInput");
        var serviceName = document.getElementById("serviceName");
        var previewBtn = document.getElementById("previewBtn");
        var backBtn = document.getElementById("backBtn");
        var storeBtn = document.getElementById("storeBtn");
        var keyCards = document.getElementById("keyCards");
        var passRemaining = document.getElementById("passRemaining");
        var fileUpload = document.getElementById("fileUpload");
        var fileInput = document.getElementById("fileInput");
        var countdownEl = document.getElementById("countdownTime");
        var expiredOverlay = document.getElementById("expiredOverlay");
        var storedKeysToggle = document.getElementById("storedKeysToggle");
        var storedKeysPanel = document.getElementById("storedKeysPanel");
        var storedKeysArrow = document.getElementById("storedKeysArrow");
        var storedKeysList = document.getElementById("storedKeysList");
        var storedKeysCount = document.getElementById("storedKeysCount");

        // Token from URL
        var params = new URLSearchParams(window.location.search);
        var token = params.get("token");
        if (!token) {
          showError("Missing token. Please use the link provided by your agent.");
          previewBtn.disabled = true;
          return;
        }

        var previewData = null;
        var removedIndices = new Set();
        var varNames = {};
        var expiresAt = null;
        var countdownInterval = null;

        // --- Stored keys management ---
        storedKeysToggle.addEventListener("click", function () {
          storedKeysPanel.classList.toggle("visible");
          storedKeysArrow.classList.toggle("open");
          if (storedKeysPanel.classList.contains("visible")) {
            loadStoredKeys();
          }
        });

        function loadStoredKeys() {
          fetch("/api/secure-input/keys?token=" + encodeURIComponent(token), {
            headers: { "X-Secure-Input-Token": token }
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data.ok && data.keys) {
                renderStoredKeys(data.keys);
              } else {
                storedKeysList.innerHTML =
                  '<div class="stored-keys-empty">Unable to load keys</div>';
              }
            })
            .catch(function () {
              storedKeysList.innerHTML =
                '<div class="stored-keys-empty">Unable to load keys</div>';
            });
        }

        function renderStoredKeys(keys) {
          storedKeysCount.textContent = keys.length;
          if (keys.length === 0) {
            storedKeysList.innerHTML =
              '<div class="stored-keys-empty">No stored keys yet</div>';
            return;
          }
          var html = "";
          for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            html +=
              '<div class="stored-key-item">' +
              '<span class="key-name">' +
              escapeHtml(k.name) +
              "</span>" +
              '<span class="key-value">' +
              escapeHtml(k.redacted || "***") +
              "</span>" +
              '<button class="delete-key-btn" data-key="' +
              escapeAttr(k.name) +
              '" title="Delete this key">&#10005;</button>' +
              "</div>";
          }
          storedKeysList.innerHTML = html;

          // Attach delete handlers
          var delBtns = storedKeysList.querySelectorAll(".delete-key-btn");
          for (var j = 0; j < delBtns.length; j++) {
            delBtns[j].addEventListener("click", function (e) {
              var keyName = e.currentTarget.getAttribute("data-key");
              deleteStoredKey(keyName);
            });
          }
        }

        function deleteStoredKey(keyName) {
          fetch(
            "/api/secure-input/keys?token=" +
              encodeURIComponent(token) +
              "&key=" +
              encodeURIComponent(keyName),
            {
              method: "DELETE",
              headers: { "X-Secure-Input-Token": token }
            }
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data.ok) {
                loadStoredKeys();
              } else {
                showError(data.error || "Failed to delete key");
              }
            })
            .catch(function () {
              showError("Failed to delete key");
            });
        }

        // --- Countdown timer ---
        function startCountdown() {
          fetch("/api/secure-input/status?token=" + encodeURIComponent(token), {
            headers: { "X-Secure-Input-Token": token }
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data.ok && data.expiresAt) {
                expiresAt = data.expiresAt;
                updateCountdown();
                countdownInterval = setInterval(updateCountdown, 1000);
              } else if (data.expired || data.used) {
                showExpired();
              }
            })
            .catch(function () {
              // Silently ignore — countdown just won't show
            });
        }

        function updateCountdown() {
          if (!expiresAt) return;
          var now = Date.now();
          var remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
          if (remaining <= 0) {
            showExpired();
            if (countdownInterval) clearInterval(countdownInterval);
            return;
          }
          var minutes = Math.floor(remaining / 60);
          var seconds = remaining % 60;
          var timeStr =
            String(minutes).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0");
          countdownEl.textContent = timeStr;
          if (remaining <= 60) {
            countdownEl.classList.add("warning");
          } else {
            countdownEl.classList.remove("warning");
          }
        }

        function showExpired() {
          expiredOverlay.classList.add("visible");
        }

        startCountdown();
        loadStoredKeys();

        // --- File upload ---
        fileUpload.addEventListener("click", function () {
          fileInput.click();
        });

        fileUpload.addEventListener("dragover", function (e) {
          e.preventDefault();
          fileUpload.classList.add("drag-over");
        });

        fileUpload.addEventListener("dragleave", function () {
          fileUpload.classList.remove("drag-over");
        });

        fileUpload.addEventListener("drop", function (e) {
          e.preventDefault();
          fileUpload.classList.remove("drag-over");
          var files = e.dataTransfer.files;
          if (files.length > 0) {
            readFile(files[0]);
          }
        });

        fileInput.addEventListener("change", function () {
          if (fileInput.files.length > 0) {
            readFile(fileInput.files[0]);
          }
        });

        function readFile(file) {
          var reader = new FileReader();
          reader.onload = function (e) {
            keyInput.value = e.target.result;
            checkInput();
          };
          reader.readAsText(file);
        }

        // --- Input validation ---
        keyInput.addEventListener("input", checkInput);

        function checkInput() {
          previewBtn.disabled = !keyInput.value.trim();
        }

        // --- Phase 1: Preview ---
        previewBtn.addEventListener("click", function () {
          var rawValue = keyInput.value.trim();
          if (!rawValue) return;

          hideError();
          showLoading();

          fetch("/api/secure-input/preview", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Secure-Input-Token": token
            },
            body: JSON.stringify({
              token: token,
              value: rawValue,
              serviceName: serviceName.value.trim() || undefined,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              hideLoading();
              if (data.ok && data.credentials && data.credentials.length > 0) {
                previewData = data;
                removedIndices = new Set();
                varNames = {};
                for (var i = 0; i < data.credentials.length; i++) {
                  varNames[i] = data.credentials[i].varName;
                }
                renderKeyCards(data.credentials);
                phase1.style.display = "none";
                phase2.style.display = "block";
                phase2.classList.add("fade-in");
              } else {
                showError(
                  data.error ||
                    data.message ||
                    "No credentials detected in the provided input."
                );
              }
            })
            .catch(function (err) {
              hideLoading();
              showError("Request failed: " + err.message);
            });
        });

        // --- Phase 2: Key cards ---
        function renderKeyCards(credentials) {
          var html = "";
          for (var i = 0; i < credentials.length; i++) {
            var cred = credentials[i];
            var isRemoved = removedIndices.has(i);
            html +=
              '<div class="key-card' +
              (isRemoved ? " removed" : "") +
              '" data-index="' +
              i +
              '">' +
              '<div class="key-card-header">' +
              '<span class="provider-label">' +
              escapeHtml(cred.provider || "Unknown provider") +
              "</span>" +
              '<button class="toggle-btn' +
              (isRemoved ? " restore" : "") +
              '" data-index="' +
              i +
              '">' +
              (isRemoved ? "Restore" : "Remove") +
              "</button>" +
              "</div>" +
              '<input class="var-name-input" data-index="' +
              i +
              '" value="' +
              escapeAttr(varNames[i] || cred.varName) +
              '" placeholder="VAR_NAME"' +
              (isRemoved ? " disabled" : "") +
              " />" +
              '<div class="redacted-value">' +
              escapeHtml(cred.redacted || "****") +
              '<button class="copy-btn" data-value="' +
              escapeAttr(cred.value) +
              '">Copy</button>' +
              "</div>" +
              "</div>";
          }
          keyCards.innerHTML = html;

          // Toggle handlers
          var toggleBtns = keyCards.querySelectorAll(".toggle-btn");
          for (var j = 0; j < toggleBtns.length; j++) {
            toggleBtns[j].addEventListener("click", function (e) {
              var idx = parseInt(e.currentTarget.getAttribute("data-index"), 10);
              if (removedIndices.has(idx)) {
                removedIndices.delete(idx);
              } else {
                removedIndices.add(idx);
              }
              renderKeyCards(previewData.credentials);
            });
          }

          // Var name input handlers
          var varInputs = keyCards.querySelectorAll(".var-name-input");
          for (var k = 0; k < varInputs.length; k++) {
            varInputs[k].addEventListener("input", function (e) {
              var idx = parseInt(e.target.getAttribute("data-index"), 10);
              var val = e.target.value;
              varNames[idx] = val;
              if (val && /^[A-Za-z_][A-Za-z0-9_]*$/.test(val)) {
                e.target.classList.remove("invalid");
              } else {
                e.target.classList.add("invalid");
              }
            });
          }

          // Copy handlers
          var copyBtns = keyCards.querySelectorAll(".copy-btn");
          for (var m = 0; m < copyBtns.length; m++) {
            copyBtns[m].addEventListener("click", function (e) {
              e.stopPropagation();
              var val = e.currentTarget.getAttribute("data-value");
              navigator.clipboard.writeText(val).then(function () {
                e.currentTarget.textContent = "Copied!";
                setTimeout(function () {
                  e.currentTarget.textContent = "Copy";
                }, 1500);
              });
            });
          }
        }

        backBtn.addEventListener("click", function () {
          phase2.style.display = "none";
          phase1.style.display = "block";
        });

        // --- Store keys ---
        storeBtn.addEventListener("click", function () {
          if (!previewData || !previewData.credentials) return;

          // Validate var names
          var selected = [];
          for (var i = 0; i < previewData.credentials.length; i++) {
            if (removedIndices.has(i)) continue;
            var vn = varNames[i] || previewData.credentials[i].varName;
            if (!vn || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(vn)) {
              showError(
                "Invalid variable name: " +
                  escapeHtml(vn || "(empty)") +
                  ". Use only letters, numbers, and underscores."
              );
              return;
            }
            selected.push({
              value: previewData.credentials[i].value,
              varName: vn,
              provider: previewData.credentials[i].provider,
            });
          }

          if (selected.length === 0) {
            showError("No keys selected to store.");
            return;
          }

          hideError();
          showLoading();

          fetch("/api/secure-input/submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Secure-Input-Token": token
            },
            body: JSON.stringify({
              token: token,
              credentials: selected,
              passRemaining: passRemaining.checked,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              hideLoading();
              if (data.ok) {
                phase2.style.display = "none";
                successBox.style.display = "block";
                successBox.classList.add("fade-in");
              } else {
                showError(
                  data.error || data.message || "Failed to store keys."
                );
              }
            })
            .catch(function (err) {
              hideLoading();
              showError("Request failed: " + err.message);
            });
        });

        // --- Helpers ---
        function showLoading() {
          loading.style.display = "block";
          phase1.style.display = "none";
          phase2.style.display = "none";
        }

        function hideLoading() {
          loading.style.display = "none";
        }

        function showSuccess() {
          successBox.style.display = "block";
        }

        function showError(msg) {
          errorBox.textContent = msg;
          errorBox.style.display = "block";
        }

        function hideError() {
          errorBox.style.display = "none";
        }

        function escapeHtml(str) {
          var div = document.createElement("div");
          div.appendChild(document.createTextNode(str));
          return div.innerHTML;
        }

        function escapeAttr(str) {
          return String(str)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }
      })();
    </script>
  </body>
</html>`;
}
