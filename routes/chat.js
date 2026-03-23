const express = require('express');
const crypto = require('crypto');

const ChatSession = require('../models/ChatSession');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');

const router = express.Router();

function newSessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function getOrCreateSession(req) {
  const headerId = String(req.headers['x-chat-session-id'] || '').trim();
  const bodyId = String(req.body?.sessionId || '').trim();
  const queryId = String(req.query?.sessionId || '').trim();
  const sessionId = headerId || bodyId || queryId || newSessionId();

  const session = await ChatSession.findOne({ sessionId });
  return { sessionId, session };
}

// GET /api/chat/session
router.get('/session', async (req, res) => {
  try {
    const { sessionId, session } = await getOrCreateSession(req);
    if (!session) {
      return res.json({
        sessionId,
        exists: false,
        phone: '',
        currentStep: 'capture_phone',
        flowData: {}
      });
    }
    return res.json({
      sessionId: session.sessionId,
      exists: true,
      phone: session.phone || '',
      currentStep: session.currentStep || 'welcome',
      flowData: session.flowData || {}
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to initialize chat session' });
  }
});

// GET /api/chat/categories
router.get('/categories', async (req, res) => {
  try {
    const items = await Category.find({ active: true }).sort({ sort: 1, createdAt: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list categories' });
  }
});

// GET /api/chat/subcategories?categoryId=...
router.get('/subcategories', async (req, res) => {
  try {
    const categoryId = String(req.query?.categoryId || '').trim();
    if (!categoryId) return res.status(400).json({ message: 'categoryId is required' });

    const items = await SubCategory.find({ category: categoryId, active: true })
      .sort({ sort: 1, createdAt: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list subcategories' });
  }
});

// GET /api/chat/products?subCategoryId=...
router.get('/products', async (req, res) => {
  try {
    const subCategoryId = String(req.query?.subCategoryId || '').trim();
    if (!subCategoryId) return res.status(400).json({ message: 'subCategoryId is required' });

    const items = await Product.find({ subCategory: subCategoryId, active: true })
      .sort({ sort: 1, createdAt: 1 })
      .populate({ path: 'subCategory', select: 'title', populate: { path: 'category', select: 'title' } });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list products' });
  }
});

// POST /api/chat/advance
router.post('/advance', async (req, res) => {
  try {
    const { sessionId, session: existingSession } = await getOrCreateSession(req);
    const step = String(req.body?.step || '').trim();
    const answer = req.body?.answer || {};
    let session = existingSession;
    const flowData = { ...(session?.flowData || {}) };

    if (step === 'capture_phone') {
      const phone = String(answer.phone || '').trim();
      if (!validPhone(phone)) {
        return res.status(400).json({ message: 'Please enter a valid phone number' });
      }
      if (!session) {
        session = await ChatSession.create({
          sessionId,
          phone,
          currentStep: 'main_menu',
          flowData: {},
          status: 'in_progress'
        });
      } else {
        session.phone = phone;
        session.currentStep = 'main_menu';
        session.status = 'in_progress';
      }
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'main_menu',
        flowData
      });
    }

    if (!session) {
      return res.status(400).json({ message: 'Session not found. Please start again from welcome.' });
    }

    if (step === 'main_menu') {
      const choice = String(answer.choice || '').trim().toLowerCase();
      if (choice !== 'product') {
        return res.status(400).json({ message: 'Only Product Information is available in phase 1' });
      }

      session.currentStep = 'product_category';
      session.flowData = {};
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_category',
        flowData: {}
      });
    }

    if (step === 'product_category') {
      const categoryId = String(answer.categoryId || '').trim();
      if (!categoryId) return res.status(400).json({ message: 'Please select a category' });

      const category = await Category.findOne({ _id: categoryId, active: true });
      if (!category) return res.status(404).json({ message: 'Category not found' });

      flowData.categoryId = categoryId;
      flowData.categoryTitle = category.title;
      delete flowData.subCategoryId;
      delete flowData.subCategoryTitle;
      delete flowData.productId;
      delete flowData.productTitle;
      delete flowData.productLink;

      session.currentStep = 'product_subcategory';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_subcategory',
        flowData
      });
    }

    if (step === 'product_subcategory') {
      const subCategoryId = String(answer.subCategoryId || '').trim();
      if (!subCategoryId) return res.status(400).json({ message: 'Please select a sub-category' });

      const subCategory = await SubCategory.findOne({
        _id: subCategoryId,
        category: flowData.categoryId,
        active: true
      }).populate('category', 'title');

      if (!subCategory) return res.status(404).json({ message: 'Sub-category not found' });

      flowData.subCategoryId = subCategoryId;
      flowData.subCategoryTitle = subCategory.title;
      delete flowData.productId;
      delete flowData.productTitle;
      delete flowData.productLink;

      session.currentStep = 'product_product';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_product',
        flowData
      });
    }

    if (step === 'product_product') {
      const productId = String(answer.productId || '').trim();
      if (!productId) return res.status(400).json({ message: 'Please select a product' });

      const product = await Product.findOne({
        _id: productId,
        subCategory: flowData.subCategoryId,
        active: true
      }).populate({
        path: 'subCategory',
        select: 'title',
        populate: { path: 'category', select: 'title' }
      });

      if (!product) return res.status(404).json({ message: 'Product not found' });

      const categorySlug = toSlug(product.subCategory?.category?.title);
      const subCategorySlug = toSlug(product.subCategory?.title);
      const productSlug = toSlug(product.title);
      const productLink = `/products/${categorySlug}/${subCategorySlug}/${productSlug}`;

      flowData.productId = String(product._id);
      flowData.productTitle = product.title;
      flowData.productLink = productLink;

      session.currentStep = 'product_details';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_details',
        flowData
      });
    }

    if (step === 'product_details') {
      const name = String(answer.name || '').trim();
      const company = String(answer.company || '').trim();
      const email = String(answer.email || '').trim().toLowerCase();

      if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
      if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email' });

      flowData.name = name;
      flowData.company = company;
      flowData.email = email;

      session.currentStep = 'product_submit';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_submit',
        flowData
      });
    }

    return res.status(400).json({ message: 'Unknown chat step' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to advance chat flow' });
  }
});

// POST /api/chat/submit
router.post('/submit', async (req, res) => {
  try {
    const { session } = await getOrCreateSession(req);
    if (!session) {
      return res.status(400).json({ message: 'Session not found. Please restart chatbot and enter phone again.' });
    }
    const type = String(req.body?.type || '').trim().toLowerCase();
    if (type !== 'product') {
      return res.status(400).json({ message: 'Only product enquiry is available in phase 1' });
    }

    const flowData = { ...(session.flowData || {}) };

    const name = String(req.body?.name || flowData.name || '').trim();
    const company = String(req.body?.company || flowData.company || '').trim();
    const email = String(req.body?.email || flowData.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || session.phone || '').trim();
    const productId = String(req.body?.productId || flowData.productId || '').trim();
    const productTitle = String(flowData.productTitle || '').trim();
    const productLink = String(req.body?.productLink || flowData.productLink || '').trim();

    if (!validPhone(phone)) return res.status(400).json({ message: 'Phone number is missing from session' });
    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
    if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email' });
    if (!productId) return res.status(400).json({ message: 'Please select a product first' });

    const message = [
      'Product enquiry received via chatbot.',
      flowData.categoryTitle ? `Category: ${flowData.categoryTitle}` : '',
      flowData.subCategoryTitle ? `Sub-category: ${flowData.subCategoryTitle}` : '',
      productTitle ? `Product: ${productTitle}` : '',
      productLink ? `Product link: ${productLink}` : ''
    ].filter(Boolean).join('\n');

    session.name = name;
    session.email = email;
    session.company = company;
    session.message = message;
    session.productId = productId;
    session.productLink = productLink;
    session.status = 'completed';
    session.currentStep = 'completed';
    session.completedAt = new Date();
    await session.save();

    return res.status(201).json({
      message: 'Product enquiry submitted successfully. Our team will contact you soon.',
      id: session._id,
      nextStep: 'completed'
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to submit chatbot enquiry' });
  }
});

module.exports = router;
