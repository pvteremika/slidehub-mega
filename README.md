# SlideHub MEGA backend (starter/demo)

This project serves the SlideHub HTML app and provides API routes to upload, list, download, and delete `.ppt`/`.pptx` files in one MEGA account. It enforces a maximum of 3 PPT files and a default 10 MB maximum per file.

## Files

- `server.js` — Express backend, signed browser cookie, file validation, 3-file quota, MEGA upload/list/download/delete routes.
- `package.json` — Node dependencies and start command.
- `.env.example` — names of secrets to set in the hosting dashboard. Do not put real credentials in this file or upload them to GitHub.
- `public/index.html` — SlideHub HTML modified to use the backend API for the Uploaded PowerPoint files section. Editor-created presentations remain in that browser's localStorage.

## Important limitations / security

1. This starter uses a signed anonymous browser cookie instead of account login. It creates a separate MEGA folder for each browser profile. This is **not verified user identity**: clearing cookies or using another browser can create another profile and bypass the 3-file-per-profile limit. Do not describe this as a secure per-person quota. For real per-user quotas across devices, add real authentication (for example, Firebase Auth) and verify ID tokens on the server.
2. MEGA integration uses `megajs`, an unofficial third-party library, not an official MEGA SDK. Review its security notes and MEGA's current Terms of Service before storing other people's files. Use a separate MEGA account for testing; do not use a personal account containing private files.
3. Never put your MEGA password in the HTML, GitHub repository, or chat. Keep it only in hosting Environment Variables. Use a unique password and enable MEGA two-factor authentication if compatible with your deployment workflow (the sample currently expects email/password without a second-factor code, so 2FA may require additional implementation).
4. The backend does not publish public MEGA links; downloads stream through this server. Do not add public link-sharing unless you intentionally want files to be accessible by anyone with the link.
5. Render free services may sleep and have operational limitations. MEGA stores file contents, but the web service still must wake up to serve requests. Avoid trying to bypass a host's free-tier limits with frequent pings.
6. This starter has no true user login, malware scanning, or robust audit logging. Treat it as a prototype, not production storage for sensitive documents.

## Local testing

1. Install Node.js 20 or later on your computer/hosting environment.
2. In this folder, install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MEGA_EMAIL`, `MEGA_PASSWORD`, and a random `COOKIE_SECRET` of at least 32 characters. Never commit `.env`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

The HTML file must be served by this Express server for the `/api/files` calls to work. Opening `public/index.html` directly from Downloads will not connect to the backend.

## Deploy on Render from GitHub (phone-friendly outline)

1. Create a private GitHub repository. Upload the contents of this project folder, including `public/index.html`, `server.js`, `package.json`, `.gitignore`, and README. Do **not** upload `.env` or any real password.
2. In Render, choose **New → Web Service** and connect that repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. In Render's Environment settings add:
   - `MEGA_EMAIL` = your MEGA login email
   - `MEGA_PASSWORD` = your MEGA password
   - `COOKIE_SECRET` = a long random value (at least 32 characters)
   - `NODE_ENV` = `production`
   - `MAX_FILE_MB` = `10`
5. Deploy. Open the Render service URL, then test upload, download, and delete with non-sensitive sample PPT files.
6. If the service errors at startup, check Render Logs. Never send anyone your MEGA password or secret values.

## MEGA folder layout

The server creates `SlideHub-UserFiles/` in the MEGA cloud drive, then a folder per signed browser cookie (`u-<random-id>`). Each browser folder can hold up to 3 PPT/PPTX files. Do not manually rename those folders while testing.
