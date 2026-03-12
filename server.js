const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

require('dotenv').config();

app.use(cors());
app.use(express.json());

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
