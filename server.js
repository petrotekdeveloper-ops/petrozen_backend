const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const compression = require('compression');
const app = express();

require('dotenv').config();

app.use(cors());
app.disable('x-powered-by');
app.use(
  compression({
    threshold: 1024,
  }),
);
app.use(express.json());

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    return next();
  }

  const isImmutableAsset = /\.(?:js|css|mjs|woff2?|ttf|eot|otf|svg|png|jpe?g|webp|avif|gif|ico)$/i.test(req.path);
  if (isImmutableAsset) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const adminRoutes = require('./routes/admin');
const adminSeoRoutes = require('./routes/adminSeo');

app.use('/api/admin', adminRoutes);
app.use('/api/admin/seo', adminSeoRoutes);

// Product hierarchy routes
const categoryRoutes = require('./routes/categories');
const subCategoryRoutes = require('./routes/subcategories');
const productRoutes = require('./routes/products');
const blogRoutes = require('./routes/blog');

app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subCategoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/brands', require('./routes/brands'));

// SEO (public)
const seoRoutes = require('./routes/seo');
app.use('/api/seo', seoRoutes);

// Contact (public form submission)
const contactRoutes = require('./routes/contact');
app.use('/api/contact', contactRoutes);

// Prerender (bots only, for SEO/meta)
const prerenderRoutes = require('./routes/prerender');
app.use('/', prerenderRoutes);

// Chatbot (phase 1: product enquiry)
const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

// XML sitemap
const sitemapRoutes = require('./routes/sitemap');
app.use('/', sitemapRoutes);

async function connectDB() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("MongoDB Connected");
    } catch (err) {
      console.log("Mongo Error:", err);
    }
  }
  
  connectDB();


const PORT = process.env.PORT;
app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
});
