'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { Storage } = require('megajs');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = Math.max(1, Number(process.env.MAX_FILE_MB || 10)) * 1024 * 1024;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD || !COOKIE_SECRET || COOKIE_SECRET.length < 32) {
  console.error('Missing MEGA_EMAIL / MEGA_PASSWORD / COOKIE_SECRET. Add them as environment variables. COOKIE_SECRET must be at least 32 characters.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser(COOKIE_SECRET));
app.use((req, res, next) => {
  // Signed, HttpOnly browser-session identity. This is an anonymous device profile, not verified human identity.
  let sid = req.signedCookies && req.signedCookies.shsid;
  if (!sid || !/^[a-f0-9-]{36}$/i.test(sid)) {
    sid = crypto.randomUUID();
    res.cookie('shsid', sid, {
      signed: true,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }
  req.slidehubSid = sid;
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.ppt' && ext !== '.pptx') return cb(new Error('Only .ppt and .pptx files are allowed.'));
    cb(null, true);
  }
});
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

let storagePromise;
function getStorage() {
  if (!storagePromise) {
    storagePromise = (async () => {
      const s = new Storage({ email: process.env.MEGA_EMAIL, password: process.env.MEGA_PASSWORD, keepalive: false });
      await s.ready;
      return s;
    })().catch(err => { storagePromise = null; throw err; });
  }
  return storagePromise;
}

async function refreshStorage(s) {
  if (typeof s.reload === 'function') await s.reload();
}
async function getUserFolder(s, sid, create = true) {
  await refreshStorage(s);
  let root = s.root;
  if (!root || !Array.isArray(root.children)) throw new Error('MEGA folder list is not ready. Please retry.');
  let top = root.children.find(x => x.directory && x.name === 'SlideHub-UserFiles');
  if (!top && create) top = await root.mkdir('SlideHub-UserFiles');
  if (!top) return null;
  if (!Array.isArray(top.children)) await refreshStorage(s);
  top = s.root.children.find(x => x.directory && x.name === 'SlideHub-UserFiles') || top;
  let folder = (top.children || []).find(x => x.directory && x.name === `u-${sid}`);
  if (!folder && create) folder = await top.mkdir(`u-${sid}`);
  return folder || null;
}
function safeName(name) {
  return String(name || 'presentation.pptx').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 180) || 'presentation.pptx';
}
function listFiles(folder) {
  return (folder?.children || []).filter(f => !f.directory && /\.(ppt|pptx)$/i.test(f.name || '')).map(f => ({
    id: f.nodeId,
    name: f.name,
    size: Number(f.size || 0),
    addedAt: Number(f.timestamp || Math.floor(Date.now() / 1000)) * 1000
  }));
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'SlideHub MEGA backend' }));
app.get('/api/files', async (req, res, next) => {
  try {
    const s = await getStorage();
    await refreshStorage(s);
    const folder = await getUserFolder(s, req.slidehubSid, false);
    const files = listFiles(folder);
    res.json({ files, limit: MAX_FILES, remaining: Math.max(0, MAX_FILES - files.length), maxFileBytes: MAX_FILE_BYTES });
  } catch (e) { next(e); }
});
app.post('/api/files', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a .ppt or .pptx file.' });
    const s = await getStorage();
    const folder = await getUserFolder(s, req.slidehubSid, true);
    const files = listFiles(folder);
    if (files.length >= MAX_FILES) return res.status(409).json({ error: `Upload limit reached: maximum ${MAX_FILES} PPT files per browser profile.` });
    const name = safeName(req.file.originalname);
    if (files.some(f => f.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A file with this name is already uploaded. Delete it first or rename the file.' });
    const uploaded = await folder.upload({ name, size: req.file.size, forceHttps: true }, req.file.buffer).complete;
    res.status(201).json({ file: { id: uploaded.nodeId, name: uploaded.name || name, size: req.file.size, addedAt: Date.now() } });
  } catch (e) { next(e); }
});
app.get('/api/files/:id/download', async (req, res, next) => {
  try {
    const s = await getStorage();
    const folder = await getUserFolder(s, req.slidehubSid, false);
    const f = (folder?.children || []).find(x => !x.directory && String(x.nodeId) === String(req.params.id));
    if (!f) return res.status(404).json({ error: 'File not found in this browser profile.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    f.download().on('error', next).pipe(res);
  } catch (e) { next(e); }
});
app.delete('/api/files/:id', async (req, res, next) => {
  try {
    const s = await getStorage();
    const folder = await getUserFolder(s, req.slidehubSid, false);
    const f = (folder?.children || []).find(x => !x.directory && String(x.nodeId) === String(req.params.id));
    if (!f) return res.status(404).json({ error: 'File not found in this browser profile.' });
    await f.delete(true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  console.error('[SlideHub]', err && (err.stack || err.message || err));
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large. Maximum size is ${process.env.MAX_FILE_MB || 10} MB.` });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload rejected. Choose one PPT/PPTX file.' });
  const message = String(err?.message || 'Server error');
  const safeMessage = /Only \.ppt|File too large|Choose a/i.test(message) ? message : 'Storage service error. Check the server environment variables and MEGA connection.';
  res.status(500).json({ error: safeMessage });
});

app.listen(PORT, () => console.log(`SlideHub running on port ${PORT}`));
