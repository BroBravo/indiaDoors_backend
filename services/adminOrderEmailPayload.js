import db from "../config/connection1.js";

// ---------- small helpers ----------
function money(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[c] || c;
  });
}

function buildVariantText(r) {
  const parts = [];
  if (r.width_in && r.height_in) parts.push(`${r.width_in}x${r.height_in} in`);
  if (r.front_wrap) parts.push(`Front Wrap: ${r.front_wrap}`);
  if (r.back_wrap) parts.push(`Back Wrap: ${r.back_wrap}`);
  if (r.front_carving) parts.push(`Front Carving: ${r.front_carving}`);
  if (r.back_carving) parts.push(`Back Carving: ${r.back_carving}`);
  return parts.join(" | ");
}

function buildItemsRows(items = []) {
  return items
    .map((r) => {
      const qty = Number(r.quantity || 1);
      const unit = Number(r.item_amount || 0);
      const line = unit * qty;
      const variant = buildVariantText(r);

      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eef2f7;">
            ${escapeHtml(r.item_name || "")}
            ${
              variant
                ? `<br><small style="color:#6b7280">${escapeHtml(
                    variant
                  )}</small>`
                : ""
            }
          </td>
          <td align="center" style="padding:10px;border-bottom:1px solid #eef2f7;">${qty}</td>
          <td align="right" style="padding:10px;border-bottom:1px solid #eef2f7;">₹${money(unit)}</td>
          <td align="right" style="padding:10px;border-bottom:1px solid #eef2f7;">₹${money(line)}</td>
        </tr>
      `;
    })
    .join("");
}

async function getCustomerForOrder(user_id) {
  const [[u]] = await db.query(
    `SELECT id, email, phone, user_type FROM users WHERE id = ? LIMIT 1`,
    [user_id]
  );
  if (!u) return { name: "Customer", email: "", phone: "" };

  const profileTable =
    u.user_type === "Business Partner" ? "business_partners" : "retail_customers";

  const [[p]] = await db.query(
    `SELECT first_name, last_name, email, phone_number
     FROM ${profileTable}
     WHERE user_id = ?
     LIMIT 1`,
    [user_id]
  );

  const name =
    [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || "Customer";

  return {
    name,
    email: p?.email || u.email || "",
    phone: p?.phone_number || u.phone || "",
  };
}

// ---------- main builder ----------
export async function buildAdminOrderEmailPayloadByRazorpayOrderId(razorpay_order_id) {
  // 1) internal order_id
  const [[payRow]] = await db.query(
    `SELECT order_id FROM payments WHERE razorpay_order_id = ? LIMIT 1`,
    [razorpay_order_id]
  );
  if (!payRow) throw new Error("No payment row found for razorpay_order_id");

  const orderDbId = payRow.order_id;

  // 2) order
  const [[orderRow]] = await db.query(
    `SELECT id, user_id, total_amount, shipping_fee,
            order_status, payment_status, payment_method,
            shipping_address_text, billing_address_text,
            tracking_id, order_date
     FROM orders
     WHERE id = ?
     LIMIT 1`,
    [orderDbId]
  );
  if (!orderRow) throw new Error("Order not found");

  // 3) items
  const [itemsRows] = await db.query(
    `SELECT item_name, item_amount, quantity,
            width_in, height_in,
            front_wrap, back_wrap,
            front_carving, back_carving
     FROM ordered_items
     WHERE order_id = ?
     ORDER BY id ASC`,
    [orderDbId]
  );

  // 4) customer
  const customer = await getCustomerForOrder(orderRow.user_id);

  // 5) invoice
  const [[inv]] = await db.query(
    `SELECT invoice_no, pdf_path
     FROM invoices
     WHERE order_id = ?
     LIMIT 1`,
    [orderDbId]
  );

  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

  let invoice_download_url = "";
  let invoice_no = "";

  if (inv?.pdf_path) {
    invoice_no = inv.invoice_no || "";
    const rel = String(inv.pdf_path).startsWith("/")
      ? String(inv.pdf_path)
      : `/${String(inv.pdf_path)}`;

    // If PUBLIC_BASE_URL not set, it will be a relative URL (email clients may not like it)
    invoice_download_url = base ? `${base}${rel}` : rel;
  }

  // totals
  const subtotal = (itemsRows || []).reduce((s, r) => {
    const qty = Number(r.quantity || 1);
    const unit = Number(r.item_amount || 0);
    return s + unit * qty;
  }, 0);

  const shipping_fee = Number(orderRow.shipping_fee || 0);
  const total = Number(orderRow.total_amount || subtotal + shipping_fee);
  const discount = 0;

  return {
    order_id: String(orderRow.id),
    order_datetime: orderRow.order_date
      ? new Date(orderRow.order_date).toLocaleString("en-IN")
      : "",
    timezone: "IST",

    payment_method: String(orderRow.payment_method || ""),
    payment_status: String(orderRow.payment_status || ""),
    order_status: String(orderRow.order_status || ""),

    order_total: money(total),
    subtotal: money(subtotal),
    shipping_fee: money(shipping_fee),
    discount: money(discount),

    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_email: customer.email,

    shipping_address: String(orderRow.shipping_address_text || ""),
    billing_address: String(orderRow.billing_address_text || ""),

    // ✅ template placeholder
    items_rows: buildItemsRows(itemsRows),

    // ✅ template placeholders
    invoice_no: String(invoice_no || ""),
    invoice_download_url: String(invoice_download_url || ""),
  };
}

