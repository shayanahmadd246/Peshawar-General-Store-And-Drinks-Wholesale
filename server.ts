import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

interface Wholesaler {
  id: string;
  name: string;
  category: string;
  city: string;
  status: 'active' | 'suspended';
  ownerEmail: string;
  phone: string;
  rating: number;
  password?: string;
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

interface ClientUser {
  id: string;
  name: string;
  storeName: string;
  phone: string;
}

// Seed Data
let wholesalers: Wholesaler[] = [
  { id: 'W001', name: 'Khyber Grain & Flour Mills', category: 'Grains & Flour', city: 'Peshawar', status: 'active', ownerEmail: 'wholesaler1@market.pk', phone: '+92 300 1234567', rating: 4.8, password: 'password123' },
  { id: 'W002', name: 'Peshawar Electronics & Solar', category: 'Electronics & Solar', city: 'Karkhano Market', status: 'active', ownerEmail: 'wholesaler2@market.pk', phone: '+92 301 7654321', rating: 4.6, password: 'password123' },
  { id: 'W003', name: 'Frontier Spices & Dry Fruits', category: 'Spices & Dry Fruits', city: 'Peshawar', status: 'active', ownerEmail: 'wholesaler3@market.pk', phone: '+92 302 9876543', rating: 4.9, password: 'password123' },
];

let clients: ClientUser[] = [
  { id: 'CLI-01', name: 'Babar Khan', storeName: 'Babar General Store', phone: '03009876543' }
];

let products: Product[] = [
  {
    id: 'P101',
    wholesalerId: 'W001',
    sku: 'FLOUR-SUPER-50KG',
    name: 'Super Fine Wheat Flour (50kg Bag)',
    aliases: { en: 'Wheat Flour Bag 50kg', ur: 'گندم کا آٹا 50 کلو', ps: 'غنم اوړه 50 کیلو' },
    unit: 'bag',
    packSize: '50kg bag',
    costPrice: 6200,
    sellingPrice: 6800,
    moq: 2,
    reorderPoint: 20,
    stockOnHand: 150,
    stockReserved: 10,
    status: 'available'
  },
  {
    id: 'P102',
    wholesalerId: 'W001',
    sku: 'RICE-BASMATI-25KG',
    name: 'Khyber Premium Basmati Rice (25kg)',
    aliases: { en: 'Basmati Rice 25kg', ur: 'باسമതി چاول 25 کلو', ps: 'باسمتی وریجې 25 کیلو' },
    unit: 'bag',
    packSize: '25kg bag',
    costPrice: 9500,
    sellingPrice: 10500,
    moq: 1,
    reorderPoint: 15,
    stockOnHand: 80,
    stockReserved: 5,
    status: 'available'
  },
  {
    id: 'P103',
    wholesalerId: 'W001',
    sku: 'COOKING-OIL-16L',
    name: 'Pure Banaspati Cooking Oil (16L Tin)',
    aliases: { en: 'Cooking Oil Tin 16L', ur: 'کوکنگ آئل 16 لٹر', ps: 'پخولو غوړي 16 لټره' },
    unit: 'carton',
    packSize: '16 Liter Tin',
    costPrice: 5400,
    sellingPrice: 5900,
    moq: 2,
    reorderPoint: 25,
    stockOnHand: 120,
    stockReserved: 0,
    status: 'available'
  },
  {
    id: 'P201',
    wholesalerId: 'W002',
    sku: 'SOLAR-PANEL-550W',
    name: 'Mono Perc Solar Panel 550W Tier-1',
    aliases: { en: '550W Solar Panel', ur: 'سولر پینل 550 واٹ', ps: 'سولر پینل 550 واټ' },
    unit: 'piece',
    packSize: '1 piece',
    costPrice: 28500,
    sellingPrice: 31000,
    moq: 2,
    reorderPoint: 10,
    stockOnHand: 45,
    stockReserved: 4,
    status: 'available'
  },
  {
    id: 'P301',
    wholesalerId: 'W003',
    sku: 'SPICE-RED-CHILI-5KG',
    name: 'Peshawari Red Chili Powder (5kg)',
    aliases: { en: 'Red Chili Powder 5kg', ur: 'سرخ مرچ پاؤڈر 5 کلو', ps: 'سرخ مرچ پوډر 5 کیلو' },
    unit: 'bag',
    packSize: '5kg pack',
    costPrice: 3200,
    sellingPrice: 3600,
    moq: 2,
    reorderPoint: 10,
    stockOnHand: 60,
    stockReserved: 0,
    status: 'available'
  }
];

let orders: Order[] = [
  {
    id: 'ORD-1001',
    clientId: 'CLI-01',
    clientName: 'Babar General Store (Peshawar)',
    deliveryAddress: 'University Road, near Islamia College, Peshawar',
    status: 'Approved',
    subOrders: [
      {
        id: 'SUB-1001-1',
        wholesalerId: 'W001',
        items: [
          { productId: 'P101', name: 'Super Fine Wheat Flour (50kg Bag)', quantity: 5, unitPrice: 6800, unit: 'bag' },
          { productId: 'P103', name: 'Pure Banaspati Cooking Oil (16L Tin)', quantity: 4, unitPrice: 5900, unit: 'carton' }
        ],
        subtotal: 57600,
        status: 'Approved'
      }
    ],
    totalAmount: 57600,
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    paymentStatus: 'Unpaid',
    paidAmount: 0
  }
];

let shipments: Shipment[] = [
  {
    id: 'SHP-9001',
    orderId: 'ORD-1001',
    wholesalerId: 'W001',
    assigneeId: 'DRV-01',
    assigneeName: 'Gul Khan Logistics',
    status: 'Assigned',
    expectedDate: new Date(Date.now() + 86400000).toISOString()
  }
];

let invoices: Invoice[] = [
  {
    id: 'INV-5001',
    orderId: 'ORD-1001',
    wholesalerId: 'W001',
    amount: 57600,
    paidAmount: 0,
    status: 'Issued',
    createdAt: new Date(Date.now() - 3600000 * 3).toISOString()
  }
];

let auditEvents: AuditEvent[] = [
  {
    id: 'ADT-101',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    actor: 'Super Admin',
    role: 'Admin',
    action: 'SYSTEM_INIT',
    details: 'System initialized with 3 wholesalers and seeded catalog items.'
  }
];

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/market/data', (req, res) => {
  res.json({
    wholesalers,
    products,
    orders,
    shipments,
    invoices,
    auditEvents,
    clients
  });
});

// Auth endpoints
app.post('/api/auth/client/signup', (req, res) => {
  const { name, storeName, phone } = req.body;
  if (!name || !storeName || !phone) {
    return res.status(400).json({ error: 'Name, store name and phone number are required.' });
  }
  const existing = clients.find(c => c.phone === phone);
  if (existing) {
    return res.json({ success: true, client: existing });
  }
  const newClient: ClientUser = {
    id: `CLI-${Date.now()}`,
    name,
    storeName,
    phone
  };
  clients.push(newClient);
  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: name,
    role: 'Shopkeeper',
    action: 'CLIENT_SIGNUP',
    details: `New client signed up: ${storeName} (${phone})`
  });
  res.json({ success: true, client: newClient });
});

app.post('/api/auth/client/signin', (req, res) => {
  const { phone } = req.body;
  const client = clients.find(c => c.phone === phone);
  if (!client) {
    return res.status(401).json({ error: 'Client not found with this phone number. Please sign up first.' });
  }
  res.json({ success: true, client });
});

app.post('/api/auth/wholesaler/signin', (req, res) => {
  const { email, password } = req.body;
  const wholesaler = wholesalers.find(w => w.ownerEmail === email);
  if (!wholesaler || wholesaler.password !== password) {
    return res.status(401).json({ error: 'Wrong email or password. Please check your credentials.' });
  }
  if (wholesaler.status === 'suspended') {
    return res.status(403).json({ error: 'This wholesaler account has been suspended by Admin.' });
  }
  res.json({ success: true, wholesaler });
});

app.post('/api/auth/admin/signin', (req, res) => {
  const { email, password } = req.body;
  if (email === 'admin@market.pk' && password === 'admin123') {
    res.json({ success: true, admin: { name: 'Super Admin', email: 'admin@market.pk' } });
  } else {
    res.status(401).json({ error: 'Wrong admin email or password.' });
  }
});

// Wholesaler Management (Add, Suspend, Reactivate, Remove)
app.post('/api/wholesalers', (req, res) => {
  const { name, category, city, ownerEmail, phone, password } = req.body;
  const newWholesaler: Wholesaler = {
    id: `W00${wholesalers.length + 1}`,
    name,
    category,
    city,
    status: 'active',
    ownerEmail,
    phone,
    rating: 5.0,
    password: password || 'password123'
  };
  wholesalers.push(newWholesaler);
  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Super Admin',
    role: 'Admin',
    action: 'CREATE_WHOLESALER',
    details: `Created wholesaler tenant: ${name} (${newWholesaler.id})`
  });
  res.json({ success: true, wholesaler: newWholesaler });
});

app.patch('/api/wholesalers/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'active' or 'suspended'
  const wh = wholesalers.find(w => w.id === id);
  if (!wh) return res.status(404).json({ error: 'Wholesaler not found' });
  wh.status = status;
  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Super Admin',
    role: 'Admin',
    action: 'UPDATE_WHOLESALER_STATUS',
    details: `Updated wholesaler ${wh.name} status to ${status}`
  });
  res.json({ success: true, wholesaler: wh });
});

app.delete('/api/wholesalers/:id', (req, res) => {
  const { id } = req.params;
  const idx = wholesalers.findIndex(w => w.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Wholesaler not found' });
  const removed = wholesalers.splice(idx, 1)[0];
  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Super Admin',
    role: 'Admin',
    action: 'DELETE_WHOLESALER',
    details: `Permanently removed wholesaler tenant: ${removed.name} (${removed.id})`
  });
  res.json({ success: true, removed });
});

// Orders & AI Chat
app.post('/api/orders', (req, res) => {
  const { clientId, clientName, deliveryAddress, cartItems } = req.body;
  const grouped: { [wholesalerId: string]: { productId: string; name: string; quantity: number; unitPrice: number; unit: string }[] } = {};
  
  let totalAmount = 0;
  for (const item of cartItems) {
    const prod = products.find(p => p.id === item.productId);
    if (!prod) continue;
    if (!grouped[prod.wholesalerId]) {
      grouped[prod.wholesalerId] = [];
    }
    const lineTotal = prod.sellingPrice * item.quantity;
    totalAmount += lineTotal;
    grouped[prod.wholesalerId].push({
      productId: prod.id,
      name: prod.name,
      quantity: item.quantity,
      unitPrice: prod.sellingPrice,
      unit: prod.unit
    });
  }

  const subOrders: SubOrder[] = Object.keys(grouped).map((whId, idx) => {
    const items = grouped[whId];
    const subtotal = items.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
    return {
      id: `SUB-${Date.now()}-${idx + 1}`,
      wholesalerId: whId,
      items,
      subtotal,
      status: 'Submitted'
    };
  });

  const newOrder: Order = {
    id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
    clientId: clientId || 'CLI-01',
    clientName: clientName || 'Babar General Store',
    deliveryAddress: deliveryAddress || 'University Road, Peshawar',
    status: 'Submitted',
    subOrders,
    totalAmount,
    createdAt: new Date().toISOString(),
    paymentStatus: 'Unpaid',
    paidAmount: 0
  };

  orders.unshift(newOrder);

  subOrders.forEach((sub, idx) => {
    invoices.unshift({
      id: `INV-${Date.now()}-${idx}`,
      orderId: newOrder.id,
      wholesalerId: sub.wholesalerId,
      amount: sub.subtotal,
      paidAmount: 0,
      status: 'Issued',
      createdAt: new Date().toISOString()
    });
  });

  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: clientName || 'Shopkeeper',
    role: 'Shopkeeper',
    action: 'ORDER_SUBMITTED',
    details: `Order ${newOrder.id} submitted with ${subOrders.length} suborders totaling PKR ${totalAmount}`
  });

  res.json({ success: true, order: newOrder });
});

app.patch('/api/suborders/:subOrderId/review', (req, res) => {
  const { subOrderId } = req.params;
  const { action, rejectReason } = req.body;
  
  let targetSub: SubOrder | undefined;
  let targetOrder: Order | undefined;

  for (const ord of orders) {
    const sub = ord.subOrders.find(s => s.id === subOrderId);
    if (sub) {
      targetSub = sub;
      targetOrder = ord;
      break;
    }
  }

  if (!targetSub || !targetOrder) {
    return res.status(404).json({ error: 'Suborder not found' });
  }

  targetSub.status = action;
  if (action === 'Rejected' && rejectReason) {
    targetSub.rejectReason = rejectReason;
  }

  if (action === 'Approved') {
    for (const item of targetSub.items) {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        prod.stockReserved += item.quantity;
        prod.stockOnHand = Math.max(0, prod.stockOnHand - item.quantity);
      }
    }
    shipments.push({
      id: `SHP-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId: targetOrder.id,
      wholesalerId: targetSub.wholesalerId,
      status: 'Unassigned',
      expectedDate: new Date(Date.now() + 86400000 * 2).toISOString()
    });
  }

  const allStatuses = targetOrder.subOrders.map(s => s.status);
  if (allStatuses.every(s => s === 'Approved')) {
    targetOrder.status = 'Approved';
  } else if (allStatuses.some(s => s === 'Approved') && allStatuses.some(s => s === 'Submitted' || s === 'In Review')) {
    targetOrder.status = 'Partially Approved';
  } else if (allStatuses.every(s => s === 'Rejected')) {
    targetOrder.status = 'Cancelled';
  }

  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: `Wholesaler (${targetSub.wholesalerId})`,
    role: 'Wholesaler',
    action: `SUBORDER_${action.toUpperCase()}`,
    details: `Suborder ${targetSub.id} was ${action.toLowerCase()}`
  });

  res.json({ success: true, order: targetOrder });
});

app.patch('/api/shipments/:shipmentId/assign', (req, res) => {
  const { shipmentId } = req.params;
  const { assigneeId, assigneeName } = req.body;
  const shp = shipments.find(s => s.id === shipmentId);
  if (!shp) return res.status(404).json({ error: 'Shipment not found' });
  
  shp.assigneeId = assigneeId || 'DRV-01';
  shp.assigneeName = assigneeName || 'Gul Khan Logistics';
  shp.status = 'Assigned';

  auditEvents.unshift({
    id: `ADT-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'Super Admin',
    role: 'Admin',
    action: 'ASSIGN_SHIPMENT',
    details: `Assigned shipment ${shp.id} to ${shp.assigneeName}`
  });

  res.json({ success: true, shipment: shp });
});

app.post('/api/ai/chat', async (req, res) => {
  const { message, language = 'en' } = req.body;
  if (!ai) {
    return res.json({
      reply: `[AI Assistant] I received your request regarding "${message}". Browse our general store inventory of drinks, snacks, and wholesale staples below!`,
      detectedLanguage: language,
      suggestedProducts: products.slice(0, 3)
    });
  }

  try {
    const catalogSummary = products.map(p => `${p.name} (SKU: ${p.sku}, Price: PKR ${p.sellingPrice} per ${p.unit}, Stock: ${p.stockOnHand})`).join('\n');
    const prompt = `You are the AI Assistant for Peshawar Wholesale Market General Store & Drinks Platform.
Catalog:
${catalogSummary}
User message: "${message}"
Respond helpfully in ${language} with prices and units.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    const textReply = response.text || '';
    const matchedProducts = products.filter((p: Product) => 
      message.toLowerCase().split(' ').some((word: string) => 
        word.length > 2 && (p.name.toLowerCase().includes(word) || p.sku.toLowerCase().includes(word))
      )
    );

    res.json({
      reply: textReply,
      detectedLanguage: language,
      suggestedProducts: matchedProducts.length > 0 ? matchedProducts : products.slice(0, 2)
    });
  } catch (err: any) {
    res.json({
      reply: `I understand you are asking about "${message}". Please review our available drinks and general store items.`,
      detectedLanguage: language,
      suggestedProducts: products.slice(0, 2)
    });
  }
});

if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false }
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Wholesale Market Platform running on http://localhost:${PORT}`);
});
