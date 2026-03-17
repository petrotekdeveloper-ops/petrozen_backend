const express = require('express');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
const router = express.Router();

function getBaseUrl(req) {
  const host = req.get('host');
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
}

function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];
  return new Date(date).toISOString().split('T')[0];
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req).replace(/\/+$/, '');

    const [categories, subcategories, products] = await Promise.all([
      Category.find({ active: true }).sort({ sort: 1, createdAt: 1 }).lean(),
      SubCategory.find({ active: true }).sort({ sort: 1, createdAt: 1 }).lean(),
      Product.find({ active: true }).sort({ sort: 1, createdAt: 1 }).lean(),
    ]);

    const categoryById = new Map(categories.map((c) => [String(c._id), c]));
    const subcategoryById = new Map(subcategories.map((s) => [String(s._id), s]));

    const urls = [];

    // Homepage
    urls.push({
      loc: `${baseUrl}/`,
      lastmod: formatDate(),
      changefreq: 'weekly',
      priority: '1.0',
    });

    // Static pages
    const staticPages = [
      { path: '/about', changefreq: 'monthly', priority: '0.6' },
      { path: '/services', changefreq: 'monthly', priority: '0.6' },
      { path: '/certifications', changefreq: 'monthly', priority: '0.6' },
      { path: '/products', changefreq: 'weekly', priority: '0.8' },
      { path: '/contact', changefreq: 'monthly', priority: '0.5' },
      { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
    ];

    staticPages.forEach((page) => {
      urls.push({
        loc: `${baseUrl}${page.path}`,
        lastmod: formatDate(),
        changefreq: page.changefreq,
        priority: page.priority,
      });
    });

    // Categories
    categories.forEach((cat) => {
      const slug = toSlug(cat.title);
      urls.push({
        loc: `${baseUrl}/products/${slug}`,
        lastmod: formatDate(cat.updatedAt || cat.createdAt),
        changefreq: 'weekly',
        priority: '0.8',
      });
    });

    // Subcategories
    subcategories.forEach((sub) => {
      const category = categoryById.get(String(sub.category));
      if (!category) return;

      const categorySlug = toSlug(category.title);
      const subSlug = toSlug(sub.title);

      urls.push({
        loc: `${baseUrl}/products/${categorySlug}/${subSlug}`,
        lastmod: formatDate(sub.updatedAt || sub.createdAt),
        changefreq: 'weekly',
        priority: '0.75',
      });
    });

    // Products
    products.forEach((prod) => {
      const subcategory = subcategoryById.get(String(prod.subCategory));
      if (!subcategory) return;

      const category = categoryById.get(String(subcategory.category));
      if (!category) return;

      const categorySlug = toSlug(category.title);
      const subSlug = toSlug(subcategory.title);
      const prodSlug = toSlug(prod.title);

      urls.push({
        loc: `${baseUrl}/products/${categorySlug}/${subSlug}/${prodSlug}`,
        lastmod: formatDate(prod.updatedAt || prod.createdAt),
        changefreq: 'weekly',
        priority: '0.7',
      });
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => {
        return [
          '  <url>',
          `    <loc>${escapeXml(u.loc)}</loc>`,
          `    <lastmod>${escapeXml(u.lastmod)}</lastmod>`,
          `    <changefreq>${escapeXml(u.changefreq)}</changefreq>`,
          `    <priority>${escapeXml(u.priority)}</priority>`,
          '  </url>',
        ].join('\n');
      }),
      '</urlset>',
    ].join('\n');

    res.header('Content-Type', 'application/xml');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('Failed to generate sitemap.xml', err);
    return res.status(500).header('Content-Type', 'application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
    );
  }
});

module.exports = router;

