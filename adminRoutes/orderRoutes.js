const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../config/connection1");  
const SECRET_KEY = process.env.JWT_SECRET || "your_secret_key";

router.get("/get/table", /* verifyAdmin, */ async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id, user_id, total_amount, currency,
        order_status, payment_status, payment_method,
        shipping_address_id, billing_address_id,
        tracking_id, expected_delivery, order_date, updated_at
      FROM orders
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

    // Pull limit+1 rows to detect if there is another page
    const [rows] = await db.query(sql, [limit + 1, offset]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      success: true,
      items,
      nextOffset: offset + items.length,
      hasMore,
    });
  } catch (err) {
    console.error("GET /admin/orders failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;