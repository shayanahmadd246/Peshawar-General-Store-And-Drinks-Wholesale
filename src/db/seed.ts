import { eq } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './index';
import { auditEvents, products, users, wholesalers } from './schema';
import { hashPassword } from '../auth/passwords';
import { getSeedCredentials, isProduction } from '../config/env';

const SEED_WHOLESALERS = [
  {
    id: 'W001',
    name: 'Khyber Grain & Flour Mills',
    category: 'Grains & Flour',
    city: 'Peshawar',
    status: 'active',
    ownerEmail: 'wholesaler1@market.pk',
    phone: '+92 300 1234567',
    rating: '4.80',
  },
  {
    id: 'W002',
    name: 'Peshawar Electronics & Solar',
    category: 'Electronics & Solar',
    city: 'Karkhano Market',
    status: 'active',
    ownerEmail: 'wholesaler2@market.pk',
    phone: '+92 301 7654321',
    rating: '4.60',
  },
  {
    id: 'W003',
    name: 'Frontier Spices & Dry Fruits',
    category: 'Spices & Dry Fruits',
    city: 'Peshawar',
    status: 'active',
    ownerEmail: 'wholesaler3@market.pk',
    phone: '+92 302 9876543',
    rating: '4.90',
  },
];

const SEED_PRODUCTS = [
  {
    id: 'P101',
    wholesalerId: 'W001',
    sku: 'FLOUR-SUPER-50KG',
    name: 'Super Fine Wheat Flour (50kg Bag)',
    aliases: { en: 'Wheat Flour Bag 50kg', ur: 'گندم کا آٹا 50 کلو', ps: 'غنم اوړه 50 کیلو' },
    unit: 'bag',
    packSize: '50kg bag',
    costPrice: '6200.00',
    sellingPrice: '6800.00',
    moq: 2,
    reorderPoint: 20,
    stockOnHand: 150,
    stockReserved: 10,
    status: 'available',
  },
  {
    id: 'P102',
    wholesalerId: 'W001',
    sku: 'RICE-BASMATI-25KG',
    name: 'Khyber Premium Basmati Rice (25kg)',
    aliases: { en: 'Basmati Rice 25kg', ur: 'باسമതی چاول 25 کلو', ps: 'باسمتی وریجې 25 کیلو' },
    unit: 'bag',
    packSize: '25kg bag',
    costPrice: '9500.00',
    sellingPrice: '10500.00',
    moq: 1,
    reorderPoint: 15,
    stockOnHand: 80,
    stockReserved: 5,
    status: 'available',
  },
  {
    id: 'P103',
    wholesalerId: 'W001',
    sku: 'COOKING-OIL-16L',
    name: 'Pure Banaspati Cooking Oil (16L Tin)',
    aliases: { en: 'Cooking Oil Tin 16L', ur: 'کوکنگ آئل 16 لٹر', ps: 'پخولو غوړي 16 لټره' },
    unit: 'carton',
    packSize: '16 Liter Tin',
    costPrice: '5400.00',
    sellingPrice: '5900.00',
    moq: 2,
    reorderPoint: 25,
    stockOnHand: 120,
    stockReserved: 0,
    status: 'available',
  },
  {
    id: 'P201',
    wholesalerId: 'W002',
    sku: 'SOLAR-PANEL-550W',
    name: 'Mono Perc Solar Panel 550W Tier-1',
    aliases: { en: '550W Solar Panel', ur: 'سولر پینل 550 واٹ', ps: 'سولر پینل 550 واټ' },
    unit: 'piece',
    packSize: '1 piece',
    costPrice: '28500.00',
    sellingPrice: '31000.00',
    moq: 2,
    reorderPoint: 10,
    stockOnHand: 45,
    stockReserved: 4,
    status: 'available',
  },
  {
    id: 'P301',
    wholesalerId: 'W003',
    sku: 'SPICE-RED-CHILI-5KG',
    name: 'Peshawari Red Chili Powder (5kg)',
    aliases: { en: 'Red Chili Powder 5kg', ur: 'سرخ مرچ پاؤڈر 5 کلو', ps: 'سرخ مرچ پوډر 5 کیلو' },
    unit: 'bag',
    packSize: '5kg pack',
    costPrice: '3200.00',
    sellingPrice: '3600.00',
    moq: 2,
    reorderPoint: 10,
    stockOnHand: 60,
    stockReserved: 0,
    status: 'available',
  },
  {
    id: 'P401',
    wholesalerId: 'W001',
    sku: 'DRINK-COLA-24CAN',
    name: 'Cola Soft Drink Carton (24 x 330ml)',
    aliases: {
      en: 'Cola carton 24 cans Pepsi soft drink cold drinks petiyan',
      ur: 'کولا کارٹن 24 کین پیپسی پیپسي پیٹیاں کولڈ ڈرنک',
      ps: 'کولا کارټن 24 کین پیپسي کارټنه سړې څښاک',
    },
    unit: 'carton',
    packSize: '24 x 330ml',
    costPrice: '1850.00',
    sellingPrice: '2100.00',
    moq: 2,
    reorderPoint: 20,
    stockOnHand: 200,
    stockReserved: 0,
    status: 'available',
  },
  {
    id: 'P402',
    wholesalerId: 'W001',
    sku: 'WATER-1.5L-12BOT',
    name: 'Mineral Water Bundle (12 x 1.5L)',
    aliases: { en: 'Mineral water 1.5L pack', ur: 'منرل واٹر 1.5 لٹر', ps: 'منرل اوبه 1.5 لیټر' },
    unit: 'carton',
    packSize: '12 bottles',
    costPrice: '720.00',
    sellingPrice: '850.00',
    moq: 5,
    reorderPoint: 30,
    stockOnHand: 320,
    stockReserved: 0,
    status: 'available',
  },
  {
    id: 'P501',
    wholesalerId: 'W002',
    sku: 'JUICE-MANGO-1L-12',
    name: 'Mango Juice Carton (12 x 1L)',
    aliases: { en: 'Mango juice carton', ur: 'آم کا رس کارٹن', ps: 'د آم جوس کارټن' },
    unit: 'carton',
    packSize: '12 x 1L',
    costPrice: '2400.00',
    sellingPrice: '2750.00',
    moq: 2,
    reorderPoint: 15,
    stockOnHand: 90,
    stockReserved: 0,
    status: 'available',
  },
  {
    id: 'P502',
    wholesalerId: 'W002',
    sku: 'ENERGY-DRINK-24CAN',
    name: 'Energy Drink Case (24 cans)',
    aliases: { en: 'Energy drink case', ur: 'انرجی ڈرنک کیس', ps: 'انرژي څښاک کیس' },
    unit: 'carton',
    packSize: '24 cans',
    costPrice: '4200.00',
    sellingPrice: '4800.00',
    moq: 1,
    reorderPoint: 12,
    stockOnHand: 55,
    stockReserved: 0,
    status: 'available',
  },
];

export async function seedDevelopmentData(): Promise<void> {
  if (isProduction()) return;

  const creds = getSeedCredentials();
  const adminHash = await hashPassword(creds.adminPassword);
  const wholesalerHash = await hashPassword(creds.wholesalerPassword);
  const clientHash = await hashPassword(creds.clientPassword);

  for (const wholesaler of SEED_WHOLESALERS) {
    await getDb().insert(wholesalers).values(wholesaler).onConflictDoNothing({ target: wholesalers.id });
    await getDb()
      .insert(users)
      .values({
        id: `USR-${wholesaler.id}`,
        name: wholesaler.name,
        email: wholesaler.ownerEmail,
        phone: wholesaler.phone.replace(/\s+/g, ''),
        passwordHash: wholesalerHash,
        role: 'wholesaler',
        tenantId: wholesaler.id,
        status: 'active',
      })
      .onConflictDoNothing({ target: users.id });
  }

  await getDb()
    .insert(users)
    .values({
      id: 'USR-ADMIN',
      name: 'Super Admin',
      email: creds.adminEmail.toLowerCase(),
      phone: null,
      passwordHash: adminHash,
      role: 'admin',
      tenantId: null,
      status: 'active',
    })
    .onConflictDoNothing({ target: users.id });

  await getDb()
    .insert(users)
    .values({
      id: 'CLI-01',
      name: 'Babar Khan',
      storeName: 'Babar General Store',
      email: null,
      phone: creds.clientPhone,
      passwordHash: clientHash,
      role: 'client',
      tenantId: null,
      status: 'active',
    })
    .onConflictDoNothing({ target: users.id });

  const deliveryHash = await hashPassword(creds.deliveryPassword);
  await getDb()
    .insert(users)
    .values({
      id: 'DRV-01',
      name: 'Gul Khan Logistics',
      email: creds.deliveryEmail.toLowerCase(),
      phone: '03001234567',
      passwordHash: deliveryHash,
      role: 'delivery',
      tenantId: null,
      status: 'active',
    })
    .onConflictDoNothing({ target: users.id });

  for (const product of SEED_PRODUCTS) {
    await getDb()
      .insert(products)
      .values(product)
      .onConflictDoUpdate({
        target: products.id,
        set: { aliases: product.aliases, name: product.name, sku: product.sku },
      });
  }

  const [existingAudit] = await getDb().select().from(auditEvents).where(eq(auditEvents.id, 'ADT-101')).limit(1);
  if (!existingAudit) {
    await getDb().insert(auditEvents).values({
      id: 'ADT-101',
      actor: 'Super Admin',
      role: 'Admin',
      action: 'SYSTEM_INIT',
      details: 'System initialized with 3 wholesalers and seeded catalog items.',
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedDevelopmentData()
    .then(() => {
      console.log('Development seed complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

export async function loadRuntimeCatalog() {
  const wholesalerRows = await getDb().select().from(wholesalers);
  const productRows = await getDb().select().from(products);
  const clientRows = await getDb().select().from(users).where(eq(users.role, 'client'));
  const auditRows = await getDb().select().from(auditEvents);

  return {
    wholesalers: wholesalerRows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      city: row.city,
      status: row.status as 'active' | 'suspended',
      ownerEmail: row.ownerEmail,
      phone: row.phone,
      rating: Number(row.rating),
    })),
    products: productRows.map((row) => ({
      id: row.id,
      wholesalerId: row.wholesalerId,
      sku: row.sku,
      name: row.name,
      aliases: row.aliases as { en: string; ur: string; ps: string },
      unit: row.unit,
      packSize: row.packSize,
      costPrice: Number(row.costPrice),
      sellingPrice: Number(row.sellingPrice),
      moq: row.moq,
      reorderPoint: row.reorderPoint,
      stockOnHand: row.stockOnHand,
      stockReserved: row.stockReserved,
      status: row.status as 'available' | 'low_stock' | 'out_of_stock',
    })),
    clients: clientRows.map((row) => ({
      id: row.id,
      name: row.name,
      storeName: row.storeName || '',
      phone: row.phone || '',
    })),
    auditEvents: auditRows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      actor: row.actor,
      role: row.role,
      action: row.action,
      details: row.details,
    })),
  };
}
