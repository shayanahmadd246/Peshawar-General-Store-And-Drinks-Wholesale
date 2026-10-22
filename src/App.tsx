import React, { useState, useEffect, useRef } from 'react';
import { 
  Store, Package, Users, Truck, ShoppingCart, 
  MessageSquare, Mic, Volume2, Search, CheckCircle2, XCircle, 
  Clock, ArrowRight, DollarSign, RefreshCw, Send, 
  FileText, Plus, ShieldCheck, MapPin, Phone, Lock, User, LogOut, ArrowLeft, Sparkles, Trash2, Check
} from 'lucide-react';

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
  status: 'available' | 'low_stock' | 'out_of_stock';
}

interface SubOrder {
  id: string;
  wholesalerId: string;
  items: { productId: string; name: string; quantity: number; unitPrice: number; unit: string }[];
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
  wholesalerId: string;
  assigneeId?: string;
  assigneeName?: string;
  status: string;
  expectedDate: string;
  proofNotes?: string;
}

interface Invoice {
  id: string;
  orderId: string;
  wholesalerId: string;
  amount: number;
  paidAmount: number;
  status: string;
  createdAt: string;
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
  timestamp: string;
}

export default function App() {
  const [navState, setNavState] = useState<string>('gateway');

  // Client Auth
  const [clientAuthMode, setClientAuthMode] = useState<'signin' | 'signup'>('signin');
  const [clientSignupForm, setClientSignupForm] = useState({ name: '', storeName: '', phone: '' });
  const [clientSigninPhone, setClientSigninPhone] = useState('');
  const [currentClient, setCurrentClient] = useState<{ id: string; name: string; storeName: string; phone: string } | null>(null);

  // Wholesaler Auth
  const [wholesalerEmail, setWholesalerEmail] = useState('wholesaler1@market.pk');
  const [wholesalerPassword, setWholesalerPassword] = useState('password123');
  const [currentWholesaler, setCurrentWholesaler] = useState<Wholesaler | null>(null);

  // Admin Auth
  const [adminEmail, setAdminEmail] = useState('admin@market.pk');
  const [adminPassword, setAdminPassword] = useState('admin123');
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);

  const [authError, setAuthError] = useState('');

  // Backend Data
  const [wholesalers, setWholesalers] = useState<Wholesaler[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Client Tabs & Cart
  const [clientTab, setClientTab] = useState<'chat' | 'catalog' | 'orders' | 'invoices'>('chat');
  const [cart, setCart] = useState<{ [productId: string]: number }>({});
  const [deliveryAddress, setDeliveryAddress] = useState<string>('Babar General Store, University Road, Peshawar');
  const [checkoutModal, setCheckoutModal] = useState<boolean>(false);

  // Wholesaler Tabs
  const [wholesalerTab, setWholesalerTab] = useState<'dashboard' | 'products' | 'suborders'>('dashboard');

  // Admin Tabs & New Wholesaler Modal
  const [adminTab, setAdminTab] = useState<'overview' | 'wholesalers' | 'dispatch' | 'audit' | 'all_orders'>('overview');
  const [showAddWholesalerModal, setShowAddWholesalerModal] = useState(false);
  const [newWholesalerForm, setNewWholesalerForm] = useState({ name: '', category: 'Grains & Flour', city: 'Peshawar', ownerEmail: '', phone: '', password: 'password123' });

  // AI Chat State
  const [chatLanguage, setChatLanguage] = useState<'en' | 'ur' | 'ps'>('ur');
  const [chatInput, setChatInput] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      sender: 'ai',
      text: 'السلام علیکم! Welcome to Peshawar General Store & Drinks Wholesale Hub. How can I assist your store stock today?',
      language: 'ur',
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/market/data');
      const data = await res.json();
      setWholesalers(data.wholesalers || []);
      setProducts(data.products || []);
      setOrders(data.orders || []);
      setShipments(data.shipments || []);
      setInvoices(data.invoices || []);
      setAuditEvents(data.auditEvents || []);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch data', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Auth Handlers
  const handleClientSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!clientSignupForm.name || !clientSignupForm.storeName || !clientSignupForm.phone) {
      setAuthError('Please enter exact Name, Store Name, and Phone Number.');
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
        setCurrentClient(data.client);
        setNavState('client_portal');
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
    if (!clientSigninPhone) {
      setAuthError('Please enter your phone number.');
      return;
    }
    try {
      const res = await fetch('/api/auth/client/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clientSigninPhone })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentClient(data.client);
        setNavState('client_portal');
      } else {
        setAuthError(data.error || 'Client not found.');
      }
    } catch (err) {
      setAuthError('Sign in failed.');
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
        setCurrentWholesaler(data.wholesaler);
        setNavState('wholesaler_portal');
      } else {
        setAuthError(data.error || 'Wrong email or password.');
      }
    } catch (err) {
      setAuthError('Wrong password or email.');
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
        setIsAdminLoggedIn(true);
        setNavState('admin_portal');
      } else {
        setAuthError(data.error || 'Wrong admin email or password.');
      }
    } catch (err) {
      setAuthError('Wrong admin email or password.');
    }
  };

  // Cart operations
  const addToCart = (productId: string, qty: number = 1) => {
    setCart(prev => ({ ...prev, [productId]: (prev[productId] || 0) + qty }));
  };

  const updateCartQty = (productId: string, qty: number) => {
    setCart(prev => {
      const copy = { ...prev };
      if (qty <= 0) delete copy[productId];
      else copy[productId] = qty;
      return copy;
    });
  };

  const totalCartItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const submitOrder = async () => {
    const cartItems = Object.keys(cart).map(productId => ({ productId, quantity: cart[productId] }));
    if (cartItems.length === 0) return;
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: currentClient?.id || 'CLI-01',
          clientName: currentClient?.storeName || 'Babar General Store',
          deliveryAddress,
          cartItems
        })
      });
      const data = await res.json();
      if (data.success) {
        setCart({});
        setCheckoutModal(false);
        fetchData();
        alert(`Order ${data.order.id} submitted successfully!`);
      }
    } catch (err) {
      console.error('Order submission error', err);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { sender: 'user', text: chatInput, timestamp: new Date().toLocaleTimeString() };
    setChatHistory(prev => [...prev, userMsg]);
    const query = chatInput;
    setChatInput('');
    setIsAiLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, language: chatLanguage })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, {
        sender: 'ai',
        text: data.reply,
        audioPlayable: true,
        language: data.detectedLanguage,
        products: data.suggestedProducts,
        timestamp: new Date().toLocaleTimeString()
      }]);
    } catch (err) {
      setChatHistory(prev => [...prev, {
        sender: 'ai',
        text: 'Sorry, AI assistant is temporarily busy. Please check our conventional product catalog.',
        timestamp: new Date().toLocaleTimeString()
      }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const reviewSubOrder = async (subOrderId: string, action: 'Approved' | 'Rejected') => {
    try {
      await fetch(`/api/suborders/${subOrderId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectReason: action === 'Rejected' ? 'Stock temporarily limited' : undefined })
      });
      fetchData();
    } catch (err) {
      console.error('Review suborder error', err);
    }
  };

  const assignShipment = async (shipmentId: string) => {
    try {
      await fetch(`/api/shipments/${shipmentId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: 'DRV-01', assigneeName: 'Gul Khan Logistics' })
      });
      fetchData();
    } catch (err) {
      console.error('Assign error', err);
    }
  };

  const toggleWholesalerStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await fetch(`/api/wholesalers/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`/api/wholesalers/${id}`, { method: 'DELETE' });
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
        headers: { 'Content-Type': 'application/json' },
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#502A40] flex items-center justify-center text-[#F6F0E8]">
        <div className="text-center space-y-4">
          <RefreshCw className="w-10 h-10 animate-spin mx-auto text-[#C7A67C]" />
          <p className="text-lg font-serif">Loading Wholesale Platform...</p>
        </div>
      </div>
    );
  }

  // ================= 1. GATEWAY HOMEPAGE =================
  if (navState === 'gateway') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] text-[#502A40] flex flex-col font-sans selection:bg-[#C7A67C] selection:text-white">
        <header className="bg-[#502A40] text-[#F6F0E8] py-6 px-8 shadow-md">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-[#C7A67C] flex items-center justify-center shadow-lg text-[#502A40]">
                <Store className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-serif font-bold tracking-wide">Peshawar General Store & Drinks Wholesale</h1>
                <p className="text-xs text-[#C7A67C] tracking-widest uppercase">Elite B2B Wholesale Marketplace</p>
              </div>
            </div>
            <div className="hidden md:flex items-center space-x-6 text-sm text-[#F6F0E8]/80 font-serif">
              <span>Secure Portals</span>
              <span>•</span>
              <span>Beverages & Groceries</span>
              <span>•</span>
              <span>Multi-Agent AI</span>
            </div>
          </div>
        </header>

        <section className="relative py-16 px-6 bg-[#502A40] text-white overflow-hidden">
          <div className="absolute inset-0 opacity-25 mix-blend-overlay bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1600&q=80')` }}></div>
          <div className="max-w-5xl mx-auto relative z-10 text-center space-y-6">
            <span className="bg-[#C7A67C]/20 border border-[#C7A67C]/40 text-[#C7A67C] px-4 py-1.5 rounded-full text-xs font-serif uppercase tracking-widest">
              Exclusive Wholesale Distribution
            </span>
            <h2 className="text-4xl md:text-6xl font-serif font-bold leading-tight">
              Sourcing Excellence for <span className="text-[#C7A67C]">General Stores & Drinks</span>
            </h2>
            <p className="text-base md:text-lg text-[#F6F0E8]/95 max-w-2xl mx-auto font-light leading-relaxed">
              Connect directly with independent wholesalers, beverages distributors, and flour mills. Experience seamless multi-agent AI ordering and rapid delivery dispatch.
            </p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-16 -mt-10 relative z-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 flex flex-col justify-between hover:-translate-y-1 transition duration-300">
              <div className="space-y-4">
                <div className="h-48 rounded-2xl overflow-hidden shadow-inner">
                  <img src="https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&w=800&q=80" alt="General Store Drinks" className="w-full h-full object-cover hover:scale-105 transition duration-500" />
                </div>
                <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] flex items-center justify-center font-serif text-xl shadow">
                  <ShoppingCart className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-[#502A40]">Client / Shopkeeper Portal</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Browse drinks, beverages, and grocery catalogs, chat with our multilingual AI assistant, and place multi-wholesaler orders.
                </p>
              </div>
              <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-3">
                <button onClick={() => { setClientAuthMode('signin'); setNavState('client_auth'); }} className="flex-1 bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow">Sign In</button>
                <button onClick={() => { setClientAuthMode('signup'); setNavState('client_auth'); }} className="flex-1 bg-[#C7A67C] hover:bg-[#b5926b] text-[#502A40] font-semibold py-3 rounded-xl font-serif text-sm transition shadow">Sign Up</button>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 flex flex-col justify-between hover:-translate-y-1 transition duration-300">
              <div className="space-y-4">
                <div className="h-48 rounded-2xl overflow-hidden shadow-inner">
                  <img src="https://images.unsplash.com/photo-1588964895597-cfccd6e2dbf9?auto=format&fit=crop&w=800&q=80" alt="Wholesale Inventory" className="w-full h-full object-cover hover:scale-105 transition duration-500" />
                </div>
                <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] flex items-center justify-center font-serif text-xl shadow">
                  <Package className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-[#502A40]">Wholesaler Tenant Portal</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Manage your private catalog, stock inventory, revenues, COGS, and approve/reject incoming suborders.
                </p>
              </div>
              <div className="pt-6 mt-6 border-t border-slate-100">
                <button onClick={() => setNavState('wholesaler_auth')} className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow flex items-center justify-center gap-2">
                  Sign In <ArrowRight className="w-4 h-4 text-[#C7A67C]" />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 flex flex-col justify-between hover:-translate-y-1 transition duration-300">
              <div className="space-y-4">
                <div className="h-48 rounded-2xl overflow-hidden shadow-inner">
                  <img src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80" alt="Logistics & Dispatch" className="w-full h-full object-cover hover:scale-105 transition duration-500" />
                </div>
                <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] flex items-center justify-center font-serif text-xl shadow">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-serif font-bold text-[#502A40]">Super Admin Portal</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Oversee tenant onboarding & suspension, global order dispatch queues, delivery assignments, and immutable audit logs.
                </p>
              </div>
              <div className="pt-6 mt-6 border-t border-slate-100">
                <button onClick={() => setNavState('admin_auth')} className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow flex items-center justify-center gap-2">
                  Sign In <ArrowRight className="w-4 h-4 text-[#C7A67C]" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-auto bg-[#502A40] text-[#F6F0E8] py-8 px-6 text-center text-xs font-serif border-t border-[#C7A67C]/20">
          <p>© 2026 Peshawar General Store & Drinks Wholesale Platform. Elegant Premium Theme Edition.</p>
        </footer>
      </div>
    );
  }

  // ================= 2. CLIENT AUTH =================
  if (navState === 'client_auth') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 space-y-6">
          <button onClick={() => setNavState('gateway')} className="flex items-center gap-2 text-xs font-serif text-[#502A40] hover:text-[#C7A67C] transition">
            <ArrowLeft className="w-4 h-4" /> Back to Gateway
          </button>
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] mx-auto flex items-center justify-center shadow">
              <Store className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#502A40]">
              {clientAuthMode === 'signin' ? 'Client Sign In' : 'Client Registration'}
            </h2>
            <p className="text-xs text-slate-500">
              {clientAuthMode === 'signin' ? 'Enter your phone number to access your store orders.' : 'Enter your exact Name, Store Name, and Phone Number.'}
            </p>
          </div>
          {authError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium">{authError}</div>}
          {clientAuthMode === 'signup' ? (
            <form onSubmit={handleClientSignup} className="space-y-4">
              <div>
                <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Your Full Name</label>
                <input type="text" required value={clientSignupForm.name} onChange={e => setClientSignupForm({ ...clientSignupForm, name: e.target.value })} placeholder="e.g. Babar Khan" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
              </div>
              <div>
                <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Store Name</label>
                <input type="text" required value={clientSignupForm.storeName} onChange={e => setClientSignupForm({ ...clientSignupForm, storeName: e.target.value })} placeholder="e.g. Babar General Store" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
              </div>
              <div>
                <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Phone Number</label>
                <input type="text" required value={clientSignupForm.phone} onChange={e => setClientSignupForm({ ...clientSignupForm, phone: e.target.value })} placeholder="e.g. 03009876543" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
              </div>
              <button type="submit" className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow-lg">Complete Sign Up</button>
            </form>
          ) : (
            <form onSubmit={handleClientSignin} className="space-y-4">
              <div>
                <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Phone Number</label>
                <input type="text" required value={clientSigninPhone} onChange={e => setClientSigninPhone(e.target.value)} placeholder="e.g. 03009876543" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
              </div>
              <button type="submit" className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow-lg">Sign In to Portal</button>
            </form>
          )}
          <div className="text-center pt-2">
            <button onClick={() => { setClientAuthMode(clientAuthMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }} className="text-xs text-[#C7A67C] hover:underline font-serif">
              {clientAuthMode === 'signin' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ================= 3. WHOLESALER AUTH =================
  if (navState === 'wholesaler_auth') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 space-y-6">
          <button onClick={() => setNavState('gateway')} className="flex items-center gap-2 text-xs font-serif text-[#502A40] hover:text-[#C7A67C] transition">
            <ArrowLeft className="w-4 h-4" /> Back to Gateway
          </button>
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] mx-auto flex items-center justify-center shadow">
              <Package className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#502A40]">Wholesaler Sign In</h2>
            <p className="text-xs text-slate-500">Enter your registered tenant email and exact password.</p>
          </div>
          {authError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium">{authError}</div>}
          <form onSubmit={handleWholesalerSignin} className="space-y-4">
            <div>
              <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Wholesaler Email</label>
              <input type="email" required value={wholesalerEmail} onChange={e => setWholesalerEmail(e.target.value)} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
            </div>
            <div>
              <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Password</label>
              <input type="password" required value={wholesalerPassword} onChange={e => setWholesalerPassword(e.target.value)} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
            </div>
            <button type="submit" className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow-lg">Sign In to Tenant Portal</button>
          </form>
          <div className="text-xs text-slate-400 text-center">Demo credentials: wholesaler1@market.pk / password123</div>
        </div>
      </div>
    );
  }

  // ================= 4. ADMIN AUTH =================
  if (navState === 'admin_auth') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-[#C7A67C]/30 space-y-6">
          <button onClick={() => setNavState('gateway')} className="flex items-center gap-2 text-xs font-serif text-[#502A40] hover:text-[#C7A67C] transition">
            <ArrowLeft className="w-4 h-4" /> Back to Gateway
          </button>
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#502A40] text-[#C7A67C] mx-auto flex items-center justify-center shadow">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#502A40]">Super Admin Sign In</h2>
            <p className="text-xs text-slate-500">Enter exact administrator credentials.</p>
          </div>
          {authError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium">{authError}</div>}
          <form onSubmit={handleAdminSignin} className="space-y-4">
            <div>
              <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Admin Email</label>
              <input type="email" required value={adminEmail} onChange={e => setAdminEmail(e.target.value)} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
            </div>
            <div>
              <label className="text-xs font-serif font-semibold text-[#502A40] block mb-1">Password</label>
              <input type="password" required value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
            </div>
            <button type="submit" className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow-lg">Sign In as Super Admin</button>
          </form>
          <div className="text-xs text-slate-400 text-center">Demo credentials: admin@market.pk / admin123</div>
        </div>
      </div>
    );
  }

  // ================= 5. CLIENT PORTAL =================
  if (navState === 'client_portal') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] text-[#502A40] flex flex-col font-sans">
        <header className="bg-[#502A40] text-[#F6F0E8] px-6 py-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#C7A67C] flex items-center justify-center text-[#502A40] font-bold">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-base">{currentClient?.storeName || 'Babar General Store'}</h1>
              <p className="text-xs text-[#C7A67C]">Client Portal • {currentClient?.name}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button onClick={() => setCheckoutModal(true)} className="relative bg-[#C7A67C]/20 border border-[#C7A67C]/40 text-[#F6F0E8] hover:bg-[#C7A67C]/30 px-4 py-2 rounded-xl flex items-center gap-2 text-xs font-serif transition">
              <ShoppingCart className="w-4 h-4 text-[#C7A67C]" /> Cart ({totalCartItemsCount})
              {totalCartItemsCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-[#C7A67C] text-[#502A40] font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center">{totalCartItemsCount}</span>}
            </button>
            <button onClick={() => setNavState('gateway')} className="bg-white/10 hover:bg-white/20 text-[#F6F0E8] px-3 py-2 rounded-xl text-xs font-serif flex items-center gap-1.5 transition">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </header>

        <div className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
          <div className="flex space-x-2 bg-white p-2 rounded-2xl border border-[#C7A67C]/30 shadow-sm">
            <button onClick={() => setClientTab('chat')} className={`px-4 py-2 rounded-xl text-xs font-serif transition flex items-center gap-2 ${clientTab === 'chat' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}><MessageSquare className="w-4 h-4 text-[#C7A67C]" /> AI Assistant & Drinks Chat</button>
            <button onClick={() => setClientTab('catalog')} className={`px-4 py-2 rounded-xl text-xs font-serif transition flex items-center gap-2 ${clientTab === 'catalog' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}><Package className="w-4 h-4 text-[#C7A67C]" /> General Store & Drinks Catalog</button>
            <button onClick={() => setClientTab('orders')} className={`px-4 py-2 rounded-xl text-xs font-serif transition flex items-center gap-2 ${clientTab === 'orders' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}><Clock className="w-4 h-4 text-[#C7A67C]" /> Orders Timeline</button>
            <button onClick={() => setClientTab('invoices')} className={`px-4 py-2 rounded-xl text-xs font-serif transition flex items-center gap-2 ${clientTab === 'invoices' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}><FileText className="w-4 h-4 text-[#C7A67C]" /> Invoices & Balances</button>
          </div>

          {clientTab === 'chat' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-3xl border border-[#C7A67C]/30 flex flex-col h-[600px] shadow-xl overflow-hidden">
                <div className="p-4 bg-[#502A40] text-[#F6F0E8] flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-[#C7A67C] flex items-center justify-center text-[#502A40] font-bold text-xs">AI</div>
                    <div>
                      <h3 className="font-serif font-bold text-sm">Peshawar Wholesale Assistant</h3>
                      <p className="text-[10px] text-[#C7A67C]">Multilingual Drinks & Groceries AI</p>
                    </div>
                  </div>
                  <div className="flex space-x-1 bg-black/20 p-1 rounded-xl">
                    <button onClick={() => setChatLanguage('ur')} className={`px-2.5 py-1 rounded-lg text-xs font-serif ${chatLanguage === 'ur' ? 'bg-[#C7A67C] text-[#502A40]' : 'text-white'}`}>اردو</button>
                    <button onClick={() => setChatLanguage('ps')} className={`px-2.5 py-1 rounded-lg text-xs font-serif ${chatLanguage === 'ps' ? 'bg-[#C7A67C] text-[#502A40]' : 'text-white'}`}>پښتو</button>
                    <button onClick={() => setChatLanguage('en')} className={`px-2.5 py-1 rounded-lg text-xs font-serif ${chatLanguage === 'en' ? 'bg-[#C7A67C] text-[#502A40]' : 'text-white'}`}>ENG</button>
                  </div>
                </div>

                <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#F6F0E8]/40">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm ${msg.sender === 'user' ? 'bg-[#502A40] text-white rounded-br-sm' : 'bg-white text-[#502A40] rounded-bl-sm border border-[#C7A67C]/30'}`}>
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        {msg.products && msg.products.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {msg.products.map(p => (
                              <div key={p.id} className="bg-[#F6F0E8] p-2.5 rounded-xl border border-[#C7A67C]/30 flex flex-col justify-between">
                                <div>
                                  <h4 className="font-serif font-bold text-xs text-[#502A40]">{p.name}</h4>
                                  <p className="text-xs text-slate-600 font-semibold mt-1">PKR {p.sellingPrice.toLocaleString()} / {p.unit}</p>
                                </div>
                                <button onClick={() => { addToCart(p.id, p.moq); alert(`Added ${p.name} to cart!`); }} className="mt-2 bg-[#502A40] hover:bg-[#683753] text-white text-xs py-1.5 rounded-lg font-serif transition">Add to Cart</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
                    </div>
                  ))}
                  {isAiLoading && <p className="text-xs text-slate-500 italic">AI assistant is checking stock...</p>}
                </div>

                <div className="p-3 bg-white border-t border-[#C7A67C]/30 flex items-center gap-2">
                  <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Ask for drinks, beverages, flour, or grocery stocks..." className="flex-1 bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl px-4 py-2.5 text-sm text-[#502A40] focus:outline-none focus:border-[#502A40]" />
                  <button onClick={handleSendMessage} className="bg-[#502A40] hover:bg-[#683753] text-white p-2.5 rounded-xl transition shadow"><Send className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-white rounded-3xl p-6 border border-[#C7A67C]/30 shadow-xl space-y-4">
                  <h4 className="font-serif font-bold text-[#502A40] text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#C7A67C]" /> Drinks & Store Quick Prompts</h4>
                  <div className="space-y-2">
                    <button onClick={() => { setChatInput('Show available drinks and cold beverages'); handleSendMessage(); }} className="w-full text-left p-3 rounded-xl bg-[#F6F0E8]/60 hover:bg-[#F6F0E8] border border-[#C7A67C]/30 text-xs text-[#502A40] font-serif transition">"Show available drinks and cold beverages"</button>
                    <button onClick={() => { setChatInput('5 bags of super fine wheat flour'); handleSendMessage(); }} className="w-full text-left p-3 rounded-xl bg-[#F6F0E8]/60 hover:bg-[#F6F0E8] border border-[#C7A67C]/30 text-xs text-[#502A40] font-serif transition">"5 bags of super fine wheat flour"</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {clientTab === 'catalog' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {products.map(p => (
                <div key={p.id} className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] bg-[#C7A67C]/20 text-[#502A40] px-2 py-0.5 rounded-full font-serif font-semibold">{p.sku}</span>
                    <h3 className="font-serif font-bold text-[#502A40] text-lg mt-2 mb-1">{p.name}</h3>
                    <p className="text-xs text-slate-500 mb-4">Pack: {p.packSize} | Stock: {p.stockOnHand} {p.unit}s</p>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    <span className="text-base font-bold text-[#502A40]">PKR {p.sellingPrice.toLocaleString()}</span>
                    <button onClick={() => { addToCart(p.id, p.moq); alert(`Added ${p.name} to cart!`); }} className="bg-[#502A40] hover:bg-[#683753] text-white px-4 py-2 rounded-xl text-xs font-serif transition shadow">Add to Cart</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {clientTab === 'orders' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">My Orders & Suborders Timeline</h3>
              <div className="space-y-4">
                {orders.map(ord => (
                  <div key={ord.id} className="bg-[#F6F0E8]/50 p-5 rounded-2xl border border-[#C7A67C]/30 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-[#C7A67C]/20">
                      <div>
                        <span className="font-serif font-bold text-[#502A40] text-base">{ord.id}</span>
                        <span className="ml-3 text-xs bg-[#C7A67C]/20 text-[#502A40] px-2.5 py-0.5 rounded-full font-serif font-semibold">{ord.status}</span>
                      </div>
                      <span className="font-serif font-bold text-[#502A40]">PKR {ord.totalAmount.toLocaleString()}</span>
                    </div>
                    <ul className="text-xs text-slate-600 space-y-1">
                      {(ord.subOrders || []).flatMap(s => s.items || []).map((item, i) => (
                        <li key={i}>• {item.name} × {item.quantity} {item.unit}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {clientTab === 'invoices' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">Invoices & Account Balances</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-[#F6F0E8] text-[#502A40] font-serif text-xs uppercase">
                    <tr><th className="p-3">Invoice ID</th><th className="p-3">Order ID</th><th className="p-3">Amount</th><th className="p-3">Paid</th><th className="p-3">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map(inv => (
                      <tr key={inv.id}>
                        <td className="p-3 font-serif font-bold text-[#502A40]">{inv.id}</td>
                        <td className="p-3">{inv.orderId}</td>
                        <td className="p-3 font-semibold">PKR {inv.amount.toLocaleString()}</td>
                        <td className="p-3 text-emerald-600">PKR {inv.paidAmount.toLocaleString()}</td>
                        <td className="p-3"><span className="bg-[#C7A67C]/20 text-[#502A40] px-2 py-0.5 rounded text-xs font-serif">{inv.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {checkoutModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-[#C7A67C]/40 rounded-3xl p-6 max-w-lg w-full space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h3 className="font-serif font-bold text-[#502A40] text-xl">Confirm Wholesale Order</h3>
                <button onClick={() => setCheckoutModal(false)} className="text-slate-400 hover:text-[#502A40]">✕</button>
              </div>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {Object.keys(cart).map(productId => {
                  const p = products.find(prod => prod.id === productId);
                  if (!p) return null;
                  return (
                    <div key={productId} className="bg-[#F6F0E8]/50 p-3 rounded-2xl flex justify-between items-center">
                      <div>
                        <h4 className="font-serif font-bold text-[#502A40] text-sm">{p.name}</h4>
                        <p className="text-xs text-slate-500">PKR {p.sellingPrice.toLocaleString()} / {p.unit}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button onClick={() => updateCartQty(productId, cart[productId] - 1)} className="px-2 py-0.5 bg-white rounded border border-[#C7A67C]/30">-</button>
                        <span className="text-xs font-bold text-[#502A40]">{cart[productId]}</span>
                        <button onClick={() => updateCartQty(productId, cart[productId] + 1)} className="px-2 py-0.5 bg-white rounded border border-[#C7A67C]/30">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <span className="font-serif text-slate-600">Total Consolidated:</span>
                <span className="font-serif font-bold text-xl text-[#502A40]">
                  PKR {Object.keys(cart).reduce((sum, id) => {
                    const p = products.find(prod => prod.id === id);
                    return sum + (p ? p.sellingPrice * cart[id] : 0);
                  }, 0).toLocaleString()}
                </span>
              </div>
              <button onClick={submitOrder} className="w-full bg-[#502A40] hover:bg-[#683753] text-white py-3 rounded-xl font-serif text-sm transition shadow-lg">Submit Order to Wholesaler(s)</button>
            </div>
          </div>
        )}
      </div>
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
        const prod = products.find(p => p.id === item.productId);
        return sum + ((prod ? prod.costPrice : 0) * item.quantity);
      }, 0);
    }, 0);
    const myProfit = myRevenue - myCogs;

    return (
      <div className="min-h-screen bg-[#F6F0E8] text-[#502A40] flex flex-col font-sans">
        <header className="bg-[#502A40] text-[#F6F0E8] px-6 py-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#C7A67C] flex items-center justify-center text-[#502A40] font-bold">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-base">{wh?.name || 'Wholesaler'} (My Tenant Portal)</h1>
              <p className="text-xs text-[#C7A67C]">{wh?.city || 'Peshawar'} • Isolated Secure View</p>
            </div>
          </div>
          <button onClick={() => setNavState('gateway')} className="bg-white/10 hover:bg-white/20 text-[#F6F0E8] px-3 py-2 rounded-xl text-xs font-serif flex items-center gap-1.5 transition">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </header>

        <div className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
          <div className="flex space-x-2 bg-white p-2 rounded-2xl border border-[#C7A67C]/30 shadow-sm">
            <button onClick={() => setWholesalerTab('dashboard')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${wholesalerTab === 'dashboard' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>My Dashboard & Profit</button>
            <button onClick={() => setWholesalerTab('products')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${wholesalerTab === 'products' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>My Catalog & Stock</button>
            <button onClick={() => setWholesalerTab('suborders')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${wholesalerTab === 'suborders' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>My Suborders ({mySubOrders.length})</button>
          </div>

          {wholesalerTab === 'dashboard' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">My Revenue</span>
                <span className="text-2xl font-serif font-bold text-[#502A40]">PKR {myRevenue.toLocaleString()}</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">My COGS</span>
                <span className="text-2xl font-serif font-bold text-slate-600">PKR {myCogs.toLocaleString()}</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">My Gross Profit</span>
                <span className="text-2xl font-serif font-bold text-[#C7A67C]">PKR {myProfit.toLocaleString()}</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">Status</span>
                <span className="text-xl font-serif font-bold text-emerald-600 uppercase">{wh?.status}</span>
              </div>
            </div>
          )}

          {wholesalerTab === 'products' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">My Products & Inventory (Isolated)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-[#F6F0E8] text-[#502A40] font-serif text-xs uppercase">
                    <tr><th className="p-3">SKU</th><th className="p-3">Name</th><th className="p-3">Cost</th><th className="p-3">Selling Price</th><th className="p-3">Stock</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myProducts.map(p => (
                      <tr key={p.id}>
                        <td className="p-3 font-serif font-bold text-[#502A40]">{p.sku}</td>
                        <td className="p-3">{p.name}</td>
                        <td className="p-3">PKR {p.costPrice.toLocaleString()}</td>
                        <td className="p-3 font-semibold">PKR {p.sellingPrice.toLocaleString()}</td>
                        <td className="p-3 text-emerald-600 font-bold">{p.stockOnHand} {p.unit}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {wholesalerTab === 'suborders' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">My Suborder Approvals</h3>
              <div className="space-y-4">
                {mySubOrders.map(sub => (
                  <div key={sub.id} className="bg-[#F6F0E8]/40 p-5 rounded-2xl border border-[#C7A67C]/30 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-serif font-bold text-[#502A40]">{sub.id}</span>
                        <span className="text-xs bg-[#C7A67C]/20 text-[#502A40] px-2 py-0.5 rounded font-serif">{sub.status}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Client: {sub.clientName} | Order: {sub.orderId}</p>
                      <ul className="text-xs text-slate-600 mt-2 space-y-1">
                        {(sub.items || []).map((it, i) => (
                          <li key={i}>• {it.name} × {it.quantity} {it.unit} (PKR {(it.quantity * it.unitPrice).toLocaleString()})</li>
                        ))}
                      </ul>
                    </div>
                    {sub.status === 'Submitted' && (
                      <div className="flex gap-2">
                        <button onClick={() => reviewSubOrder(sub.id, 'Approved')} className="bg-[#502A40] hover:bg-[#683753] text-white px-4 py-2 rounded-xl text-xs font-serif transition shadow">Approve</button>
                        <button onClick={() => reviewSubOrder(sub.id, 'Rejected')} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-xs font-serif transition">Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ================= 7. ADMIN PORTAL =================
  if (navState === 'admin_portal') {
    return (
      <div className="min-h-screen bg-[#F6F0E8] text-[#502A40] flex flex-col font-sans">
        <header className="bg-[#502A40] text-[#F6F0E8] px-6 py-4 shadow-md sticky top-0 z-40 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#C7A67C] flex items-center justify-center text-[#502A40] font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-base">Super Admin Control Hub (Sees Everything)</h1>
              <p className="text-xs text-[#C7A67C]">Platform Governance & Full Auditing</p>
            </div>
          </div>
          <button onClick={() => setNavState('gateway')} className="bg-white/10 hover:bg-white/20 text-[#F6F0E8] px-3 py-2 rounded-xl text-xs font-serif flex items-center gap-1.5 transition">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </header>

        <div className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
          <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-[#C7A67C]/30 shadow-sm">
            <button onClick={() => setAdminTab('overview')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${adminTab === 'overview' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>Overview</button>
            <button onClick={() => setAdminTab('wholesalers')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${adminTab === 'wholesalers' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>Manage Wholesalers</button>
            <button onClick={() => setAdminTab('all_orders')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${adminTab === 'all_orders' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>All Client Orders & Approvals</button>
            <button onClick={() => setAdminTab('dispatch')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${adminTab === 'dispatch' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>Dispatch & Logistics</button>
            <button onClick={() => setAdminTab('audit')} className={`px-4 py-2 rounded-xl text-xs font-serif transition ${adminTab === 'audit' ? 'bg-[#502A40] text-[#F6F0E8]' : 'text-slate-600 hover:bg-[#F6F0E8]'}`}>Audit Logs</button>
          </div>

          {adminTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">Total Gross GMV</span>
                <span className="text-2xl font-serif font-bold text-[#502A40]">PKR 1,450,200</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">Total Wholesalers</span>
                <span className="text-2xl font-serif font-bold text-emerald-600">{wholesalers.length}</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">Total Client Orders</span>
                <span className="text-2xl font-serif font-bold text-[#502A40]">{orders.length}</span>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-[#C7A67C]/30 shadow-xl">
                <span className="text-xs font-serif text-slate-500 block mb-1">Pending Shipments</span>
                <span className="text-2xl font-serif font-bold text-[#C7A67C]">{shipments.filter(s => s.status === 'Unassigned').length}</span>
              </div>
            </div>
          )}

          {adminTab === 'wholesalers' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-serif font-bold text-[#502A40] text-lg">Wholesaler Tenants Management (Add, Suspend, Reactivate, Remove)</h3>
                <button onClick={() => setShowAddWholesalerModal(true)} className="bg-[#502A40] hover:bg-[#683753] text-white px-4 py-2 rounded-xl text-xs font-serif transition shadow flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Add New Wholesaler
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-[#F6F0E8] text-[#502A40] font-serif text-xs uppercase">
                    <tr><th className="p-3">ID</th><th className="p-3">Name</th><th className="p-3">City</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wholesalers.map(w => (
                      <tr key={w.id}>
                        <td className="p-3 font-serif font-bold text-[#502A40]">{w.id}</td>
                        <td className="p-3">{w.name}</td>
                        <td className="p-3">{w.city}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-serif ${w.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{w.status}</span></td>
                        <td className="p-3 text-right space-x-2">
                          <button onClick={() => toggleWholesalerStatus(w.id, w.status)} className="bg-[#C7A67C]/20 hover:bg-[#C7A67C]/30 text-[#502A40] px-3 py-1 rounded text-xs font-serif transition">
                            {w.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </button>
                          <button onClick={() => deleteWholesaler(w.id)} className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1 rounded text-xs font-serif transition">
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminTab === 'all_orders' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">All Client Orders & Wholesaler Approvals (Admin Master View)</h3>
              <div className="space-y-4">
                {orders.map(ord => (
                  <div key={ord.id} className="bg-[#F6F0E8]/40 p-5 rounded-2xl border border-[#C7A67C]/30 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-[#C7A67C]/20">
                      <div>
                        <span className="font-serif font-bold text-[#502A40] text-base">{ord.id}</span>
                        <span className="ml-3 text-xs bg-[#C7A67C]/20 text-[#502A40] px-2.5 py-0.5 rounded font-serif">{ord.status}</span>
                        <span className="ml-2 text-xs text-slate-500">Client: {ord.clientName}</span>
                      </div>
                      <span className="font-serif font-bold text-[#502A40]">PKR {ord.totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-serif font-semibold text-slate-600">Suborders by Wholesaler:</p>
                      {(ord.subOrders || []).map(sub => {
                        const wh = wholesalers.find(w => w.id === sub.wholesalerId);
                        return (
                          <div key={sub.id} className="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center text-xs">
                            <div>
                              <span className="font-bold text-[#502A40]">{wh?.name || sub.wholesalerId}</span>: 
                              <span className="ml-2 text-slate-600">{(sub.items || []).map(it => `${it.name} (${it.quantity} ${it.unit})`).join(', ')}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded font-serif ${sub.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{sub.status}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'dispatch' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">Order Dispatch & Delivery Assignment</h3>
              <div className="space-y-4">
                {shipments.map(shp => (
                  <div key={shp.id} className="bg-[#F6F0E8]/40 p-5 rounded-2xl border border-[#C7A67C]/30 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-serif font-bold text-[#502A40]">{shp.id}</span>
                        <span className="text-xs bg-[#C7A67C]/20 text-[#502A40] px-2 py-0.5 rounded font-serif">{shp.status}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Order: {shp.orderId} | Assigned: {shp.assigneeName || 'Unassigned'}</p>
                    </div>
                    {shp.status === 'Unassigned' && (
                      <button onClick={() => assignShipment(shp.id)} className="bg-[#502A40] hover:bg-[#683753] text-white px-4 py-2 rounded-xl text-xs font-serif transition shadow">Assign Delivery Partner</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'audit' && (
            <div className="bg-white rounded-3xl border border-[#C7A67C]/30 p-6 shadow-xl space-y-4">
              <h3 className="font-serif font-bold text-[#502A40] text-lg">Immutable Audit Trail</h3>
              <div className="space-y-3">
                {auditEvents.map(evt => (
                  <div key={evt.id} className="bg-[#F6F0E8]/50 p-4 rounded-xl border border-[#C7A67C]/20 flex justify-between items-center">
                    <div>
                      <span className="text-xs bg-[#502A40] text-[#F6F0E8] px-2 py-0.5 rounded font-mono">{evt.action}</span>
                      <p className="text-xs text-slate-700 mt-1">{evt.details}</p>
                    </div>
                    <span className="text-[10px] text-slate-400">{new Date(evt.timestamp).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showAddWholesalerModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <form onSubmit={handleAddWholesaler} className="bg-white border border-[#C7A67C]/40 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
              <h3 className="font-serif font-bold text-[#502A40] text-xl">Add New Wholesaler Tenant</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">Wholesaler Name</label>
                  <input type="text" required value={newWholesalerForm.name} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, name: e.target.value })} placeholder="e.g. Swat Beverages & Drinks" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">Category</label>
                  <input type="text" required value={newWholesalerForm.category} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, category: e.target.value })} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">City / Hub</label>
                  <input type="text" required value={newWholesalerForm.city} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, city: e.target.value })} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">Owner Email (Sign In)</label>
                  <input type="email" required value={newWholesalerForm.ownerEmail} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, ownerEmail: e.target.value })} placeholder="tenant@market.pk" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">Password</label>
                  <input type="text" required value={newWholesalerForm.password} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, password: e.target.value })} className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
                <div>
                  <label className="font-serif font-semibold text-[#502A40] block mb-1">Phone</label>
                  <input type="text" required value={newWholesalerForm.phone} onChange={e => setNewWholesalerForm({ ...newWholesalerForm, phone: e.target.value })} placeholder="+92 300 0000000" className="w-full bg-[#F6F0E8]/50 border border-[#C7A67C]/40 rounded-xl p-3 text-sm text-[#502A40]" />
                </div>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setShowAddWholesalerModal(false)} className="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600 font-serif">Cancel`</button>
                <button type="submit" className="px-4 py-2 rounded-xl text-xs bg-[#502A40] hover:bg-[#683753] text-white font-serif font-semibold">Create Tenant</button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return null;
}
