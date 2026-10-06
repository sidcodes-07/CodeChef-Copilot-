# CodeChef Copilot

CodeChef Copilot is a Chrome/Edge Manifest V3 extension plus a Node backend that proxies structured question context to NVIDIA's API. The NVIDIA key stays on the backend and must never be included in the extension.

## Public launch checklist

The repository includes a Render Blueprint in `render.yaml`. Hosting setup requires a GitHub repository, a Render account, and an NVIDIA API key. A support contact can be omitted for initial deployment/testing; add one before store submission.

### 1. Push the project to a private or public GitHub repository

Create a GitHub repository and push these project files. Do not upload `.env`, API keys, `node_modules`, or local credentials. `.gitignore` excludes `.env` and `node_modules`.

### 2. Deploy the API on Render

1. In Render, choose **New > Blueprint** and connect the GitHub repository.
2. Review the service from `render.yaml`, then create it. Render asks for the `NVIDIA_API_KEY` secret because its Blueprint entry uses `sync: false`.
3. Enter the raw NVIDIA key (normally starts with `nvapi-`) into Render's secret field or the service's **Environment** settings. Do not add an authorization prefix: the backend formats the authorization header automatically. Set `NVIDIA_MODEL` to `moonshotai/kimi-k3` if needed. Never put the actual API key in `render.yaml`, GitHub, or the extension.
4. Wait for deployment and open `https://codechef-copilot-api.onrender.com/api/health`.
5. Confirm the health response says `"nvidiaConfigured":true`; open `/privacy` and check the contact instructions.
6. In GitHub repository **Settings > Secrets and variables > Actions > Variables**, add `RENDER_HEALTH_URL` with the full Render health URL, for example `https://codechef-copilot-api.onrender.com/api/health`. The workflow in `.github/workflows/keep-render-alive.yml` requests this endpoint every five minutes.

The starter Blueprint uses Render's free plan, which may spin down while idle and take time to wake. For reliably live service, switch to a paid always-on plan. NVIDIA requests also incur usage under the NVIDIA account. The public API limits each IP to 10 model requests per minute by default; adjust `API_CALLS_PER_MINUTE` in Render if needed. This is a basic abuse/cost guard, not user authentication or a hard spending cap. Monitor NVIDIA and Render usage.

If Render assigns a different hostname, change `backend-config.js` and the exact backend host permission in `manifest.json` to match it, then reload/build the extension. Keep both values identical.

### 3. Smoke-test the deployed service

Test these routes:

- `GET /api/health` — service availability and whether the server has an NVIDIA key configured
- `GET /privacy` — public privacy policy
- `POST /api/solve` — validates compact MCQ/programming context and returns NVIDIA output; without an NVIDIA key it returns an explicit error

Do not publish until real NVIDIA requests work, a publisher contact is configured for store users, and the module/editor flow has been tested on CodeChef pages.

### 4. Load/test the extension

In Chrome open `chrome://extensions`, or in Edge open `edge://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the project folder. Open a non-assessment CodeChef practice/module page and test detection, code insertion, result waiting, stop, and failure controls.

The public API hostname is configured in `backend-config.js`; `manifest.json` grants access only to that hostname and HTTPS CodeChef pages. After changing either, reload the extension.

### 5. Publish in browser stores

Create publisher accounts for the Chrome Web Store and/or Microsoft Edge Add-ons, complete their current verification requirements, and prepare a listing: title, description, screenshots, publisher/support contact, and privacy-policy URL (`https://codechef-copilot-api.onrender.com/privacy`). You may omit `PRIVACY_CONTACT_EMAIL` during deployment/testing; provide a contact method before publishing.

For the extension upload, make a ZIP containing only:

```text
manifest.json
backend-config.js
background.js
content.js
popup.html
popup.css
popup.js
```

Do not include `.env`, `node_modules`, `server.js`, or the NVIDIA key. Submit the ZIP for store review; it will not be publicly available until the store approves it. Chrome and Edge may have separate review processes.

## Local backend development

1. Copy `.env.example` to `.env` and replace `nvapi-PASTE_YOUR_KEY_HERE` with your raw development NVIDIA key. Do not add an authorization prefix. The backend adds the required authorization scheme itself.
2. The default NVIDIA model is `moonshotai/kimi-k3`.
3. Run `npm install`.
4. Run `npm start`.
5. Test the local API at `http://127.0.0.1:3000/api/health`. The published extension config is intentionally pinned to the HTTPS Render hostname; do not ship a build pointed at a local backend.

The earlier static UI prototype can be previewed separately with `python -m http.server 8000`.

## Data and limitations

The extension sends only the detected question/options or problem/editor context needed for solving. The backend forwards it to NVIDIA and does not intentionally persist prompts or answers. IP addresses are used in memory for rate limiting; hosting and AI providers can process service metadata under their own terms. See `privacy.html`.

The detector scans the current DOM immediately; it does not poll while scanning. The MCQ detector is validated against the shared CodeChef course page's `_mcqContainer_`, `_mcqStatement_`, and `_optionBox_` elements and its `#submit_btn`. Programming detection now recognizes CodeChef's `#submit-ide-v2` Ace editor, reads/writes the editor through Ace, detects the `#language-select` C control, CodeChef's `#compile_btn` Run and `#submit_btn`, and extracts the visible problem statement/sample. Live result/feedback rendering still needs validation with a Run on the programming page; automatic Submit only happens after sample-output validation.
