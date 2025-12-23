
import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import db from "../config/connection1.js";
import verifyUserToken from "../config/verifyUserToken.js";

dotenv.config();

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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

export default router;