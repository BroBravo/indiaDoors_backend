const express = require("express");
const verifyAdminToken = require("../config/verifyAdminToken");
const db = require("../config/connection1");
const router = express.Router();

router.get("/get/table", verifyAdminToken, async (req, res) => {
  try {
    // 🧩 Pagination parameters
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // 🧠 SQL query — aligned with your finished products table
    const sql = `
      SELECT
        product_id, name, image, mrp, price,
        front_wrap, back_wrap,
        front_carving, back_carving,
        width_in, height_in,
        created_at, updated_at
      FROM products
      ORDER BY product_id DESC
      LIMIT ? OFFSET ?
    `;

    // ⚙️ Fetch one extra row to detect "hasMore"
    const [rows] = await db.query(sql, [limit + 1, offset]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // ✅ Response payload
    res.json({
      success: true,
      items,
      nextOffset: offset + items.length,
      hasMore,
    });
  } catch (err) {
    console.error("GET /admin/products failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/laminate/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id, name, image_path, price, discount_perc, active
      FROM laminates
      WHERE active = 1
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

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
    console.error("GET /admin/laminates failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/carving/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id, name, image_path, price, discount_perc, active
      FROM carvings
      WHERE active = 1
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;

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
    console.error("GET /admin/carvings failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



module.exports = router;
