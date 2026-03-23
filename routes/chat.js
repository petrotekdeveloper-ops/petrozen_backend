const express = require('express');
const crypto = require('crypto');
const adminAuth = require('../middleware/adminAuth');
const { parseBool } = require('../utils/uploads');

const ChatSession = require('../models/ChatSession');
const ChatbotProductQuestion = require('../models/ChatbotProductQuestion');
const ChatbotServiceQuestion = require('../models/ChatbotServiceQuestion');
const ChatbotQuoteQuestion = require('../models/ChatbotQuoteQuestion');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');

const SETTINGS_SESSION_ID = '_settings';

const router = express.Router();

// GET /api/chat/visible - public, returns whether chatbot widget should show
router.get('/visible', async (req, res) => {
  try {
    const doc = await ChatSession.findOne({ sessionId: SETTINGS_SESSION_ID }).lean();
    const enabled = doc && doc.enabled !== undefined ? doc.enabled !== false : true;
    return res.json({ enabled });
  } catch (err) {
    return res.json({ enabled: false });
  }
});

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

const chatbotVisibleFilter = { $or: [{ chatbotActive: true }, { chatbotActive: { $exists: false } }] };

// GET /api/chat/categories
router.get('/categories', async (req, res) => {
  try {
    const items = await Category.find({ active: true, ...chatbotVisibleFilter }).sort({ sort: 1, createdAt: 1 });
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

    const items = await SubCategory.find({ category: categoryId, active: true, ...chatbotVisibleFilter })
      .sort({ sort: 1, createdAt: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list subcategories' });
  }
});

// GET /api/chat/product-questions?productId=... (public, for chatbot)
router.get('/product-questions', async (req, res) => {
  try {
    const productId = String(req.query?.productId || '').trim();
    if (!productId) return res.status(400).json({ message: 'productId is required' });
    const items = await ChatbotProductQuestion.find({ products: productId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .select('_id questionText sortOrder required answerType options')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list product questions' });
  }
});

// GET /api/chat/products?subCategoryId=...
router.get('/products', async (req, res) => {
  try {
    const subCategoryId = String(req.query?.subCategoryId || '').trim();
    if (!subCategoryId) return res.status(400).json({ message: 'subCategoryId is required' });

    const items = await Product.find({ subCategory: subCategoryId, active: true, ...chatbotVisibleFilter })
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
      if (choice === 'product') {
        session.currentStep = 'product_category';
        session.flowData = {};
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'product_category',
          flowData: {}
        });
      }
      if (choice === 'quote') {
        session.currentStep = 'quote_details';
        session.flowData = { customAnswers: {} };
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'quote_details',
          flowData: { customAnswers: {} }
        });
      }
      if (choice === 'service') {
        const serviceQuestions = await ChatbotServiceQuestion.find()
          .sort({ sortOrder: 1, createdAt: 1 })
          .select('_id questionText sortOrder required answerType options')
          .lean();
        flowData.customAnswers = flowData.customAnswers || {};
        if (serviceQuestions && serviceQuestions.length > 0) {
          flowData.serviceQuestions = serviceQuestions.map((q) => ({
            _id: String(q._id),
            questionText: q.questionText,
            required: q.required,
            answerType: q.answerType || 'plain_text',
            options: Array.isArray(q.options) ? q.options : []
          }));
          session.currentStep = 'service_questions';
          session.flowData = flowData;
          await session.save();
          return res.json({
            sessionId: session.sessionId,
            nextStep: 'service_questions',
            flowData,
            serviceQuestions: flowData.serviceQuestions
          });
        }
        session.currentStep = 'service_details';
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'service_details',
          flowData
        });
      }
      return res.status(400).json({ message: 'Please select an option' });
    }

    if (step === 'service_questions') {
      const questionId = String(answer.questionId || '').trim();
      const answerText = String(answer.answer ?? '').trim();
      const serviceQuestions = flowData.serviceQuestions || [];

      if (!questionId) return res.status(400).json({ message: 'Question ID is required' });

      const q = serviceQuestions.find((sq) => String(sq._id) === questionId);
      if (!q) return res.status(400).json({ message: 'Invalid question' });
      if (q.required && !answerText) return res.status(400).json({ message: 'This question is required' });

      const answerType = q.answerType || 'plain_text';
      if (answerType === 'option' && answerText) {
        const opts = Array.isArray(q.options) ? q.options : [];
        if (opts.length > 0 && !opts.includes(answerText)) {
          return res.status(400).json({ message: 'Please select one of the options' });
        }
      }

      flowData.customAnswers = flowData.customAnswers || {};
      flowData.customAnswers[questionId] = answerText;

      const answeredIds = Object.keys(flowData.customAnswers);
      const allRequiredAnswered = serviceQuestions
        .filter((sq) => sq.required)
        .every((sq) => answeredIds.includes(String(sq._id)));
      const allAnswered = serviceQuestions.every((sq) => answeredIds.includes(String(sq._id)));

      if (allAnswered || allRequiredAnswered) {
        session.currentStep = 'service_details';
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'service_details',
          flowData
        });
      }

      session.flowData = flowData;
      await session.save();
      const nextQ = serviceQuestions.find((sq) => !answeredIds.includes(String(sq._id)));
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'service_questions',
        flowData,
        nextQuestion: nextQ ? {
          _id: nextQ._id,
          questionText: nextQ.questionText,
          required: nextQ.required,
          answerType: nextQ.answerType || 'plain_text',
          options: Array.isArray(nextQ.options) ? nextQ.options : []
        } : null
      });
    }

    if (step === 'service_details') {
      const name = String(answer.name || '').trim();
      const company = String(answer.company || '').trim();
      const email = String(answer.email || '').trim().toLowerCase();

      if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
      if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email' });

      flowData.name = name;
      flowData.company = company;
      flowData.email = email;

      session.currentStep = 'service_submit';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'service_submit',
        flowData
      });
    }

    if (step === 'quote_details') {
      const name = String(answer.name || '').trim();
      const company = String(answer.company || '').trim();
      const email = String(answer.email || '').trim().toLowerCase();

      if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
      if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email' });

      flowData.name = name;
      flowData.company = company;
      flowData.email = email;
      session.name = name;
      session.company = company;
      session.email = email;

      const quoteQuestions = await ChatbotQuoteQuestion.find()
        .sort({ sortOrder: 1, createdAt: 1 })
        .select('_id questionText sortOrder required answerType options')
        .lean();

      if (quoteQuestions && quoteQuestions.length > 0) {
        flowData.quoteQuestions = quoteQuestions.map((q) => ({
          _id: String(q._id),
          questionText: q.questionText,
          required: q.required,
          answerType: q.answerType || 'plain_text',
          options: Array.isArray(q.options) ? q.options : []
        }));
        flowData.customAnswers = flowData.customAnswers || {};
        session.currentStep = 'quote_questions';
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'quote_questions',
          flowData,
          quoteQuestions: flowData.quoteQuestions,
          nextQuestion: flowData.quoteQuestions[0]
        });
      }

      session.enquiryType = 'quote';
      session.message = 'Quote request received via chatbot.';
      session.customAnswers = {};
      session.status = 'completed';
      session.currentStep = 'completed';
      session.completedAt = new Date();
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'enquiry_complete',
        flowData
      });
    }

    if (step === 'quote_questions') {
      const questionId = String(answer.questionId || '').trim();
      const answerText = String(answer.answer ?? '').trim();
      const quoteQuestions = flowData.quoteQuestions || [];

      if (!questionId) return res.status(400).json({ message: 'Question ID is required' });

      const q = quoteQuestions.find((sq) => String(sq._id) === questionId);
      if (!q) return res.status(400).json({ message: 'Invalid question' });
      if (q.required && !answerText) return res.status(400).json({ message: 'This question is required' });

      const answerType = q.answerType || 'plain_text';
      if (answerType === 'option' && answerText) {
        const opts = Array.isArray(q.options) ? q.options : [];
        if (opts.length > 0 && !opts.includes(answerText)) {
          return res.status(400).json({ message: 'Please select one of the options' });
        }
      }

      flowData.customAnswers = flowData.customAnswers || {};
      flowData.customAnswers[questionId] = answerText;

      const answeredIds = Object.keys(flowData.customAnswers);
      const allRequiredAnswered = quoteQuestions
        .filter((sq) => sq.required)
        .every((sq) => answeredIds.includes(String(sq._id)));
      const allAnswered = quoteQuestions.every((sq) => answeredIds.includes(String(sq._id)));

      if (allAnswered || allRequiredAnswered) {
        const messageParts = ['Quote request received via chatbot.'];
        if (Object.keys(flowData.customAnswers).length > 0 && quoteQuestions.length > 0) {
          messageParts.push('');
          messageParts.push('Answers:');
          quoteQuestions.forEach((qu) => {
            const ans = flowData.customAnswers[String(qu._id)];
            if (ans !== undefined) messageParts.push(`- ${qu.questionText}: ${ans}`);
          });
        }
        session.enquiryType = 'quote';
        session.message = messageParts.join('\n');
        session.customAnswers = flowData.customAnswers;
        session.status = 'completed';
        session.currentStep = 'completed';
        session.completedAt = new Date();
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'enquiry_complete',
          flowData
        });
      }

      session.flowData = flowData;
      await session.save();
      const nextQ = quoteQuestions.find((sq) => !answeredIds.includes(String(sq._id)));
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'quote_questions',
        flowData,
        nextQuestion: nextQ ? {
          _id: nextQ._id,
          questionText: nextQ.questionText,
          required: nextQ.required,
          answerType: nextQ.answerType || 'plain_text',
          options: Array.isArray(nextQ.options) ? nextQ.options : []
        } : null
      });
    }

    if (step === 'product_category') {
      const categoryId = String(answer.categoryId || '').trim();
      if (!categoryId) return res.status(400).json({ message: 'Please select a category' });

      const category = await Category.findOne({ _id: categoryId, active: true, ...chatbotVisibleFilter });
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
        active: true,
        ...chatbotVisibleFilter
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
        active: true,
        ...chatbotVisibleFilter
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
      flowData.customAnswers = flowData.customAnswers || {};

      const productQuestions = await ChatbotProductQuestion.find({ products: productId })
        .sort({ sortOrder: 1, createdAt: 1 })
        .select('_id questionText sortOrder required answerType options')
        .lean();

      if (productQuestions && productQuestions.length > 0) {
        flowData.productQuestions = productQuestions.map((q) => ({
          _id: String(q._id),
          questionText: q.questionText,
          required: q.required,
          answerType: q.answerType || 'plain_text',
          options: Array.isArray(q.options) ? q.options : []
        }));
        session.currentStep = 'product_questions';
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'product_questions',
          flowData,
          productQuestions: flowData.productQuestions
        });
      }

      session.currentStep = 'product_details';
      session.flowData = flowData;
      await session.save();
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_details',
        flowData
      });
    }

    if (step === 'product_questions') {
      const questionId = String(answer.questionId || '').trim();
      const answerText = String(answer.answer ?? '').trim();
      const productQuestions = flowData.productQuestions || [];

      if (!questionId) return res.status(400).json({ message: 'Question ID is required' });

      const q = productQuestions.find((pq) => String(pq._id) === questionId);
      if (!q) return res.status(400).json({ message: 'Invalid question' });
      if (q.required && !answerText) return res.status(400).json({ message: 'This question is required' });

      const answerType = q.answerType || 'plain_text';
      if (answerType === 'option' && answerText) {
        const opts = Array.isArray(q.options) ? q.options : [];
        if (opts.length > 0 && !opts.includes(answerText)) {
          return res.status(400).json({ message: 'Please select one of the options' });
        }
      }

      flowData.customAnswers = flowData.customAnswers || {};
      flowData.customAnswers[questionId] = answerText;

      const answeredIds = Object.keys(flowData.customAnswers);
      const allRequiredAnswered = productQuestions
        .filter((pq) => pq.required)
        .every((pq) => answeredIds.includes(String(pq._id)));
      const allAnswered = productQuestions.every((pq) => answeredIds.includes(String(pq._id)));

      if (allAnswered || allRequiredAnswered) {
        session.currentStep = 'product_details';
        session.flowData = flowData;
        await session.save();
        return res.json({
          sessionId: session.sessionId,
          nextStep: 'product_details',
          flowData
        });
      }

      session.flowData = flowData;
      await session.save();
      const nextQ = productQuestions.find((pq) => !answeredIds.includes(String(pq._id)));
      return res.json({
        sessionId: session.sessionId,
        nextStep: 'product_questions',
        flowData,
        nextQuestion: nextQ ? {
          _id: nextQ._id,
          questionText: nextQ.questionText,
          required: nextQ.required,
          answerType: nextQ.answerType || 'plain_text',
          options: Array.isArray(nextQ.options) ? nextQ.options : []
        } : null
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
    const flowData = { ...(session.flowData || {}) };

    const name = String(req.body?.name || flowData.name || '').trim();
    const company = String(req.body?.company || flowData.company || '').trim();
    const email = String(req.body?.email || flowData.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || session.phone || '').trim();

    if (!validPhone(phone)) return res.status(400).json({ message: 'Phone number is missing from session' });
    if (name.length < 2) return res.status(400).json({ message: 'Please enter your name' });
    if (!validEmail(email)) return res.status(400).json({ message: 'Please enter a valid email' });

    if (type === 'service') {
      const customAnswers = req.body?.customAnswers || flowData.customAnswers || {};
      const serviceQuestions = flowData.serviceQuestions || [];
      const messageParts = ['Service enquiry received via chatbot.'];
      if (Object.keys(customAnswers).length > 0 && serviceQuestions.length > 0) {
        messageParts.push('');
        messageParts.push('Answers:');
        serviceQuestions.forEach((q) => {
          const ans = customAnswers[String(q._id)];
          if (ans !== undefined) messageParts.push(`- ${q.questionText}: ${ans}`);
        });
      }
      const message = messageParts.join('\n');

      session.enquiryType = 'service';
      session.name = name;
      session.email = email;
      session.company = company;
      session.message = message;
      session.customAnswers = customAnswers;
      session.serviceCategoryId = '';
      session.serviceCategoryTitle = '';
      session.status = 'completed';
      session.currentStep = 'completed';
      session.completedAt = new Date();
      await session.save();

      return res.status(201).json({
        message: 'Service enquiry submitted successfully. Our team will contact you soon.',
        id: session._id,
        nextStep: 'completed'
      });
    }

    if (type !== 'product') {
      return res.status(400).json({ message: 'Invalid enquiry type' });
    }

    const productId = String(req.body?.productId || flowData.productId || '').trim();
    const productTitle = String(flowData.productTitle || '').trim();
    const productLink = String(req.body?.productLink || flowData.productLink || '').trim();
    const customAnswers = req.body?.customAnswers || flowData.customAnswers || {};

    if (!productId) return res.status(400).json({ message: 'Please select a product first' });

    const messageParts = [
      'Product enquiry received via chatbot.',
      flowData.categoryTitle ? `Category: ${flowData.categoryTitle}` : '',
      flowData.subCategoryTitle ? `Sub-category: ${flowData.subCategoryTitle}` : '',
      productTitle ? `Product: ${productTitle}` : '',
      productLink ? `Product link: ${productLink}` : ''
    ];
    const productQuestions = flowData.productQuestions || [];
    if (Object.keys(customAnswers).length > 0 && productQuestions.length > 0) {
      messageParts.push('');
      messageParts.push('Custom answers:');
      productQuestions.forEach((q) => {
        const ans = customAnswers[String(q._id)];
        if (ans !== undefined) messageParts.push(`- ${q.questionText}: ${ans}`);
      });
    }
    const message = messageParts.filter(Boolean).join('\n');

    session.enquiryType = 'product';
    session.name = name;
    session.email = email;
    session.company = company;
    session.message = message;
    session.customAnswers = customAnswers;
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

// ── Admin: Chatbot visibility management ────────────────────────────────────

// GET /api/chat/admin/categories
router.get('/admin/categories', adminAuth, async (req, res) => {
  try {
    const items = await Category.find().sort({ sort: 1, createdAt: 1 }).select('_id title active chatbotActive').lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list categories' });
  }
});

// PUT /api/chat/admin/categories/:id/chatbot-active
router.put('/admin/categories/:id/chatbot-active', adminAuth, async (req, res) => {
  try {
    const chatbotActive = parseBool(req.body?.chatbotActive, true);
    const item = await Category.findByIdAndUpdate(
      req.params.id,
      { chatbotActive },
      { new: true }
    ).select('_id title active chatbotActive');
    if (!item) return res.status(404).json({ message: 'Category not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update category chatbot visibility' });
  }
});

// GET /api/chat/admin/subcategories?categoryId=...
router.get('/admin/subcategories', adminAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.categoryId) filter.category = req.query.categoryId;
    const items = await SubCategory.find(filter)
      .sort({ sort: 1, createdAt: 1 })
      .populate('category', 'title')
      .select('_id title category active chatbotActive')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list subcategories' });
  }
});

// PUT /api/chat/admin/subcategories/:id/chatbot-active
router.put('/admin/subcategories/:id/chatbot-active', adminAuth, async (req, res) => {
  try {
    const chatbotActive = parseBool(req.body?.chatbotActive, true);
    const item = await SubCategory.findByIdAndUpdate(
      req.params.id,
      { chatbotActive },
      { new: true }
    ).populate('category', 'title').select('_id title category active chatbotActive');
    if (!item) return res.status(404).json({ message: 'Subcategory not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update subcategory chatbot visibility' });
  }
});

// GET /api/chat/admin/products?subCategoryId=...
router.get('/admin/products', adminAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.subCategoryId) filter.subCategory = req.query.subCategoryId;
    const items = await Product.find(filter)
      .sort({ sort: 1, createdAt: 1 })
      .populate({ path: 'subCategory', select: 'title', populate: { path: 'category', select: 'title' } })
      .select('_id title subCategory active chatbotActive')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list products' });
  }
});

// PUT /api/chat/admin/products/:id/chatbot-active
router.put('/admin/products/:id/chatbot-active', adminAuth, async (req, res) => {
  try {
    const chatbotActive = parseBool(req.body?.chatbotActive, true);
    const item = await Product.findByIdAndUpdate(
      req.params.id,
      { chatbotActive },
      { new: true }
    )
      .populate({ path: 'subCategory', select: 'title', populate: { path: 'category', select: 'title' } })
      .select('_id title subCategory active chatbotActive');
    if (!item) return res.status(404).json({ message: 'Product not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update product chatbot visibility' });
  }
});

// ── Admin: Chatbot product questions ────────────────────────────────────────

// GET /api/chat/admin/product-questions (all) or ?productId=... (filter by product)
router.get('/admin/product-questions', adminAuth, async (req, res) => {
  try {
    const productId = String(req.query?.productId || '').trim();
    const filter = productId ? { products: productId } : {};
    const items = await ChatbotProductQuestion.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .populate('products', 'title')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list product questions' });
  }
});

// POST /api/chat/admin/product-questions
router.post('/admin/product-questions', adminAuth, async (req, res) => {
  try {
    const { products: productIds, questionText, sortOrder, required } = req.body || {};
    if (!questionText || !String(questionText).trim()) return res.status(400).json({ message: 'questionText is required' });

    const ids = Array.isArray(productIds) ? productIds : (productIds ? [productIds] : []);
    const validIds = ids.filter((id) => id && String(id).trim()).map((id) => String(id).trim());

    const answerType = String(req.body?.answerType || 'plain_text').trim();
    const opts = Array.isArray(req.body?.options) ? req.body.options : [];
    const validOptions = opts.map((o) => String(o || '').trim()).filter(Boolean);

    const item = await ChatbotProductQuestion.create({
      products: validIds,
      questionText: String(questionText).trim(),
      sortOrder: Number(sortOrder) || 0,
      required: parseBool(required, true),
      answerType: answerType === 'option' ? 'option' : 'plain_text',
      options: validOptions
    });
    const populated = await ChatbotProductQuestion.findById(item._id).populate('products', 'title').lean();
    return res.status(201).json({ item: populated });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create product question' });
  }
});

// PUT /api/chat/admin/product-questions/:id
router.put('/admin/product-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotProductQuestion.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product question not found' });

    const { products: productIds, questionText, sortOrder, required, answerType, options } = req.body || {};
    if (productIds !== undefined) {
      const ids = Array.isArray(productIds) ? productIds : (productIds ? [productIds] : []);
      item.products = ids.filter((id) => id && String(id).trim()).map((id) => String(id).trim());
    }
    if (questionText !== undefined) item.questionText = String(questionText).trim();
    if (sortOrder !== undefined) item.sortOrder = Number(sortOrder) || 0;
    if (required !== undefined) item.required = parseBool(required, item.required);
    if (answerType !== undefined) item.answerType = answerType === 'option' ? 'option' : 'plain_text';
    if (options !== undefined) {
      const opts = Array.isArray(options) ? options : [];
      item.options = opts.map((o) => String(o || '').trim()).filter(Boolean);
    }

    await item.save();
    const populated = await ChatbotProductQuestion.findById(item._id).populate('products', 'title').lean();
    return res.json({ item: populated });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update product question' });
  }
});

// DELETE /api/chat/admin/product-questions/:id
router.delete('/admin/product-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotProductQuestion.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product question not found' });
    return res.json({ message: 'Product question deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete product question' });
  }
});

// ── Admin: Chatbot service questions ────────────────────────────────────────

// GET /api/chat/admin/service-questions
router.get('/admin/service-questions', adminAuth, async (req, res) => {
  try {
    const items = await ChatbotServiceQuestion.find()
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list service questions' });
  }
});

// POST /api/chat/admin/service-questions
router.post('/admin/service-questions', adminAuth, async (req, res) => {
  try {
    const { questionText, sortOrder, required } = req.body || {};
    if (!questionText || !String(questionText).trim()) return res.status(400).json({ message: 'questionText is required' });

    const answerType = String(req.body?.answerType || 'plain_text').trim();
    const opts = Array.isArray(req.body?.options) ? req.body.options : [];
    const validOptions = opts.map((o) => String(o || '').trim()).filter(Boolean);

    const item = await ChatbotServiceQuestion.create({
      questionText: String(questionText).trim(),
      sortOrder: Number(sortOrder) || 0,
      required: parseBool(required, true),
      answerType: answerType === 'option' ? 'option' : 'plain_text',
      options: validOptions
    });
    return res.status(201).json({ item: item.toObject() });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create service question' });
  }
});

// PUT /api/chat/admin/service-questions/:id
router.put('/admin/service-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotServiceQuestion.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Service question not found' });

    const { questionText, sortOrder, required, answerType, options } = req.body || {};
    if (questionText !== undefined) item.questionText = String(questionText).trim();
    if (sortOrder !== undefined) item.sortOrder = Number(sortOrder) || 0;
    if (required !== undefined) item.required = parseBool(required, item.required);
    if (answerType !== undefined) item.answerType = answerType === 'option' ? 'option' : 'plain_text';
    if (options !== undefined) {
      const opts = Array.isArray(options) ? options : [];
      item.options = opts.map((o) => String(o || '').trim()).filter(Boolean);
    }

    await item.save();
    return res.json({ item: item.toObject() });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update service question' });
  }
});

// DELETE /api/chat/admin/service-questions/:id
router.delete('/admin/service-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotServiceQuestion.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Service question not found' });
    return res.json({ message: 'Service question deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete service question' });
  }
});

// ── Admin: Chatbot quote questions ────────────────────────────────────────

// GET /api/chat/admin/quote-questions
router.get('/admin/quote-questions', adminAuth, async (req, res) => {
  try {
    const items = await ChatbotQuoteQuestion.find()
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list quote questions' });
  }
});

// POST /api/chat/admin/quote-questions
router.post('/admin/quote-questions', adminAuth, async (req, res) => {
  try {
    const { questionText, sortOrder, required } = req.body || {};
    if (!questionText || !String(questionText).trim()) return res.status(400).json({ message: 'questionText is required' });

    const answerType = String(req.body?.answerType || 'plain_text').trim();
    const opts = Array.isArray(req.body?.options) ? req.body.options : [];
    const validOptions = opts.map((o) => String(o || '').trim()).filter(Boolean);

    const item = await ChatbotQuoteQuestion.create({
      questionText: String(questionText).trim(),
      sortOrder: Number(sortOrder) || 0,
      required: parseBool(required, true),
      answerType: answerType === 'option' ? 'option' : 'plain_text',
      options: validOptions
    });
    return res.status(201).json({ item: item.toObject() });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create quote question' });
  }
});

// PUT /api/chat/admin/quote-questions/:id
router.put('/admin/quote-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotQuoteQuestion.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Quote question not found' });

    const { questionText, sortOrder, required, answerType, options } = req.body || {};
    if (questionText !== undefined) item.questionText = String(questionText).trim();
    if (sortOrder !== undefined) item.sortOrder = Number(sortOrder) || 0;
    if (required !== undefined) item.required = parseBool(required, item.required);
    if (answerType !== undefined) item.answerType = answerType === 'option' ? 'option' : 'plain_text';
    if (options !== undefined) {
      const opts = Array.isArray(options) ? options : [];
      item.options = opts.map((o) => String(o || '').trim()).filter(Boolean);
    }

    await item.save();
    return res.json({ item: item.toObject() });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update quote question' });
  }
});

// DELETE /api/chat/admin/quote-questions/:id
router.delete('/admin/quote-questions/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatbotQuoteQuestion.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Quote question not found' });
    return res.json({ message: 'Quote question deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete quote question' });
  }
});

module.exports = router;
