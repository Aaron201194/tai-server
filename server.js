const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
let botStatus = 'Starting headless browser...';
let browserInstance = null;

// 1. HTTP Server (serves bot.html, health checks, and built-in Discord API relay)
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  // Built-in Discord REST/Multipart Relay (/?url=...)
  if (reqUrl.searchParams.has('url')) {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl || !targetUrl.startsWith('https://discord.com/api/')) {
      return res.writeHead(400).end('Invalid Discord API URL');
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);

    const headers = { 'User-Agent': 'DiscordBot (https://turbowarp.org, 2.0)' };
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    try {
      const discordRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuffer
      });
      const out = Buffer.from(await discordRes.arrayBuffer());
      res.writeHead(discordRes.status, {
        'Content-Type': discordRes.headers.get('content-type') || 'application/json'
      });
      return res.end(out);
    } catch (err) {
      return res.writeHead(502).end(err.message);
    }
  }

  // Serve bot.html internally to Puppeteer
  if (reqUrl.pathname === '/bot.html') {
    const filePath = path.join(__dirname, 'bot.html');
    if (!fs.existsSync(filePath)) {
      return res.writeHead(404).end('bot.html not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(filePath).pipe(res);
  }

  // Status page for Render health checks & monitoring
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`TurboWarp Cloud Runner Status: ${botStatus}`);
});

// 2. Launch Headless Chromium & Run bot.html
async function startHeadlessBot() {
  try {
    botStatus = 'Launching Chromium (low-memory mode)...';
    browserInstance = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--js-flags=--max-old-space-size=256',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    botStatus = 'Opening bot.html...';
    const page = await browserInstance.newPage();
    page.on('console', (msg) => console.log('[TURBOWARP]', msg.text()));
    page.on('pageerror', (err) => console.error('[PAGE ERROR]', err.message));

    // Use domcontentloaded so open Discord WebSockets don't block networkidle2 forever
    await page.goto(`http://127.0.0.1:${PORT}/bot.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => {
      const flag = document.querySelector('[title="Start"], .green-flag');
      if (flag) flag.click();
    });

    botStatus = `RUNNING (Started at ${new Date().toISOString()})`;
    console.log(botStatus);
  } catch (err) {
    botStatus = `ERROR: ${err.message}`;
    console.error(botStatus);
  }
}

    const page = await browserInstance.newPage();
    page.on('console', (msg) => console.log('[TURBOWARP]', msg.text()));
    page.on('pageerror', (err) => console.error('[PAGE ERROR]', err.message));

    await page.goto(`http://127.0.0.1:${PORT}/bot.html`, { waitUntil: 'networkidle2' });

    // Click green flag automatically if Auto-start wasn't enabled
    await page.evaluate(() => {
      const flag = document.querySelector('[title="Start"], .green-flag');
      if (flag) flag.click();
    });

    botStatus = `RUNNING (Started at ${new Date().toISOString()})`;
    console.log(botStatus);
  } catch (err) {
    botStatus = `CRASHED: ${err.message} - Restarting in 5s...`;
    console.error(botStatus);
    if (browserInstance) {
      try { await browserInstance.close(); } catch (_) {}
    }
    setTimeout(startHeadlessBot, 5000);
  }
}

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startHeadlessBot();
});
