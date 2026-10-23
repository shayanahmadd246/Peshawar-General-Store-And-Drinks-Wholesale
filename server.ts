import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { checkDatabaseConnection, getDb } from './src/db';
import { wholesalers as wholesalersTable } from './src/db/schema';
import { runMigrations } from './src/db/migrate';
import { seedDevelopmentData } from './src/db/seed';
import { authenticate, authorize, optionalAuthenticate } from './src/middleware/auth';
import { authRateLimit, publicFormRateLimit } from './src/middleware/rateLimit';
import {
  approveWholesalerApplication,
  listWholesalerApplications,
  rejectWholesalerApplication,
  submitWholesalerApplication,
} from './src/auth/wholesalerApplications';
import { aiChatRateLimit } from './src/middleware/aiRateLimit';
import { voiceTtsRateLimit, voiceUploadRateLimit } from './src/middleware/voiceRateLimit';
import { handleShopkeeperChat } from './src/ai/orchestrator';
import { getConversationMessages, listConversations } from './src/ai/conversations';
import { getGeminiDiagnostics, isGeminiConfigured } from './src/ai/gemini';
import {
  createTranscriptionFromUpload,
  getOwnedAudio,
  processVoiceMessageAuto,
  submitReviewedTranscript,
  synthesizeAssistantReply,
} from './src/ai/voice/service';
import { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_MS } from './src/ai/voice/audioValidate';
import {
  authenticateUser,
  createWholesalerAccount,
  publicUser,
  registerClient,
  removeWholesaler,
  setWholesalerStatus,
  writeAudit,
} from './src/auth/service';
import { changePassword, requestPasswordReset, resetPasswordWithToken } from './src/auth/passwordReset';
import { HttpError } from './src/auth/rbac';
import { isProduction } from './src/config/env';
import { getMailMode } from './src/email/config';
import { enqueueEmail, getOutboxStats, processEmailOutbox, startEmailOutboxWorker } from './src/email/outbox';
import { notifyWelcomeShopkeeper } from './src/email/notify';
import { corsMiddleware } from './src/middleware/cors';
import { ensureProductionBootstrap } from './src/auth/bootstrapAdmin';
import { getMarketData } from './src/commerce/market';
import {
  addToCart,
  getCart,
  removeCartItem,
  upsertCartItem,
} from './src/commerce/cart';
import {
  createProduct,
  deactivateProduct,
  listProductsForUser,
  updateProduct,
} from './src/commerce/products';
import {
  getOrderForUser,
  listOrdersForUser,
  placeOrder,
  reviewSubOrder,
} from './src/commerce/orders';
import {
  assignShipment,
  listAssignableDeliveryUsers,
  listDispatchQueue,
  listShipmentsForUser,
  updateShipmentStatus,
} from './src/commerce/dispatch';
import { getInvoiceForUser, listInvoicesForUser } from './src/commerce/invoices';
import { listPaymentsForUser, recordPayment } from './src/commerce/payments';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));

function handleHttpError(err: unknown, res: express.Response, fallback: string) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: fallback });
}

app.get('/api/health', async (_req, res) => {
  try {
    const connected = await checkDatabaseConnection();
    res.json({ status: 'ok', database: connected ? 'connected' : 'disconnected', time: new Date().toISOString() });
  } catch (err: any) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: err.message, time: new Date().toISOString() });
  }
});

/** External scheduler / host cron — does not rely on serverless in-process timers. */
app.post('/api/internal/email/process', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || req.get('x-cron-secret') !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const limit = Math.min(Number(req.body?.limit || 40), 100);
    const result = await processEmailOutbox(limit);
    const stats = await getOutboxStats();
    res.json({ success: true, ...result, stats });
  } catch (err) {
    handleHttpError(err, res, 'Failed to process email outbox.');
  }
});

app.get('/api/market/data', optionalAuthenticate, async (req, res) => {
  try {
    const data = await getMarketData(req.user);
    res.json(data);
  } catch (err) {
    handleHttpError(err, res, 'Failed to load market data.');
  }
});

const AUTH_FAIL = 'Invalid credentials.';

app.post('/api/auth/client/signup', authRateLimit, async (req, res) => {
  try {
    const { name, storeName, phone, password, email } = req.body;
    const { user, token } = await registerClient({ name, storeName, phone, password, email });
    const client = { id: user.id, name: user.name, storeName: user.storeName || storeName, phone: user.phone || phone, email: user.email };
    await writeAudit(name, 'Shopkeeper', 'CLIENT_SIGNUP', `New client signed up: ${storeName} (${phone})`);
    void notifyWelcomeShopkeeper(user.id).catch(() => undefined);
    res.json({ success: true, token, client, user: publicUser(user) });
  } catch (err) {
    handleHttpError(err, res, 'Client signup failed.');
  }
});

app.post('/api/auth/client/signin', authRateLimit, async (req, res) => {
  try {
    const { phone, password } = req.body;
    const { user, token } = await authenticateUser({ phone, password, expectedRole: 'client' });
    const client = {
      id: user.id,
      name: user.name,
      storeName: user.storeName || '',
      phone: user.phone || phone,
      email: user.email,
    };
    res.json({ success: true, token, client, user: publicUser(user) });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 400)) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    handleHttpError(err, res, 'Client sign in failed.');
  }
});

app.post('/api/auth/wholesaler/signin', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authenticateUser({ email, password, expectedRole: 'wholesaler' });
    if (!user.tenantId) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    const [wholesaler] = await getDb().select().from(wholesalersTable).where(eq(wholesalersTable.id, user.tenantId)).limit(1);
    if (!wholesaler) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    res.json({
      success: true,
      token,
      wholesaler: {
        id: wholesaler.id,
        name: wholesaler.name,
        category: wholesaler.category,
        city: wholesaler.city,
        status: wholesaler.status,
        ownerEmail: wholesaler.ownerEmail,
        phone: wholesaler.phone,
        rating: Number(wholesaler.rating),
      },
      user: publicUser(user),
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    if (err instanceof HttpError && err.status === 403) {
      return res.status(403).json({ error: 'This account has been suspended.' });
    }
    handleHttpError(err, res, 'Wholesaler sign in failed.');
  }
});

app.post('/api/auth/admin/signin', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authenticateUser({ email, password, expectedRole: 'admin' });
    res.json({
      success: true,
      token,
      admin: { name: user.name, email: user.email },
      user: publicUser(user),
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    handleHttpError(err, res, 'Admin sign in failed.');
  }
});

app.post('/api/auth/delivery/signin', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authenticateUser({ email, password, expectedRole: 'delivery' });
    res.json({
      success: true,
      token,
      delivery: { id: user.id, name: user.name, email: user.email },
      user: publicUser(user),
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    handleHttpError(err, res, 'Delivery sign in failed.');
  }
});

app.post('/api/auth/password/forgot', authRateLimit, async (req, res) => {
  try {
    const { email, phone } = req.body || {};
    await requestPasswordReset({ email, phone });
    // Always generic — do not reveal account existence
    res.json({
      success: true,
      message: 'If an account with that email or phone exists and has a notification email on file, a reset link has been queued.',
    });
  } catch (err) {
    handleHttpError(err, res, 'Unable to process password reset.');
  }
});

app.post('/api/auth/password/reset', authRateLimit, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    await resetPasswordWithToken({ token, newPassword });
    res.json({ success: true, message: 'Password updated. You can sign in with your new password.' });
  } catch (err) {
    handleHttpError(err, res, 'Unable to reset password.');
  }
});

app.post('/api/auth/password/change', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await changePassword(req.user!.id, currentPassword, newPassword);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      return res.status(401).json({ error: AUTH_FAIL });
    }
    handleHttpError(err, res, 'Unable to change password.');
  }
});

app.get('/api/admin/email/outbox', authenticate, authorize(['admin']), async (_req, res) => {
  try {
    const stats = await getOutboxStats();
    res.json({ success: true, mode: getMailMode(), stats });
  } catch (err) {
    handleHttpError(err, res, 'Unable to load email outbox.');
  }
});

app.post('/api/admin/email/process', authenticate, authorize(['admin']), async (_req, res) => {
  try {
    const result = await processEmailOutbox(50);
    res.json({ success: true, mode: getMailMode(), ...result });
  } catch (err) {
    handleHttpError(err, res, 'Unable to process email outbox.');
  }
});

app.post('/api/admin/email/test', authenticate, authorize(['admin']), authRateLimit, async (req, res) => {
  try {
    const to = String(req.body?.to || req.user?.email || '').trim().toLowerCase();
    if (!to || !to.includes('@')) {
      return res.status(400).json({ error: 'Provide a valid to email.' });
    }
    const queued = await enqueueEmail({
      eventKey: `test_ping:${to}:${Date.now()}`,
      template: 'test_ping',
      toEmail: to,
      toUserId: req.user!.id,
      payload: { detail: `Sent by admin ${req.user!.name} at ${new Date().toISOString()}` },
    });
    const processed = await processEmailOutbox(5);
    res.json({ success: true, queued, processed, mode: getMailMode() });
  } catch (err) {
    handleHttpError(err, res, 'Unable to send test email.');
  }
});

app.post('/api/wholesaler-applications', publicFormRateLimit, async (req, res) => {
  try {
    const result = await submitWholesalerApplication(req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    handleHttpError(err, res, 'Unable to submit application.');
  }
});

app.get('/api/wholesaler-applications', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const applications = await listWholesalerApplications(status);
    res.json({ success: true, applications });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list applications.');
  }
});

app.post('/api/wholesaler-applications/:id/approve', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await approveWholesalerApplication(req.params.id, {
      id: req.user!.id,
      name: req.user!.name || 'Admin',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    handleHttpError(err, res, 'Failed to approve application.');
  }
});

app.post('/api/wholesaler-applications/:id/reject', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const result = await rejectWholesalerApplication(
      req.params.id,
      { id: req.user!.id, name: req.user!.name || 'Admin' },
      typeof req.body?.reason === 'string' ? req.body.reason : undefined
    );
    res.json({ success: true, ...result });
  } catch (err) {
    handleHttpError(err, res, 'Failed to reject application.');
  }
});

app.post('/api/wholesalers', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { name, category, city, ownerEmail, phone, password } = req.body;
    const wholesaler = await createWholesalerAccount({ name, category, city, ownerEmail, phone, password });
    await writeAudit(req.user?.name || 'Super Admin', 'Admin', 'CREATE_WHOLESALER', `Created wholesaler tenant: ${name} (${wholesaler.id})`);
    res.json({ success: true, wholesaler });
  } catch (err) {
    handleHttpError(err, res, 'Failed to create wholesaler.');
  }
});

app.patch('/api/wholesalers/:id/status', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'Status must be active or suspended.' });
    }
    const wholesaler = await setWholesalerStatus(id, status);
    await writeAudit(req.user?.name || 'Super Admin', 'Admin', 'UPDATE_WHOLESALER_STATUS', `Updated wholesaler ${wholesaler.name} status to ${status}`);
    res.json({ success: true, wholesaler });
  } catch (err) {
    handleHttpError(err, res, 'Failed to update wholesaler.');
  }
});

app.delete('/api/wholesalers/:id', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await removeWholesaler(id);
    await writeAudit(req.user?.name || 'Super Admin', 'Admin', 'DELETE_WHOLESALER', `Permanently removed wholesaler tenant: ${removed.name} (${removed.id})`);
    res.json({ success: true, removed });
  } catch (err) {
    handleHttpError(err, res, 'Failed to delete wholesaler.');
  }
});

app.get('/api/products', authenticate, async (req, res) => {
  try {
    const products = await listProductsForUser(req.user);
    res.json({ success: true, products });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list products.');
  }
});

app.post('/api/products', authenticate, authorize(['wholesaler']), async (req, res) => {
  try {
    const product = await createProduct(req.user!, req.body);
    await writeAudit(req.user!.name, 'Wholesaler', 'PRODUCT_CREATE', `Created product ${product.sku}`);
    res.status(201).json({ success: true, product });
  } catch (err) {
    handleHttpError(err, res, 'Failed to create product.');
  }
});

app.patch('/api/products/:id', authenticate, authorize(['wholesaler']), async (req, res) => {
  try {
    const product = await updateProduct(req.user!, req.params.id, req.body);
    await writeAudit(req.user!.name, 'Wholesaler', 'PRODUCT_UPDATE', `Updated product ${product.sku}`);
    res.json({ success: true, product });
  } catch (err) {
    handleHttpError(err, res, 'Failed to update product.');
  }
});

app.post('/api/products/:id/deactivate', authenticate, authorize(['wholesaler']), async (req, res) => {
  try {
    const product = await deactivateProduct(req.user!, req.params.id);
    await writeAudit(req.user!.name, 'Wholesaler', 'PRODUCT_DEACTIVATE', `Deactivated product ${product.sku}`);
    res.json({ success: true, product });
  } catch (err) {
    handleHttpError(err, res, 'Failed to deactivate product.');
  }
});

app.get('/api/cart', authenticate, authorize(['client']), async (req, res) => {
  try {
    const cart = await getCart(req.user!);
    res.json({ success: true, cart });
  } catch (err) {
    handleHttpError(err, res, 'Failed to load cart.');
  }
});

app.post('/api/cart/items', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { productId, quantity, mode } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId is required.' });
    const cart =
      mode === 'set'
        ? await upsertCartItem(req.user!, productId, Number(quantity))
        : await addToCart(req.user!, productId, Number(quantity ?? 1));
    res.json({ success: true, cart });
  } catch (err) {
    handleHttpError(err, res, 'Failed to update cart.');
  }
});

app.delete('/api/cart/items/:productId', authenticate, authorize(['client']), async (req, res) => {
  try {
    const cart = await removeCartItem(req.user!, req.params.productId);
    res.json({ success: true, cart });
  } catch (err) {
    handleHttpError(err, res, 'Failed to remove cart item.');
  }
});

app.get('/api/orders', authenticate, authorize(['client', 'wholesaler', 'admin']), async (req, res) => {
  try {
    const orders = await listOrdersForUser(req.user!);
    res.json({ success: true, orders });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list orders.');
  }
});

app.get('/api/orders/:id', authenticate, authorize(['client', 'wholesaler', 'admin']), async (req, res) => {
  try {
    const order = await getOrderForUser(req.user!, req.params.id);
    res.json({ success: true, order });
  } catch (err) {
    handleHttpError(err, res, 'Failed to load order.');
  }
});

app.post('/api/orders', authenticate, authorize(['client']), async (req, res) => {
  try {
    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined) ||
      req.body.idempotencyKey;
    const order = await placeOrder(req.user!, {
      deliveryAddress: req.body.deliveryAddress,
      confirmed: req.body.confirmed === true,
      idempotencyKey,
    });
    res.status(201).json({ success: true, order });
  } catch (err) {
    handleHttpError(err, res, 'Failed to place order.');
  }
});

app.patch('/api/suborders/:subOrderId/review', authenticate, authorize(['wholesaler', 'admin']), async (req, res) => {
  try {
    const { action, rejectReason } = req.body;
    const order = await reviewSubOrder(req.user!, req.params.subOrderId, action, rejectReason);
    res.json({ success: true, order });
  } catch (err) {
    handleHttpError(err, res, 'Failed to review suborder.');
  }
});

app.get('/api/shipments', authenticate, authorize(['admin', 'delivery', 'wholesaler', 'client']), async (req, res) => {
  try {
    const shipments = await listShipmentsForUser(req.user!);
    res.json({ success: true, shipments });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list shipments.');
  }
});

app.get('/api/dispatch/queue', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const queue = await listDispatchQueue(req.user!);
    const deliveryUsers = await listAssignableDeliveryUsers();
    res.json({
      success: true,
      ...queue,
      deliveryUsers: deliveryUsers.map((u) => ({ id: u.id, name: u.name, email: u.email })),
    });
  } catch (err) {
    handleHttpError(err, res, 'Failed to load dispatch queue.');
  }
});

app.patch('/api/shipments/:shipmentId/assign', authenticate, authorize(['admin']), async (req, res) => {
  try {
    const shipment = await assignShipment(req.user!, req.params.shipmentId, {
      assigneeId: req.body.assigneeId || 'DRV-01',
      assigneeName: req.body.assigneeName,
      trackingRef: req.body.trackingRef,
      expectedDate: req.body.expectedDate,
    });
    res.json({ success: true, shipment });
  } catch (err) {
    handleHttpError(err, res, 'Failed to assign shipment.');
  }
});

app.patch('/api/shipments/:shipmentId/status', authenticate, authorize(['admin', 'delivery']), async (req, res) => {
  try {
    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined) ||
      req.body.idempotencyKey;
    const shipment = await updateShipmentStatus(req.user!, req.params.shipmentId, {
      status: req.body.status,
      proofNotes: req.body.proofNotes,
      failureReason: req.body.failureReason,
      idempotencyKey,
    });
    res.json({ success: true, shipment });
  } catch (err) {
    handleHttpError(err, res, 'Failed to update shipment status.');
  }
});

app.get('/api/invoices', authenticate, authorize(['admin', 'wholesaler', 'client']), async (req, res) => {
  try {
    const invoices = await listInvoicesForUser(req.user!);
    res.json({ success: true, invoices });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list invoices.');
  }
});

app.get('/api/invoices/:id', authenticate, authorize(['admin', 'wholesaler', 'client']), async (req, res) => {
  try {
    const invoice = await getInvoiceForUser(req.user!, req.params.id);
    res.json({ success: true, invoice });
  } catch (err) {
    handleHttpError(err, res, 'Failed to load invoice.');
  }
});

app.get('/api/payments', authenticate, authorize(['admin', 'wholesaler', 'client']), async (req, res) => {
  try {
    const payments = await listPaymentsForUser(req.user!);
    res.json({ success: true, payments });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list payments.');
  }
});

app.post('/api/payments', authenticate, authorize(['admin', 'wholesaler']), async (req, res) => {
  try {
    const idempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined) ||
      req.body.idempotencyKey;
    const result = await recordPayment(req.user!, {
      invoiceId: req.body.invoiceId,
      amount: req.body.amount,
      method: req.body.method,
      reference: req.body.reference,
      notes: req.body.notes,
      idempotencyKey,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    handleHttpError(err, res, 'Failed to record payment.');
  }
});

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
});

app.get('/api/ai/status', authenticate, authorize(['client']), (_req, res) => {
  const diag = getGeminiDiagnostics();
  res.json({
    success: true,
    geminiConfigured: isGeminiConfigured(),
    mode: isGeminiConfigured() ? 'gemini+tools' : 'deterministic-agents',
    gemini: diag,
    voice: {
      maxBytes: MAX_AUDIO_BYTES,
      maxDurationMs: MAX_AUDIO_DURATION_MS,
      transcription: isGeminiConfigured() ? 'gemini' : 'unavailable',
      tts: isGeminiConfigured() ? 'gemini-optional' : 'unavailable',
      pashtoTtsVerified: false,
      urduTtsVerified: false,
      whatsappStyleAutoSend: true,
      reviewModeOptional: true,
      requiresTranscriptReview: false,
      autoSubmitDisabled: false,
    },
  });
});

app.get('/api/ai/conversations', authenticate, authorize(['client']), async (req, res) => {
  try {
    const rows = await listConversations(req.user!);
    res.json({ success: true, conversations: rows });
  } catch (err) {
    handleHttpError(err, res, 'Failed to list conversations.');
  }
});

app.get('/api/ai/conversations/:id/messages', authenticate, authorize(['client']), async (req, res) => {
  try {
    const data = await getConversationMessages(req.user!, req.params.id);
    res.json({
      success: true,
      conversation: data.conversation,
      messages: data.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        language: m.language,
        metadata: m.metadata,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    handleHttpError(err, res, 'Failed to load conversation.');
  }
});

app.post('/api/ai/chat', authenticate, authorize(['client']), aiChatRateLimit, async (req, res) => {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message : '';
    const language = typeof req.body.language === 'string' ? req.body.language : 'en';
    const conversationId = typeof req.body.conversationId === 'string' ? req.body.conversationId : undefined;
    if (!message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters).' });
    }

    const result = await handleShopkeeperChat(req.user!, { message, language, conversationId });
    res.json({
      success: true,
      reply: result.reply,
      detectedLanguage: result.detectedLanguage,
      suggestedProducts: result.suggestedProducts,
      cart: result.cart,
      needsConfirmation: result.needsConfirmation,
      clarificationNeeded: result.clarificationNeeded,
      conversationId: result.conversationId,
      messageId: result.messageId,
      toolCalls: result.toolCalls,
      geminiUsed: result.geminiUsed,
      geminiModel: result.geminiModel,
      fallbackReason: result.fallbackReason,
      action: result.action,
      // Never place orders from AI chat alone
      orderPlaced: false,
    });
  } catch (err) {
    handleHttpError(err, res, 'AI assistant is temporarily unavailable. Please try again.');
  }
});

app.post(
  '/api/ai/voice/transcribe',
  authenticate,
  authorize(['client']),
  voiceUploadRateLimit,
  (req, res, next) => {
    voiceUpload.single('audio')(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `Audio exceeds maximum size of ${MAX_AUDIO_BYTES} bytes.` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: 'Audio upload failed.' });
      next();
    });
  },
  async (req, res) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'Audio file is required (field name: audio).' });
      }
      const durationRaw = req.body?.durationMs;
      const durationMs = durationRaw != null && durationRaw !== '' ? Number(durationRaw) : null;
      const result = await createTranscriptionFromUpload(req.user!, {
        buffer: file.buffer,
        declaredMime: file.mimetype,
        durationMs: Number.isFinite(durationMs as number) ? (durationMs as number) : null,
        conversationId: typeof req.body?.conversationId === 'string' ? req.body.conversationId : undefined,
        languageHint: typeof req.body?.language === 'string' ? req.body.language : undefined,
      });
      res.status(201).json({ success: true, ...result });
    } catch (err) {
      handleHttpError(err, res, 'Voice transcription failed.');
    }
  }
);

app.post(
  '/api/ai/voice/auto',
  authenticate,
  authorize(['client']),
  voiceUploadRateLimit,
  (req, res, next) => {
    voiceUpload.single('audio')(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `Audio exceeds maximum size of ${MAX_AUDIO_BYTES} bytes.` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: 'Audio upload failed.' });
      next();
    });
  },
  async (req, res) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'Audio file is required (field name: audio).' });
      }
      const durationRaw = req.body?.durationMs;
      const durationMs = durationRaw != null && durationRaw !== '' ? Number(durationRaw) : null;
      const result = await processVoiceMessageAuto(req.user!, {
        buffer: file.buffer,
        declaredMime: file.mimetype,
        durationMs: Number.isFinite(durationMs as number) ? (durationMs as number) : null,
        conversationId: typeof req.body?.conversationId === 'string' ? req.body.conversationId : undefined,
        languageHint: typeof req.body?.language === 'string' ? req.body.language : undefined,
        submissionKey: typeof req.body?.submissionKey === 'string' ? req.body.submissionKey : undefined,
      });

      if (!result.autoSent) {
        return res.status(200).json({
          success: true,
          autoSent: false,
          orderPlaced: false,
          transcriptId: result.transcriptId,
          conversationId: result.conversationId,
          transcript: result.transcript,
          detectedLanguage: result.detectedLanguage,
          geminiUsed: result.geminiUsed,
          transcriptionSucceeded: result.transcriptionSucceeded,
          error: result.error,
          errorCode: result.errorCode,
          requiresManualEntry: true,
        });
      }

      const chatResult = result as Extract<typeof result, { reply: string }>;
      res.status(201).json({
        success: true,
        autoSent: true,
        orderPlaced: false,
        transcriptId: chatResult.transcriptId,
        conversationId: chatResult.conversationId,
        userText: chatResult.transcript,
        reply: chatResult.reply,
        detectedLanguage: chatResult.detectedLanguage,
        suggestedProducts: chatResult.suggestedProducts,
        cart: chatResult.cart,
        needsConfirmation: chatResult.needsConfirmation,
        clarificationNeeded: chatResult.clarificationNeeded,
        messageId: chatResult.messageId,
        toolCalls: chatResult.toolCalls,
        geminiUsed: chatResult.geminiUsed,
        geminiModel: chatResult.geminiModel,
        fallbackReason: chatResult.fallbackReason,
        action: chatResult.action,
        transcriptionSucceeded: true,
      });
    } catch (err) {
      handleHttpError(err, res, 'Voice message failed.');
    }
  }
);

app.post('/api/ai/voice/submit', authenticate, authorize(['client']), aiChatRateLimit, async (req, res) => {
  try {
    const result = await submitReviewedTranscript(req.user!, {
      transcriptId: String(req.body.transcriptId || ''),
      editedTranscript: String(req.body.editedTranscript || ''),
      conversationId: typeof req.body.conversationId === 'string' ? req.body.conversationId : undefined,
      language: typeof req.body.language === 'string' ? req.body.language : undefined,
      submissionKey: String(req.body.submissionKey || ''),
    });
    if (result.alreadySubmitted || result.duplicate) {
      return res.json({
        success: true,
        duplicate: true,
        orderPlaced: false,
        transcriptId: result.transcriptId,
        conversationId: result.conversationId,
        message: 'Transcript was already submitted. No duplicate AI action was taken.',
      });
    }
    const chatResult = result as Extract<typeof result, { reply: string }>;
    res.json({
      success: true,
      duplicate: false,
      reply: chatResult.reply,
      detectedLanguage: chatResult.detectedLanguage,
      suggestedProducts: chatResult.suggestedProducts,
      cart: chatResult.cart,
      needsConfirmation: chatResult.needsConfirmation,
      clarificationNeeded: chatResult.clarificationNeeded,
      conversationId: chatResult.conversationId,
      messageId: chatResult.messageId,
      toolCalls: chatResult.toolCalls,
      geminiUsed: chatResult.geminiUsed,
      action: chatResult.action,
      transcriptId: chatResult.transcriptId,
      orderPlaced: false,
      requiresCheckoutConfirmation: chatResult.requiresCheckoutConfirmation,
    });
  } catch (err) {
    handleHttpError(err, res, 'Failed to submit reviewed transcript.');
  }
});

app.post('/api/ai/voice/tts', authenticate, authorize(['client']), voiceTtsRateLimit, async (req, res) => {
  try {
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: 'Text is required for speech.' });
    const result = await synthesizeAssistantReply(req.user!, {
      text,
      language: typeof req.body.language === 'string' ? req.body.language : 'en',
      conversationId: typeof req.body.conversationId === 'string' ? req.body.conversationId : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    // TTS must never block ordering
    res.json({
      success: true,
      ok: false,
      orderPlaced: false,
      fallbackReason: 'Voice playback unavailable. Text reply still works.',
      nativeLanguageReliable: false,
    });
  }
});

app.get('/api/ai/voice/audio/:id', authenticate, authorize(['client']), async (req, res) => {
  try {
    const { asset, buffer } = await getOwnedAudio(req.user!, req.params.id);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  } catch (err) {
    handleHttpError(err, res, 'Audio not found.');
  }
});

if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false },
  });
  app.use(vite.middlewares);
} else {
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 3000);

async function start() {
  try {
    await runMigrations();
    if (!isProduction()) {
      await seedDevelopmentData();
    } else {
      await ensureProductionBootstrap();
    }
    const connected = await checkDatabaseConnection();
    // Prefer in-process worker on persistent hosts; set EMAIL_WORKER_MODE=external for cron-only.
    if (process.env.EMAIL_WORKER_MODE !== 'external') {
      startEmailOutboxWorker();
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Wholesale Market Platform listening on 0.0.0.0:${PORT}`);
      console.log(`Database: ${connected ? 'connected' : 'disconnected'}`);
      console.log(`Mail mode: ${getMailMode()}`);
      console.log(`App base URL: ${process.env.APP_BASE_URL || '(unset)'}`);
    });
  } catch (err) {
    console.error('Failed to start server. PostgreSQL must be configured before the demo can run.');
    console.error(err);
    process.exit(1);
  }
}

await start();
