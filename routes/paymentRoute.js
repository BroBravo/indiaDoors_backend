const express = require("express");
const  router  = express.Router();
const Razorpay = require("razorpay");
const db = require("../config/connection1");
require('dotenv').config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,     
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

router.post("/checkout", async (req, res) => {
  const { totalAmount } = req.body;

  const options = {
    amount: Math.round(Number(totalAmount) * 100), // amount in paisa
    currency: "INR",
    receipt: `order_rcptid_${Date.now()}`,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

module.exports=router;