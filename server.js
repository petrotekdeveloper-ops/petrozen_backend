const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

require('dotenv').config();

app.use(cors());
app.use(express.json());

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Serve locally uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Product hierarchy routes
const categoryRoutes = require('./routes/categories');
const subCategoryRoutes = require('./routes/subcategories');
const productRoutes = require('./routes/products');
const blogRoutes = require('./routes/blog');

app.use('/api/categories', categoryRoutes);
app.use('/api/subcategories', subCategoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/blog', blogRoutes);

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
