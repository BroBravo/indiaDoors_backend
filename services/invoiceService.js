import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import db from "../config/connection1.js";

function fyString(date = new Date()) {
  // India FY: Apr-Mar
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const end = start + 1;
  return `${start}-${String(end).slice(2)}`; // 2025-26
}

async function generateInvoiceNo(conn) {
  const fy = fyString(new Date());
  // lock rows for this FY (simple lock via SELECT ... FOR UPDATE on a sequence table)
  await conn.query(
    `CREATE TABLE IF NOT EXISTS invoice_sequences (
      fy VARCHAR(10) PRIMARY KEY,
      last_no INT NOT NULL DEFAULT 0
    )`
  );

  const [[row]] = await conn.query(`SELECT last_no FROM invoice_sequences WHERE fy = ? FOR UPDATE`, [fy]);

  if (!row) {
    await conn.query(`INSERT INTO invoice_sequences (fy, last_no) VALUES (?, 0)`, [fy]);
  }

  const [[row2]] = await conn.query(`SELECT last_no FROM invoice_sequences WHERE fy = ? FOR UPDATE`, [fy]);
  const next = Number(row2.last_no || 0) + 1;

  await conn.query(`UPDATE invoice_sequences SET last_no = ? WHERE fy = ?`, [next, fy]);

  const padded = String(next).padStart(6, "0");
  return `IND/${fy}/${padded}`;
}

function money(n) {
  return Number(n || 0).toFixed(2);
}

function invoiceHtml(data) {
  // Minimal invoice HTML (you can style more later)
  const itemsRows = data.items.map((it) => `
    <tr>
      <td>${it.item_name}</td>
      <td style="text-align:center">${it.quantity}</td>
      <td style="text-align:right">₹${money(it.item_amount)}</td>
      <td style="text-align:right">₹${money(it.item_amount * it.quantity)}</td>
    </tr>
  `).join("");

  return `
  <html>
  <head>
    <meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; color:#111; font-size:12px; }
      .wrap { width: 760px; margin: 0 auto; padding: 20px; }
      .top { display:flex; justify-content:space-between; }
      .brand { font-size:18px; font-weight:bold; }
      table { width:100%; border-collapse:collapse; margin-top:12px; }
      th, td { border:1px solid #ddd; padding:8px; vertical-align:top; }
      th { background:#f3f4f6; text-align:left; }
      .right { text-align:right; }
      .muted { color:#666; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div>
          <div class="brand">IndiaDoors</div>
          <div class="muted">indiadoors.in</div>
          <div class="muted">Order Invoices</div>
        </div>
        <div class="right">
          <div><b>Invoice:</b> ${data.invoice_no}</div>
          <div><b>Date:</b> ${data.invoice_date}</div>
          <div><b>Order ID:</b> #${data.order_id}</div>
        </div>
      </div>

      <table>
        <tr>
          <th style="width:50%">Billing Address</th>
          <th style="width:50%">Shipping Address</th>
        </tr>
        <tr>
          <td>${data.billing_address_text || ""}</td>
          <td>${data.shipping_address_text || ""}</td>
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

export async function generateInvoiceForRazorpayOrderId(razorpay_order_id) {
  const conn = db; // mysql2 pool

  // Transaction to avoid duplicate invoice numbers on concurrent verify calls
  const connection = await conn.getConnection();
  try {
    await connection.beginTransaction();

    // Get order_id from payments
    const [[pay]] = await connection.query(
      `SELECT order_id, razorpay_payment_id FROM payments WHERE razorpay_order_id = ? LIMIT 1`,
      [razorpay_order_id]
    );
    if (!pay) throw new Error("Payment row not found");

    // If invoice already exists, just return it (idempotent)
    const [[existing]] = await connection.query(
      `SELECT * FROM invoices WHERE order_id = ? LIMIT 1`,
      [pay.order_id]
    );
    if (existing) {
      await connection.commit();
      return existing;
    }

    // Load order + items
    const [[order]] = await connection.query(
      `SELECT id, user_id, total_amount, currency, billing_address_text, shipping_address_text
       FROM orders WHERE id = ? LIMIT 1`,
      [pay.order_id]
    );
    const [items] = await connection.query(
      `SELECT item_name, item_amount, quantity
       FROM ordered_items WHERE order_id = ? ORDER BY id ASC`,
      [pay.order_id]
    );

    const invoice_no = await generateInvoiceNo(connection);

    const subtotal = items.reduce((s, it) => s + Number(it.item_amount || 0) * Number(it.quantity || 1), 0);
    const shipping_fee = Math.max(0, Number(order.total_amount) - subtotal);
    const discount = 0;

    // If you want GST later: set tax_rate and compute tax_amount properly.
    const tax_rate = 0;
    const tax_amount = 0;
    const total = Number(order.total_amount);

    // Insert invoice row (snapshot)
    const [ins] = await connection.query(
      `INSERT INTO invoices
        (order_id, invoice_no, billing_address_text, shipping_address_text,
         subtotal, shipping_fee, discount, tax_rate, tax_amount, total,
         currency, razorpay_payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        invoice_no,
        order.billing_address_text,
        order.shipping_address_text,
        subtotal,
        shipping_fee,
        discount,
        tax_rate,
        tax_amount,
        total,
        order.currency || "INR",
        pay.razorpay_payment_id || null,
      ]
    );

    const invoiceId = ins.insertId;

    // Create PDF file
    const outDir = path.join(process.cwd(), "uploads", "invoices");
    fs.mkdirSync(outDir, { recursive: true });

    const pdfPath = path.join(outDir, `invoice_${invoice_no.replaceAll("/", "_")}.pdf`);

    const html = invoiceHtml({
      invoice_no,
      invoice_date: new Date().toLocaleString("en-IN"),
      order_id: order.id,
      billing_address_text: order.billing_address_text,
      shipping_address_text: order.shipping_address_text,
      items,
      subtotal,
      shipping_fee,
      discount,
      tax_rate,
      tax_amount,
      total,
    });

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    await browser.close();

    // Save pdf_path
    await connection.query(`UPDATE invoices SET pdf_path = ? WHERE id = ?`, [pdfPath, invoiceId]);

    const [[finalRow]] = await connection.query(`SELECT * FROM invoices WHERE id = ? LIMIT 1`, [invoiceId]);

    await connection.commit();
    return finalRow;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
