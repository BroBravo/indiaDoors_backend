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
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        p.product_id,
        p.name,
        p.image,
        p.mrp,
        p.price,
        p.front_wrap,
        p.back_wrap,
        p.front_carving,
        p.back_carving,
        p.width_in,
        p.height_in,
        p.created_at,
        p.updated_at,

        -- wrap images
        fw.image_path AS front_wrap_image,
        bw.image_path AS back_wrap_image,

        -- carving images 👇
        fc.image_path AS front_carving_image,
        bc.image_path AS back_carving_image
      FROM products p
      LEFT JOIN laminates fw ON p.front_wrap = fw.name
      LEFT JOIN laminates bw ON p.back_wrap = bw.name
      LEFT JOIN carvings fc ON p.front_carving = fc.name
      LEFT JOIN carvings bc ON p.back_carving = bc.name
      ORDER BY p.product_id ASC
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
    console.error("GET /admin/products failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/get/filter", verifyAdminToken, async (req, res) => {
  try {
    const [columns] = await db.query(`DESCRIBE products`);

    const filters = [];
    const values = [];

    for (const col of columns) {
      const colName = col.Field;
      const value = req.query[colName];

      if (value !== undefined && value !== "") {
        const type = col.Type.toLowerCase();

        if (type.includes("char") || type.includes("text") || type.includes("blob")) {
          filters.push(`p.\`${colName}\` LIKE ?`);
          values.push(`${value}%`);
        } else if (type.includes("date") || type.includes("timestamp")) {
          filters.push(`DATE(p.\`${colName}\`) = ?`);
          values.push(value);
        } else {
          filters.push(`p.\`${colName}\` = ?`);
          values.push(value);
        }
      }
    }

    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT
        p.product_id,
        p.name,
        p.image,
        p.mrp,
        p.price,
        p.front_wrap,
        p.back_wrap,
        p.front_carving,
        p.back_carving,
        p.width_in,
        p.height_in,
        p.created_at,
        p.updated_at,

        -- wrap images
        fw.image_path AS front_wrap_image,
        bw.image_path AS back_wrap_image,

        -- carving images 👇
        fc.image_path AS front_carving_image,
        bc.image_path AS back_carving_image
      FROM products p
      LEFT JOIN laminates fw ON p.front_wrap = fw.name
      LEFT JOIN laminates bw ON p.back_wrap = bw.name
      LEFT JOIN carvings fc ON p.front_carving = fc.name
      LEFT JOIN carvings bc ON p.back_carving = bc.name
      ${whereClause}
      ORDER BY p.product_id ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...values, limit, offset]);

    const [[{ totalCount }]] = await db.query(
      `SELECT COUNT(*) AS totalCount FROM products p ${whereClause}`,
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



router.post("/bulk-update", verifyAdminToken, async (req, res) => {
  try {
    let { ids, filters, data } = req.body;

    // --------- 1) Validate update data ----------
    if (!data || typeof data !== "object") {
      return res.status(400).json({
        success: false,
        message: "No update data provided.",
      });
    }

    // Columns that are allowed to be updated
    const allowedColumns = [
      "name",
      "image",
      "mrp",
      "price",
      "front_wrap",
      "back_wrap",
      "front_carving",
      "back_carving",
      "width_in",
      "height_in",
      // add any more editable columns here
    ];

    const setClauses = [];
    const setValues = [];

    for (const [key, value] of Object.entries(data)) {
      if (!allowedColumns.includes(key)) continue; // skip disallowed columns
      if (value === "" || value === null || value === undefined) continue; // skip empty

      setClauses.push(`\`${key}\` = ?`);
      setValues.push(value);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update.",
      });
    }

    // Optional: always bump updated_at
    setClauses.push("updated_at = NOW()");

    // --------- 2) Build WHERE clause from ids + filters ----------

    const whereParts = [];
    const whereValues = [];

    // Normalize ids
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      whereParts.push(`product_id IN (${placeholders})`);
      whereValues.push(...ids);
    } else {
      ids = null; // treat anything else as "no IDs"
    }

    // Filters
    if (filters && typeof filters === "object") {
      // columns we allow in filters (for safety)
      const filterableColumns = [
        "product_id",
        "name",
        "mrp",
        "price",
        "front_wrap",
        "back_wrap",
        "front_carving",
        "back_carving",
        "width_in",
        "height_in",
        "created_at",
        "updated_at",
      ];

      for (const [key, rawVal] of Object.entries(filters)) {
        if (!rawVal) continue;
        if (!filterableColumns.includes(key)) continue;

        const val = String(rawVal);

        if (["mrp", "price", "width_in", "height_in", "product_id"].includes(key)) {
          // numeric / exact filters
          whereParts.push(`\`${key}\` = ?`);
          whereValues.push(val);
        } else {
          // string-ish filters -> LIKE
          whereParts.push(`\`${key}\` LIKE ?`);
          whereValues.push(`%${val}%`);
        }
      }
    }

    // If ids = null and no filters => this will update ALL rows (your requirement)
    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const sql = `
      UPDATE products
      SET ${setClauses.join(", ")}
      ${whereClause}
    `;

    // Final params: first SET values, then WHERE values
    const params = [...setValues, ...whereValues];

    const [result] = await db.query(sql, params);

    return res.json({
      success: true,
      affectedRows: result.affectedRows,
      message: `Updated ${result.affectedRows} product(s).`,
    });
  } catch (err) {
    console.error("POST /admin/product/bulk-update failed:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while updating products.",
    });
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

router.get("/laminate/get/filter", verifyAdminToken, async (req, res) => {
  try {
    const [columns] = await db.query(`DESCRIBE laminates`);

    const filters = [];
    const values = [];

    for (const col of columns) {
      const colName = col.Field;
      const value = req.query[colName];

      if (value !== undefined && value !== "") {
        const type = col.Type.toLowerCase();

        if (type.includes("char") || type.includes("text")) {
          filters.push(`${colName} LIKE ?`);
          values.push(`${value}%`);
        } else if (type.includes("date") || type.includes("timestamp")) {
          filters.push(`DATE(${colName}) = ?`);
          values.push(value);
        } else {
          filters.push(`${colName} = ?`);
          values.push(value);
        }
      }
    }

    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT id, name, image_path, price, discount_perc, active
      FROM laminates
      ${whereClause}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...values, limit, offset]);
    const [[{ totalCount }]] = await db.query(
      `SELECT COUNT(*) AS totalCount FROM laminates ${whereClause}`,
      values
    );

    const hasMore = offset + limit < totalCount;

    res.json({ success: true, total: totalCount, hasMore, items: rows });
  } catch (err) {
    console.error("GET /admin/laminate/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.post("/laminate/bulk-update", verifyAdminToken, async (req, res) => {
  try {
    let { ids, filters, data } = req.body;

    if (!data || typeof data !== "object") {
      return res.status(400).json({
        success: false,
        message: "No update data provided.",
      });
    }

    // Columns that can be edited in laminates
    const allowedColumns = [
      "name",
      "image_path",
      "price",
      "discount_perc",
      "active",
    ];

    const setClauses = [];
    const setValues = [];

    for (const [key, value] of Object.entries(data)) {
      if (!allowedColumns.includes(key)) continue;
      if (value === "" || value === null || value === undefined) continue;

      setClauses.push(`\`${key}\` = ?`);
      setValues.push(value);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update.",
      });
    }

    const whereParts = [];
    const whereValues = [];

    // IDs filter (selected rows)
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      whereParts.push(`id IN (${placeholders})`);
      whereValues.push(...ids);
    } else {
      ids = null;
    }

    // Additional filters (from table header filters)
    if (filters && typeof filters === "object") {
      const filterableColumns = [
        "id",
        "name",
        "image_path",
        "price",
        "discount_perc",
        "active",
      ];

      for (const [key, rawVal] of Object.entries(filters)) {
        if (!rawVal) continue;
        if (!filterableColumns.includes(key)) continue;

        const val = String(rawVal);

        if (["id", "price", "discount_perc", "active"].includes(key)) {
          whereParts.push(`\`${key}\` = ?`);
          whereValues.push(val);
        } else {
          whereParts.push(`\`${key}\` LIKE ?`);
          whereValues.push(`%${val}%`);
        }
      }
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const sql = `
      UPDATE laminates
      SET ${setClauses.join(", ")}
      ${whereClause}
    `;

    const params = [...setValues, ...whereValues];
    const [result] = await db.query(sql, params);

    return res.json({
      success: true,
      affectedRows: result.affectedRows,
      message: `Updated ${result.affectedRows} laminate(s).`,
    });
  } catch (err) {
    console.error("POST /admin/product/laminate/bulk-update failed:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while updating laminates.",
    });
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

router.get("/carving/get/filter", verifyAdminToken, async (req, res) => {
  try {
    const [columns] = await db.query(`DESCRIBE carvings`);

    const filters = [];
    const values = [];

    for (const col of columns) {
      const colName = col.Field;
      const value = req.query[colName];

      if (value !== undefined && value !== "") {
        const type = col.Type.toLowerCase();

        if (type.includes("char") || type.includes("text")) {
          filters.push(`${colName} LIKE ?`);
          values.push(`${value}%`);
        } else if (type.includes("date") || type.includes("timestamp")) {
          filters.push(`DATE(${colName}) = ?`);
          values.push(value);
        } else {
          filters.push(`${colName} = ?`);
          values.push(value);
        }
      }
    }

    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT id, name, image_path, price, discount_perc, active
      FROM carvings
      ${whereClause}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...values, limit, offset]);
    const [[{ totalCount }]] = await db.query(
      `SELECT COUNT(*) AS totalCount FROM carvings ${whereClause}`,
      values
    );

    const hasMore = offset + limit < totalCount;

    res.json({ success: true, total: totalCount, hasMore, items: rows });
  } catch (err) {
    console.error("GET /admin/carving/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.post("/carving/bulk-update", verifyAdminToken, async (req, res) => {
  try {
    let { ids, filters, data } = req.body;

    if (!data || typeof data !== "object") {
      return res.status(400).json({
        success: false,
        message: "No update data provided.",
      });
    }

    const allowedColumns = [
      "name",
      "image_path",
      "price",
      "discount_perc",
      "active",
    ];

    const setClauses = [];
    const setValues = [];

    for (const [key, value] of Object.entries(data)) {
      if (!allowedColumns.includes(key)) continue;
      if (value === "" || value === null || value === undefined) continue;

      setClauses.push(`\`${key}\` = ?`);
      setValues.push(value);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update.",
      });
    }

    const whereParts = [];
    const whereValues = [];

    // IDs filter
    if (Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      whereParts.push(`id IN (${placeholders})`);
      whereValues.push(...ids);
    } else {
      ids = null;
    }

    // Header filters
    if (filters && typeof filters === "object") {
      const filterableColumns = [
        "id",
        "name",
        "image_path",
        "price",
        "discount_perc",
        "active",
      ];

      for (const [key, rawVal] of Object.entries(filters)) {
        if (!rawVal) continue;
        if (!filterableColumns.includes(key)) continue;

        const val = String(rawVal);

        if (["id", "price", "discount_perc", "active"].includes(key)) {
          whereParts.push(`\`${key}\` = ?`);
          whereValues.push(val);
        } else {
          whereParts.push(`\`${key}\` LIKE ?`);
          whereValues.push(`%${val}%`);
        }
      }
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const sql = `
      UPDATE carvings
      SET ${setClauses.join(", ")}
      ${whereClause}
    `;

    const params = [...setValues, ...whereValues];
    const [result] = await db.query(sql, params);

    return res.json({
      success: true,
      affectedRows: result.affectedRows,
      message: `Updated ${result.affectedRows} carving(s).`,
    });
  } catch (err) {
    console.error("POST /admin/product/carving/bulk-update failed:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while updating carvings.",
    });
  }
});


export default router;
