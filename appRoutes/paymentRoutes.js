import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import db from "../config/connection1.js";
import verifyUserToken from "../config/verifyUserToken.js";
import { sendAdminOrderConfirmedViaTemplate } from "../services/adminOrderNotification.js";
import { generateInvoiceForRazorpayOrderId } from "../services/invoiceService.js";
import { buildAdminOrderEmailPayloadByRazorpayOrderId } from "../services/adminOrderEmailPayload.js";

dotenv.config();

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


router.post("/checkout", verifyUserToken, async (req, res) => {
  const {
    cartItems,
    totalAmount,
    shipping_fee,
    shipping_selection,
    shipping_address_id,
    shipping_address,
  } = req.body;

  const userId = req.user.id; // from verifyUserToken

  // Helper to build "one-line" address text
  const makeAddressText = (addr) => {
  if (!addr || typeof addr !== "object") return null;

  // Try multiple possible keys for first line
  const line =
    addr.address_line ||
    addr.address_line1 ||
    addr.address1 ||
    addr.address ||
    addr.street ||
    addr.line1 ||
    "";

  // Try multiple possible keys for pincode / postal code
  const pin =
    addr.postal_code ||
    addr.pincode ||
    addr.pin ||
    addr.zip ||
    "";

  const parts = [
    line,
    addr.city,
    addr.state,
    pin,
    addr.country,
  ];

  return parts.filter(Boolean).join(", ");
};


  // Defaults
  let shippingAddressId = null;
  let billingAddressId = null;
  let shippingAddressText = null;
  let billingAddressText = null;

  // Case 1: custom address during checkout
  if (shipping_selection === "custom") {
    shippingAddressId = null;
    billingAddressId = null;

    const addrText = makeAddressText(shipping_address);
    shippingAddressText = addrText;
    billingAddressText = addrText; // 🔁 same for billing as you requested
  }

  // (Optional) Case 2: if later you support using saved addresses:
  // else if (shipping_selection === "saved") {
  //   // e.g. shipping_address_id is an existing address row
  //   shippingAddressId = shipping_address_id || null;
  //   billingAddressId = shipping_address_id || null;
  //   shippingAddressText = makeAddressText(shipping_address);
  //   billingAddressText = shippingAddressText;
  // }

  try {
    // 1️⃣ Create Order in `orders` WITH address snapshot
    const [orderResult] = await db.query(
      `INSERT INTO orders 
        (user_id, total_amount, shipping_fee, currency, order_status, payment_status, payment_method,
         shipping_address_id, shipping_address_text,
         billing_address_id,  billing_address_text)
       VALUES (?, ?, ?, 'INR', 'Pending', 'Pending', 'Online',
               ?, ?, ?, ?)`,
      [
        userId,
        totalAmount,
        Number(shipping_fee || 0),
        shippingAddressId,
        shippingAddressText,
        billingAddressId,
        billingAddressText,
      ]
    );

    const orderId = orderResult.insertId;

    // 2️⃣ Insert items into ordered_items
    for (const item of cartItems) {
      await db.query(
        `INSERT INTO ordered_items 
          (order_id, item_amount, item_name, width_in, height_in, 
           front_wrap, back_wrap, front_wrap_price, back_wrap_price, 
           front_carving, back_carving, front_carving_price, back_carving_price, quantity) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.item_amount,
          item.item_name,
          item.width_in,
          item.height_in,
          item.front_wrap,
          item.back_wrap,
          item.front_wrap_price,
          item.back_wrap_price,
          item.front_carving,
          item.back_carving,
          item.front_carving_price,
          item.back_carving_price,
          item.quantity,
        ]
      );
    }

   const amountPaise = Math.round(Number(totalAmount) * 100);

    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return res.status(400).json({ error: "Invalid amount for payment" });
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: amountPaise, // ✅ integer
      currency: "INR",
      receipt: `order_${orderId}`,
    });

    await db.query(`UPDATE orders SET tracking_id = ? WHERE id = ?`, [
      razorpayOrder.id,
      orderId,
    ]);

    // 4️⃣ Insert into payments table
    await db.query(
      `INSERT INTO payments 
        (order_id, razorpay_order_id, payment_gateway, amount, currency, status, payment_mode) 
       VALUES (?, ?, 'Razorpay', ?, ?, 'Pending', 'Online')`,
      [orderId, razorpayOrder.id, Number(totalAmount), "INR"]
    );

    res.json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});


//verify razorpay payment
router.post("/verify", verifyUserToken, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  try {
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      // ❌ Payment verification failed
      await db.query(`UPDATE payments SET status = 'Failed' WHERE razorpay_order_id = ?`, [
        razorpay_order_id,
      ]);

      await db.query(
        `UPDATE orders 
         SET payment_status = 'Failed', order_status = 'Cancelled' 
         WHERE id = (SELECT order_id FROM payments WHERE razorpay_order_id = ? LIMIT 1)`,
        [razorpay_order_id]
      );

      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    // ✅ Payment verified

    // 0) Find internal order_id + user_id reliably
    const [[payRow]] = await db.query(
      `SELECT p.order_id, o.user_id
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.razorpay_order_id = ?
       LIMIT 1`,
      [razorpay_order_id]
    );

    if (!payRow?.order_id) {
      console.error("Verify: payment row not found for razorpay_order_id:", razorpay_order_id);
      return res.status(404).json({ success: false, message: "Order/payment not found" });
    }

    const internalOrderId = payRow.order_id;
    const userId = payRow.user_id;

    // 1) Update payments table
    await db.query(
      `UPDATE payments 
       SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'Completed' 
       WHERE razorpay_order_id = ?`,
      [razorpay_payment_id, razorpay_signature, razorpay_order_id]
    );

    // 2) Update orders table
    await db.query(
      `UPDATE orders 
       SET payment_status = 'Paid', order_status = 'Processing', tracking_id = COALESCE(tracking_id, ?)
       WHERE id = ?`,
      [razorpay_order_id, internalOrderId]
    );

    // 3) Clear cart_items (don’t break flow if it fails)
    try {
      await db.query(`DELETE FROM cart_items WHERE customer_id = ?`, [userId]);
    } catch (cartErr) {
      console.error("Cart clear failed:", cartErr?.message || cartErr);
    }

  // 4) Generate invoice (idempotent)
let invoice = null;
try {
  const invRow = await generateInvoiceForRazorpayOrderId(razorpay_order_id);
  if (invRow) {
    const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const rel = String(invRow.pdf_path || "");
    const url =
      rel && base
        ? `${base}${rel.startsWith("/") ? rel : `/${rel}`}`
        : rel;

    invoice = {
      invoice_no: invRow.invoice_no || "",
      pdf_path: invRow.pdf_path || "",
      invoice_download_url: url || "",
    };
  }
} catch (invErr) {
  console.error("Invoice generation failed:", invErr?.message || invErr);
}

// 5) Send admin email
try {
  const emailPayload = await buildAdminOrderEmailPayloadByRazorpayOrderId(
    razorpay_order_id
  );
  await sendAdminOrderConfirmedViaTemplate(emailPayload);
} catch (mailErr) {
  console.error("Admin email failed (raw):", mailErr);
  console.error("Admin email failed (message):", mailErr?.message);
  console.error("Admin email failed (status):", mailErr?.response?.status);
  console.error(
    "Admin email failed (data):",
    JSON.stringify(mailErr?.response?.data, null, 2)
  );
  console.error("Admin email failed (string):", String(mailErr));
}

return res.json({
  success: true,
  message: "Payment verified",
  order: { id: internalOrderId, tracking_id: razorpay_order_id },
  invoice,
});

  } catch (err) {
    console.error("Verify error:", err);
    return res.status(500).json({ error: "Verification failed" });
  }
});



router.post("/orders/:orderId/notify-admin", async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!orderId) return res.status(400).json({ ok: false, message: "Invalid orderId" });

    // Get tracking_id and build payload by razorpay_order_id if exists
    const [[o]] = await db.query(`SELECT tracking_id FROM orders WHERE id = ? LIMIT 1`, [orderId]);
    if (!o?.tracking_id) return res.status(400).json({ ok: false, message: "No tracking_id found for order" });

    const payload = await buildAdminOrderEmailPayloadByRazorpayOrderId(o.tracking_id);
    const result = await sendAdminOrderConfirmedViaTemplate(payload);

    res.json({ ok: true, zeptomail: result });
  } catch (err) {
    console.error("Zepto template send failed:", err?.response?.data || err.message);
    res.status(500).json({ ok: false, message: "Failed to send admin order notification" });
  }
});


export default router;