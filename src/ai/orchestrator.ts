import type { AuthUser } from '../auth/types';
import { HttpError } from '../auth/rbac';
import type { CartView, ProductView } from '../commerce/types';
import {
  appendMessage,
  getOrCreateConversation,
  loadRecentHistory,
} from './conversations';
import { parseIntent, sanitizeUserMessage } from './intents';
import { getGeminiModelName, isGeminiConfigured, MAX_TOOL_ROUNDS, runGeminiRound } from './gemini';
import { executeTool, searchCatalog } from './tools';
import type { AssistantResponse, ChatLanguage } from './types';

function formatMoney(n: number): string {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

function cartPreview(cart: CartView | null): string {
  if (!cart || cart.itemCount === 0) return 'Cart is empty.';
  const lines = cart.items
    .map((i) => `• ${i.product.name}: ${i.quantity} × ${formatMoney(i.product.sellingPrice)} = ${formatMoney(i.lineTotal)}`)
    .join('\n');
  const wholesalers = cart.byWholesaler.map((w) => `${w.wholesalerId} (${formatMoney(w.subtotal)})`).join(', ');
  return `${lines}\nSubtotal: ${formatMoney(cart.subtotal)} across ${cart.byWholesaler.length} wholesaler(s): ${wholesalers}`;
}

function replyForLanguage(language: ChatLanguage, payloads: Record<'en' | 'ur' | 'ps', string>): string {
  if (language === 'ur') return payloads.ur;
  if (language === 'ps') return payloads.ps;
  if (language === 'mixed') return `${payloads.ur}\n\n${payloads.en}`;
  return payloads.en;
}

async function runDeterministic(
  user: AuthUser,
  conversationId: string,
  messageId: string,
  message: string
): Promise<Omit<AssistantResponse, 'conversationId' | 'messageId' | 'geminiUsed'>> {
  const intent = parseIntent(message);
  const language = intent.language;
  let suggestedProducts: ProductView[] = [];
  let cart: CartView | null = null;
  let needsConfirmation = false;
  let clarificationNeeded = false;
  const toolCalls: { name: string; ok: boolean }[] = [];
  let action: AssistantResponse['action'] = { type: 'none' };
  let reply = '';

  const run = async (name: string, args: Record<string, unknown>) => {
    const out = await executeTool(user, name, args, { conversationId, messageId });
    toolCalls.push({ name, ok: out.status === 'ok' });
    return out;
  };

  if (intent.kind === 'unknown' && /ignore|bypass|secret|sql|drop table/i.test(message)) {
    reply = replyForLanguage(language, {
      en: 'I can only help with catalog search, cart, order status, and invoices for your shop. I cannot change system rules or access other accounts.',
      ur: 'میں صرف آپ کی دکان کے لیے کیٹلاگ، کارٹ، آرڈر سٹیٹس اور انوائس میں مدد کر سکتا ہوں۔ سسٹم قواعد تبدیل نہیں کر سکتا۔',
      ps: 'زه یوازې ستاسو دوکان ته د کتلاګ، کارټ، آرډر حالت او انوائس کې مرسته کولی شم.',
    });
    return {
      reply,
      detectedLanguage: language,
      suggestedProducts,
      cart,
      needsConfirmation,
      clarificationNeeded,
      toolCalls,
      action,
    };
  }

  if (intent.kind === 'clarify' || (intent.kind === 'add_to_cart' && !intent.productHints.length)) {
    clarificationNeeded = true;
    reply = replyForLanguage(language, {
      en: 'Which product do you need, and in what quantity/unit? For example: "5 cartons of Cola" or "Mujhe Pepsi ki 5 petiyan chahiye".',
      ur: 'کونسی چیز چاہیے اور کتنی مقدار/یونٹ میں؟ مثال: "کولا کی 5 پیٹیاں"۔',
      ps: 'کوم توکی ته اړتیا لرئ او څومره مقدار؟ مثال: "د کولا پنځه کارټنه".',
    });
    return {
      reply,
      detectedLanguage: language,
      suggestedProducts,
      cart,
      needsConfirmation,
      clarificationNeeded,
      toolCalls,
      action,
    };
  }

  if (intent.kind === 'search' || intent.kind === 'add_to_cart') {
    const query =
      intent.productHints.find((h) => ['cola', 'pepsi', 'drink', 'water', 'flour', 'juice', 'energy', 'rice', 'oil'].includes(h)) ||
      intent.query ||
      intent.productHints[0] ||
      message;
    const search = await run('search_catalog', { query, limit: 5 });
    const products = ((search.result as any)?.products || []) as ProductView[];
    suggestedProducts = products;

    if (products.length === 0) {
      reply = replyForLanguage(language, {
        en: `I could not find a matching product for "${query}". Try another name (Cola, Mineral Water, Flour, Mango Juice).`,
        ur: `"${query}" سے مماثل پروڈکٹ نہیں ملی۔ کولا، منرل واٹر، آٹا یا آم جوس آزمائیں۔`,
        ps: `"${query}" سره سمون لرونکی توکی ونه موندل شو. کولا، اوبه یا اوړه وازموئ.`,
      });
    } else if (intent.kind === 'add_to_cart') {
      if (products.length > 1 && intent.confidence < 0.75) {
        clarificationNeeded = true;
        reply =
          replyForLanguage(language, {
            en: 'I found several matches. Please pick one product, then tell me the quantity.',
            ur: 'کئی مماثل اشیاء ملیں۔ براہ کرم ایک منتخب کریں پھر مقدار بتائیں۔',
            ps: 'څو سمونونه وموندل شول. مهرباني وکړئ یو وټاکئ او مقدار ووایاست.',
          }) +
          '\n' +
          products.map((p) => `• ${p.name} — ${formatMoney(p.sellingPrice)} / ${p.unit} (stock ${p.availableStock}, MOQ ${p.moq})`).join('\n');
      } else {
        const chosen = products[0];
        const qty = intent.quantity || chosen.moq;
        const add = await run('add_to_cart', { productId: chosen.id, quantity: qty });
        if (add.status !== 'ok') {
          reply = replyForLanguage(language, {
            en: `Could not add to cart: ${(add.result as any)?.error || 'validation failed'}.`,
            ur: `کارٹ میں شامل نہیں ہو سکا: ${(add.result as any)?.error || 'غلطی'}۔`,
            ps: `کارټ ته اضافه نشوه: ${(add.result as any)?.error || 'تېروتنه'}.`,
          });
          suggestedProducts = [chosen];
        } else {
          cart = (add.result as any).cart as CartView;
          action = { type: 'refresh_cart' };
          const proposal = await run('propose_checkout', {});
          needsConfirmation = Boolean((proposal.result as any)?.ready);
          if (needsConfirmation) action = { type: 'open_checkout' };
          reply =
            replyForLanguage(language, {
              en: `Added ${qty} × ${chosen.name} (${chosen.unit}).`,
              ur: `${qty} × ${chosen.name} کارٹ میں شامل کر دی۔`,
              ps: `${qty} × ${chosen.name} کارټ ته اضافه شو.`,
            }) +
            `\n\n${cartPreview(cart)}\n\n` +
            replyForLanguage(language, {
              en: needsConfirmation
                ? 'Order is NOT placed yet. Review the summary and confirm checkout in the app to place the order.'
                : 'Tell me if you want more items or say "checkout" for a summary.',
              ur: needsConfirmation
                ? 'آرڈر ابھی نہیں ہوا۔ خلاصہ دیکھ کر ایپ میں کنفرم کریں۔'
                : 'مزید اشیاء بتائیں یا "checkout" کہیں۔',
              ps: needsConfirmation
                ? 'آرډر لا نه دی شوی. په ایپ کې تایید کړئ.'
                : 'نور توکي ووایاست یا "checkout" ووایاست.',
            });
        }
      }
    } else {
      reply =
        replyForLanguage(language, {
          en: `Here are live catalog matches for "${query}":`,
          ur: `"${query}" کے لیے دستیاب اشیاء:`,
          ps: `"${query}" لپاره موجود توکي:`,
        }) +
        '\n' +
        products
          .map(
            (p) =>
              `• ${p.name} — ${formatMoney(p.sellingPrice)} / ${p.unit} | stock ${p.availableStock} | MOQ ${p.moq} | ${p.wholesalerId}`
          )
          .join('\n');
    }
  } else if (intent.kind === 'view_cart') {
    const out = await run('get_cart', {});
    cart = (out.result as any)?.cart || null;
    reply = cartPreview(cart);
  } else if (intent.kind === 'checkout') {
    const out = await run('propose_checkout', {});
    cart = (out.result as any)?.cart || null;
    needsConfirmation = Boolean((out.result as any)?.ready);
    if (needsConfirmation) action = { type: 'open_checkout' };
    reply = needsConfirmation
      ? replyForLanguage(language, {
          en: `Checkout summary (NOT placed):\n${cartPreview(cart)}\nConfirm in the checkout dialog to place the multi-wholesaler order.`,
          ur: `چیک آؤٹ خلاصہ (آرڈر نہیں ہوا):\n${cartPreview(cart)}\nایپ میں کنفرم کریں۔`,
          ps: `چک آوټ لنډیز (آرډر نه دی شوی):\n${cartPreview(cart)}\nپه ایپ کې تایید کړئ.`,
        })
      : replyForLanguage(language, {
          en: 'Your cart is empty. Ask me to find drinks or groceries first.',
          ur: 'کارٹ خالی ہے۔ پہلے پروڈکٹ تلاش کریں۔',
          ps: 'کارټ تش دی. لومړی توکي ولټوئ.',
        });
  } else if (intent.kind === 'order_status') {
    const out = await run('get_order_status', {});
    const orders = ((out.result as any)?.orders || []) as any[];
    if (!orders.length) {
      reply = replyForLanguage(language, {
        en: 'You have no orders yet.',
        ur: 'ابھی کوئی آرڈر نہیں ہے۔',
        ps: 'تاسو لا آرډر نلرئ.',
      });
    } else {
      reply = orders
        .map(
          (o) =>
            `Order ${o.id}: ${o.status}, total ${formatMoney(o.totalAmount)}, payment ${o.paymentStatus}` +
            (o.subOrders?.length
              ? `\n  Suborders: ${o.subOrders.map((s: any) => `${s.id} ${s.status}`).join(', ')}`
              : '')
        )
        .join('\n');
    }
  } else if (intent.kind === 'invoice') {
    const out = await run('get_invoice_summary', {});
    const invoices = ((out.result as any)?.invoices || []) as any[];
    if (!invoices.length) {
      reply = replyForLanguage(language, {
        en: 'No invoices yet. Invoices appear after delivery.',
        ur: 'ابھی کوئی انوائس نہیں۔ ڈیلیوری کے بعد بنتی ہیں۔',
        ps: 'لا انوائس نشته. د تحویلۍ وروسته جوړېږي.',
      });
    } else {
      reply = invoices
        .map(
          (inv) =>
            `${inv.invoiceNumber}: ${inv.status} — amount ${formatMoney(inv.amount)}, outstanding ${formatMoney(inv.outstandingAmount)} (${inv.wholesalerName})`
        )
        .join('\n');
    }
  } else {
    // gentle catalog help
    const drinks = await searchCatalog('drink', 3);
    suggestedProducts = drinks;
    reply = replyForLanguage(language, {
      en: 'I can search stock, update your cart, summarize checkout (without placing), and explain orders/invoices. Try: "Show available cold drinks" or "Mujhe Pepsi ki 5 petiyan chahiye".',
      ur: 'میں اسٹاک تلاش، کارٹ اپڈیٹ، چیک آؤٹ خلاصہ (بغیر آرڈر) اور انوائس بتا سکتا ہوں۔',
      ps: 'زه سټاک لټون، کارټ تازه کول او چک آوټ لنډیز کولی شم.',
    });
  }

  return {
    reply,
    detectedLanguage: language,
    suggestedProducts,
    cart,
    needsConfirmation,
    clarificationNeeded,
    toolCalls,
    action,
  };
}

async function runWithGemini(
  user: AuthUser,
  conversationId: string,
  messageId: string,
  message: string,
  languageHint: string,
  history: { role: 'user' | 'model'; text: string }[]
): Promise<Omit<AssistantResponse, 'conversationId' | 'messageId' | 'geminiUsed'>> {
  let suggestedProducts: ProductView[] = [];
  let cart: CartView | null = null;
  let needsConfirmation = false;
  let clarificationNeeded = false;
  const toolCalls: { name: string; ok: boolean }[] = [];
  let action: AssistantResponse['action'] = { type: 'none' };
  let toolResults: { name: string; response: unknown; callId?: string }[] | undefined;
  let finalText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await runGeminiRound({
      history,
      message,
      languageHint,
      toolResults,
    });

    if (result.toolRequests.length === 0) {
      finalText = result.text;
      break;
    }

    toolResults = [];
    for (const req of result.toolRequests) {
      // Hard block any attempt to place orders via model hallucination
      if (/place_order|confirm_order|create_order|checkout_now/i.test(req.name)) {
        toolResults.push({
          name: req.name,
          response: {
            error: 'Ordering is blocked. Use propose_checkout only; user must confirm in UI.',
          },
          callId: req.callId,
        });
        toolCalls.push({ name: req.name, ok: false });
        continue;
      }

      const out = await executeTool(user, req.name, req.args || {}, { conversationId, messageId });
      toolCalls.push({ name: req.name, ok: out.status === 'ok' });
      toolResults.push({ name: req.name, response: out.result, callId: req.callId });

      if (req.name === 'search_catalog' && out.status === 'ok') {
        suggestedProducts = ((out.result as any).products || []) as ProductView[];
      }
      if (['get_cart', 'add_to_cart', 'update_cart_item', 'remove_cart_item', 'propose_checkout'].includes(req.name)) {
        const maybeCart = (out.result as any)?.cart as CartView | undefined;
        if (maybeCart) {
          cart = maybeCart;
          action = { type: 'refresh_cart' };
        }
        if (req.name === 'propose_checkout' && (out.result as any)?.ready) {
          needsConfirmation = true;
          action = { type: 'open_checkout' };
        }
      }
    }

    // Final narrative after last tool batch if no more loops needed later
    if (round === MAX_TOOL_ROUNDS - 1) {
      const wrap = await runGeminiRound({ history, message, languageHint, toolResults });
      finalText = wrap.text;
    }
  }

  if (!finalText) {
    finalText =
      cart && cart.itemCount > 0
        ? `Updated your cart.\n${cartPreview(cart)}` +
          (needsConfirmation ? '\nConfirm checkout in the app to place the order (not placed yet).' : '')
        : suggestedProducts.length
          ? `Found ${suggestedProducts.length} product(s). Ask me to add a quantity to your cart.`
          : 'How can I help with drinks or grocery stock today?';
  }

  if (/which (one|product)|clarify|ambiguous|کونسی|کوم/i.test(finalText)) {
    clarificationNeeded = true;
  }

  const intent = parseIntent(message);
  return {
    reply: finalText,
    detectedLanguage: intent.language,
    suggestedProducts,
    cart,
    needsConfirmation,
    clarificationNeeded,
    toolCalls,
    action,
  };
}

export async function handleShopkeeperChat(
  user: AuthUser,
  input: { message: string; conversationId?: string; language?: string }
): Promise<AssistantResponse> {
  if (user.role !== 'client') {
    throw new HttpError(403, 'Only shopkeepers can use the AI assistant.');
  }

  const cleaned = sanitizeUserMessage(input.message);
  if (!cleaned) throw new HttpError(400, 'Message is required.');
  if (cleaned.length > 2000) throw new HttpError(400, 'Message too long (max 2000 characters).');

  const conversation = await getOrCreateConversation(user, input.conversationId, input.language || 'en');
  const userMessage = await appendMessage({
    conversationId: conversation.id,
    clientId: user.id,
    role: 'user',
    content: cleaned,
    language: input.language,
  });

  const historyRows = await loadRecentHistory(conversation.id, user.id, 12);
  const history = historyRows
    .filter((m) => m.id !== userMessage.id)
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      text: m.content,
    }));

  let payload: Omit<AssistantResponse, 'conversationId' | 'messageId' | 'geminiUsed'>;
  let geminiUsed = false;

  let geminiModel: string | undefined;
  let fallbackReason: string | undefined;

  if (isGeminiConfigured()) {
    try {
      payload = await runWithGemini(
        user,
        conversation.id,
        userMessage.id,
        cleaned,
        input.language || 'auto',
        history
      );
      geminiUsed = true;
      geminiModel = getGeminiModelName();
    } catch (err: any) {
      const status = err?.status || err?.code;
      fallbackReason =
        status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(String(err?.message || ''))
          ? 'Gemini quota exhausted (HTTP 429). Using local Intent/Catalog/Cart agents.'
          : 'Live Gemini unavailable. Using local Intent/Catalog/Cart agents.';
      console.error('Gemini unavailable, using deterministic agents:', status || err?.message || err);
      payload = await runDeterministic(user, conversation.id, userMessage.id, cleaned);
      payload.reply = (payload.reply ? payload.reply + '\n\n' : '') + `(Note: ${fallbackReason})`;
    }
  } else {
    fallbackReason = 'GEMINI_API_KEY not configured.';
    payload = await runDeterministic(user, conversation.id, userMessage.id, cleaned);
  }

  const assistantMessage = await appendMessage({
    conversationId: conversation.id,
    clientId: user.id,
    role: 'assistant',
    content: payload.reply,
    language: payload.detectedLanguage,
    metadata: {
      toolCalls: payload.toolCalls,
      needsConfirmation: payload.needsConfirmation,
      suggestedProductIds: payload.suggestedProducts.map((p) => p.id),
      geminiUsed,
      geminiModel: geminiModel || null,
      fallbackReason: fallbackReason || null,
    },
  });

  return {
    ...payload,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    geminiUsed,
    geminiModel,
    fallbackReason,
  };
}
