export type EmailTemplateId =
  | 'password_reset'
  | 'welcome_shopkeeper'
  | 'order_confirmation'
  | 'order_approved'
  | 'order_rejected'
  | 'order_dispatched'
  | 'order_delivered'
  | 'order_failed'
  | 'invoice_available'
  | 'payment_receipt'
  | 'wholesaler_new_order'
  | 'delivery_assigned'
  | 'delivery_cancelled'
  | 'admin_exception'
  | 'test_ping'
  | 'wholesaler_application_received'
  | 'wholesaler_application_admin'
  | 'wholesaler_application_approved'
  | 'wholesaler_application_rejected'
  | 'wholesaler_invite';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function shell(title: string, bodyHtml: string, bodyText: string): RenderedEmail {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;background:#0b1324;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0b1324;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1324;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#0b1324,#152238);padding:20px 24px;color:#f0a202;font-weight:700;font-size:18px;">Peshawar Wholesale OS</td></tr>
        <tr><td style="padding:24px;color:#0b1324;font-size:15px;line-height:1.55;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0b1324;">${title}</h1>
          ${bodyHtml}
          <p style="margin:24px 0 0;font-size:12px;color:#5b6b7c;">This message was sent by Peshawar General Store &amp; Drinks Wholesale. Do not share passwords or reset links.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = `${title}\n\n${bodyText}\n\n— Peshawar Wholesale OS`;
  return { subject: title, html, text };
}

export function renderEmailTemplate(template: EmailTemplateId, payload: Record<string, unknown>): RenderedEmail {
  const name = String(payload.name || 'there');
  const orderId = String(payload.orderId || '');
  const link = String(payload.link || '');
  const detail = String(payload.detail || '');
  const amount = String(payload.amount || '');

  switch (template) {
    case 'password_reset':
      return shell(
        'Reset your password',
        `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your password. This link expires in 30 minutes and can be used once.</p><p><a href="${escapeAttr(link)}" style="display:inline-block;background:#f0a202;color:#0b1324;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:10px;">Reset password</a></p><p style="font-size:12px;color:#5b6b7c;">If you did not request this, you can ignore this email.</p>`,
        `Hi ${name},\nReset your password (expires in 30 minutes, single use):\n${link}\n\nIf you did not request this, ignore this email.`
      );
    case 'welcome_shopkeeper':
      return shell(
        'Welcome to Peshawar Wholesale OS',
        `<p>Hi ${escapeHtml(name)},</p><p>Your shopkeeper account is ready. Sign in with your phone and password to order from live inventory.</p>`,
        `Hi ${name},\nYour shopkeeper account is ready. Sign in with your phone and password.`
      );
    case 'order_confirmation':
      return shell(
        `Order confirmed ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>We received order <strong>${escapeHtml(orderId)}</strong>. Wholesalers will review it shortly.</p>`,
        `Hi ${name},\nOrder ${orderId} received and awaiting wholesaler review.`
      );
    case 'order_approved':
      return shell(
        `Order approved ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>Part of order <strong>${escapeHtml(orderId)}</strong> was approved and is moving to dispatch.</p><p>${escapeHtml(detail)}</p>`,
        `Hi ${name},\nOrder ${orderId} approved. ${detail}`
      );
    case 'order_rejected':
      return shell(
        `Order update ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>A suborder on <strong>${escapeHtml(orderId)}</strong> was rejected.</p><p>${escapeHtml(detail)}</p>`,
        `Hi ${name},\nSuborder on ${orderId} rejected. ${detail}`
      );
    case 'order_dispatched':
      return shell(
        `Order dispatched ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>Your order <strong>${escapeHtml(orderId)}</strong> is on the way.</p>`,
        `Hi ${name},\nOrder ${orderId} has been dispatched.`
      );
    case 'order_delivered':
      return shell(
        `Delivered ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>Order <strong>${escapeHtml(orderId)}</strong> was marked delivered. Your invoice will appear in the portal.</p>`,
        `Hi ${name},\nOrder ${orderId} delivered.`
      );
    case 'order_failed':
      return shell(
        `Delivery issue ${orderId}`,
        `<p>Hi ${escapeHtml(name)},</p><p>Delivery for <strong>${escapeHtml(orderId)}</strong> failed.</p><p>${escapeHtml(detail)}</p>`,
        `Hi ${name},\nDelivery failed for ${orderId}. ${detail}`
      );
    case 'invoice_available':
      return shell(
        `Invoice ready ${String(payload.invoiceNumber || '')}`,
        `<p>Hi ${escapeHtml(name)},</p><p>Invoice <strong>${escapeHtml(String(payload.invoiceNumber || ''))}</strong> for order ${escapeHtml(orderId)} is available in your portal.</p>`,
        `Hi ${name},\nInvoice ${payload.invoiceNumber} for ${orderId} is available in your portal.`
      );
    case 'payment_receipt':
      return shell(
        'Payment received',
        `<p>Hi ${escapeHtml(name)},</p><p>We recorded a payment of <strong>PKR ${escapeHtml(amount)}</strong>.</p>`,
        `Hi ${name},\nPayment of PKR ${amount} recorded.`
      );
    case 'wholesaler_new_order':
      return shell(
        `New suborder ${String(payload.subOrderId || '')}`,
        `<p>Hi ${escapeHtml(name)},</p><p>A new suborder awaits approval for client order <strong>${escapeHtml(orderId)}</strong>.</p>`,
        `Hi ${name},\nNew suborder for ${orderId} awaits approval.`
      );
    case 'delivery_assigned':
      return shell(
        `New delivery run ${String(payload.shipmentId || '')}`,
        `<p>Hi ${escapeHtml(name)},</p><p>You were assigned shipment <strong>${escapeHtml(String(payload.shipmentId || ''))}</strong> for order ${escapeHtml(orderId)}.</p><p>${escapeHtml(detail)}</p>`,
        `Hi ${name},\nAssigned shipment ${payload.shipmentId} for ${orderId}. ${detail}`
      );
    case 'delivery_cancelled':
      return shell(
        'Delivery assignment updated',
        `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(detail || 'A delivery assignment was cancelled or reassigned.')}</p>`,
        `Hi ${name},\n${detail || 'Delivery assignment updated.'}`
      );
    case 'admin_exception':
      return shell(
        'Operational exception',
        `<p>Admin alert:</p><p>${escapeHtml(detail)}</p>`,
        `Admin alert: ${detail}`
      );
    case 'test_ping':
      return shell(
        'Test email from Peshawar Wholesale OS',
        `<p>This is a configuration test. If you received it, SMTP is working.</p><p>${escapeHtml(detail)}</p>`,
        `SMTP test OK. ${detail}`
      );
    case 'wholesaler_application_received':
      return shell(
        'We received your wholesaler application',
        `<p>Hi ${escapeHtml(name)},</p><p>Thanks for applying to join <strong>${escapeHtml(String(payload.businessName || 'Peshawar Wholesale'))}</strong>. Our team will review your request and email you when a decision is ready.</p><p style="font-size:12px;color:#5b6b7c;">Reference: ${escapeHtml(String(payload.applicationId || ''))}</p>`,
        `Hi ${name},\nWe received your wholesaler application for ${payload.businessName}. Reference: ${payload.applicationId}.`
      );
    case 'wholesaler_application_admin':
      return shell(
        'New wholesaler application',
        `<p>A new wholesaler application needs review.</p><p><strong>${escapeHtml(String(payload.businessName || ''))}</strong> — ${escapeHtml(name)} (${escapeHtml(String(payload.email || ''))})</p><p>${escapeHtml(detail)}</p>`,
        `New wholesaler application: ${payload.businessName} — ${name} (${payload.email}). ${detail}`
      );
    case 'wholesaler_application_approved':
      return shell(
        'Your wholesaler application was approved',
        `<p>Hi ${escapeHtml(name)},</p><p>Congratulations — <strong>${escapeHtml(String(payload.businessName || ''))}</strong> was approved. Use the button below to set your password and sign in. This link expires in 7 days and can be used once.</p><p><a href="${escapeAttr(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:10px;">Set your password</a></p>`,
        `Hi ${name},\nYour wholesaler application for ${payload.businessName} was approved.\nSet your password (expires in 7 days):\n${link}`
      );
    case 'wholesaler_application_rejected':
      return shell(
        'Update on your wholesaler application',
        `<p>Hi ${escapeHtml(name)},</p><p>We reviewed your application for <strong>${escapeHtml(String(payload.businessName || ''))}</strong> and are unable to approve it at this time.</p>${detail ? `<p>${escapeHtml(detail)}</p>` : ''}<p>You may apply again later with updated details.</p>`,
        `Hi ${name},\nYour wholesaler application for ${payload.businessName} was not approved.${detail ? `\n${detail}` : ''}`
      );
    case 'wholesaler_invite':
      return shell(
        'Set up your wholesaler account',
        `<p>Hi ${escapeHtml(name)},</p><p>Your wholesaler portal is ready. Choose a password to activate sign-in. This link expires in 7 days and can be used once. We never send passwords by email.</p><p><a href="${escapeAttr(link)}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:10px;">Set your password</a></p>`,
        `Hi ${name},\nSet up your wholesaler password (expires in 7 days):\n${link}`
      );
    default:
      return shell('Notification', `<p>${escapeHtml(detail || 'Update from Peshawar Wholesale OS.')}</p>`, detail || 'Update');
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
