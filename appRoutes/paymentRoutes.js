
import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import db from "../config/connection1.js";
import verifyUserToken from "../config/verifyUserToken.js";
import { sendAdminOrderConfirmedViaTemplate } from "../services/adminOrderNotification.js";

dotenv.config();

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

function safe(s) {
  return s == null ? "" : String(s);
}

function buildItemVariant(row) {
  const parts = [];
  if (row.width_in && row.height_in) parts.push(`${row.width_in}x${row.height_in} in`);
  if (row.front_wrap) parts.push(`Front Wrap: ${row.front_wrap}`);
  if (row.back_wrap) parts.push(`Back Wrap: ${row.back_wrap}`);
  if (row.front_carving) parts.push(`Front Carving: ${row.front_carving}`);
  if (row.back_carving) parts.push(`Back Carving: ${row.back_carving}`);
  return parts.join(" | ");
}

// Fetch a payload for email template from DB (order + items + user)
async function buildAdminOrderEmailPayloadByRazorpayOrderId(razorpay_order_id) {
  // 1) Find the internal order_id from payments
  const [[payRow]] = await db.query(
    `SELECT order_id FROM payments WHERE razorpay_order_id = ? LIMIT 1`,
    [razorpay_order_id]
  );
  if (!payRow) throw new Error("No payment row found for razorpay_order_id");

  const orderDbId = payRow.order_id;

  // 2) Get order
  const [[orderRow]] = await db.query(
    `SELECT id, user_id, total_amount, order_status, payment_status, payment_method,
            shipping_address_text, billing_address_text, tracking_id, order_date
     FROM orders
     WHERE id = ?
     LIMIT 1`,
    [orderDbId]
  );
  if (!orderRow) throw new Error("Order not found");

  // 3) Get items
  const [itemsRows] = await db.query(
    `SELECT item_name, item_amount, quantity,
            width_in, height_in,
            front_wrap, back_wrap, front_wrap_price, back_wrap_price,
            front_carving, back_carving, front_carving_price, back_carving_price
     FROM ordered_items
     WHERE order_id = ?
     ORDER BY id ASC`,
    [orderDbId]
  );

  // 4) Get user/customer info
  // IMPORTANT: adjust table name/columns if your user table differs.
  // I'm assuming a `users` table with id, username, phone, email.
  let customer = { username: "Customer", phone: "", email: "" };
  try {
    const [[u]] = await db.query(
      `SELECT username, phone, email FROM users WHERE id = ? LIMIT 1`,
      [orderRow.user_id]
    );
    if (u) customer = u;
  } catch (e) {
    // If your table isn't `users`, update query to your actual table name.
  }

  // Build items for template
  const items = itemsRows.map((r) => {
    const qty = Number(r.quantity || 1);
    const unit = Number(r.item_amount || 0);
    return {
      name: safe(r.item_name),
      variant: buildItemVariant(r),
      qty,
      unit_price: unit, // used by many templates
      line_total: unit * qty,
    };
  });

  const subtotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
  const total = Number(orderRow.total_amount || subtotal);

  // If you want shipping fee/discount, compute/stash them in DB later.
  const shipping_fee = Math.max(0, total - subtotal);
  const discount = 0;

  return {
    order_id: orderRow.id,
    order_datetime: orderRow.order_date ? new Date(orderRow.order_date).toLocaleString("en-IN") : "",
    payment_method: safe(orderRow.payment_method),
    payment_status: safe(orderRow.payment_status),
    order_status: safe(orderRow.order_status),
    order_total: total,

    customer_name: safe(customer.username),
    customer_phone: safe(customer.phone),
    customer_email: safe(customer.email),

    shipping_address: safe(orderRow.shipping_address_text),
    billing_address: safe(orderRow.billing_address_text),

    subtotal,
    shipping_fee,
    discount,
    items,
  };
}

// router.post("/checkout", async (req, res) => {
//   const { totalAmount } = req.body;

//   const options = {
//     amount: Math.round(Number(totalAmount) * 100), // amount in paisa
//     currency: "INR",
//     receipt: `order_rcptid_${Date.now()}`,
//   };

//   try {
//     const order = await razorpay.orders.create(options);
//     res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create order" });
//   }
// });

router.post("/checkout", verifyUserToken, async (req, res) => {
  const {
    cartItems,
    totalAmount,
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
        (user_id, total_amount, currency, order_status, payment_status, payment_method,
         shipping_address_id, shipping_address_text,
         billing_address_id,  billing_address_text)
       VALUES (?, ?, 'INR', 'Pending', 'Pending', 'Online',
               ?, ?, ?, ?)`,
      [
        userId,
        totalAmount,
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

    // 3️⃣ Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount * 100, // paise
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
      [orderId, razorpayOrder.id, totalAmount, "INR"]
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
router.post("/verify",verifyUserToken,  async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  try {
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature === razorpay_signature) {
      // ✅ Payment verified

      // 1. Update payments table
      await db.query(
        `UPDATE payments 
         SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'Completed' 
         WHERE razorpay_order_id = ?`,
        [razorpay_payment_id, razorpay_signature, razorpay_order_id]
      );

      // 2. Update orders table
      await db.query(
        `UPDATE orders 
         SET payment_status = 'Paid', order_status = 'Processing' 
         WHERE tracking_id = ? OR id = (
            SELECT order_id FROM payments WHERE razorpay_order_id = ?
         )`,
        [razorpay_order_id, razorpay_order_id]
      );

      // 3. (Optional) Clear cart_items for user
      // safer: find user_id via order -> then clear cart
      const [[orderRow]] = await db.query(
        "SELECT user_id FROM orders WHERE tracking_id = ?",
        [razorpay_order_id]
      );
      if (orderRow) {
        await db.query("DELETE FROM cart_items WHERE customer_id = ?", [orderRow.user_id]);
      }

      // ✅ Send admin email (don’t break payment success if email fails)
      try {
        const emailPayload = await buildAdminOrderEmailPayloadByRazorpayOrderId(razorpay_order_id);
        await sendAdminOrderConfirmedViaTemplate(emailPayload);
      } catch (mailErr) {
        console.error("Admin email failed (raw):", mailErr);

        // If axios error:
        console.error("Admin email failed (message):", mailErr?.message);
        console.error("Admin email failed (status):", mailErr?.response?.status);
        console.error("Admin email failed (data):", JSON.stringify(mailErr?.response?.data, null, 2));

        // If ZeptoMail SDK error (non-axios):
        console.error("Admin email failed (string):", String(mailErr));
      }


      res.json({ success: true, message: "Payment verified" });
    } else {
      // ❌ Payment verification failed
      await db.query(
        `UPDATE payments SET status = 'Failed' WHERE razorpay_order_id = ?`,
        [razorpay_order_id]
      );
      await db.query(
        `UPDATE orders SET payment_status = 'Failed', order_status = 'Cancelled' 
         WHERE tracking_id = ?`,
        [razorpay_order_id]
      );

      res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error("Verify error:", err);
    res.status(500).json({ error: "Verification failed" });
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