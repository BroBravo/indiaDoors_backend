import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import db from "../config/connection1.js";

// -------------------------
// Helpers
// -------------------------
function fyString(date = new Date()) {
  // India FY: Apr-Mar
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const end = start + 1;
  return `${start}-${String(end).slice(2)}`; // 2025-26
}

async function ensureInvoiceSequenceTable(poolOrConn) {
  // IMPORTANT: keep DDL OUTSIDE transactions where possible
  await poolOrConn.query(
    `CREATE TABLE IF NOT EXISTS invoice_sequences (
      fy VARCHAR(10) PRIMARY KEY,
      last_no INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`
  );
}

async function generateInvoiceNo(conn) {
  const fy = fyString(new Date());

  // Ensure row exists (no lock yet)
  await conn.query(
    `INSERT INTO invoice_sequences (fy, last_no)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE fy = fy`,
    [fy]
  );

  // Lock FY row
  const [[row]] = await conn.query(
    `SELECT last_no FROM invoice_sequences WHERE fy = ? FOR UPDATE`,
    [fy]
  );

  const next = Number(row?.last_no || 0) + 1;

  await conn.query(`UPDATE invoice_sequences SET last_no = ? WHERE fy = ?`, [
    next,
    fy,
  ]);

  const padded = String(next).padStart(6, "0");
  return `IND/${fy}/${padded}`;
}

function money(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toFixed(2) : "0.00";
}

function safe(v) {
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

function buildVariantText(it) {
  const parts = [];
  if (it.width_in && it.height_in) parts.push(`${it.width_in}x${it.height_in} in`);
  if (it.front_wrap) parts.push(`Front Wrap: ${it.front_wrap}`);
  if (it.back_wrap) parts.push(`Back Wrap: ${it.back_wrap}`);
  if (it.front_carving) parts.push(`Front Carving: ${it.front_carving}`);
  if (it.back_carving) parts.push(`Back Carving: ${it.back_carving}`);
  return parts.join(" | ");
}

function invoiceHtml(data) {
  const itemsRows = (data.items || [])
    .map((it) => {
      const qty = Number(it.quantity || 1);
      const unit = Number(it.item_amount || 0);
      const lineTotal = unit * qty;
      const variant = buildVariantText(it);

      return `
        <tr>
          <td>
            <div><b>${safe(it.item_name || "Item")}</b></div>
            ${variant ? `<div class="muted" style="margin-top:2px">${safe(variant)}</div>` : ""}
          </td>
          <td style="text-align:center">${qty}</td>
          <td style="text-align:right">₹${money(unit)}</td>
          <td style="text-align:right">₹${money(lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; color:#111; font-size:12px; }
      .wrap { width: 760px; margin: 0 auto; padding: 20px; }
      .top { display:flex; justify-content:space-between; gap:16px; }
      .brand { font-size:18px; font-weight:bold; }
      table { width:100%; border-collapse:collapse; margin-top:12px; }
      th, td { border:1px solid #ddd; padding:8px; vertical-align:top; }
      th { background:#f3f4f6; text-align:left; }
      .right { text-align:right; }
      .muted { color:#666; font-size:11px; }
      .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
      .box { border:1px solid #ddd; padding:10px; }
      .k { color:#555; font-size:11px; }
      .v { font-weight:bold; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div>
          <div class="brand">IndiaDoors</div>
          <div class="muted">indiadoors.in</div>
          <div class="muted">System Generated Invoice</div>
        </div>
        <div class="right">
          <div><span class="k">Invoice:</span> <span class="v">${safe(data.invoice_no)}</span></div>
          <div><span class="k">Date:</span> <span class="v">${safe(data.invoice_date)}</span></div>
          <div><span class="k">Order ID:</span> <span class="v">#${safe(data.order_id)}</span></div>
          ${data.razorpay_payment_id ? `<div><span class="k">Payment ID:</span> <span class="v">${safe(data.razorpay_payment_id)}</span></div>` : ""}
        </div>
      </div>

      <div class="grid2" style="margin-top:12px;">
        <div class="box">
          <div style="font-weight:bold; margin-bottom:6px;">Customer</div>
          <div>${safe(data.customer_name || "Customer")}</div>
          ${data.customer_phone ? `<div class="muted">Phone: ${safe(data.customer_phone)}</div>` : ""}
          ${data.customer_email ? `<div class="muted">Email: ${safe(data.customer_email)}</div>` : ""}
          ${data.user_type ? `<div class="muted">Type: ${safe(data.user_type)}</div>` : ""}
        </div>

        <div class="box">
          <div style="font-weight:bold; margin-bottom:6px;">Order</div>
          <div class="muted">Payment Method: ${safe(data.payment_method || "")}</div>
          <div class="muted">Currency: ${safe(data.currency || "INR")}</div>
        </div>
      </div>

      <table>
        <tr>
          <th style="width:50%">Billing Address</th>
          <th style="width:50%">Shipping Address</th>
        </tr>
        <tr>
          <td>${safe(data.billing_address_text || "")}</td>
          <td>${safe(data.shipping_address_text || "")}</td>
        </tr>
      </table>

      <table>
        <tr>
          <th>Item</th>
          <th style="width:70px;text-align:center">Qty</th>
          <th style="width:120px;text-align:right">Unit</th>
          <th style="width:120px;text-align:right">Line Total</th>
        </tr>
        ${itemsRows}
      </table>

      <table>
        <tr><td class="right" colspan="3"><b>Subtotal</b></td><td class="right">₹${money(data.subtotal)}</td></tr>
        <tr><td class="right" colspan="3">Shipping</td><td class="right">₹${money(data.shipping_fee)}</td></tr>
        <tr><td class="right" colspan="3">Discount</td><td class="right">-₹${money(data.discount)}</td></tr>
        <tr><td class="right" colspan="3">Tax (${money(data.tax_rate)}%)</td><td class="right">₹${money(data.tax_amount)}</td></tr>
        <tr><td class="right" colspan="3" style="font-size:13px"><b>Total</b></td><td class="right" style="font-size:13px"><b>₹${money(data.total)}</b></td></tr>
      </table>

      <p class="muted" style="margin-top:12px;">
        This is a system-generated invoice.
      </p>
    </div>
  </body>
  </html>`;
}

async function fetchCustomerProfile(connection, userId) {
  const [[u]] = await connection.query(
    `SELECT id, phone, email, user_type
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  let customer_name = "Customer";
  let customer_phone = u?.phone || "";
  let customer_email = u?.email || "";
  let user_type = u?.user_type || "";

  if (u?.user_type === "Customer") {
    const [[rc]] = await connection.query(
      `SELECT first_name, last_name, phone_number, email
       FROM retail_customers
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    if (rc) {
      customer_name = `${rc.first_name || ""} ${rc.last_name || ""}`.trim() || customer_name;
      customer_phone = rc.phone_number || customer_phone;
      customer_email = rc.email || customer_email;
    }
  } else if (u?.user_type === "Business Partner") {
    const [[bp]] = await connection.query(
      `SELECT first_name, last_name, phone_number, email
       FROM business_partners
       WHERE user_id = ?
       LIMIT 1`,
      [userId]
    );
    if (bp) {
      customer_name = `${bp.first_name || ""} ${bp.last_name || ""}`.trim() || customer_name;
      customer_phone = bp.phone_number || customer_phone;
      customer_email = bp.email || customer_email;
    }
  }

  return { customer_name, customer_phone, customer_email, user_type, payment_fallback_email: u?.email || "" };
}

async function ensurePdfExistsForInvoice({ orderId, razorpay_order_id }) {
  // Use pool direct queries (no long transaction)
  const connection = await db.getConnection();
  try {
    // invoice row
    const [[inv]] = await connection.query(
      `SELECT id, order_id, invoice_no, invoice_date, pdf_path, status
       FROM invoices
       WHERE order_id = ?
       LIMIT 1`,
      [orderId]
    );
    if (!inv) return null;

    const fileName = path.basename(inv.pdf_path || "");
    if (!fileName) return inv;

    const invoicesDirFs = path.join(process.cwd(), "invoices");
    fs.mkdirSync(invoicesDirFs, { recursive: true });

    const pdfFsPath = path.join(invoicesDirFs, fileName);

    // Already exists
    if (fs.existsSync(pdfFsPath)) return inv;

    // Load order + payment + items for PDF generation
    const [[pay]] = await connection.query(
      `SELECT razorpay_payment_id
       FROM payments
       WHERE razorpay_order_id = ?
       LIMIT 1`,
      [razorpay_order_id]
    );

    const [[order]] = await connection.query(
      `SELECT id, user_id, total_amount, shipping_fee, currency, payment_method,
              billing_address_text, shipping_address_text, order_date
       FROM orders
       WHERE id = ?
       LIMIT 1`,
      [orderId]
    );
    if (!order) return inv;

    const [items] = await connection.query(
      `SELECT item_name, item_amount, quantity,
              width_in, height_in,
              front_wrap, back_wrap,
              front_carving, back_carving
       FROM ordered_items
       WHERE order_id = ?
       ORDER BY id ASC`,
      [orderId]
    );

    const { customer_name, customer_phone, customer_email, user_type } =
      await fetchCustomerProfile(connection, order.user_id);

    const subtotal = (items || []).reduce(
      (s, it) => s + Number(it.item_amount || 0) * Number(it.quantity || 1),
      0
    );

    const shipping_fee = Number(order.shipping_fee || 0);
    const total = Number(order.total_amount || (subtotal + shipping_fee));
    const discount = 0;
    const tax_rate = 0;
    const tax_amount = 0;

    const html = invoiceHtml({
      invoice_no: inv.invoice_no,
      invoice_date: new Date(inv.invoice_date || Date.now()).toLocaleString("en-IN"),
      order_id: orderId,
      currency: order.currency || "INR",
      payment_method: order.payment_method || "",
      razorpay_payment_id: pay?.razorpay_payment_id || "",

      billing_address_text: order.billing_address_text || "",
      shipping_address_text: order.shipping_address_text || "",

      customer_name,
      customer_phone,
      customer_email,
      user_type,

      items,
      subtotal,
      shipping_fee,
      discount,
      tax_rate,
      tax_amount,
      total,
    });

    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.pdf({ path: pdfFsPath, format: "A4", printBackground: true });
    } finally {
      await browser.close();
    }

    return inv;
  } finally {
    connection.release();
  }
}

// -------------------------
// Main export
// -------------------------
export async function generateInvoiceForRazorpayOrderId(razorpay_order_id) {
  // Ensure sequence table exists OUTSIDE any transaction
  await ensureInvoiceSequenceTable(db);

  const pool = db;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // payments -> order_id
    const [[pay]] = await connection.query(
      `SELECT order_id
       FROM payments
       WHERE razorpay_order_id = ?
       LIMIT 1`,
      [razorpay_order_id]
    );
    if (!pay?.order_id) throw new Error("Payment row not found for razorpay_order_id");

    const orderId = pay.order_id;

    // idempotent: invoice exists?
    const [[existing]] = await connection.query(
      `SELECT id, order_id, invoice_no, invoice_date, pdf_path, status
       FROM invoices
       WHERE order_id = ?
       LIMIT 1`,
      [orderId]
    );

    if (existing) {
      await connection.commit();
      // If file missing, regenerate it
      await ensurePdfExistsForInvoice({ orderId, razorpay_order_id });
      return existing;
    }

    // Create invoice number + insert invoice row (minimal table columns)
    const invoice_no = await generateInvoiceNo(connection);

    const invoicesDirFs = path.join(process.cwd(), "invoices");
    fs.mkdirSync(invoicesDirFs, { recursive: true });

    const fileSafe = invoice_no.replaceAll("/", "_");
    const fileName = `invoice_${fileSafe}.pdf`;

    // Save WEB path in DB
    const pdfDbPath = `/invoices/${fileName}`;

    // Insert row (pdf_path is NOT NULL in your invoices table)
    try {
      await connection.query(
        `INSERT INTO invoices (order_id, invoice_no, pdf_path)
         VALUES (?, ?, ?)`,
        [orderId, invoice_no, pdfDbPath]
      );
    } catch (e) {
      // If concurrent call inserted already
      if (String(e?.code) === "ER_DUP_ENTRY") {
        const [[inv]] = await connection.query(
          `SELECT id, order_id, invoice_no, invoice_date, pdf_path, status
           FROM invoices
           WHERE order_id = ?
           LIMIT 1`,
          [orderId]
        );
        await connection.commit();
        await ensurePdfExistsForInvoice({ orderId, razorpay_order_id });
        return inv;
      }
      throw e;
    }

    const [[finalRow]] = await connection.query(
      `SELECT id, order_id, invoice_no, invoice_date, pdf_path, status
       FROM invoices
       WHERE order_id = ?
       LIMIT 1`,
      [orderId]
    );

    await connection.commit();

    // Generate PDF after commit (fast DB transaction, heavy work outside)
    await ensurePdfExistsForInvoice({ orderId, razorpay_order_id });

    return finalRow;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
