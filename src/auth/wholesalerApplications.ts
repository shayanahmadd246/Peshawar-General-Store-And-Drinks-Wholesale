import { randomBytes } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { wholesalerApplications, users } from '../db/schema';
import {
  notifyWholesalerApplicationApproved,
  notifyWholesalerApplicationReceived,
  notifyWholesalerApplicationRejected,
  notifyAdminsWholesalerApplication,
} from '../email/notify';
import { createWholesalerAccount, writeAudit } from './service';
import { issuePasswordSetupInvite } from './passwordReset';
import { HttpError } from './rbac';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s()]{10,20}$/;

function clean(s: unknown, max = 200) {
  return String(s ?? '')
    .trim()
    .slice(0, max);
}

export function validateApplicationInput(body: Record<string, unknown>) {
  const businessName = clean(body.businessName, 120);
  const applicantName = clean(body.applicantName, 100);
  const email = clean(body.email, 160).toLowerCase();
  const phone = clean(body.phone, 32).replace(/\s+/g, '');
  const location = clean(body.location, 160);
  const description = clean(body.description, 1200);
  const category = clean(body.category || 'General Wholesale', 80) || 'General Wholesale';

  if (!businessName || businessName.length < 2) throw new HttpError(400, 'Business name is required.');
  if (!applicantName || applicantName.length < 2) throw new HttpError(400, 'Applicant name is required.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid business email is required.');
  if (!PHONE_RE.test(phone)) throw new HttpError(400, 'A valid phone number is required.');
  if (!location || location.length < 2) throw new HttpError(400, 'Business location is required.');
  if (!description || description.length < 20) {
    throw new HttpError(400, 'Please describe your business in at least 20 characters.');
  }

  return { businessName, applicantName, email, phone, location, description, category };
}

export async function submitWholesalerApplication(body: Record<string, unknown>) {
  const input = validateApplicationInput(body);

  const existingUser = await getDb().select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existingUser[0]) {
    throw new HttpError(409, 'This email is already associated with an account. Please sign in instead.');
  }

  const [pending] = await getDb()
    .select()
    .from(wholesalerApplications)
    .where(and(eq(wholesalerApplications.email, input.email), eq(wholesalerApplications.status, 'pending')))
    .limit(1);

  if (pending) {
    throw new HttpError(409, 'An application with this email is already pending review.');
  }

  const id = `WAPP-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const [row] = await getDb()
    .insert(wholesalerApplications)
    .values({
      id,
      businessName: input.businessName,
      applicantName: input.applicantName,
      email: input.email,
      phone: input.phone,
      location: input.location,
      description: input.description,
      category: input.category,
      status: 'pending',
    })
    .returning();

  await notifyWholesalerApplicationReceived({
    applicationId: row.id,
    email: row.email,
    applicantName: row.applicantName,
    businessName: row.businessName,
  });
  await notifyAdminsWholesalerApplication({
    applicationId: row.id,
    businessName: row.businessName,
    applicantName: row.applicantName,
    email: row.email,
    location: row.location,
  });

  return {
    id: row.id,
    status: row.status,
    message: 'Application received. Our team will review it and email you with next steps.',
  };
}

export async function listWholesalerApplications(status?: string) {
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    return getDb()
      .select()
      .from(wholesalerApplications)
      .where(eq(wholesalerApplications.status, status))
      .orderBy(desc(wholesalerApplications.createdAt));
  }
  return getDb().select().from(wholesalerApplications).orderBy(desc(wholesalerApplications.createdAt));
}

export async function approveWholesalerApplication(applicationId: string, reviewer: { id: string; name: string }) {
  const [app] = await getDb().select().from(wholesalerApplications).where(eq(wholesalerApplications.id, applicationId)).limit(1);
  if (!app) throw new HttpError(404, 'Application not found.');
  if (app.status === 'approved' && app.wholesalerId) {
    return { alreadyApproved: true as const, application: app, wholesalerId: app.wholesalerId };
  }
  if (app.status !== 'pending') {
    throw new HttpError(409, `Application is already ${app.status}.`);
  }

  const tempPassword = randomBytes(32).toString('hex');
  const wholesaler = await createWholesalerAccount({
    name: app.businessName,
    category: app.category || 'General Wholesale',
    city: app.location.split(',')[0]?.trim() || app.location,
    ownerEmail: app.email,
    phone: app.phone,
    password: tempPassword,
  });

  const userId = `USR-${wholesaler.id}`;
  const invite = await issuePasswordSetupInvite(userId);

  const [updated] = await getDb()
    .update(wholesalerApplications)
    .set({
      status: 'approved',
      reviewedByUserId: reviewer.id,
      reviewedAt: new Date(),
      wholesalerId: wholesaler.id,
      updatedAt: new Date(),
      rejectReason: null,
    })
    .where(and(eq(wholesalerApplications.id, applicationId), eq(wholesalerApplications.status, 'pending')))
    .returning();

  if (!updated) {
    // Race: another admin approved first — leave created tenant (idempotent success path)
    const [again] = await getDb().select().from(wholesalerApplications).where(eq(wholesalerApplications.id, applicationId)).limit(1);
    return { alreadyApproved: true as const, application: again!, wholesalerId: again?.wholesalerId || wholesaler.id };
  }

  await notifyWholesalerApplicationApproved({
    applicationId: app.id,
    email: app.email,
    applicantName: app.applicantName,
    businessName: app.businessName,
    inviteLink: invite.link,
  });

  await writeAudit(reviewer.name, 'Admin', 'APPROVE_WHOLESALER_APPLICATION', `Approved ${app.id} → tenant ${wholesaler.id} (${app.businessName})`);

  return { alreadyApproved: false as const, application: updated, wholesaler, inviteSent: Boolean(invite.link) };
}

export async function rejectWholesalerApplication(
  applicationId: string,
  reviewer: { id: string; name: string },
  reason?: string
) {
  const [app] = await getDb().select().from(wholesalerApplications).where(eq(wholesalerApplications.id, applicationId)).limit(1);
  if (!app) throw new HttpError(404, 'Application not found.');
  if (app.status === 'rejected') {
    return { alreadyRejected: true as const, application: app };
  }
  if (app.status !== 'pending') {
    throw new HttpError(409, `Application is already ${app.status}.`);
  }

  const rejectReason = clean(reason, 500) || null;
  const [updated] = await getDb()
    .update(wholesalerApplications)
    .set({
      status: 'rejected',
      rejectReason,
      reviewedByUserId: reviewer.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(wholesalerApplications.id, applicationId), eq(wholesalerApplications.status, 'pending')))
    .returning();

  if (!updated) {
    const [again] = await getDb().select().from(wholesalerApplications).where(eq(wholesalerApplications.id, applicationId)).limit(1);
    return { alreadyRejected: true as const, application: again! };
  }

  await notifyWholesalerApplicationRejected({
    applicationId: app.id,
    email: app.email,
    applicantName: app.applicantName,
    businessName: app.businessName,
    reason: rejectReason || undefined,
  });

  await writeAudit(
    reviewer.name,
    'Admin',
    'REJECT_WHOLESALER_APPLICATION',
    `Rejected ${app.id} (${app.businessName})${rejectReason ? `: ${rejectReason}` : ''}`
  );

  return { alreadyRejected: false as const, application: updated };
}
