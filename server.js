/**
 * Ompage — Server locale
 * Avvia con: node server.js
 * Nessun npm install richiesto — solo moduli nativi Node.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 3001;
const ROOT = __dirname;

// ── MIME TYPES ──────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// ── BODY READER ─────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── MULTIPART PARSER (per upload immagini) ───────────────────
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const bStart = buffer.indexOf(boundaryBuf, start);
    if (bStart === -1) break;
    const headerStart = bStart + boundaryBuf.length + 2; // skip \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const bEnd = buffer.indexOf(boundaryBuf, dataStart);
    if (bEnd === -1) break;
    const dataEnd = bEnd - 2; // remove trailing \r\n
    const data = buffer.slice(dataStart, dataEnd);

    const nameMatch    = headerStr.match(/name="([^"]+)"/);
    const fileMatch    = headerStr.match(/filename="([^"]+)"/);
    const contentMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    if (nameMatch) {
      parts.push({
        name:        nameMatch[1],
        filename:    fileMatch    ? fileMatch[1]    : null,
        contentType: contentMatch ? contentMatch[1].trim() : 'text/plain',
        data,
      });
    }
    start = bEnd;
  }
  return parts;
}

// ── CORS HEADERS ─────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── SERVER ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  const parsed  = url.parse(req.url);
  const pathname = parsed.pathname;

  // ── POST /save — sovrascrive config.json ─────────────────
  if (req.method === 'POST' && pathname === '/save') {
    try {
      const body = await readBody(req);
      const text = body.toString('utf-8');
      // Valida JSON prima di scrivere
      JSON.parse(text);
      const dest = path.join(ROOT, 'config.json');
      fs.writeFileSync(dest, text, 'utf-8');
      const ts = new Date().toLocaleTimeString('it-IT');
      console.log(`[${ts}] ✅ config.json salvato`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('❌ Errore salvataggio:', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── POST /upload — salva immagine in /assets/ ────────────
  if (req.method === 'POST' && pathname === '/upload') {
    try {
      const ct = req.headers['content-type'] || '';
      const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) throw new Error('Boundary multipart mancante');

      const body  = await readBody(req);
      const parts = parseMultipart(body, boundaryMatch[1]);
      const file  = parts.find(p => p.filename);
      if (!file) throw new Error('Nessun file trovato nella richiesta');

      // Sicurezza: accetta solo immagini
      const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
      if (!allowed.includes(file.contentType)) throw new Error('Tipo file non consentito');

      // Crea cartella assets se non esiste
      const assetsDir = path.join(ROOT, 'assets');
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

      // Nome file sicuro: timestamp + nome originale sanitizzato
      const safeName = Date.now() + '_' + file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(assetsDir, safeName);
      fs.writeFileSync(dest, file.data);

      const ts = new Date().toLocaleTimeString('it-IT');
      console.log(`[${ts}] 📷 Immagine salvata: assets/${safeName}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: 'assets/' + safeName }));
    } catch (e) {
      console.error('❌ Errore upload:', e.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── GET — serve file statici ─────────────────────────────
  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);

  // Sicurezza: path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Directory → index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File non trovato: ' + pathname);
    return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch (e) {
    res.writeHead(500); res.end('Errore server');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║       Ompage — Server locale           ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Sito:    http://localhost:${PORT}          ║`);
  console.log(`║  Pannello: http://localhost:${PORT}/pannello.html ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('  Premi Ctrl+C per fermare il server.');
  console.log('');

  // Apri browser automaticamente
  const start =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' : 'xdg-open';
  const { exec } = require('child_process');
  exec(`${start} http://localhost:${PORT}/pannello.html`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ La porta ${PORT} è già in uso.`);
    console.error('   Chiudi l\'altro server e riprova.\n');
  } else {
    console.error('❌ Errore server:', e.message);
  }
  process.exit(1);
});