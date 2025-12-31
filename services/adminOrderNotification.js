import { sendZeptoTemplateEmail } from "./zeptomailTemplate.js";

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function buildItemsHtml(items = []) {
  // Put {{items_html}} in your ZeptoMail template where you want these rows injected
  return items
    .map((it) => {
      const name = escapeHtml(it.name || "Item");
      const variant = escapeHtml(it.variant || "");
      const qty = Number(it.qty || 1);
      const unit = money(it.unit_price);
      const line = money(qty * Number(it.unit_price || 0));

      return `
        <tr>
          <td>${name}${variant ? `<br><small>${variant}</small>` : ""}</td>
          <td align="center">${qty}</td>
          <td align="right">₹${unit}</td>
          <td align="right">₹${line}</td>
        </tr>
      `;
    })
    .join("");
}

export async function sendAdminOrderConfirmedViaTemplate(order) {
  const templateKey = process.env.ZEPTOMAIL_TEMPLATE_KEY_ORDER_ADMIN;

  const from = {
    address: process.env.ZEPTOMAIL_FROM_ADDRESS,
    name: process.env.ZEPTOMAIL_FROM_NAME || "IndiaDoors",
  };

  const adminTo = [{ address: process.env.ADMIN_NOTIFY_EMAIL, name: "IndiaDoors Admin" }];

  const subject = `Order Confirmed ✅ #${order.order_id} | ₹${money(order.order_total)} | ${order.customer_name}`;

  const mergeInfo = {
    order_id: String(order.order_id),
    order_total: money(order.order_total),
    order_datetime: order.order_datetime || "",
    payment_method: order.payment_method || "",
    payment_status: order.payment_status || "",
    order_status: order.order_status || "Confirmed",

    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    customer_email: order.customer_email || "",

    shipping_address: order.shipping_address || "",
    admin_order_link: order.admin_order_link || "",

    subtotal: money(order.subtotal),
    shipping_fee: money(order.shipping_fee),
    discount: money(order.discount),

    items_html: buildItemsHtml(order.items), // use {{items_html}} in template
  };

  return sendZeptoTemplateEmail({
    templateKey,
    from,
    to: adminTo,
    subject,
    mergeInfo,
    clientReference: `order-${order.order_id}`,
  });
}
