import { sendZeptoTemplateEmail } from "./zeptomailTemplate.js";

function money(n) {
  return Number(n || 0).toFixed(2);
}

export async function sendAdminOrderConfirmedViaTemplate(payload) {
  const templateKey = process.env.ZEPTOMAIL_TEMPLATE_KEY_ORDER_ADMIN;

  const from = {
    address: process.env.ZEPTOMAIL_FROM_ADDRESS,
    name: process.env.ZEPTOMAIL_FROM_NAME || "IndiaDoors",
  };

  const adminTo = [
    { address: process.env.ADMIN_NOTIFY_EMAIL, name: "IndiaDoors Admin" },
  ];

  const subject = `Order Confirmed ✅ #${payload.order_id} | ₹${payload.order_total} | ${payload.customer_name}`;

  // ✅ IMPORTANT: keys MUST match template placeholders exactly
  const mergeInfo = {
    order_id: String(payload.order_id || ""),
    order_total: String(payload.order_total || money(0)),
    order_datetime: String(payload.order_datetime || ""),
    timezone: String(payload.timezone || "IST"),
    payment_method: String(payload.payment_method || ""),
    payment_status: String(payload.payment_status || ""),
    order_status: String(payload.order_status || ""),

    customer_name: String(payload.customer_name || ""),
    customer_phone: String(payload.customer_phone || ""),
    customer_email: String(payload.customer_email || ""),

    shipping_address: String(payload.shipping_address || ""),
    billing_address: String(payload.billing_address || ""),

    subtotal: String(payload.subtotal || money(0)),
    shipping_fee: String(payload.shipping_fee || money(0)),
    discount: String(payload.discount || money(0)),

    // ✅ matches template: {{items_rows}}
    items_rows: String(payload.items_rows || ""),

    // ✅ matches template: {{invoice_no}} + {{invoice_download_url}}
    invoice_no: String(payload.invoice_no || ""),
    invoice_download_url: String(payload.invoice_download_url || ""),
  };

  return sendZeptoTemplateEmail({
    templateKey,
    from,
    to: adminTo,
    subject,
    mergeInfo,
    clientReference: `order-${payload.order_id}`,
  });
}

