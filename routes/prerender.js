const express = require('express');
const puppeteer = require('puppeteer');

const router = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, html }

function getSiteUrl() {
  const siteUrl = process.env.SITE_URL || process.env.FRONTEND_URL;
  return String(siteUrl || '').replace(/\/+$/, '');
}

function isBotUserAgent(ua) {
  const s = String(ua || '').toLowerCase();
  return (
    s.includes('googlebot') ||
    s.includes('bingbot') ||
    s.includes('duckduckbot') ||
    s.includes('yandex') ||
    s.includes('baiduspider') ||
    s.includes('facebookexternalhit') ||
    s.includes('twitterbot') ||
    s.includes('linkedinbot') ||
    s.includes('slackbot') ||
    s.includes('discordbot') ||
    s.includes('whatsapp') ||
    s.includes('applebot')
  );
}

function shouldBypass(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith('/')) return true;

  if (p === '/robots.txt' || p === '/sitemap.xml') return true;
  if (p === '/__prerender') return true;
  if (p.startsWith('/api')) return true;
  if (p.startsWith('/admin')) return true;
  if (/\.(?:css|js|mjs|map|json|png|jpg|jpeg|gif|webp|svg|ico|txt|xml|woff2?|ttf|eot|pdf|zip)$/i.test(p)) return true;
  return false;
}

// GET /__prerender?path=/products/...
router.get('/__prerender', async (req, res) => {
  try {
    const siteUrl = getSiteUrl();
    if (!siteUrl) {
      return res.status(500).json({ message: 'SITE_URL is not configured' });
    }

    // This endpoint is intended to be called by Netlify Edge for bots only.
    const ua = req.get('user-agent') || '';
    if (!isBotUserAgent(ua)) {
      return res.status(403).json({ message: 'Bots only' });
    }

    const rawPath = String(req.query.path || '/');
    const pathOnly = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    if (shouldBypass(pathOnly)) {
      return res.status(400).json({ message: 'Path not eligible for prerender' });
    }

    const cacheKey = `${siteUrl}${pathOnly}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Prerender-Cache', 'HIT');
      return res.status(200).send(cached.html);
    }

    const browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent(ua);
      await page.setExtraHTTPHeaders({
        // Hint to any proxy/layer not to loop.
        'x-prerender': '1',
      });

      const url = `${siteUrl}${pathOnly}`;
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

      // Give Helmet/React a brief moment to flush tags.
      await page.waitForTimeout(250);

      const html = await page.content();

      cache.set(cacheKey, { at: Date.now(), html });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Prerender-Cache', 'MISS');
      return res.status(200).send(html);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('Prerender failed', err);
    return res.status(500).json({ message: 'Prerender failed' });
  }
});

module.exports = router;

