const express = require("express");
const crypto = require("crypto");
const  router  = express.Router();
const Razorpay = require("razorpay");
const db = require("../config/connection1");
const verifyToken = require('../config/verifyToken');
require('dotenv').config();

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

router.post("/checkout",verifyToken, async (req, res) => {
  const { cartItems, totalAmount } = req.body;
  const userId = req.user.id; // assuming auth middleware

  try {
    // 1. Create Order in `orders`
    const [orderResult] = await db.query(
      `INSERT INTO orders 
      (user_id, total_amount, currency, order_status, payment_status, payment_method) 
      VALUES (?, ?, 'INR', 'Pending', 'Pending', 'Online')`,
      [userId, totalAmount]
    );

    const orderId = orderResult.insertId;

    // 2. Insert items into ordered_items
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

    // 3. Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: totalAmount * 100, // in paise
      currency: "INR",
      receipt: `order_${orderId}`,
    });

    // 4. Insert into payments table
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
router.post("/verify",verifyToken,  async (req, res) => {
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

module.exports=router;