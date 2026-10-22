import type { CartView, ProductView } from '../commerce/types';

export type ChatLanguage = 'en' | 'ur' | 'ps' | 'mixed';

export interface AssistantAction {
  type: 'open_checkout' | 'refresh_cart' | 'none';
}

export interface AssistantResponse {
  reply: string;
  detectedLanguage: ChatLanguage;
  suggestedProducts: ProductView[];
  cart: CartView | null;
  needsConfirmation: boolean;
  clarificationNeeded: boolean;
  conversationId: string;
  messageId: string;
  toolCalls: { name: string; ok: boolean }[];
  geminiUsed: boolean;
  geminiModel?: string;
  fallbackReason?: string;
  action: AssistantAction;
}

export interface ToolContext {
  conversationId: string;
  messageId?: string;
}
