import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users, wholesalers } from '../db/schema';
import { getAppBaseUrl } from './config';
import { enqueueEmail } from './outbox';
import type { EmailTemplateId } from './templates';

async function userEmail(userId: string | null | undefined) {
  if (!userId) return null;
  const [row] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row?.email) return null;
  return { email: row.email, name: row.name, id: row.id };
}

async function wholesalerOwnerEmail(wholesalerId: string) {
  const [tenant] = await getDb().select().from(wholesalers).where(eq(wholesalers.id, wholesalerId)).limit(1);
  if (!tenant?.ownerEmail) return null;
  const [owner] = await getDb().select().from(users).where(eq(users.email, tenant.ownerEmail.toLowerCase())).limit(1);
  return {
    email: tenant.ownerEmail,
    name: owner?.name || tenant.name,
    id: owner?.id || null,
  };
}

async function adminEmails() {
  const rows = await getDb().select().from(users).where(eq(users.role, 'admin'));
  return rows.filter((r) => r.email).map((r) => ({ email: r.email!, name: r.name, id: r.id }));
}

export async function notifyPasswordReset(userId: string, rawToken: string) {
  const u = await userEmail(userId);
  if (!u) return { enqueued: false, reason: 'no_valid_email' as const };
  const link = `${getAppBaseUrl()}/?resetToken=${encodeURIComponent(rawToken)}`;
  return enqueueEmail({
    eventKey: `password_reset:${userId}:${rawToken.slice(0, 8)}`,
    template: 'password_reset',
    toEmail: u.email,
    toUserId: u.id,
    payload: { name: u.name, link },
  });
}

export async function notifyWelcomeShopkeeper(userId: string) {
  const u = await userEmail(userId);
  if (!u) return { enqueued: false, reason: 'no_valid_email' as const };
  return enqueueEmail({
    eventKey: `welcome_shopkeeper:${userId}`,
    template: 'welcome_shopkeeper',
    toEmail: u.email,
    toUserId: u.id,
    payload: { name: u.name },
  });
}

export async function notifyOrderPlaced(input: {
  orderId: string;
  clientId: string;
  subOrders: { id: string; wholesalerId: string }[];
}) {
  const client = await userEmail(input.clientId);
  if (client) {
    await enqueueEmail({
      eventKey: `order_confirmation:${input.orderId}`,
      template: 'order_confirmation',
      toEmail: client.email,
      toUserId: client.id,
      payload: { name: client.name, orderId: input.orderId },
    });
  }
  for (const sub of input.subOrders) {
    const owner = await wholesalerOwnerEmail(sub.wholesalerId);
    if (!owner) continue;
    await enqueueEmail({
      eventKey: `wholesaler_new_order:${sub.id}`,
      template: 'wholesaler_new_order',
      toEmail: owner.email,
      toUserId: owner.id,
      payload: { name: owner.name, orderId: input.orderId, subOrderId: sub.id },
    });
  }
}

export async function notifySubOrderReviewed(input: {
  orderId: string;
  subOrderId: string;
  clientId: string;
  status: 'Approved' | 'Rejected';
  rejectReason?: string;
}) {
  const client = await userEmail(input.clientId);
  if (!client) return;
  const template: EmailTemplateId = input.status === 'Approved' ? 'order_approved' : 'order_rejected';
  await enqueueEmail({
    eventKey: `suborder_${input.status.toLowerCase()}:${input.subOrderId}`,
    template,
    toEmail: client.email,
    toUserId: client.id,
    payload: {
      name: client.name,
      orderId: input.orderId,
      detail: input.rejectReason || (input.status === 'Approved' ? 'Approved by wholesaler.' : 'Rejected by wholesaler.'),
    },
  });
}

export async function notifyShipmentAssigned(input: {
  shipmentId: string;
  orderId: string;
  assigneeId: string;
  deliveryAddress?: string;
}) {
  const courier = await userEmail(input.assigneeId);
  if (!courier) return;
  await enqueueEmail({
    eventKey: `delivery_assigned:${input.shipmentId}:${input.assigneeId}`,
    template: 'delivery_assigned',
    toEmail: courier.email,
    toUserId: courier.id,
    payload: {
      name: courier.name,
      shipmentId: input.shipmentId,
      orderId: input.orderId,
      detail: input.deliveryAddress ? `Address: ${input.deliveryAddress}` : '',
    },
  });
}

export async function notifyShipmentStatus(input: {
  shipmentId: string;
  orderId: string;
  clientId: string;
  status: string;
  failureReason?: string;
  invoiceNumber?: string | null;
}) {
  const client = await userEmail(input.clientId);
  if (!client) return;

  if (input.status === 'Dispatched' || input.status === 'InTransit') {
    await enqueueEmail({
      eventKey: `order_dispatched:${input.shipmentId}:${input.status}`,
      template: 'order_dispatched',
      toEmail: client.email,
      toUserId: client.id,
      payload: { name: client.name, orderId: input.orderId },
    });
  } else if (input.status === 'Delivered') {
    await enqueueEmail({
      eventKey: `order_delivered:${input.shipmentId}`,
      template: 'order_delivered',
      toEmail: client.email,
      toUserId: client.id,
      payload: { name: client.name, orderId: input.orderId },
    });
    if (input.invoiceNumber) {
      await enqueueEmail({
        eventKey: `invoice_available:${input.shipmentId}:${input.invoiceNumber}`,
        template: 'invoice_available',
        toEmail: client.email,
        toUserId: client.id,
        payload: { name: client.name, orderId: input.orderId, invoiceNumber: input.invoiceNumber },
      });
    }
  } else if (input.status === 'Failed') {
    await enqueueEmail({
      eventKey: `order_failed:${input.shipmentId}`,
      template: 'order_failed',
      toEmail: client.email,
      toUserId: client.id,
      payload: { name: client.name, orderId: input.orderId, detail: input.failureReason || 'Delivery failed.' },
    });
    for (const admin of await adminEmails()) {
      await enqueueEmail({
        eventKey: `admin_exception:failed_shipment:${input.shipmentId}:${admin.id}`,
        template: 'admin_exception',
        toEmail: admin.email,
        toUserId: admin.id,
        payload: { detail: `Shipment ${input.shipmentId} failed for order ${input.orderId}: ${input.failureReason || 'n/a'}` },
      });
    }
  }
}

export async function notifyPaymentReceipt(input: {
  paymentId: string;
  clientId?: string | null;
  amount: string;
}) {
  if (!input.clientId) return;
  const client = await userEmail(input.clientId);
  if (!client) return;
  await enqueueEmail({
    eventKey: `payment_receipt:${input.paymentId}`,
    template: 'payment_receipt',
    toEmail: client.email,
    toUserId: client.id,
    payload: { name: client.name, amount: input.amount },
  });
}

export async function notifyWholesalerApplicationReceived(input: {
  applicationId: string;
  email: string;
  applicantName: string;
  businessName: string;
}) {
  return enqueueEmail({
    eventKey: `wholesaler_application_received:${input.applicationId}`,
    template: 'wholesaler_application_received',
    toEmail: input.email,
    payload: {
      name: input.applicantName,
      businessName: input.businessName,
      applicationId: input.applicationId,
    },
  });
}

export async function notifyAdminsWholesalerApplication(input: {
  applicationId: string;
  businessName: string;
  applicantName: string;
  email: string;
  location: string;
}) {
  for (const admin of await adminEmails()) {
    await enqueueEmail({
      eventKey: `wholesaler_application_admin:${input.applicationId}:${admin.id}`,
      template: 'wholesaler_application_admin',
      toEmail: admin.email,
      toUserId: admin.id,
      payload: {
        name: input.applicantName,
        businessName: input.businessName,
        email: input.email,
        detail: `Location: ${input.location}. Open Admin → Wholesaler Applications to review.`,
      },
    });
  }
}

export async function notifyWholesalerApplicationApproved(input: {
  applicationId: string;
  email: string;
  applicantName: string;
  businessName: string;
  inviteLink: string;
}) {
  return enqueueEmail({
    eventKey: `wholesaler_application_approved:${input.applicationId}`,
    template: 'wholesaler_application_approved',
    toEmail: input.email,
    payload: {
      name: input.applicantName,
      businessName: input.businessName,
      link: input.inviteLink,
    },
  });
}

export async function notifyWholesalerApplicationRejected(input: {
  applicationId: string;
  email: string;
  applicantName: string;
  businessName: string;
  reason?: string;
}) {
  return enqueueEmail({
    eventKey: `wholesaler_application_rejected:${input.applicationId}`,
    template: 'wholesaler_application_rejected',
    toEmail: input.email,
    payload: {
      name: input.applicantName,
      businessName: input.businessName,
      detail: input.reason || '',
    },
  });
}

export async function notifyWholesalerInvite(userId: string, _rawToken: string, link: string) {
  const u = await userEmail(userId);
  if (!u) return { enqueued: false, reason: 'no_valid_email' as const };
  return enqueueEmail({
    eventKey: `wholesaler_invite:${userId}:${link.slice(-12)}`,
    template: 'wholesaler_invite',
    toEmail: u.email,
    toUserId: u.id,
    payload: { name: u.name, link },
  });
}
