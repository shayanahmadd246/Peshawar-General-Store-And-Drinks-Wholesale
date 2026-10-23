import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { auditEvents, invoices, paymentAllocations, payments } from '../db/schema';
import { HttpError } from '../auth/rbac';
import type { AuthUser } from '../auth/types';
import { addPaisa, fromPaisa, toPaisa } from './money';
import { getInvoiceForUser } from './invoices';

export interface PaymentView {
  id: string;
  clientId: string;
  amount: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  allocations: { invoiceId: string; amount: string; invoiceNumber?: string }[];
}

function assertPaymentRecorder(user: AuthUser) {
  if (user.role !== 'admin' && user.role !== 'wholesaler') {
    throw new HttpError(403, 'Only admin or wholesaler can record payments.');
  }
}

export async function recordPayment(
  user: AuthUser,
  input: {
    invoiceId: string;
    amount: string | number;
    method: 'cash' | 'bank_transfer';
    reference?: string;
    notes?: string;
    idempotencyKey?: string;
  }
): Promise<{ payment: PaymentView; invoice: Awaited<ReturnType<typeof getInvoiceForUser>> }> {
  assertPaymentRecorder(user);

  if (input.method !== 'cash' && input.method !== 'bank_transfer') {
    throw new HttpError(400, 'Payment method must be cash or bank_transfer.');
  }

  let amountPaisa: number;
  try {
    amountPaisa = toPaisa(input.amount);
  } catch {
    throw new HttpError(400, 'Invalid payment amount.');
  }
  if (amountPaisa <= 0) throw new HttpError(400, 'Payment amount must be positive.');

  return getDb().transaction(async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) {
        const allocs = await tx
          .select()
          .from(paymentAllocations)
          .where(eq(paymentAllocations.paymentId, existing.id));
        const invoice = await getInvoiceForUser(user, input.invoiceId);
        return {
          payment: {
            id: existing.id,
            clientId: existing.clientId,
            amount: existing.amount,
            method: existing.method,
            reference: existing.reference,
            notes: existing.notes,
            status: existing.status,
            createdAt: existing.createdAt.toISOString(),
            allocations: allocs.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
          },
          invoice,
        };
      }
    }

    const locked = await tx.execute(sql`SELECT * FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE`);
    const inv = ((locked as any).rows || [])[0];
    if (!inv) throw new HttpError(404, 'Invoice not found.');

    if (user.role === 'wholesaler' && inv.wholesaler_id !== user.tenantId) {
      throw new HttpError(403, 'Cross-tenant payment denied.');
    }

    const outstandingPaisa = toPaisa(inv.outstanding_amount);
    if (amountPaisa > outstandingPaisa) {
      throw new HttpError(400, `Overpayment rejected. Outstanding balance is ${inv.outstanding_amount}.`);
    }

    const newPaid = addPaisa(toPaisa(inv.paid_amount), amountPaisa);
    const newOutstanding = addPaisa(toPaisa(inv.amount), -newPaid);
    if (newOutstanding < 0) {
      throw new HttpError(400, 'Overpayment rejected.');
    }

    const status = newOutstanding === 0 ? 'Paid' : 'Partially Paid';
    const paymentId = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const [payment] = await tx
      .insert(payments)
      .values({
        id: paymentId,
        clientId: inv.client_id,
        recordedByUserId: user.id,
        recordedByRole: user.role,
        amount: fromPaisa(amountPaisa),
        method: input.method,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        status: 'Posted',
        idempotencyKey: input.idempotencyKey || null,
      })
      .returning();

    await tx.insert(paymentAllocations).values({
      id: `PAL-${paymentId}`,
      paymentId: payment.id,
      invoiceId: inv.id,
      amount: fromPaisa(amountPaisa),
    });

    await tx
      .update(invoices)
      .set({
        paidAmount: fromPaisa(newPaid),
        outstandingAmount: fromPaisa(newOutstanding),
        status,
      })
      .where(eq(invoices.id, inv.id));

    await tx.insert(auditEvents).values({
      id: `ADT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actor: user.name,
      role: user.role === 'admin' ? 'Admin' : 'Wholesaler',
      action: 'PAYMENT_RECORDED',
      details: `Recorded ${fromPaisa(amountPaisa)} ${input.method} payment against invoice ${inv.id}`,
    });

    return {
      payment: {
        id: payment.id,
        clientId: payment.clientId,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        allocations: [{ invoiceId: inv.id, amount: fromPaisa(amountPaisa), invoiceNumber: inv.invoice_number }],
      },
      invoiceId: inv.id as string,
    };
  }).then(async (result) => {
    if ('invoice' in result) return result as { payment: PaymentView; invoice: Awaited<ReturnType<typeof getInvoiceForUser>> };
    const invoice = await getInvoiceForUser(user, result.invoiceId);
    try {
      const { notifyPaymentReceipt } = await import('../email/notify');
      await notifyPaymentReceipt({
        paymentId: result.payment.id,
        clientId: result.payment.clientId,
        amount: String(result.payment.amount),
      });
    } catch (err: any) {
      console.warn('[notify] payment:', err?.message || err);
    }
    return { payment: result.payment, invoice };
  });
}

export async function listPaymentsForUser(user: AuthUser): Promise<PaymentView[]> {
  let paymentRows: (typeof payments.$inferSelect)[] = [];
  if (user.role === 'admin') {
    paymentRows = await getDb().select().from(payments).orderBy(desc(payments.createdAt));
  } else if (user.role === 'client') {
    paymentRows = await getDb()
      .select()
      .from(payments)
      .where(eq(payments.clientId, user.id))
      .orderBy(desc(payments.createdAt));
  } else if (user.role === 'wholesaler') {
    if (!user.tenantId) throw new HttpError(403, 'Wholesaler tenant missing.');
    const invs = await getDb().select().from(invoices).where(eq(invoices.wholesalerId, user.tenantId));
    const invIds = invs.map((i) => i.id);
    if (invIds.length === 0) return [];
    const allocs = await getDb()
      .select()
      .from(paymentAllocations)
      .where(inArray(paymentAllocations.invoiceId, invIds));
    const payIds = [...new Set(allocs.map((a) => a.paymentId))];
    if (payIds.length === 0) return [];
    paymentRows = await getDb().select().from(payments).where(inArray(payments.id, payIds));
  } else {
    throw new HttpError(403, 'Forbidden');
  }

  if (paymentRows.length === 0) return [];
  const allocs = await getDb()
    .select()
    .from(paymentAllocations)
    .where(
      inArray(
        paymentAllocations.paymentId,
        paymentRows.map((p) => p.id)
      )
    );

  return paymentRows
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => ({
      id: p.id,
      clientId: p.clientId,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      allocations: allocs
        .filter((a) => a.paymentId === p.id)
        .map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
    }));
}
