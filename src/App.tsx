import React, { useState, useEffect, useRef } from 'react';
import {
  Store, Package, Users, Truck, ShoppingCart,
  MessageSquare, Mic, Volume2, CheckCircle2, XCircle,
  Clock, ArrowRight, DollarSign, RefreshCw, Send,
  FileText, Plus, ShieldCheck, MapPin, Sparkles, Check,
  Square, Pause, X, ClipboardList,
} from 'lucide-react';
import { formatDuration, isMediaRecordingSupported, MAX_CLIENT_RECORD_MS, pickRecorderMimeType } from './voice/mediaSupport';
import {
  AlertBanner,
  AuthLayout,
  EmptyState,
  KpiCard,
  ModalFrame,
  PortalHeader,
  StatusBadge,
  StockMeter,
  TabRail,
} from './ui/system';
import { ChatMessageMotion, FadeIn, Pressable, Stagger } from './motion/Motion';
import { AmbientShell } from './motion/LivingBackdrop';
import { AiAura, AiStateLabel, deriveAiVisualState } from './motion/AiAura';
import { AiModeChip, MicOrb, TypingDots, WaveformBars } from './ui/chatChrome';
import { HealthMeter, SparkBars } from './ui/charts';
import {
  bestSellersFromSubOrders,
  frequentProductsFromOrders,
  inventoryHealth,
  lastOrderLines,
  orderAmountSeries,
} from './insights/derive';
import { LandingPage, type ApplyForm, type LandingAction } from './landing/LandingPage';
import { BrandLoader, SoftProgress } from './ux/BrandLoader';
import { OfflineScreen, useConnectivity } from './ux/connectivity';
import { ContentReveal } from './ux/skeletons';
import { friendlyNetworkMessage, safeFetch } from './ux/safeFetch';

interface Wholesaler {
  id: string;
  name: string;
  category: string;
  city: string;
  status: 'active' | 'suspended';
  ownerEmail: string;
  phone: string;
  rating: number;
}

interface Product {
  id: string;
  wholesalerId: string;
  sku: string;
  name: string;
  aliases: { en: string; ur: string; ps: string };
  unit: string;
  packSize: string;
  costPrice: number;
  sellingPrice: number;
  moq: number;
  reorderPoint: number;
  stockOnHand: number;
  stockReserved: number;
  availableStock?: number;
  status: 'available' | 'low_stock' | 'out_of_stock' | 'inactive' | string;
}

interface SubOrder {
  id: string;
  wholesalerId: string;
  items: { productId: string; name: string; quantity: number; unitPrice: number; costPrice?: number; unit: string }[];
  subtotal: number;
  status: string;
  rejectReason?: string;
}

interface Order {
  id: string;
  clientId: string;
  clientName: string;
  deliveryAddress: string;
  status: string;
  subOrders: SubOrder[];
  totalAmount: number;
  createdAt: string;
  paymentStatus: string;
  paidAmount: number;
}

interface Shipment {
  id: string;
  orderId: string;
  subOrderId?: string | null;
  wholesalerId: string;
  assigneeId?: string;
  assigneeName?: string;
  status: string;
  expectedDate: string;
  proofNotes?: string;
  trackingRef?: string;
  clientName?: string;
  deliveryAddress?: string;
  failureReason?: string;
}

interface Invoice {
  id: string;
  invoiceNumber?: string;
  orderId: string;
  subOrderId?: string;
  wholesalerId: string;
  wholesalerName?: string;
  clientId?: string;
  clientName?: string;
  amount: number;
  paidAmount: number;
  outstandingAmount?: number;
  status: string;
  createdAt: string;
  issuedAt?: string;
  lines?: { id: string; name: string; quantity: number; unitPrice: string; lineTotal: string; unit: string; packSize: string }[];
}

interface PaymentRecord {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  createdAt: string;
  allocations: { invoiceId: string; amount: string }[];
}

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  details: string;
}

interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  audioPlayable?: boolean;
  language?: string;
  products?: Product[];
  cartPreview?: { itemCount: number; subtotal: number; lines: { name: string; quantity: number; lineTotal: number }[] };
  needsConfirmation?: boolean;
  error?: boolean;
  retryText?: string;
  ttsNote?: string;
  timestamp: string;
  geminiUsed?: boolean;
  fallbackReason?: string;
}

type VoiceUiState = 'idle' | 'recording' | 'preview' | 'transcribing' | 'review' | 'submitting';

export default function App() {
  const connectivity = useConnectivity();
  const [navState, setNavState] = useState<string>('gateway');
  const [bootFailed, setBootFailed] = useState(false);

  // Client Auth
  const [clientAuthMode, setClientAuthMode] = useState<'signin' | 'signup'>('signin');
  const [clientSignupForm, setClientSignupForm] = useState({ name: '', storeName: '', phone: '', email: '', password: '' });
  const [clientSigninPhone, setClientSigninPhone] = useState('03009876543');
  const [clientSigninPassword, setClientSigninPassword] = useState('password123');
  const [currentClient, setCurrentClient] = useState<{ id: string; name: string; storeName: string; phone: string; email?: string | null } | null>(null);
  const [forgotIdentity, setForgotIdentity] = useState({ email: '', phone: '' });
  const [resetPasswordForm, setResetPasswordForm] = useState({ token: '', newPassword: '', confirm: '' });
  const [authInfo, setAuthInfo] = useState('');

  // Wholesaler Auth
  const [wholesalerEmail, setWholesalerEmail] = useState('wholesaler1@market.pk');
  const [wholesalerPassword, setWholesalerPassword] = useState('password123');
  const [currentWholesaler, setCurrentWholesaler] = useState<Wholesaler | null>(null);

  // Admin Auth
  const [adminEmail, setAdminEmail] = useState('admin@market.pk');
  const [adminPassword, setAdminPassword] = useState('admin123');
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

  // Delivery Auth
  const [deliveryEmail, setDeliveryEmail] = useState('delivery@market.pk');
  const [deliveryPassword, setDeliveryPassword] = useState('delivery123');
  const [currentDelivery, setCurrentDelivery] = useState<{ id: string; name: string; email: string | null } | null>(null);

  const [authError, setAuthError] = useState('');
  const [authToken, setAuthToken] = useState('');
  const authTokenRef = useRef('');

  // Backend Data
  const [wholesalers, setWholesalers] = useState<Wholesaler[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [paymentForm, setPaymentForm] = useState({ invoiceId: '', amount: '', method: 'cash', reference: '' });
  const [paymentBusy, setPaymentBusy] = useState(false);

  // Client Tabs & Cart
  const [clientTab, setClientTab] = useState<'chat' | 'catalog' | 'orders' | 'invoices'>('chat');
  const [cart, setCart] = useState<{ [productId: string]: number }>({});
  const [cartSubtotal, setCartSubtotal] = useState(0);
  const [deliveryAddress, setDeliveryAddress] = useState<string>('Babar General Store, University Road, Peshawar');
  const [checkoutModal, setCheckoutModal] = useState<boolean>(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [actionError, setActionError] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);

  // Wholesaler Tabs
  const [wholesalerTab, setWholesalerTab] = useState<'dashboard' | 'products' | 'suborders'>('dashboard');
  const [productForm, setProductForm] = useState({
    sku: '',
    name: '',
    unit: 'carton',
    packSize: '',
    costPrice: '',
    sellingPrice: '',
    moq: '1',
    reorderPoint: '10',
    stockOnHand: '0',
  });
  const [productBusy, setProductBusy] = useState(false);

  // Admin Tabs & New Wholesaler Modal
  const [adminTab, setAdminTab] = useState<'overview' | 'wholesalers' | 'applications' | 'dispatch' | 'audit' | 'all_orders'>('overview');
  const [showAddWholesalerModal, setShowAddWholesalerModal] = useState(false);
  const [newWholesalerForm, setNewWholesalerForm] = useState({ name: '', category: 'Grains & Flour', city: 'Peshawar', ownerEmail: '', phone: '', password: 'password123' });
  const [wholesalerApplications, setWholesalerApplications] = useState<
    {
      id: string;
      businessName: string;
      applicantName: string;
      email: string;
      phone: string;
      location: string;
      description: string;
      category: string;
      status: string;
      rejectReason?: string | null;
      wholesalerId?: string | null;
      createdAt: string;
      reviewedAt?: string | null;
    }[]
  >([]);
  const [applicationBusyId, setApplicationBusyId] = useState('');
  const [rejectReasonDraft, setRejectReasonDraft] = useState<Record<string, string>>({});

  // Public wholesaler application (landing)
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [applySuccess, setApplySuccess] = useState('');

  // AI Chat State
  const [chatLanguage, setChatLanguage] = useState<'en' | 'ur' | 'ps'>('ur');
  const [chatInput, setChatInput] = useState<string>('');
  const [conversationId, setConversationId] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      sender: 'ai',
      text: 'السلام علیکم! Welcome to Peshawar Wholesale. Ask in English, اردو, پښتو, or Roman Urdu — I search live stock and update your cart. Checkout still needs your explicit confirmation.',
      language: 'ur',
      timestamp: new Date().toLocaleTimeString(),
      geminiUsed: undefined,
    }
  ]);
  const [aiStatus, setAiStatus] = useState<{ geminiConfigured?: boolean; mode?: string } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Voice assistant state
  const [voiceState, setVoiceState] = useState<VoiceUiState>('idle');
  const [voiceError, setVoiceError] = useState('');
  const [recordingMs, setRecordingMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptId, setTranscriptId] = useState('');
  const [transcriptLanguage, setTranscriptLanguage] = useState<'en' | 'ur' | 'ps' | 'mixed'>('en');
  const [voiceBusyNote, setVoiceBusyNote] = useState('');
  const [transcriptionSucceeded, setTranscriptionSucceeded] = useState(false);
  const [voiceReviewMode, setVoiceReviewMode] = useState(false);
  const [playingMsgIdx, setPlayingMsgIdx] = useState<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef(0);
  const recordTimerRef = useRef<number | null>(null);
  const recordLimitRef = useRef<number | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRecordingRef = useRef(false);
  const voiceReviewModeRef = useRef(false);
  const conversationIdRef = useRef('');
  const chatLanguageRef = useRef(chatLanguage);
  const voiceSupported = typeof window !== 'undefined' && isMediaRecordingSupported();
  const secureContext =
    typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

  useEffect(() => {
    voiceReviewModeRef.current = voiceReviewMode;
  }, [voiceReviewMode]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    chatLanguageRef.current = chatLanguage;
  }, [chatLanguage]);

  const AUTH_SESSION_KEY = 'pgsw_auth_session_v1';

  const storeAuthToken = (token?: string, meta?: { role?: string; portal?: string }) => {
    const value = token || '';
    authTokenRef.current = value;
    setAuthToken(value);
    try {
      if (!value) {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
      } else {
        sessionStorage.setItem(
          AUTH_SESSION_KEY,
          JSON.stringify({ token: value, role: meta?.role || '', portal: meta?.portal || '', savedAt: Date.now() })
        );
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
  };

  const authHeaders = (json = true): HeadersInit => {
    const headers: Record<string, string> = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (authTokenRef.current) headers.Authorization = `Bearer ${authTokenRef.current}`;
    return headers;
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const resetToken = params.get('resetToken');
      if (resetToken) {
        setResetPasswordForm((f) => ({ ...f, token: resetToken }));
        setNavState('password_reset');
        window.history.replaceState({}, '', window.location.pathname);
      }
      const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.token || Date.now() - Number(parsed.savedAt || 0) > 12 * 60 * 60 * 1000) {
        sessionStorage.removeItem(AUTH_SESSION_KEY);
        return;
      }
      authTokenRef.current = parsed.token;
      setAuthToken(parsed.token);
    } catch {
      /* ignore */
    }
  }, []);

  const handleLogout = () => {
    storeAuthToken('');
    setCurrentClient(null);
    setCurrentWholesaler(null);
    setCurrentDelivery(null);
    setIsAdminLoggedIn(false);
    setAuthInfo('');
    setCart({});
    setCartSubtotal(0);
    setCheckoutError('');
    setActionError('');
    setSelectedInvoice(null);
    setConversationId('');
    setChatError('');
    setChatHistory([
      {
        sender: 'ai',
        text: 'السلام علیکم! Welcome to Peshawar General Store & Drinks Wholesale Hub. Ask in English, اردو, پښتو, or Roman Urdu — I search live stock and update your cart (orders still need your checkout confirmation).',
        language: 'ur',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    setNavState('gateway');
  };

  const applyCartPayload = (cartPayload: any) => {
    if (!cartPayload) {
      setCart({});
      setCartSubtotal(0);
      return;
    }
    const next: { [productId: string]: number } = {};
    for (const item of cartPayload.items || []) {
      next[item.productId] = item.quantity;
    }
    setCart(next);
    setCartSubtotal(Number(cartPayload.subtotal || 0));
  };

  const fetchData = async () => {
    try {
      const res = await safeFetch('/api/market/data', {
        headers: authHeaders(false),
        retry: 1,
        timeoutMs: 20_000,
      });
      const data = await res.json();
      setWholesalers(data.wholesalers || []);
      setProducts(data.products || []);
      setOrders(data.orders || []);
      setShipments(data.shipments || []);
      setInvoices(data.invoices || []);
      setPayments(data.payments || []);
      setAuditEvents(data.auditEvents || []);
      applyCartPayload(data.cart);
      setBootFailed(false);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch data', err);
      setBootFailed(true);
      setActionError(friendlyNetworkMessage(err, 'Unable to load live market data.'));
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const onReconnect = () => {
      void fetchData();
    };
    window.addEventListener('wholesale:reconnected', onReconnect);
    return () => window.removeEventListener('wholesale:reconnected', onReconnect);
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const fetchAiStatus = async (token?: string) => {
    try {
      const res = await fetch('/api/ai/status', {
        headers: { Authorization: `Bearer ${token || authTokenRef.current}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setAiStatus({ geminiConfigured: data.geminiConfigured, mode: data.mode });
    } catch {
      // ignore — chat still works
    }
  };

  const reorderLastOrder = async () => {
    const last = lastOrderLines(orders as any);
    if (!last?.lines.length) {
      setActionError('No previous order lines to reorder yet.');
      return;
    }
    setCartBusy(true);
    setActionError('');
    try {
      for (const line of last.lines) {
        const product = products.find((p) => p.id === line.productId);
        const qty = Math.max(line.quantity, product?.moq || 1);
        const res = await fetch('/api/cart/items', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ productId: line.productId, quantity: qty }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Could not add ${line.name}`);
        applyCartPayload(data.cart);
      }
      await fetchData();
      setCheckoutModal(true);
    } catch (err: any) {
      setActionError(err?.message || 'Reorder failed.');
    } finally {
      setCartBusy(false);
    }
  };

  // Auth Handlers
  const handleClientSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    if (!clientSignupForm.name || !clientSignupForm.storeName || !clientSignupForm.phone || !clientSignupForm.password) {
      setAuthError('Name, store, phone, and password (min 8 characters) are required.');
      return;
    }
    if (clientSignupForm.password.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    try {
      const res = await fetch('/api/auth/client/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientSignupForm)
      });
      const data = await res.json();
      if (data.success) {
        storeAuthToken(data.token, { role: 'client', portal: 'client_portal' });
        setCurrentClient(data.client);
        setNavState('client_portal');
        fetchData();
        fetchAiStatus(data.token);
        loadConversationHistory(data.token);
      } else {
        setAuthError(data.error || 'Signup failed.');
      }
    } catch (err) {
      setAuthError('Network error.');
    }
  };

  const handleClientSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    if (!clientSigninPhone || !clientSigninPassword) {
      setAuthError('Enter your phone number and password.');
      return;
    }
    try {
      const res = await fetch('/api/auth/client/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clientSigninPhone, password: clientSigninPassword })
      });
      const data = await res.json();
      if (data.success) {
        storeAuthToken(data.token, { role: 'client', portal: 'client_portal' });
        setCurrentClient(data.client);
        setNavState('client_portal');
        fetchData();
        fetchAiStatus(data.token);
        loadConversationHistory(data.token);
      } else {
        setAuthError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setAuthError('Sign in failed.');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    try {
      const res = await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotIdentity.email || undefined,
          phone: forgotIdentity.phone || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Unable to process request.');
        return;
      }
      setAuthInfo(data.message || 'If an account exists, a reset link has been queued.');
    } catch {
      setAuthError('Network error.');
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    if (resetPasswordForm.newPassword.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirm) {
      setAuthError('Passwords do not match.');
      return;
    }
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetPasswordForm.token, newPassword: resetPasswordForm.newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Unable to reset password.');
        return;
      }
      setAuthInfo('Password updated. You can sign in now.');
      setNavState('client_auth');
      setClientAuthMode('signin');
    } catch {
      setAuthError('Network error.');
    }
  };

  const handleWholesalerSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/wholesaler/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: wholesalerEmail, password: wholesalerPassword })
      });
      const data = await res.json();
      if (data.success) {
        storeAuthToken(data.token, { role: 'wholesaler', portal: 'wholesaler_portal' });
        setCurrentWholesaler(data.wholesaler);
        setNavState('wholesaler_portal');
        fetchData();
      } else {
        setAuthError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setAuthError('Invalid credentials.');
    }
  };

  const handleAdminSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/admin/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        storeAuthToken(data.token, { role: 'admin', portal: 'admin_portal' });
        setIsAdminLoggedIn(true);
        setNavState('admin_portal');
        fetchData();
        fetchWholesalerApplications();
      } else {
        setAuthError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setAuthError('Invalid credentials.');
    }
  };

  const handleDeliverySignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/delivery/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: deliveryEmail, password: deliveryPassword }),
      });
      const data = await res.json();
      if (data.success) {
        storeAuthToken(data.token, { role: 'delivery', portal: 'delivery_portal' });
        setCurrentDelivery(data.delivery);
        setNavState('delivery_portal');
        fetchData();
      } else {
        setAuthError(data.error || 'Invalid credentials.');
      }
    } catch {
      setAuthError('Invalid credentials.');
    }
  };

  // Cart operations (server-backed; prices/totals never trusted from client math for checkout)
  const addToCart = async (productId: string, qty: number = 1) => {
    setCartBusy(true);
    setActionError('');
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ productId, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not add item to cart.');
        return;
      }
      applyCartPayload(data.cart);
    } catch {
      setActionError('Network error while updating cart.');
    } finally {
      setCartBusy(false);
    }
  };

  const updateCartQty = async (productId: string, qty: number) => {
    setCartBusy(true);
    setCheckoutError('');
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ productId, quantity: qty, mode: 'set' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCheckoutError(data.error || 'Could not update cart quantity.');
        return;
      }
      applyCartPayload(data.cart);
    } catch {
      setCheckoutError('Network error while updating cart.');
    } finally {
      setCartBusy(false);
    }
  };

  const totalCartItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const submitOrder = async () => {
    if (totalCartItemsCount === 0 || orderBusy) return;
    setOrderBusy(true);
    setCheckoutError('');
    const idempotencyKey = `CHK-${currentClient?.id || 'client'}-${Date.now()}`;
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          deliveryAddress,
          confirmed: true,
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCheckoutError(data.error || 'Order submission failed.');
        return;
      }
      setCart({});
      setCartSubtotal(0);
      setCheckoutModal(false);
      await fetchData();
      alert(`Order ${data.order.id} submitted successfully!`);
    } catch {
      setCheckoutError('Network error while placing order.');
    } finally {
      setOrderBusy(false);
    }
  };

  const loadConversationHistory = async (tokenOverride?: string) => {
    const headers: HeadersInit = {};
    const token = tokenOverride || authTokenRef.current;
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const listRes = await fetch('/api/ai/conversations', { headers });
      if (!listRes.ok) return;
      const listData = await listRes.json();
      const latest = listData.conversations?.[0];
      if (!latest) return;
      setConversationId(latest.id);
      const msgRes = await fetch(`/api/ai/conversations/${latest.id}/messages`, { headers });
      if (!msgRes.ok) return;
      const msgData = await msgRes.json();
      if (!msgData.messages?.length) return;
      setChatHistory(
        msgData.messages.map((m: any) => ({
          sender: m.role === 'user' ? 'user' : 'ai',
          text: m.content,
          language: m.language,
          needsConfirmation: Boolean(m.metadata?.needsConfirmation),
          timestamp: m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : new Date().toLocaleTimeString(),
        }))
      );
    } catch {
      // keep welcome message
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const query = (overrideText ?? chatInput).trim();
    if (!query || isAiLoading) return;
    if (!authTokenRef.current || !currentClient) {
      setChatError('Sign in as a shopkeeper to use the AI assistant.');
      return;
    }

    const userMsg: ChatMessage = { sender: 'user', text: query, timestamp: new Date().toLocaleTimeString() };
    setChatHistory((prev) => [...prev, userMsg]);
    setChatInput('');
    setChatError('');
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: query, language: chatLanguage, conversationId: conversationId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatHistory((prev) => [
          ...prev,
          {
            sender: 'ai',
            text: data.error || 'AI request failed. Tap retry or try again.',
            error: true,
            retryText: query,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        setChatError(data.error || 'AI request failed.');
        return;
      }

      if (data.conversationId) setConversationId(data.conversationId);
      if (data.cart) applyCartPayload(data.cart);
      if (data.action?.type === 'refresh_cart' || data.cart) await fetchData();
      if (data.needsConfirmation || data.action?.type === 'open_checkout') {
        setCheckoutModal(true);
      }

      const cartPreview =
        data.cart && data.cart.itemCount > 0
          ? {
              itemCount: data.cart.itemCount,
              subtotal: Number(data.cart.subtotal || 0),
              lines: (data.cart.items || []).map((i: any) => ({
                name: i.product?.name || i.productId,
                quantity: i.quantity,
                lineTotal: Number(i.lineTotal || 0),
              })),
            }
          : undefined;

      setChatHistory((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: data.reply,
          language: data.detectedLanguage,
          products: data.suggestedProducts,
          cartPreview,
          needsConfirmation: Boolean(data.needsConfirmation),
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } catch {
      setChatHistory((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: 'Sorry, the assistant is temporarily unavailable. Your catalog and cart still work — retry this message when ready.',
          error: true,
          retryText: query,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setChatError('Network error talking to the AI assistant.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const clearRecordingTimers = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recordLimitRef.current) {
      window.clearTimeout(recordLimitRef.current);
      recordLimitRef.current = null;
    }
  };

  const stopMediaTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  const resetVoiceSession = (keepError = false) => {
    clearRecordingTimers();
    stopMediaTracks();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    audioBlobRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordingMs(0);
    setVoiceState('idle');
    setTranscriptDraft('');
    setTranscriptId('');
    setVoiceBusyNote('');
    setTranscriptionSucceeded(false);
    if (!keepError) setVoiceError('');
    cancelRecordingRef.current = false;
  };

  const appendAssistantFromApi = async (data: any, userText: string, userLang?: string) => {
    setChatHistory((prev) => [
      ...prev,
      { sender: 'user', text: userText, timestamp: new Date().toLocaleTimeString(), language: userLang },
    ]);
    if (data.conversationId) setConversationId(data.conversationId);
    if (data.cart) applyCartPayload(data.cart);
    if (data.action?.type === 'refresh_cart' || data.cart) await fetchData();
    if (data.needsConfirmation || data.action?.type === 'open_checkout') setCheckoutModal(true);

    const cartPreview =
      data.cart && data.cart.itemCount > 0
        ? {
            itemCount: data.cart.itemCount,
            subtotal: Number(data.cart.subtotal || 0),
            lines: (data.cart.items || []).map((i: any) => ({
              name: i.product?.name || i.productId,
              quantity: i.quantity,
              lineTotal: Number(i.lineTotal || 0),
            })),
          }
        : undefined;

    setChatHistory((prev) => [
      ...prev,
      {
        sender: 'ai',
        text: data.reply,
        language: data.detectedLanguage,
        products: data.suggestedProducts,
        cartPreview,
        needsConfirmation: Boolean(data.needsConfirmation),
        audioPlayable: true,
        geminiUsed: Boolean(data.geminiUsed),
        fallbackReason: data.fallbackReason,
        ttsNote: data.fallbackReason || (data.geminiUsed ? undefined : 'Deterministic agents (Gemini unavailable).'),
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const processAutoVoice = async (blob: Blob, durationMs: number) => {
    setVoiceError('');
    setVoiceState('transcribing');
    setVoiceBusyNote('Uploading & transcribing…');
    setIsAiLoading(true);
    try {
      if (blob.size < 256) {
        setVoiceError('Recording was empty. Hold the mic longer, then stop — or type your request.');
        setVoiceState('idle');
        return;
      }
      const form = new FormData();
      const mime = blob.type || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append('durationMs', String(durationMs));
      form.append('language', chatLanguageRef.current);
      if (conversationIdRef.current) form.append('conversationId', conversationIdRef.current);
      form.append('submissionKey', `AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`);

      const res = await fetch('/api/ai/voice/auto', {
        method: 'POST',
        headers: authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setVoiceError(data.error || 'Voice upload failed.');
        setVoiceState('idle');
        return;
      }

      if (data.autoSent && data.reply) {
        await appendAssistantFromApi(data, data.userText || data.transcript, data.detectedLanguage);
        resetVoiceSession();
        return;
      }

      // Failed STT / empty / quota — manual fallback (never fabricate text)
      if (data.conversationId) setConversationId(data.conversationId);
      setTranscriptId(data.transcriptId || '');
      setTranscriptDraft('');
      setTranscriptionSucceeded(false);
      setTranscriptLanguage(data.detectedLanguage || chatLanguageRef.current);
      setVoiceError(
        data.error ||
          (data.errorCode === 'quota'
            ? 'Gemini quota reached (429). Type what you said below, or use text chat. Ordering still works.'
            : 'Could not transcribe that recording. Type what you said below — nothing was auto-sent.')
      );
      setVoiceState('review');
    } catch {
      setVoiceError('Network error during voice upload. Type your request instead.');
      setVoiceState('idle');
    } finally {
      setIsAiLoading(false);
      setVoiceBusyNote('');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError('');
    if (!authTokenRef.current || !currentClient) {
      setVoiceError('Sign in as a shopkeeper to use voice.');
      return;
    }
    if (!secureContext) {
      setVoiceError('Microphone requires localhost or HTTPS (secure context).');
      return;
    }
    if (!voiceSupported) {
      setVoiceError('This browser does not support microphone recording. Use Chrome/Edge/Safari or type instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      cancelRecordingRef.current = false;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onerror = () => {
        setVoiceError('Recording failed. Please try again or type your request.');
        resetVoiceSession(true);
      };
      recorder.onstop = () => {
        clearRecordingTimers();
        stopMediaTracks();
        const elapsed = Date.now() - recordStartedAtRef.current;
        if (cancelRecordingRef.current) {
          resetVoiceSession();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        audioBlobRef.current = blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecordingMs(elapsed);

        if (blob.size < 256) {
          setVoiceError('Recording produced no audio data. Check the mic and try again, or type instead.');
          setVoiceState('idle');
          return;
        }

        if (voiceReviewModeRef.current) {
          setVoiceState('preview');
          return;
        }
        // WhatsApp-style: auto upload → STT → AI
        void processAutoVoice(blob, elapsed);
      };

      // timeslice keeps chunks flowing so stop() is less likely to yield 0 bytes
      recorder.start(200);
      recordStartedAtRef.current = Date.now();
      setRecordingMs(0);
      setVoiceState('recording');
      recordTimerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - recordStartedAtRef.current);
      }, 200);
      recordLimitRef.current = window.setTimeout(() => {
        stopVoiceRecording();
      }, MAX_CLIENT_RECORD_MS);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setVoiceError('Microphone permission denied. Allow mic access or type your order instead.');
      } else if (name === 'NotFoundError') {
        setVoiceError('No microphone found on this device.');
      } else {
        setVoiceError('Could not start recording. Try again or use text chat.');
      }
      resetVoiceSession(true);
    }
  };

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      // Flush final chunk before stop (browser-dependent but helps nonempty blobs)
      if (typeof recorder.requestData === 'function') recorder.requestData();
    } catch {
      // ignore
    }
    recorder.stop();
  };

  const cancelVoiceRecording = () => {
    cancelRecordingRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') {
      try {
        if (typeof mediaRecorderRef.current.requestData === 'function') mediaRecorderRef.current.requestData();
      } catch {
        // ignore
      }
      mediaRecorderRef.current.stop();
    } else {
      resetVoiceSession();
    }
  };

  /** Review mode: upload → STT only → editable transcript → user Send (no auto AI). */
  const uploadAndTranscribeForReview = async () => {
    const blob = audioBlobRef.current;
    if (!blob) return;
    setVoiceError('');
    setVoiceState('transcribing');
    setVoiceBusyNote('Transcribing for review…');
    setIsAiLoading(true);
    try {
      if (blob.size < 256) {
        setVoiceError('Recording was empty. Re-record or type your request.');
        setVoiceState('idle');
        return;
      }
      const form = new FormData();
      const mime = blob.type || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append('durationMs', String(recordingMs || Date.now() - recordStartedAtRef.current));
      form.append('language', chatLanguageRef.current);
      if (conversationIdRef.current) form.append('conversationId', conversationIdRef.current);

      const res = await fetch('/api/ai/voice/transcribe', {
        method: 'POST',
        headers: authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setVoiceError(data.error || 'Transcription upload failed.');
        setVoiceState('preview');
        return;
      }
      if (data.conversationId) setConversationId(data.conversationId);
      setTranscriptId(data.transcriptId || '');
      setTranscriptionSucceeded(Boolean(data.transcriptionSucceeded));
      setTranscriptLanguage(data.detectedLanguage || chatLanguageRef.current);
      setTranscriptDraft(data.transcriptionSucceeded ? String(data.transcript || '') : '');
      if (!data.transcriptionSucceeded) {
        setVoiceError(
          data.error ||
            (data.errorCode === 'quota'
              ? 'Gemini quota reached (429). Type what you said below, or use text chat.'
              : 'Could not transcribe. Type what you said below — nothing was auto-sent.')
        );
      } else {
        setVoiceError('');
      }
      setVoiceState('review');
    } catch {
      setVoiceError('Network error during transcription. Type your request instead.');
      setVoiceState('idle');
    } finally {
      setIsAiLoading(false);
      setVoiceBusyNote('');
    }
  };

  const submitReviewedVoice = async () => {
    const edited = transcriptDraft.trim();
    if (!edited || !transcriptId || voiceState === 'submitting') return;
    setVoiceState('submitting');
    setVoiceBusyNote('Sending to assistant…');
    setIsAiLoading(true);
    const submissionKey = `VOICE-${transcriptId}-${Date.now()}`;
    try {
      const res = await fetch('/api/ai/voice/submit', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          transcriptId,
          editedTranscript: edited,
          conversationId: conversationId || undefined,
          language: transcriptLanguage || chatLanguage,
          submissionKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVoiceError(data.error || 'Could not submit transcript.');
        setVoiceState('review');
        return;
      }
      if (data.duplicate) {
        setVoiceError('This recording was already submitted. Record a new message if needed.');
        resetVoiceSession(true);
        return;
      }
      await appendAssistantFromApi(data, edited, transcriptLanguage);
      resetVoiceSession();
    } catch {
      setVoiceError('Network error submitting transcript.');
      setVoiceState('review');
    } finally {
      setIsAiLoading(false);
      setVoiceBusyNote('');
    }
  };

  const playAssistantTts = async (msg: ChatMessage, idx: number) => {
    if (msg.sender !== 'ai' || !msg.text) return;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      if (playingMsgIdx === idx) {
        setPlayingMsgIdx(null);
        return;
      }
    }
    try {
      const res = await fetch('/api/ai/voice/tts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          text: msg.text,
          language: msg.language || chatLanguage,
          conversationId: conversationId || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok || !data.audioBase64) {
        setChatHistory((prev) =>
          prev.map((m, i) =>
            i === idx
              ? {
                  ...m,
                  ttsNote:
                    data.fallbackReason ||
                    'Voice playback unavailable for this language. Read the text reply instead.',
                }
              : m
          )
        );
        return;
      }
      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      ttsAudioRef.current = audio;
      setPlayingMsgIdx(idx);
      if (data.fallbackReason || data.nativeLanguageReliable === false) {
        setChatHistory((prev) =>
          prev.map((m, i) => (i === idx ? { ...m, ttsNote: data.fallbackReason || 'Playback may not match native pronunciation.' } : m))
        );
      }
      audio.onended = () => setPlayingMsgIdx(null);
      await audio.play();
    } catch {
      setChatHistory((prev) =>
        prev.map((m, i) => (i === idx ? { ...m, ttsNote: 'Could not play voice. Text reply still works.' } : m))
      );
    }
  };

  const reviewSubOrder = async (subOrderId: string, action: 'Approved' | 'Rejected') => {
    setActionError('');
    try {
      const res = await fetch(`/api/suborders/${subOrderId}/review`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ action, rejectReason: action === 'Rejected' ? 'Stock temporarily limited' : undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not review suborder.');
        return;
      }
      await fetchData();
    } catch {
      setActionError('Network error while reviewing suborder.');
    }
  };

  const createWholesalerProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductBusy(true);
    setActionError('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sku: productForm.sku,
          name: productForm.name,
          unit: productForm.unit,
          packSize: productForm.packSize,
          costPrice: Number(productForm.costPrice),
          sellingPrice: Number(productForm.sellingPrice),
          moq: Number(productForm.moq),
          reorderPoint: Number(productForm.reorderPoint),
          stockOnHand: Number(productForm.stockOnHand),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not create product.');
        return;
      }
      setProductForm({
        sku: '',
        name: '',
        unit: 'carton',
        packSize: '',
        costPrice: '',
        sellingPrice: '',
        moq: '1',
        reorderPoint: '10',
        stockOnHand: '0',
      });
      await fetchData();
    } catch {
      setActionError('Network error while creating product.');
    } finally {
      setProductBusy(false);
    }
  };

  const deactivateWholesalerProduct = async (productId: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/products/${productId}/deactivate`, {
        method: 'POST',
        headers: authHeaders(false),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not deactivate product.');
        return;
      }
      await fetchData();
    } catch {
      setActionError('Network error while deactivating product.');
    }
  };

  const assignShipment = async (shipmentId: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/assign`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ assigneeId: 'DRV-01', assigneeName: 'Gul Khan Logistics' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not assign shipment.');
        return;
      }
      await fetchData();
    } catch {
      setActionError('Network error while assigning shipment.');
    }
  };

  const updateShipmentStatus = async (shipmentId: string, status: string, extra: Record<string, string> = {}) => {
    setActionError('');
    try {
      const idempotencyKey = `SHP-${shipmentId}-${status}-${Date.now()}`;
      const res = await fetch(`/api/shipments/${shipmentId}/status`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ status, idempotencyKey, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Could not update delivery status.');
        return;
      }
      await fetchData();
    } catch {
      setActionError('Network error while updating delivery.');
    }
  };

  const recordInvoicePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.invoiceId || !paymentForm.amount) return;
    setPaymentBusy(true);
    setActionError('');
    try {
      const idempotencyKey = `PAY-${paymentForm.invoiceId}-${paymentForm.amount}-${Date.now()}`;
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { ...authHeaders(), 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          invoiceId: paymentForm.invoiceId,
          amount: paymentForm.amount,
          method: paymentForm.method,
          reference: paymentForm.reference,
          idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Payment recording failed.');
        return;
      }
      setPaymentForm({ invoiceId: '', amount: '', method: 'cash', reference: '' });
      await fetchData();
    } catch {
      setActionError('Network error while recording payment.');
    } finally {
      setPaymentBusy(false);
    }
  };

  const toggleWholesalerStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await fetch(`/api/wholesalers/${id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus })
      });
      fetchData();
    } catch (err) {
      console.error('Status error', err);
    }
  };

  const deleteWholesaler = async (id: string) => {
    if (!confirm('Are you sure you want to remove/delete this wholesaler tenant?')) return;
    try {
      await fetch(`/api/wholesalers/${id}`, { method: 'DELETE', headers: authHeaders(false) });
      fetchData();
    } catch (err) {
      console.error('Delete error', err);
    }
  };

  const handleAddWholesaler = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/wholesalers', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(newWholesalerForm)
      });
      const data = await res.json();
      if (data.success) {
        setShowAddWholesalerModal(false);
        setNewWholesalerForm({ name: '', category: 'Grains & Flour', city: 'Peshawar', ownerEmail: '', phone: '', password: 'password123' });
        fetchData();
      }
    } catch (err) {
      console.error('Add wholesaler error', err);
    }
  };

  const fetchWholesalerApplications = async () => {
    try {
      const res = await fetch('/api/wholesaler-applications', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setWholesalerApplications(data.applications || []);
    } catch (err) {
      console.error('Applications fetch error', err);
    }
  };

  const handleLandingAction = (action: LandingAction) => {
    setApplyError('');
    if (action === 'apply') {
      setApplyOpen(true);
      setApplySuccess('');
      return;
    }
    if (action === 'shopkeeper_signin') {
      setClientAuthMode('signin');
      setNavState('client_auth');
      return;
    }
    if (action === 'shopkeeper_signup') {
      setClientAuthMode('signup');
      setNavState('client_auth');
      return;
    }
    if (action === 'wholesaler_signin') {
      setNavState('wholesaler_auth');
      return;
    }
    if (action === 'delivery_signin') {
      setNavState('delivery_auth');
      return;
    }
    if (action === 'admin_signin') {
      setNavState('admin_auth');
    }
  };

  const handleSubmitWholesalerApplication = async (form: ApplyForm) => {
    setApplyBusy(true);
    setApplyError('');
    setApplySuccess('');
    try {
      const res = await fetch('/api/wholesaler-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setApplyError(data.error || 'Unable to submit application.');
        return;
      }
      setApplySuccess(data.message || 'Application submitted. We will email you after review.');
    } catch {
      setApplyError('Network error. Please try again.');
    } finally {
      setApplyBusy(false);
    }
  };

  const approveApplication = async (id: string) => {
    setApplicationBusyId(id);
    setActionError('');
    try {
      const res = await fetch(`/api/wholesaler-applications/${id}/approve`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Approval failed.');
        return;
      }
      await Promise.all([fetchWholesalerApplications(), fetchData()]);
    } catch {
      setActionError('Approval failed.');
    } finally {
      setApplicationBusyId('');
    }
  };

  const rejectApplication = async (id: string) => {
    setApplicationBusyId(id);
    setActionError('');
    try {
      const res = await fetch(`/api/wholesaler-applications/${id}/reject`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reason: rejectReasonDraft[id] || '' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || 'Rejection failed.');
        return;
      }
      await fetchWholesalerApplications();
    } catch {
      setActionError('Rejection failed.');
    } finally {
      setApplicationBusyId('');
    }
  };

  if (loading) {
    return <BrandLoader title="Loading wholesale platform…" subtitle="Preparing secure portals and live catalog" />;
  }

  if (!connectivity.browserOnline && navState !== 'gateway') {
    return (
      <OfflineScreen
        reason="offline"
        onRetry={() => void connectivity.refreshConnectivity()}
        onHome={() => setNavState('gateway')}
      />
    );
  }

  if (bootFailed && connectivity.backendReachable === false && navState !== 'gateway') {
    return (
      <OfflineScreen
        reason="backend"
        onRetry={() => {
          void connectivity.refreshConnectivity();
          setLoading(true);
          void fetchData();
        }}
        onHome={() => setNavState('gateway')}
      />
    );
  }

  // ================= 1. GATEWAY HOMEPAGE =================
  if (navState === 'gateway') {
    return (
      <ContentReveal>
        <LandingPage
          onAction={handleLandingAction}
          applyOpen={applyOpen}
          onCloseApply={() => {
            setApplyOpen(false);
            setApplyError('');
          }}
          onSubmitApply={handleSubmitWholesalerApplication}
          applyBusy={applyBusy}
          applyError={applyError}
          applySuccess={applySuccess}
        />
      </ContentReveal>
    );
  }

  // ================= 2. CLIENT AUTH =================
  if (navState === 'password_forgot') {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title="Forgot password"
        subtitle="Enter the email or phone on your account. If we find a match with a notification email, a single-use reset link is queued."
        error={authError}
        onBack={() => setNavState('client_auth')}
        footer={<p className="text-[11px] text-muted text-center">Demo shopkeeper email: babar@market.pk</p>}
      >
        {authInfo && <div className="alert alert-info text-xs">{authInfo}</div>}
        <form onSubmit={handleForgotPassword} className="space-y-3.5">
          <div>
            <label className="field-label">Email</label>
            <input type="email" value={forgotIdentity.email} onChange={(e) => setForgotIdentity({ ...forgotIdentity, email: e.target.value })} className="field" placeholder="you@store.pk" />
          </div>
          <div>
            <label className="field-label">Or phone</label>
            <input type="text" value={forgotIdentity.phone} onChange={(e) => setForgotIdentity({ ...forgotIdentity, phone: e.target.value })} className="field" placeholder="03009876543" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg w-full">Send reset link</button>
        </form>
      </AuthLayout>
    );
  }

  if (navState === 'password_reset') {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title="Choose a new password"
        subtitle="Paste your reset token if needed, then set a password of at least 8 characters."
        error={authError}
        onBack={() => setNavState('client_auth')}
      >
        {authInfo && <div className="alert alert-info text-xs">{authInfo}</div>}
        <form onSubmit={handlePasswordResetSubmit} className="space-y-3.5">
          <div>
            <label className="field-label">Reset token</label>
            <input required value={resetPasswordForm.token} onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, token: e.target.value })} className="field font-mono text-xs" />
          </div>
          <div>
            <label className="field-label">New password</label>
            <input type="password" required minLength={8} value={resetPasswordForm.newPassword} onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value })} className="field" />
          </div>
          <div>
            <label className="field-label">Confirm password</label>
            <input type="password" required minLength={8} value={resetPasswordForm.confirm} onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, confirm: e.target.value })} className="field" />
          </div>
          <button type="submit" className="btn btn-accent btn-lg w-full">Update password</button>
        </form>
      </AuthLayout>
    );
  }

  if (navState === 'client_auth') {
    return (
      <AuthLayout
        icon={Store}
        title={clientAuthMode === 'signin' ? 'Shopkeeper sign in' : 'Register your store'}
        subtitle={clientAuthMode === 'signin' ? 'Phone + password. Checkout and AI stay behind your account.' : 'Create a store account with a password. Email is optional but required for password reset emails.'}
        error={authError}
        onBack={() => setNavState('gateway')}
        footer={
          <div className="space-y-3 text-center">
            <p className="text-[11px] text-muted">Demo: 03009876543 / password123 · babar@market.pk</p>
            {clientAuthMode === 'signin' && (
              <button type="button" onClick={() => { setNavState('password_forgot'); setAuthError(''); setAuthInfo(''); }} className="text-xs font-semibold text-accent hover:underline block w-full">
                Forgot password?
              </button>
            )}
            <button type="button" onClick={() => { setClientAuthMode(clientAuthMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }} className="text-xs font-semibold text-accent hover:underline">
              {clientAuthMode === 'signin' ? "Don't have an account? Sign up" : 'Already registered? Sign in'}
            </button>
          </div>
        }
      >
        {authInfo && <div className="alert alert-info text-xs">{authInfo}</div>}
        {clientAuthMode === 'signup' ? (
          <form onSubmit={handleClientSignup} className="space-y-3.5">
            <div>
              <label className="field-label">Full name</label>
              <input type="text" required value={clientSignupForm.name} onChange={e => setClientSignupForm({ ...clientSignupForm, name: e.target.value })} placeholder="e.g. Babar Khan" className="field" autoComplete="name" />
            </div>
            <div>
              <label className="field-label">Store name</label>
              <input type="text" required value={clientSignupForm.storeName} onChange={e => setClientSignupForm({ ...clientSignupForm, storeName: e.target.value })} placeholder="e.g. Babar General Store" className="field" />
            </div>
            <div>
              <label className="field-label">Phone number</label>
              <input type="text" required value={clientSignupForm.phone} onChange={e => setClientSignupForm({ ...clientSignupForm, phone: e.target.value })} placeholder="e.g. 03009876543" className="field" autoComplete="tel" />
            </div>
            <div>
              <label className="field-label">Email <span className="text-muted font-normal">(for notifications)</span></label>
              <input type="email" value={clientSignupForm.email} onChange={e => setClientSignupForm({ ...clientSignupForm, email: e.target.value })} placeholder="optional@store.pk" className="field" autoComplete="email" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input type="password" required minLength={8} value={clientSignupForm.password} onChange={e => setClientSignupForm({ ...clientSignupForm, password: e.target.value })} className="field" autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full">Create account</button>
          </form>
        ) : (
          <form onSubmit={handleClientSignin} className="space-y-3.5">
            <div>
              <label className="field-label">Phone number</label>
              <input type="text" required value={clientSigninPhone} onChange={e => setClientSigninPhone(e.target.value)} placeholder="e.g. 03009876543" className="field" autoComplete="username" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input type="password" required value={clientSigninPassword} onChange={e => setClientSigninPassword(e.target.value)} className="field" autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full">Enter shopkeeper portal</button>
          </form>
        )}
      </AuthLayout>
    );
  }

  // ================= 3. WHOLESALER AUTH =================
  if (navState === 'wholesaler_auth') {
    return (
      <AuthLayout
        icon={Package}
        title="Wholesaler sign in"
        subtitle="Tenant email and password for your isolated catalog."
        error={authError}
        onBack={() => setNavState('gateway')}
        footer={
          <div className="space-y-2 text-center">
            <p className="text-[11px] text-muted">Demo: wholesaler1@market.pk / password123</p>
            <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => { setForgotIdentity({ email: wholesalerEmail, phone: '' }); setNavState('password_forgot'); }}>Forgot password?</button>
          </div>
        }
      >
        <form onSubmit={handleWholesalerSignin} className="space-y-3.5">
          <div>
            <label className="field-label">Email</label>
            <input type="email" required value={wholesalerEmail} onChange={e => setWholesalerEmail(e.target.value)} className="field" autoComplete="username" />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input type="password" required value={wholesalerPassword} onChange={e => setWholesalerPassword(e.target.value)} className="field" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg w-full">Enter tenant portal</button>
        </form>
      </AuthLayout>
    );
  }

  // ================= 4. ADMIN AUTH =================
  if (navState === 'admin_auth') {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title="Admin sign in"
        subtitle="Platform governance credentials."
        error={authError}
        onBack={() => setNavState('gateway')}
        footer={
          <div className="space-y-2 text-center">
            <p className="text-[11px] text-muted">Demo: admin@market.pk / admin123</p>
            <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => { setForgotIdentity({ email: adminEmail, phone: '' }); setNavState('password_forgot'); }}>Forgot password?</button>
          </div>
        }
      >
        <form onSubmit={handleAdminSignin} className="space-y-3.5">
          <div>
            <label className="field-label">Admin email</label>
            <input type="email" required value={adminEmail} onChange={e => setAdminEmail(e.target.value)} className="field" autoComplete="username" />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input type="password" required value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="field" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg w-full">Enter control hub</button>
        </form>
      </AuthLayout>
    );
  }

  // ================= 4b. DELIVERY AUTH =================
  if (navState === 'delivery_auth') {
    return (
      <AuthLayout
        icon={Truck}
        title="Delivery sign in"
        subtitle="Assigned courier credentials only."
        error={authError}
        onBack={() => setNavState('gateway')}
        footer={<p className="text-[11px] text-muted text-center">Demo: delivery@market.pk / delivery123</p>}
      >
        <form onSubmit={handleDeliverySignin} className="space-y-3.5">
          <div>
            <label className="field-label">Delivery email</label>
            <input type="email" required value={deliveryEmail} onChange={e => setDeliveryEmail(e.target.value)} className="field" />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input type="password" required value={deliveryPassword} onChange={e => setDeliveryPassword(e.target.value)} className="field" />
          </div>
          <button type="submit" className="btn btn-primary btn-lg w-full">Open delivery runs</button>
        </form>
      </AuthLayout>
    );
  }

  // ================= 4c. DELIVERY PORTAL =================
  if (navState === 'delivery_portal') {
    const pipeline = ['Assigned', 'Dispatched', 'InTransit', 'Delivered'] as const;
    const nextAction = (status: string) => {
      if (status === 'Assigned') return { status: 'Dispatched', label: 'Mark dispatched' };
      if (status === 'Dispatched') return { status: 'InTransit', label: 'Mark in transit' };
      if (status === 'InTransit') return { status: 'Delivered', label: 'Confirm delivered' };
      return null;
    };
    const activeRuns = shipments.filter((s) => !['Delivered', 'Failed', 'Cancelled'].includes(s.status));
    const failedRuns = shipments.filter((s) => s.status === 'Failed');
    return (
      <AmbientShell intensity="delivery" className="app-shell !bg-transparent">
        <PortalHeader
          icon={Truck}
          title={`${currentDelivery?.name || 'Courier'} · Assigned runs`}
          subtitle="Mobile delivery workspace"
          onLogout={handleLogout}
        />
        <div className="portal-main !max-w-3xl space-y-4">
          <FadeIn>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Active runs" value={activeRuns.length} tone="accent" />
              <KpiCard label="Exceptions" value={failedRuns.length} tone={failedRuns.length ? 'muted' : 'success'} />
            </div>
          </FadeIn>
          <AlertBanner>{actionError}</AlertBanner>
          {shipments.length === 0 && (
            <div className="surface-card">
              <EmptyState icon={Truck} title="No assigned deliveries" description="When dispatch assigns a run, it will appear here with large action buttons." />
            </div>
          )}
          <Stagger className="space-y-3">
            {shipments.map((shp) => {
              const action = nextAction(shp.status);
              const stepIdx = pipeline.indexOf(shp.status as (typeof pipeline)[number]);
              return (
                <article key={shp.id} className="surface-card p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-serif font-bold text-brand text-base">{shp.id}</span>
                        <StatusBadge status={shp.status} />
                      </div>
                      <p className="text-sm font-semibold text-brand">{shp.clientName || 'Shopkeeper'}</p>
                      <p className="text-xs text-muted flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
                        <span>{shp.deliveryAddress || 'Address on order'}</span>
                      </p>
                      <p className="text-[11px] text-muted">Order {shp.orderId}</p>
                      {shp.failureReason && <p className="text-xs text-danger">Failure: {shp.failureReason}</p>}
                    </div>
                  </div>
                  {shp.status !== 'Failed' && (
                    <ol className="delivery-pipeline" aria-label="Delivery progress">
                      {pipeline.map((step, i) => (
                        <li key={step} className={i <= stepIdx ? 'is-done' : ''}>
                          <span className="dp-dot" />
                          <span className="dp-label">{step === 'InTransit' ? 'In transit' : step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {action && (
                      <Pressable
                        onClick={() => updateShipmentStatus(shp.id, action.status, action.status === 'Delivered' ? { proofNotes: 'Delivered to storefront' } : {})}
                        className="btn btn-primary delivery-action w-full"
                      >
                        <CheckCircle2 className="w-4 h-4" /> {action.label}
                      </Pressable>
                    )}
                    {shp.status === 'InTransit' && (
                      <Pressable
                        onClick={() => updateShipmentStatus(shp.id, 'Failed', { failureReason: 'Customer unavailable' })}
                        className="btn btn-danger delivery-action w-full"
                      >
                        <XCircle className="w-4 h-4" /> Mark failed
                      </Pressable>
                    )}
                  </div>
                </article>
              );
            })}
          </Stagger>
        </div>
      </AmbientShell>
    );
  }

  // ================= 5. CLIENT PORTAL =================
  if (navState === 'client_portal') {
    const freq = frequentProductsFromOrders(orders as any, 5);
    const last = lastOrderLines(orders as any);
    const aiVisual = deriveAiVisualState({
      isAiLoading,
      voiceState,
      chatError,
      voiceError,
    });
    const chatReactive = aiVisual === 'thinking' || aiVisual === 'listening';

    return (
      <AmbientShell intensity={clientTab === 'chat' ? 'chat' : 'commerce'} reactive={chatReactive} className="app-shell !bg-transparent">
        <PortalHeader
          icon={Store}
          title={currentClient?.storeName || 'Babar General Store'}
          subtitle={`Shopkeeper · ${currentClient?.name || 'Account'}`}
          onLogout={handleLogout}
        >
          <Pressable onClick={() => setCheckoutModal(true)} className="btn btn-ghost btn-sm relative">
            <ShoppingCart className="w-4 h-4 text-accent" />
            <span className="hidden sm:inline">Cart</span>
            <span className="font-bold">{totalCartItemsCount}</span>
            {totalCartItemsCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-brand font-bold text-[10px] min-w-4 h-4 px-1 rounded-full grid place-items-center">
                {totalCartItemsCount}
              </span>
            )}
          </Pressable>
        </PortalHeader>

        <div className="portal-main">
          <FadeIn>
            <div className="insight-strip">
              <div className="surface-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-serif font-bold text-brand text-sm">One-click reorder</h3>
                  {last && <span className="text-[10px] text-muted">{last.orderId}</span>}
                </div>
                {last ? (
                  <>
                    <p className="text-xs text-muted leading-relaxed">
                      Restock {last.lines.length} line(s) from your latest order · PKR {last.totalAmount.toLocaleString()}
                    </p>
                    <Pressable disabled={cartBusy} onClick={reorderLastOrder} className="btn btn-accent btn-sm">
                      <RefreshCw className="w-3.5 h-3.5" /> Reorder into cart
                    </Pressable>
                  </>
                ) : (
                  <p className="text-xs text-muted">Place an order once to unlock reorder.</p>
                )}
              </div>
              <div className="surface-card p-4 sm:p-5 space-y-3">
                <h3 className="font-serif font-bold text-brand text-sm">Frequently ordered</h3>
                {freq.length === 0 && <p className="text-xs text-muted">Built from your real order history.</p>}
                <div className="space-y-2">
                  {freq.slice(0, 3).map((f) => (
                    <div key={f.productId} className="product-chip">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-brand truncate">{f.name}</p>
                        <p className="text-[10px] text-muted">{f.timesOrdered}× ordered · {f.totalQty} {f.unit}</p>
                      </div>
                      <Pressable
                        disabled={cartBusy}
                        className="btn btn-primary btn-sm"
                        onClick={() => addToCart(f.productId, Math.max(1, products.find((p) => p.id === f.productId)?.moq || 1))}
                      >
                        Add
                      </Pressable>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>

          <TabRail
            value={clientTab}
            onChange={(id) => setClientTab(id as typeof clientTab)}
            tabs={[
              { id: 'chat', label: 'AI assistant', icon: MessageSquare },
              { id: 'catalog', label: 'Catalog', icon: Package },
              { id: 'orders', label: 'Orders', icon: Clock },
              { id: 'invoices', label: 'Invoices', icon: FileText },
            ]}
          />

          {clientTab === 'chat' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
              <div className={`lg:col-span-2 surface-card chat-shell !border-0 shadow-lift ${aiVisual === 'thinking' ? 'is-thinking' : ''} ${aiVisual === 'listening' ? 'is-listening' : ''}`}>
                <div className="chat-top px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="ai-avatar-slot">
                      <AiAura state={aiVisual} />
                      <div className="ai-avatar-core">AI</div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-serif font-bold text-sm truncate text-white">Wholesale Copilot</h3>
                        <AiStateLabel state={aiVisual} />
                      </div>
                      <p className="text-[10px] text-accent/90">
                        {aiStatus?.geminiConfigured ? 'Gemini ready · voice auto-send' : 'Local agents · voice + text'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={voiceReviewMode} onChange={(e) => setVoiceReviewMode(e.target.checked)} className="rounded border-accent" />
                      Review
                    </label>
                    <div className="flex bg-black/30 p-0.5 rounded-lg" role="group" aria-label="Chat language">
                      {([
                        ['ur', 'اردو'],
                        ['ps', 'پښتو'],
                        ['en', 'EN'],
                      ] as const).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setChatLanguage(code)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${chatLanguage === code ? 'bg-accent text-brand' : 'text-slate-300 hover:text-white'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div ref={chatScrollRef} className="chat-thread space-y-3">
                  <SoftProgress show={isAiLoading || Boolean(voiceBusyNote)} label={voiceBusyNote || (isAiLoading ? 'Assistant is working…' : undefined)} />
                  {chatHistory.map((msg, idx) => (
                    <ChatMessageMotion key={idx} fromUser={msg.sender === 'user'}>
                      <div className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[92%] sm:max-w-[85%] p-3.5 text-sm leading-relaxed ${msg.sender === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai'}`}>
                          {msg.sender === 'ai' && (
                            <div className="mb-2">
                              <AiModeChip geminiUsed={msg.geminiUsed} fallbackReason={msg.fallbackReason || msg.ttsNote} />
                            </div>
                          )}
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                          {msg.products && msg.products.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {msg.products.map((p) => {
                                const avail = p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved);
                                return (
                                  <div key={p.id} className="bg-black/25 p-2.5 rounded-xl border border-white/10 flex flex-col gap-2">
                                    <div>
                                      <h4 className="font-serif font-bold text-xs text-white">{p.name}</h4>
                                      <p className="text-[10px] text-slate-400 mt-0.5">MOQ {p.moq} · {p.unit}</p>
                                      <p className="text-xs font-semibold text-accent mt-1">PKR {p.sellingPrice.toLocaleString()}</p>
                                      <div className="mt-2">
                                        <StockMeter available={avail} capacity={Math.max(p.stockOnHand, avail, 1)} />
                                      </div>
                                    </div>
                                    <Pressable disabled={cartBusy} onClick={() => addToCart(p.id, Math.max(p.moq, 1))} className="btn btn-accent btn-sm w-full">Add to cart</Pressable>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {msg.cartPreview && (
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Cart preview</p>
                              {msg.cartPreview.lines.map((line, i) => (
                                <p key={i} className="text-xs text-slate-300">{line.quantity} × {line.name} — PKR {line.lineTotal.toLocaleString()}</p>
                              ))}
                              <p className="text-xs font-semibold text-white">Subtotal PKR {msg.cartPreview.subtotal.toLocaleString()}</p>
                            </div>
                          )}
                          {msg.needsConfirmation && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Pressable onClick={() => setCheckoutModal(true)} className="btn btn-accent btn-sm">Review & confirm checkout</Pressable>
                              <span className="text-[10px] text-amber-300">Not placed until you confirm.</span>
                            </div>
                          )}
                          {msg.sender === 'ai' && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => playAssistantTts(msg, idx)} className="btn btn-secondary btn-sm !bg-white/10 !text-white !border-white/15">
                                {playingMsgIdx === idx ? <Pause className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                                {playingMsgIdx === idx ? 'Pause' : 'Play'}
                              </button>
                              {msg.ttsNote && <span className="text-[10px] text-amber-200/90 leading-snug">{msg.ttsNote}</span>}
                            </div>
                          )}
                          {msg.error && msg.retryText && (
                            <button type="button" onClick={() => handleSendMessage(msg.retryText)} className="mt-3 text-xs underline text-accent font-semibold">Retry message</button>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
                      </div>
                    </ChatMessageMotion>
                  ))}
                  {isAiLoading && (
                    <div className="flex items-start">
                      <TypingDots label={voiceBusyNote || 'Checking live stock & cart…'} />
                    </div>
                  )}
                </div>

                <div className="chat-composer space-y-2">
                  {chatError && <AlertBanner>{chatError}</AlertBanner>}
                  {voiceError && <AlertBanner>{voiceError}</AlertBanner>}

                  {voiceState === 'recording' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-500/15 border border-rose-400/30 px-3 py-2.5">
                      <div className="flex items-center gap-3 text-rose-100 text-xs font-semibold">
                        <WaveformBars active />
                        <span>Recording… {formatDuration(recordingMs)} / 1:00</span>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={stopVoiceRecording} className="btn btn-accent btn-sm"><Square className="w-3 h-3" /> Stop</button>
                        <button type="button" onClick={cancelVoiceRecording} className="btn btn-danger btn-sm"><X className="w-3 h-3" /> Cancel</button>
                      </div>
                    </div>
                  )}

                  {voiceState === 'preview' && previewUrl && (
                    <div className="rounded-xl border border-line bg-canvas/70 p-3 space-y-2">
                      <p className="text-[11px] text-brand font-semibold">Review mode — preview ({formatDuration(recordingMs)})</p>
                      <audio ref={previewAudioRef} src={previewUrl} controls className="w-full h-9" />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={uploadAndTranscribeForReview} className="btn btn-primary btn-sm">Transcribe to edit</button>
                        <button type="button" onClick={() => { resetVoiceSession(); startVoiceRecording(); }} className="btn btn-secondary btn-sm">Re-record</button>
                        <button type="button" onClick={() => resetVoiceSession()} className="btn btn-secondary btn-sm">Discard</button>
                      </div>
                    </div>
                  )}

                  {(voiceState === 'transcribing' || voiceState === 'submitting') && (
                    <p className="text-[11px] text-muted px-1 italic flex items-center gap-2">
                      <RefreshCw className="w-3 h-3 animate-spin text-accent" />
                      {voiceBusyNote || 'Processing voice…'}
                    </p>
                  )}

                  {voiceState === 'review' && (
                    <div className="rounded-xl border border-line bg-white p-3 space-y-2">
                      <p className="text-[11px] text-brand font-semibold">
                        {transcriptionSucceeded ? 'Edit transcript before sending' : 'Manual text fallback'}
                      </p>
                      {!transcriptionSucceeded && (
                        <AlertBanner tone="warn">
                          Transcription did not succeed. Type what you said — we never invent a transcript. Checkout still needs a separate confirm.
                        </AlertBanner>
                      )}
                      {transcriptionSucceeded && (
                        <p className="text-[10px] text-muted">Review mode is on. Edit if needed, then send.</p>
                      )}
                      <textarea
                        value={transcriptDraft}
                        onChange={(e) => setTranscriptDraft(e.target.value)}
                        rows={3}
                        className="field"
                        placeholder="Type or edit what you said, e.g. Mujhe Pepsi ki 2 petiyan chahiye"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!transcriptDraft.trim() || !transcriptId} onClick={submitReviewedVoice} className="btn btn-primary btn-sm">Send to assistant</button>
                        <button type="button" onClick={() => { resetVoiceSession(); startVoiceRecording(); }} className="btn btn-secondary btn-sm">Re-record</button>
                        <button type="button" onClick={() => resetVoiceSession()} className="btn btn-secondary btn-sm">Discard</button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <MicOrb
                      recording={voiceState === 'recording'}
                      disabled={isAiLoading || voiceState === 'transcribing' || voiceState === 'submitting' || voiceState === 'review'}
                      title={voiceSupported ? 'Record voice message' : 'Voice unsupported in this browser'}
                      onClick={() => (voiceState === 'recording' ? stopVoiceRecording() : startVoiceRecording())}
                    />
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                      placeholder="Message in English / اردو / پښتو…"
                      className="field flex-1 !py-2.5"
                      disabled={isAiLoading || voiceState === 'submitting'}
                    />
                    <Pressable onClick={() => handleSendMessage()} disabled={isAiLoading || !chatInput.trim() || voiceState === 'submitting'} className="btn btn-accent btn-icon shrink-0" aria-label="Send message">
                      <Send className="w-4 h-4" />
                    </Pressable>
                  </div>
                </div>
              </div>

              <aside className="space-y-4">
                <div className="surface-card p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-serif font-bold text-brand text-sm">Cart preview</h4>
                    <span className="text-[10px] text-muted">{totalCartItemsCount} items</span>
                  </div>
                  {totalCartItemsCount === 0 ? (
                    <p className="text-xs text-muted">Add from chat or catalog — checkout stays explicit.</p>
                  ) : (
                    <ul className="space-y-2 max-h-36 overflow-y-auto">
                      {Object.keys(cart).slice(0, 6).map((id) => {
                        const p = products.find((prod) => prod.id === id);
                        if (!p) return null;
                        return (
                          <li key={id} className="flex justify-between gap-2 text-xs">
                            <span className="truncate text-brand font-medium">{p.name} × {cart[id]}</span>
                            <span className="text-muted shrink-0">PKR {(p.sellingPrice * cart[id]).toLocaleString()}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Pressable disabled={totalCartItemsCount === 0} onClick={() => setCheckoutModal(true)} className="btn btn-accent btn-sm w-full">
                    Review cart
                  </Pressable>
                </div>
                <div className="surface-card p-5 space-y-3">
                  <h4 className="font-serif font-bold text-brand text-sm flex items-center gap-2"><Mic className="w-4 h-4 text-accent" /> Voice tips</h4>
                  <ul className="text-[11px] text-muted space-y-1.5 leading-relaxed list-disc pl-4">
                    <li>Mic → speak → Stop → auto transcript + reply.</li>
                    <li>Enable Review to edit before send.</li>
                    <li>On STT failure / 429, type manually — never fabricated.</li>
                    <li>Checkout always needs your explicit confirm.</li>
                  </ul>
                  <label className="flex sm:hidden items-center gap-2 text-[11px] text-brand font-medium">
                    <input type="checkbox" checked={voiceReviewMode} onChange={(e) => setVoiceReviewMode(e.target.checked)} />
                    Review mode
                  </label>
                </div>
                <div className="surface-card p-5 space-y-3">
                  <h4 className="font-serif font-bold text-brand text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" /> Quick prompts</h4>
                  <div className="space-y-2">
                    {[
                      'Show me available cold drinks.',
                      'Mujhe Pepsi ki 5 petiyan chahiye.',
                      'ما ته د پیپسي پنځه کارټنه پکار دي.',
                      'Show my cart and propose checkout',
                    ].map((prompt) => (
                      <Pressable
                        key={prompt}
                        disabled={isAiLoading}
                        onClick={() => handleSendMessage(prompt)}
                        className="w-full text-left p-3 rounded-xl bg-canvas/70 hover:bg-canvas border border-line text-xs text-brand font-medium disabled:opacity-60"
                      >
                        “{prompt}”
                      </Pressable>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          )}

          {clientTab === 'catalog' && (
            <div className="space-y-4">
              <AlertBanner>{actionError}</AlertBanner>
              {products.filter((p) => p.status !== 'inactive').length === 0 && (
                <div className="surface-card">
                  <EmptyState icon={Package} title="No products available" description="Ask the assistant or check back when wholesalers restock." />
                </div>
              )}
              <Stagger className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {products.filter((p) => p.status !== 'inactive').map((p) => {
                  const avail = p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved);
                  return (
                    <article key={p.id} className="surface-card product-card p-5 flex flex-col justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="status-pill status-neutral">{p.sku}</span>
                          <StatusBadge status={p.status} />
                        </div>
                        <h3 className="font-serif font-bold text-brand text-lg leading-snug">{p.name}</h3>
                        <p className="text-xs text-muted">Pack {p.packSize} · MOQ {p.moq} {p.unit}</p>
                        <StockMeter available={avail} capacity={Math.max(p.stockOnHand, avail, 1)} />
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-line">
                        <span className="text-base font-bold text-brand">PKR {p.sellingPrice.toLocaleString()}</span>
                        <Pressable disabled={cartBusy || avail <= 0} onClick={() => addToCart(p.id, p.moq)} className="btn btn-accent btn-sm">Add to cart</Pressable>
                      </div>
                    </article>
                  );
                })}
              </Stagger>
            </div>
          )}

          {clientTab === 'orders' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">Orders timeline</h3>
              {orders.length === 0 && <EmptyState icon={Clock} title="No orders yet" description="Confirm checkout from your cart to place the first wholesale order." />}
              <div className="space-y-3">
                {orders.map((ord) => (
                  <article key={ord.id} className="rounded-2xl border border-line bg-canvas/50 p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-line">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-serif font-bold text-brand">{ord.id}</span>
                        <StatusBadge status={ord.status} />
                      </div>
                      <span className="font-serif font-bold text-brand">PKR {ord.totalAmount.toLocaleString()}</span>
                    </div>
                    <ul className="text-xs text-muted space-y-1">
                      {(ord.subOrders || []).flatMap((s) => s.items || []).map((item, i) => (
                        <li key={i}>• {item.name} × {item.quantity} {item.unit}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>
          )}

          {clientTab === 'invoices' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">Invoices & balances</h3>
              {invoices.length === 0 && <EmptyState icon={FileText} title="No invoices yet" description="Invoices appear after successful delivery." />}
              {invoices.length > 0 && (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th><th>Order</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="font-serif font-bold text-brand">{inv.invoiceNumber || inv.id}</td>
                          <td>{inv.orderId}</td>
                          <td className="font-semibold">PKR {Number(inv.amount).toLocaleString()}</td>
                          <td className="text-success">PKR {Number(inv.paidAmount).toLocaleString()}</td>
                          <td className="text-warning">PKR {Number(inv.outstandingAmount ?? (inv.amount - inv.paidAmount)).toLocaleString()}</td>
                          <td><StatusBadge status={inv.status} /></td>
                          <td>
                            <button type="button" onClick={() => setSelectedInvoice(inv)} className="text-xs font-semibold text-brand hover:underline">View</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <ModalFrame open={checkoutModal} onClose={() => setCheckoutModal(false)} title="Confirm wholesale order">
          <AlertBanner tone="warn">Orders are never placed silently. Review quantities and confirm below.</AlertBanner>
          <div className="space-y-2.5 max-h-56 overflow-y-auto">
            {Object.keys(cart).length === 0 && <p className="text-sm text-muted">Your cart is empty.</p>}
            {Object.keys(cart).map((productId) => {
              const p = products.find((prod) => prod.id === productId);
              if (!p) return null;
              return (
                <div key={productId} className="bg-canvas/70 p-3 rounded-xl flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <h4 className="font-serif font-bold text-brand text-sm truncate">{p.name}</h4>
                    <p className="text-xs text-muted">PKR {p.sellingPrice.toLocaleString()} / {p.unit}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => updateCartQty(productId, cart[productId] - 1)} className="btn btn-secondary btn-sm !px-2.5">−</button>
                    <span className="text-xs font-bold text-brand w-6 text-center">{cart[productId]}</span>
                    <button type="button" onClick={() => updateCartQty(productId, cart[productId] + 1)} className="btn btn-secondary btn-sm !px-2.5">+</button>
                  </div>
                </div>
              );
            })}
          </div>
          <label className="block">
            <span className="field-label">Delivery address</span>
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className="field" />
          </label>
          <div className="pt-2 border-t border-line flex justify-between items-center gap-3">
            <span className="text-sm text-muted">Server preview total</span>
            <span className="font-serif font-bold text-xl text-brand">
              PKR {(cartSubtotal || Object.keys(cart).reduce((sum, id) => {
                const p = products.find((prod) => prod.id === id);
                return sum + (p ? p.sellingPrice * cart[id] : 0);
              }, 0)).toLocaleString()}
            </span>
          </div>
          <AlertBanner>{checkoutError}</AlertBanner>
          <button type="button" disabled={orderBusy || cartBusy || totalCartItemsCount === 0} onClick={submitOrder} className="btn btn-primary btn-lg w-full">
            {orderBusy ? 'Submitting…' : 'Confirm & submit to wholesaler(s)'}
          </button>
        </ModalFrame>

        <ModalFrame open={Boolean(selectedInvoice)} onClose={() => setSelectedInvoice(null)} title={`Invoice ${selectedInvoice?.invoiceNumber || selectedInvoice?.id || ''}`} zClass="z-[60]">
          {selectedInvoice && (
            <>
              <p className="text-xs text-muted">Order {selectedInvoice.orderId} · {selectedInvoice.clientName || 'Shopkeeper'}</p>
              <p className="text-xs text-muted">Wholesaler: {selectedInvoice.wholesalerName || selectedInvoice.wholesalerId}</p>
              <ul className="text-sm space-y-2 border-y border-line py-3">
                {(selectedInvoice.lines || []).map((line) => (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span>{line.name} × {line.quantity} {line.unit}</span>
                    <span className="font-serif font-semibold">PKR {Number(line.lineTotal).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span>Total</span><span className="font-serif font-bold">PKR {Number(selectedInvoice.amount).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Paid</span><span>PKR {Number(selectedInvoice.paidAmount).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Outstanding</span><span className="font-serif font-bold text-warning">PKR {Number(selectedInvoice.outstandingAmount ?? (selectedInvoice.amount - selectedInvoice.paidAmount)).toLocaleString()}</span></div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => window.print()} className="btn btn-primary flex-1">Print</button>
                <button type="button" onClick={() => setSelectedInvoice(null)} className="btn btn-secondary flex-1">Close</button>
              </div>
            </>
          )}
        </ModalFrame>
      </AmbientShell>
    );
  }

  // ================= 6. WHOLESALER PORTAL (ISOLATED TO OWN PORTAL & OWN PROFIT) =================
  if (navState === 'wholesaler_portal') {
    const wh = currentWholesaler || wholesalers[0];
    const myProducts = products.filter(p => p.wholesalerId === wh?.id);
    const mySubOrders = (orders || []).flatMap(o => (o.subOrders || []).filter(s => s.wholesalerId === wh?.id).map(s => ({ ...s, orderId: o.id, clientName: o.clientName })));
    
    const approvedSubs = mySubOrders.filter(s => s.status === 'Approved' || s.status === 'Fulfilled');
    const myRevenue = approvedSubs.reduce((acc, s) => acc + (s.subtotal || 0), 0);
    const myCogs = approvedSubs.reduce((acc, s) => {
      return acc + (s.items || []).reduce((sum, item) => {
        const snap = (item as any).costPrice;
        if (typeof snap === 'number') return sum + snap * item.quantity;
        const prod = products.find(p => p.id === item.productId);
        return sum + ((prod ? prod.costPrice : 0) * item.quantity);
      }, 0);
    }, 0);
    const myProfit = myRevenue - myCogs;
    const health = inventoryHealth(myProducts as any);
    const sellers = bestSellersFromSubOrders(orders as any, (sub) => (sub as any).wholesalerId === wh?.id, 5);
    const pendingSubs = mySubOrders.filter((s) => s.status === 'Submitted').length;
    const tenantOrders = (orders || []).filter((o) => (o.subOrders || []).some((s) => s.wholesalerId === wh?.id));
    const salesSpark = orderAmountSeries(tenantOrders as any, 8);
    const lowStockSkus = myProducts.filter((p) => {
      const avail = p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved);
      return p.status !== 'inactive' && (avail <= p.reorderPoint || p.status === 'low_stock' || avail <= 0);
    }).filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);

    return (
      <AmbientShell intensity="ops" className="app-shell !bg-transparent">
        <PortalHeader
          icon={Package}
          title={wh?.name || 'Wholesaler'}
          subtitle={`${wh?.city || 'Peshawar'} · isolated tenant portal`}
          onLogout={handleLogout}
        />
        <div className="portal-main">
          <TabRail
            value={wholesalerTab}
            onChange={(id) => setWholesalerTab(id as typeof wholesalerTab)}
            tabs={[
              { id: 'dashboard', label: 'Dashboard', icon: DollarSign },
              { id: 'products', label: 'Catalog & stock', icon: Package },
              { id: 'suborders', label: 'Suborders', icon: CheckCircle2, count: mySubOrders.length },
            ]}
          />

          {wholesalerTab === 'dashboard' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard label="Revenue" value={`PKR ${myRevenue.toLocaleString()}`} />
                <KpiCard label="COGS" value={`PKR ${myCogs.toLocaleString()}`} tone="muted" />
                <KpiCard label="Gross profit" value={`PKR ${myProfit.toLocaleString()}`} tone="accent" />
                <KpiCard label="Pending review" value={pendingSubs} tone={pendingSubs ? 'accent' : 'success'} />
              </div>
              <div className="insight-strip">
                <div className="surface-card p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-serif font-bold text-brand text-sm">Inventory health</h3>
                    <StatusBadge status={wh?.status || 'unknown'} />
                  </div>
                  <HealthMeter healthy={health.healthy} low={health.low} out={health.out} />
                  {lowStockSkus.length > 0 ? (
                    <ul className="text-xs text-muted space-y-1.5">
                      {lowStockSkus.slice(0, 4).map((p) => (
                        <li key={p.id} className="flex justify-between gap-2">
                          <span className="truncate text-brand font-medium">{p.name}</span>
                          <span>{p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved)} left</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">All active SKUs above reorder point.</p>
                  )}
                </div>
                <div className="surface-card p-5 space-y-3">
                  <h3 className="font-serif font-bold text-brand text-sm">Sales pulse</h3>
                  <SparkBars values={salesSpark} />
                  <p className="text-[11px] text-muted">Order totals for this tenant · live data only</p>
                  <h4 className="text-xs font-semibold text-brand pt-1">Best sellers</h4>
                  {sellers.length === 0 && <p className="text-xs text-muted">Approve suborders to unlock rankings.</p>}
                  <ul className="space-y-2">
                    {sellers.map((s) => (
                      <li key={s.name} className="flex justify-between gap-2 text-xs">
                        <span className="font-medium text-brand truncate">{s.name}</span>
                        <span className="text-muted shrink-0">{s.qty} u · PKR {s.revenue.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {wholesalerTab === 'products' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">Products & inventory</h3>
              <AlertBanner>{actionError}</AlertBanner>
              <form onSubmit={createWholesalerProduct} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 bg-canvas/60 p-4 rounded-2xl border border-line">
                <input required placeholder="SKU" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="field !py-2.5 !text-xs md:col-span-2" />
                <input required placeholder="Unit" value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Pack size" value={productForm.packSize} onChange={(e) => setProductForm({ ...productForm, packSize: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Cost" type="number" value={productForm.costPrice} onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Selling price" type="number" value={productForm.sellingPrice} onChange={(e) => setProductForm({ ...productForm, sellingPrice: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="MOQ" type="number" value={productForm.moq} onChange={(e) => setProductForm({ ...productForm, moq: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Reorder point" type="number" value={productForm.reorderPoint} onChange={(e) => setProductForm({ ...productForm, reorderPoint: e.target.value })} className="field !py-2.5 !text-xs" />
                <input required placeholder="Stock on hand" type="number" value={productForm.stockOnHand} onChange={(e) => setProductForm({ ...productForm, stockOnHand: e.target.value })} className="field !py-2.5 !text-xs" />
                <button disabled={productBusy} type="submit" className="btn btn-primary md:col-span-3">{productBusy ? 'Saving…' : 'Add product'}</button>
              </form>
              {myProducts.length === 0 ? (
                <EmptyState icon={Package} title="No products yet" description="Add your first SKU to start receiving shopkeeper orders." />
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>SKU</th><th>Name</th><th>Cost</th><th>Selling</th><th>Available</th><th>Status</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {myProducts.map((p) => (
                        <tr key={p.id}>
                          <td className="font-serif font-bold text-brand">{p.sku}</td>
                          <td>{p.name}</td>
                          <td>PKR {p.costPrice.toLocaleString()}</td>
                          <td className="font-semibold">PKR {p.sellingPrice.toLocaleString()}</td>
                          <td className="text-success font-bold">{p.availableStock ?? Math.max(0, p.stockOnHand - p.stockReserved)} {p.unit}s</td>
                          <td><StatusBadge status={p.status} /></td>
                          <td>
                            {p.status !== 'inactive' && (
                              <button type="button" onClick={() => deactivateWholesalerProduct(p.id)} className="text-xs font-semibold text-danger hover:underline">Deactivate</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {wholesalerTab === 'suborders' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">Incoming suborders</h3>
              <AlertBanner>{actionError}</AlertBanner>
              {mySubOrders.length === 0 && <EmptyState icon={CheckCircle2} title="No suborders" description="Approved shopkeeper checkouts will appear here for your tenant." />}
              <div className="space-y-3">
                {mySubOrders.map((sub) => (
                  <article key={sub.id} className="rounded-2xl border border-line bg-canvas/50 p-4 sm:p-5 flex flex-col sm:flex-row sm:justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-serif font-bold text-brand">{sub.id}</span>
                        <StatusBadge status={sub.status} />
                      </div>
                      <p className="text-xs text-muted">Client: {sub.clientName} · Order {sub.orderId}</p>
                      <ul className="text-xs text-muted space-y-1">
                        {(sub.items || []).map((it, i) => (
                          <li key={i}>• {it.name} × {it.quantity} {it.unit} (PKR {(it.quantity * it.unitPrice).toLocaleString()})</li>
                        ))}
                      </ul>
                    </div>
                    {sub.status === 'Submitted' && (
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button type="button" onClick={() => reviewSubOrder(sub.id, 'Approved')} className="btn btn-primary btn-sm"><Check className="w-3.5 h-3.5" /> Approve</button>
                        <button type="button" onClick={() => reviewSubOrder(sub.id, 'Rejected')} className="btn btn-danger btn-sm"><X className="w-3.5 h-3.5" /> Reject</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </AmbientShell>
    );
  }

  // ================= 7. ADMIN PORTAL =================
  if (navState === 'admin_portal') {
    const platformGmv = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const unassigned = shipments.filter((s) => s.status === 'Unassigned');
    const failedShipments = shipments.filter((s) => s.status === 'Failed');
    const pendingApplications = wholesalerApplications.filter((a) => a.status === 'pending');
    const platformSpark = orderAmountSeries(orders as any, 8);
    const platformSellers = bestSellersFromSubOrders(orders as any, undefined, 5);
    const stockHealth = inventoryHealth(products as any);
    const outstanding = invoices.reduce((sum, inv) => sum + Number(inv.outstandingAmount ?? (inv.amount - inv.paidAmount)), 0);
    const recentActivity = [
      ...auditEvents.slice(0, 8).map((e) => ({
        id: e.id,
        kind: 'audit' as const,
        title: e.action,
        detail: e.details,
        at: e.timestamp,
      })),
      ...failedShipments.slice(0, 4).map((s) => ({
        id: `fail-${s.id}`,
        kind: 'exception' as const,
        title: `Failed shipment ${s.id}`,
        detail: s.failureReason || 'Exception recorded',
        at: s.expectedDate,
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 10);

    return (
      <AmbientShell intensity="ops" className="app-shell !bg-transparent">
        <PortalHeader
          icon={ShieldCheck}
          title="Admin control hub"
          subtitle="Tenants · dispatch · payments · audit"
          onLogout={handleLogout}
        />
        <div className="portal-main">
          <TabRail
            value={adminTab}
            onChange={(id) => setAdminTab(id as typeof adminTab)}
            tabs={[
              { id: 'overview', label: 'Overview', icon: DollarSign },
              { id: 'wholesalers', label: 'Wholesalers', icon: Users },
              { id: 'applications', label: 'Applications', icon: ClipboardList, count: pendingApplications.length },
              { id: 'all_orders', label: 'Orders', icon: FileText },
              { id: 'dispatch', label: 'Dispatch', icon: Truck, count: unassigned.length + failedShipments.length },
              { id: 'audit', label: 'Audit', icon: ShieldCheck },
            ]}
          />

          {adminTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard label="Platform GMV" value={`PKR ${platformGmv.toLocaleString()}`} />
                <KpiCard label="Wholesalers" value={wholesalers.length} tone="success" />
                <KpiCard label="Outstanding AR" value={`PKR ${outstanding.toLocaleString()}`} tone="accent" />
                <KpiCard label="Exceptions" value={failedShipments.length + unassigned.length} tone={failedShipments.length ? 'muted' : 'success'} />
              </div>
              <div className="insight-strip">
                <div className="surface-card p-5 space-y-3">
                  <h3 className="font-serif font-bold text-brand text-sm">GMV pulse</h3>
                  <SparkBars values={platformSpark} />
                  <p className="text-[11px] text-muted">{orders.length} client order(s) · live totals</p>
                  <HealthMeter healthy={stockHealth.healthy} low={stockHealth.low} out={stockHealth.out} />
                </div>
                <div className="surface-card p-5 space-y-3">
                  <h3 className="font-serif font-bold text-brand text-sm">Ops exceptions</h3>
                  {unassigned.length === 0 && failedShipments.length === 0 ? (
                    <p className="text-xs text-muted">No unassigned or failed shipments.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {unassigned.slice(0, 3).map((s) => (
                        <li key={s.id} className="flex justify-between gap-2 rounded-lg bg-canvas/70 px-3 py-2 border border-line">
                          <span className="font-medium text-brand truncate">{s.id} · unassigned</span>
                          <Pressable onClick={() => setAdminTab('dispatch')} className="text-accent font-semibold shrink-0">Dispatch</Pressable>
                        </li>
                      ))}
                      {failedShipments.slice(0, 3).map((s) => (
                        <li key={s.id} className="rounded-lg bg-rose-50 px-3 py-2 border border-rose-200 text-danger">
                          {s.id}: {s.failureReason || 'Failed'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4 className="text-xs font-semibold text-brand pt-1">Top movers</h4>
                  {platformSellers.length === 0 && <p className="text-xs text-muted">No approved sales yet.</p>}
                  <ul className="space-y-1.5">
                    {platformSellers.map((s) => (
                      <li key={s.name} className="flex justify-between gap-2 text-xs">
                        <span className="truncate text-brand font-medium">{s.name}</span>
                        <span className="text-muted shrink-0">{s.qty} u</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="surface-card p-5 space-y-3">
                <h3 className="font-serif font-bold text-brand text-sm">Operational timeline</h3>
                {recentActivity.length === 0 && <EmptyState icon={ShieldCheck} title="Quiet so far" description="Audit events and delivery exceptions will stream here." />}
                <div className="space-y-2">
                  {recentActivity.map((evt) => (
                    <div key={evt.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 rounded-xl border border-line bg-canvas/50 px-3 py-2.5">
                      <div className="min-w-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${evt.kind === 'exception' ? 'bg-danger text-white' : 'bg-brand text-canvas'}`}>{evt.title}</span>
                        <p className="text-xs text-brand mt-1 truncate">{evt.detail}</p>
                      </div>
                      <span className="text-[10px] text-muted shrink-0">{new Date(evt.at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminTab === 'wholesalers' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <h3 className="font-serif font-bold text-brand text-lg">Wholesaler tenants</h3>
                <button type="button" onClick={() => setShowAddWholesalerModal(true)} className="btn btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Add wholesaler
                </button>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>ID</th><th>Name</th><th>City</th><th>Status</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {wholesalers.map((w) => (
                      <tr key={w.id}>
                        <td className="font-serif font-bold text-brand">{w.id}</td>
                        <td>{w.name}</td>
                        <td>{w.city}</td>
                        <td><StatusBadge status={w.status} /></td>
                        <td className="text-right space-x-2 whitespace-nowrap">
                          <button type="button" onClick={() => toggleWholesalerStatus(w.id, w.status)} className="btn btn-secondary btn-sm">
                            {w.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </button>
                          <button type="button" onClick={() => deleteWholesaler(w.id)} className="btn btn-danger btn-sm">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminTab === 'applications' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h3 className="font-serif font-bold text-brand text-lg">Wholesaler applications</h3>
                  <p className="text-xs text-muted mt-1">Review public requests. Approval creates a tenant and emails a password setup link—never a plaintext password.</p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchWholesalerApplications()}>
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>
              <AlertBanner>{actionError}</AlertBanner>
              {wholesalerApplications.length === 0 && (
                <EmptyState icon={ClipboardList} title="No applications yet" description="When a business submits Become a Wholesaler, it appears here for review." />
              )}
              <div className="space-y-3">
                {wholesalerApplications.map((app) => (
                  <article key={app.id} className="rounded-2xl border border-line bg-canvas/50 p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap justify-between gap-2 items-start">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-serif font-bold text-brand text-base">{app.businessName}</h4>
                          <StatusBadge status={app.status} />
                        </div>
                        <p className="text-xs text-muted">
                          {app.applicantName} · {app.email} · {app.phone}
                        </p>
                        <p className="text-xs text-muted">{app.location} · {app.category}</p>
                      </div>
                      <span className="text-[10px] text-muted shrink-0">{new Date(app.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-brand leading-relaxed whitespace-pre-wrap">{app.description}</p>
                    {app.rejectReason && <p className="text-xs text-danger">Rejection reason: {app.rejectReason}</p>}
                    {app.wholesalerId && <p className="text-xs text-success font-semibold">Tenant created: {app.wholesalerId}</p>}
                    {app.status === 'pending' && (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-line">
                        <input
                          className="field !py-2 flex-1 text-xs"
                          placeholder="Optional rejection reason"
                          value={rejectReasonDraft[app.id] || ''}
                          onChange={(e) => setRejectReasonDraft({ ...rejectReasonDraft, [app.id]: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={applicationBusyId === app.id}
                          onClick={() => approveApplication(app.id)}
                        >
                          {applicationBusyId === app.id ? 'Working…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={applicationBusyId === app.id}
                          onClick={() => rejectApplication(app.id)}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'all_orders' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">All client orders</h3>
              {orders.length === 0 && <EmptyState icon={FileText} title="No orders yet" />}
              <div className="space-y-3">
                {orders.map((ord) => (
                  <article key={ord.id} className="rounded-2xl border border-line bg-canvas/50 p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap justify-between items-center gap-2 pb-2 border-b border-line">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-serif font-bold text-brand">{ord.id}</span>
                        <StatusBadge status={ord.status} />
                        <span className="text-xs text-muted">Client: {ord.clientName}</span>
                      </div>
                      <span className="font-serif font-bold text-brand">PKR {ord.totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted">Suborders</p>
                      {(ord.subOrders || []).map((sub) => {
                        const wh = wholesalers.find((w) => w.id === sub.wholesalerId);
                        return (
                          <div key={sub.id} className="bg-white p-3 rounded-xl border border-line flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs">
                            <div className="min-w-0">
                              <span className="font-bold text-brand">{wh?.name || sub.wholesalerId}</span>
                              <span className="ml-2 text-muted">{(sub.items || []).map((it) => `${it.name} (${it.quantity} ${it.unit})`).join(', ')}</span>
                            </div>
                            <StatusBadge status={sub.status} />
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'dispatch' && (
            <div className="surface-card p-5 sm:p-6 space-y-5">
              <h3 className="font-serif font-bold text-brand text-lg">Dispatch & logistics</h3>
              <AlertBanner>{actionError}</AlertBanner>
              {shipments.length === 0 && <EmptyState icon={Truck} title="No shipments yet" description="Approve a suborder to create a dispatch queue item." />}
              <div className="space-y-3">
                {shipments.map((shp) => (
                  <article key={shp.id} className="rounded-2xl border border-line bg-canvas/50 p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-serif font-bold text-brand">{shp.id}</span>
                        <StatusBadge status={shp.status} />
                      </div>
                      <p className="text-xs text-muted">Order {shp.orderId} · Assigned: {shp.assigneeName || 'Unassigned'}</p>
                      {shp.failureReason && <p className="text-xs text-danger">Failure: {shp.failureReason}</p>}
                    </div>
                    {(shp.status === 'Unassigned' || shp.status === 'Failed') && (
                      <button type="button" onClick={() => assignShipment(shp.id)} className="btn btn-primary btn-sm shrink-0">Assign delivery partner</button>
                    )}
                  </article>
                ))}
              </div>

              <div className="pt-4 border-t border-line space-y-3">
                <h4 className="font-serif font-bold text-brand">Record payment</h4>
                <form onSubmit={recordInvoicePayment} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <select required value={paymentForm.invoiceId} onChange={(e) => setPaymentForm({ ...paymentForm, invoiceId: e.target.value })} className="field !py-2.5 !text-xs md:col-span-2">
                    <option value="">Select invoice</option>
                    {invoices.filter((i) => Number(i.outstandingAmount ?? (i.amount - i.paidAmount)) > 0).map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.invoiceNumber || inv.id} — outstanding PKR {Number(inv.outstandingAmount ?? (inv.amount - inv.paidAmount)).toLocaleString()}</option>
                    ))}
                  </select>
                  <input required type="number" step="0.01" min="0.01" placeholder="Amount" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="field !py-2.5 !text-xs" />
                  <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} className="field !py-2.5 !text-xs">
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                  <button disabled={paymentBusy} type="submit" className="btn btn-primary">{paymentBusy ? 'Saving…' : 'Post payment'}</button>
                </form>
                {payments.length > 0 && (
                  <div className="text-xs text-muted space-y-1">
                    {payments.slice(0, 5).map((p) => (
                      <div key={p.id}>• {p.id}: PKR {p.amount} via {p.method} at {new Date(p.createdAt).toLocaleString()}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {adminTab === 'audit' && (
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <h3 className="font-serif font-bold text-brand text-lg">Immutable audit trail</h3>
              {auditEvents.length === 0 && <EmptyState icon={ShieldCheck} title="No audit events yet" />}
              <div className="space-y-2.5">
                {auditEvents.map((evt) => (
                  <div key={evt.id} className="bg-canvas/60 p-4 rounded-xl border border-line flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                    <div>
                      <span className="text-[10px] bg-brand text-canvas px-2 py-0.5 rounded font-mono">{evt.action}</span>
                      <p className="text-xs text-brand mt-1.5 leading-relaxed">{evt.details}</p>
                    </div>
                    <span className="text-[10px] text-muted shrink-0">{new Date(evt.timestamp).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <ModalFrame open={showAddWholesalerModal} onClose={() => setShowAddWholesalerModal(false)} title="Add wholesaler tenant">
          <form onSubmit={handleAddWholesaler} className="space-y-3">
            <div>
              <label className="field-label">Wholesaler name</label>
              <input type="text" required value={newWholesalerForm.name} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, name: e.target.value })} placeholder="e.g. Swat Beverages & Drinks" className="field" />
            </div>
            <div>
              <label className="field-label">Category</label>
              <input type="text" required value={newWholesalerForm.category} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, category: e.target.value })} className="field" />
            </div>
            <div>
              <label className="field-label">City / hub</label>
              <input type="text" required value={newWholesalerForm.city} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, city: e.target.value })} className="field" />
            </div>
            <div>
              <label className="field-label">Owner email</label>
              <input type="email" required value={newWholesalerForm.ownerEmail} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, ownerEmail: e.target.value })} placeholder="tenant@market.pk" className="field" />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input type="text" required value={newWholesalerForm.password} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, password: e.target.value })} className="field" />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input type="text" required value={newWholesalerForm.phone} onChange={(e) => setNewWholesalerForm({ ...newWholesalerForm, phone: e.target.value })} placeholder="+92 300 0000000" className="field" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowAddWholesalerModal(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Create tenant</button>
            </div>
          </form>
        </ModalFrame>
      </AmbientShell>
    );
  }

  return null;
}
