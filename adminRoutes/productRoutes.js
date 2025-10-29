// const express = require("express");
// const verifyAdminToken = require("../config/verifyAdminToken");
// const db = require("../config/connection1");
// const router = express.Router();
import express from "express";
import verifyAdminToken from "../config/verifyAdminToken.js";
import db from "../config/connection1.js";

const router = express.Router();

// ---Finished Products Table Routes------------------------------------------------------------------------

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
      ORDER BY product_id ASC
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



router.get("/get/filter", verifyAdminToken, async (req, res) => {
  try {
    // Fetch table metadata once
    const [columns] = await db.query(`DESCRIBE products`);

    const filters = [];
    const values = [];

    // Build filters dynamically
    for (const col of columns) {
      const colName = col.Field;
      const value = req.query[colName];

      if (value !== undefined && value !== "") {
        const type = col.Type.toLowerCase();

        // Detect string-like columns for partial search
        if (type.includes("char") || type.includes("text") || type.includes("blob")) {
          filters.push(`${colName} LIKE ?`);
          values.push(`${value}%`);
        }
        // For date columns, compare date only
        else if (type.includes("date") || type.includes("timestamp")) {
          filters.push(`DATE(${colName}) = ?`);
          values.push(value);
        }
        // Numeric/decimal types
        else {
          filters.push(`${colName} = ?`);
          values.push(value);
        }
      }
    }

    // Pagination
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Main query
    const sql = `
      SELECT
        product_id, name, image, mrp, price,
        front_wrap, back_wrap,
        front_carving, back_carving,
        width_in, height_in,
        created_at, updated_at
      FROM products
      ${whereClause}
      ORDER BY product_id ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...values, limit, offset]);

    // Total count
    const [[{ totalCount }]] = await db.query(
      `SELECT COUNT(*) AS totalCount FROM products ${whereClause}`,
      values
    );

    const hasMore = offset + limit < totalCount;

    res.json({
      success: true,
      total: totalCount,
      hasMore,
      currentOffset: offset,
      items: rows,
    });
  } catch (err) {
    console.error("GET /admin/products/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---Laminate Products Routes------------------------------------------------------------------------

router.get("/laminate/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id, name, image_path, price, discount_perc, active
      FROM laminates
      WHERE active = 1
      ORDER BY id ASC
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

// ---Carving Products Routes------------------------------------------------------------------------

router.get("/carving/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id, name, image_path, price, discount_perc, active
      FROM carvings
      WHERE active = 1
      ORDER BY id ASC
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


export default router;
