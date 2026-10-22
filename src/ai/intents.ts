import type { ChatLanguage } from './types';

export type IntentKind =
  | 'search'
  | 'add_to_cart'
  | 'view_cart'
  | 'checkout'
  | 'order_status'
  | 'invoice'
  | 'clarify'
  | 'unknown';

export interface ParsedIntent {
  kind: IntentKind;
  language: ChatLanguage;
  query?: string;
  quantity?: number;
  unitHint?: string;
  productHints: string[];
  confidence: number;
}

const URDU_SCRIPT = /[\u0600-\u06FF]/;
const PASHTO_HINTS = /(ما ته|پکار|کارټن|پیپسي|څښاک|اوبه|وريجې)/i;
const ROMAN_URDU = /\b(mujhe|chahiye|kitne|kitni|peti|petiyan|carton|cartons?|dikhao|dijiye|hai|hain|ka|ki|ke)\b/i;

const UNIT_MAP: Record<string, string> = {
  peti: 'carton',
  petiyan: 'carton',
  petiyaan: 'carton',
  carton: 'carton',
  cartons: 'carton',
  bag: 'bag',
  bags: 'bag',
  tin: 'tin',
  case: 'carton',
  کارٹن: 'carton',
  کارټن: 'carton',
  کارټنه: 'carton',
  پیٹی: 'carton',
};

const PRODUCT_ALIASES: Record<string, string[]> = {
  cola: ['cola', 'pepsi', 'پیپسي', 'پیپسی', 'کولا', 'cold drink', 'soft drink', 'drink'],
  water: ['water', 'mineral', 'واٹر', 'اوبه', 'پانی'],
  flour: ['flour', 'atta', 'آٹا', 'اوړه', 'wheat'],
  juice: ['juice', 'mango', 'رس', 'جوس', 'آم'],
  energy: ['energy', 'انرجی', 'انرژي'],
  rice: ['rice', 'basmati', 'چاول', 'وریجې'],
  oil: ['oil', 'آئل', 'غوړي'],
  chili: ['chili', 'chilli', 'مرچ'],
};

function detectLanguage(text: string): ChatLanguage {
  const hasArabic = URDU_SCRIPT.test(text);
  const hasPashto = PASHTO_HINTS.test(text);
  const hasRoman = ROMAN_URDU.test(text);
  const hasLatin = /[A-Za-z]{3,}/.test(text);

  if (hasArabic && hasPashto) return 'ps';
  if (hasArabic && hasLatin) return 'mixed';
  if (hasArabic) return hasPashto ? 'ps' : 'ur';
  if (hasRoman && hasLatin) return 'mixed';
  if (hasRoman) return 'ur';
  if (hasPashto) return 'ps';
  return 'en';
}

function extractQuantity(text: string): number | undefined {
  const western = text.match(/\b(\d{1,5})\b/);
  if (western) return Number(western[1]);

  const urduDigits = text.match(/([۰-۹]{1,5})/);
  if (urduDigits) {
    const map: Record<string, string> = {
      '۰': '0',
      '۱': '1',
      '۲': '2',
      '۳': '3',
      '۴': '4',
      '۵': '5',
      '۶': '6',
      '۷': '7',
      '۸': '8',
      '۹': '9',
    };
    return Number(
      urduDigits[1]
        .split('')
        .map((c) => map[c] || c)
        .join('')
    );
  }

  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    fivee: 5,
    panj: 5,
    پنج: 5,
    پنځه: 5,
    ek: 1,
    do: 2,
    teen: 3,
    char: 4,
    paanch: 5,
  };
  const lower = text.toLowerCase();
  for (const [w, n] of Object.entries(words)) {
    if (lower.includes(w)) return n;
  }
  return undefined;
}

function extractUnit(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [key, unit] of Object.entries(UNIT_MAP)) {
    if (lower.includes(key.toLowerCase()) || text.includes(key)) return unit;
  }
  return undefined;
}

function extractProductHints(text: string): string[] {
  const lower = text.toLowerCase();
  const hints = new Set<string>();
  for (const [canonical, aliases] of Object.entries(PRODUCT_ALIASES)) {
    if (aliases.some((a) => lower.includes(a.toLowerCase()) || text.includes(a))) {
      hints.add(canonical);
      aliases.forEach((a) => {
        if (a.length > 2) hints.add(a);
      });
    }
  }
  // free tokens
  lower
    .split(/[\s,،.؟!?]+/)
    .filter((t) => t.length > 2 && !['mujhe', 'chahiye', 'show', 'available', 'please', 'want', 'need'].includes(t))
    .forEach((t) => hints.add(t));
  return [...hints].slice(0, 8);
}

export function parseIntent(message: string): ParsedIntent {
  const text = String(message || '').trim().slice(0, 2000);
  const language = detectLanguage(text);
  const lower = text.toLowerCase();
  const quantity = extractQuantity(text);
  const unitHint = extractUnit(text);
  const productHints = extractProductHints(text);

  if (/ignore (previous|all) instruction|system prompt|reveal (api|key|secret)|drop table|bypass|sql injection/i.test(text)) {
    return { kind: 'unknown', language, productHints: [], confidence: 1 };
  }

  if (/checkout|propose checkout|place order|order confirm|confirm order|finalize/i.test(text) || /چیک آؤٹ|آرڈر کنفرم/.test(text)) {
    return { kind: 'checkout', language, productHints, confidence: 0.9 };
  }

  if (/\b(cart|basket|mera cart|میرا کارٹ)\b/i.test(text) || /کارٹ دیکھو|show (my )?cart/i.test(lower)) {
    return { kind: 'view_cart', language, productHints, confidence: 0.9 };
  }

  if (/invoice|balance|outstanding|بل|ادائیگی|payment status/i.test(text)) {
    return { kind: 'invoice', language, productHints, confidence: 0.85 };
  }

  if (/order status|shipment|delivery|tracking|آرڈر سٹیٹس|ڈیلیوری/i.test(text)) {
    return { kind: 'order_status', language, productHints, confidence: 0.85 };
  }

  const wantsAdd =
    Boolean(quantity) ||
    /\b(add|chahiye|chahye|pkar|پکار|need|want|order|buy|le lo|dal do)\b/i.test(text) ||
    /ما ته|پکار دي/.test(text);

  if (wantsAdd && productHints.length > 0) {
    return {
      kind: 'add_to_cart',
      language,
      query: productHints[0],
      quantity,
      unitHint,
      productHints,
      confidence: quantity ? 0.8 : 0.55,
    };
  }

  if (/show|available|dikhao|دکھا|list|search|cold drink|drinks|beverages|stock/i.test(text) || productHints.length > 0) {
    return {
      kind: 'search',
      language,
      query: productHints[0] || text.slice(0, 80),
      productHints,
      unitHint,
      confidence: 0.75,
    };
  }

  if (!productHints.length && wantsAdd) {
    return { kind: 'clarify', language, productHints, quantity, unitHint, confidence: 0.7 };
  }

  return { kind: 'unknown', language, productHints, quantity, unitHint, confidence: 0.3 };
}

export function sanitizeUserMessage(message: string): string {
  return String(message || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .trim()
    .slice(0, 2000);
}
