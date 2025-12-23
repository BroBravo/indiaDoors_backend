import express from "express";
import verifyAdminToken from "../config/verifyAdminToken.js";
import db from "../config/connection1.js";

import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const router = express.Router();

/* ==================================================================
   ROLE MIDDLEWARE — ADMIN + SUPERUSER CAN MODIFY
   ================================================================== */

function requireAdminOrSuperuser(req, res, next) {
  // Adjust these depending on what verifyAdminToken sets
  const role =
    req.admin?.role ||
    req.user?.role ||
    req.adminUser?.role ||
    req.auth?.role ||
    req.session?.user?.role;

  if (role !== "admin" && role !== "superuser") {
    return res.status(403).json({
      success: false,
      message:
        "Only admin and superuser roles are allowed to modify product tables.",
    });
  }

  next();
}

// ------------------------------------------------------------------
//  Common path helpers
// ------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PROJECT ROOT  (../ from routes folder)
const PROJECT_ROOT = path.join(__dirname, "..");

// Where your existing static assets live (as in screenshots):
//   assets/products/laminates/...
//   assets/products/carvings/...
const ASSETS_PRODUCTS_ROOT = path.join(PROJECT_ROOT, "assets", "products");
const LAMINATE_DIR = path.join(ASSETS_PRODUCTS_ROOT, "laminates");
const CARVING_DIR = path.join(ASSETS_PRODUCTS_ROOT, "carvings");

// Make sure folders exist
fs.mkdirSync(LAMINATE_DIR, { recursive: true });
fs.mkdirSync(CARVING_DIR, { recursive: true });

// Separate storage configs so each route goes to the right folder
const laminateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, LAMINATE_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const carvingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CARVING_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const uploadLaminate = multer({ storage: laminateStorage });
const uploadCarving = multer({ storage: carvingStorage });

/* ==================================================================
   FINISHED PRODUCTS — TABLE VIEW / FILTER / BULK UPDATE
   ================================================================== */

router.get("/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        p.product_id,
        p.name,
        p.mrp,
        p.price,
        p.wood_type, 
        p.front_wrap,
        p.back_wrap,
        p.front_carving,
        p.back_carving,
        p.width_in,
        p.height_in,
        p.active,
        p.created_at,
        p.updated_at,

        -- wrap images
        fw.image_path AS front_wrap_image,
        bw.image_path AS back_wrap_image,

        -- carving images
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
    console.error("GET /admin/product/get/table failed:", err);
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

        if (
          type.includes("char") ||
          type.includes("text") ||
          type.includes("blob")
        ) {
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
        p.mrp,
        p.price,
        p.wood_type, 
        p.front_wrap,
        p.back_wrap,
        p.front_carving,
        p.back_carving,
        p.width_in,
        p.height_in,
        p.active,
        p.created_at,
        p.updated_at,

        -- wrap images
        fw.image_path AS front_wrap_image,
        bw.image_path AS back_wrap_image,

        -- carving images
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
    console.error("GET /admin/product/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/bulk-update",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
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
        "mrp",
        "price",
        "wood_type",
        "front_wrap",
        "back_wrap",
        "front_carving",
        "back_carving",
        "width_in",
        "height_in",
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

      setClauses.push("updated_at = NOW()");

      const whereParts = [];
      const whereValues = [];

      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        whereParts.push(`product_id IN (${placeholders})`);
        whereValues.push(...ids);
      } else {
        ids = null;
      }

      if (filters && typeof filters === "object") {
        const filterableColumns = [
          "product_id",
          "name",
          "mrp",
          "price",
          "wood_type",
          "front_wrap",
          "back_wrap",
          "front_carving",
          "back_carving",
          "width_in",
          "height_in",
          "active",
          "created_at",
          "updated_at",
        ];

        for (const [key, rawVal] of Object.entries(filters)) {
          if (!rawVal) continue;
          if (!filterableColumns.includes(key)) continue;

          const val = String(rawVal);

          if (
            ["mrp", "price", "width_in", "height_in", "product_id"].includes(
              key
            )
          ) {
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
        UPDATE products
        SET ${setClauses.join(", ")}
        ${whereClause}
      `;

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
  }
);

/* ==================================================================
   FINISHED PRODUCT — CREATE (no image file)
   ================================================================== */

router.post(
  "/upload",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
    try {
      const {
        name,
        mrp,
        price,
        wood_type,
        front_wrap,
        back_wrap,
        front_carving,
        back_carving,
        width_in,
        height_in,
        active,
      } = req.body;

      const allowedWoodTypes = ["jungle wood", "saagon"];
      const safeWoodType = allowedWoodTypes.includes(wood_type)
        ? wood_type
        : "jungle wood";

      const isActive =
        active === "0" || active === 0 || active === false ? 0 : 1;

      const sql = `
        INSERT INTO products 
          (name, mrp, price, wood_type, front_wrap, back_wrap, front_carving, back_carving, width_in, height_in, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const params = [
        name || null,
        mrp || null,
        price || null,
        safeWoodType,
        front_wrap || null,
        back_wrap || null,
        front_carving || null,
        back_carving || null,
        width_in || null,
        height_in || null,
        isActive,
      ];

      const [result] = await db.query(sql, params);

      res.json({
        success: true,
        product_id: result.insertId,
        message: "Product created successfully",
      });
    } catch (err) {
      console.error("POST /admin/product/upload failed:", err);
      res.status(500).json({
        success: false,
        message: "Server error while creating product.",
      });
    }
  }
);

/* ==================================================================
   LAMINATES — TABLE VIEW / FILTER / BULK UPDATE
   ================================================================== */

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
    console.error("GET /admin/product/laminate/get/table failed:", err);
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
    console.error("GET /admin/product/laminate/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/laminate/bulk-update",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
    try {
      let { ids, filters, data } = req.body;

      if (!data || typeof data !== "object") {
        return res.status(400).json({
          success: false,
          message: "No update data provided.",
        });
      }

      const allowedColumns = ["name", "image_path", "price", "discount_perc", "active"];

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

      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        whereParts.push(`id IN (${placeholders})`);
        whereValues.push(...ids);
      } else {
        ids = null;
      }

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
  }
);

/* ==================================================================
   LAMINATES — CREATE with IMAGE UPLOAD
   ================================================================== */

router.post(
  "/laminate/upload",
  verifyAdminToken,
  requireAdminOrSuperuser,
  uploadLaminate.single("image_path"),
  async (req, res) => {
    try {
      const { name, price, discount_perc, active } = req.body;

      const relativePath = req.file
        ? path
            .join("assets", "products", "laminates", req.file.filename)
            .replace(/\\/g, "/")
        : null;

      const sql = `
        INSERT INTO laminates (name, image_path, price, discount_perc, active)
        VALUES (?, ?, ?, ?, ?)
      `;

      const params = [
        name || null,
        relativePath,
        price || null,
        discount_perc || 0,
        active ? Number(active) : 1,
      ];

      const [result] = await db.query(sql, params);

      res.json({
        success: true,
        id: result.insertId,
        image_path: relativePath,
        message: "Laminate created successfully",
      });
    } catch (err) {
      console.error("POST /admin/product/laminate/upload failed:", err);
      res.status(500).json({
        success: false,
        message: "Server error while creating laminate.",
      });
    }
  }
);

/* ==================================================================
   CARVINGS — TABLE VIEW / FILTER / BULK UPDATE
   ================================================================== */

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
    console.error("GET /admin/product/carving/get/table failed:", err);
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
    console.error("GET /admin/product/carving/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post(
  "/carving/bulk-update",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
    try {
      let { ids, filters, data } = req.body;

      if (!data || typeof data !== "object") {
        return res.status(400).json({
          success: false,
          message: "No update data provided.",
        });
      }

      const allowedColumns = ["name", "image_path", "price", "discount_perc", "active"];

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

      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        whereParts.push(`id IN (${placeholders})`);
        whereValues.push(...ids);
      } else {
        ids = null;
      }

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
  }
);

/* ==================================================================
   CARVINGS — CREATE with IMAGE UPLOAD
   ================================================================== */

router.post(
  "/carving/upload",
  verifyAdminToken,
  requireAdminOrSuperuser,
  uploadCarving.single("image_path"),
  async (req, res) => {
    try {
      const { name, price, discount_perc, active } = req.body;

      const relativePath = req.file
        ? path
            .join("assets", "products", "carvings", req.file.filename)
            .replace(/\\/g, "/")
        : null;

      const sql = `
        INSERT INTO carvings (name, image_path, price, discount_perc, active)
        VALUES (?, ?, ?, ?, ?)
      `;

      const params = [
        name || null,
        relativePath,
        price || null,
        discount_perc || 0,
        active ? Number(active) : 1,
      ];

      const [result] = await db.query(sql, params);

      res.json({
        success: true,
        id: result.insertId,
        image_path: relativePath,
        message: "Carving created successfully",
      });
    } catch (err) {
      console.error("POST /admin/product/carving/upload failed:", err);
      res.status(500).json({
        success: false,
        message: "Server error while creating carving.",
      });
    }
  }
); 

/* ==================================================================
   WOODS — TABLE VIEW / FILTER / BULK UPDATE / CREATE
   ================================================================== */

/**
 * GET /admin/product/wood/get/table
 * Basic paginated table for woods
 */
router.get("/wood/get/table", verifyAdminToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT
        id,
        wood_name,
        price_per_sqft,
        is_active,
        created_at,
        updated_at
      FROM woods
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
    console.error("GET /admin/product/wood/get/table failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * GET /admin/product/wood/get/filter
 * Flexible filter using DESCRIBE (same pattern as products/laminates/carvings)
 */
router.get("/wood/get/filter", verifyAdminToken, async (req, res) => {
  try {
    const [columns] = await db.query(`DESCRIBE woods`);

    const filters = [];
    const values = [];

    for (const col of columns) {
      const colName = col.Field;
      const value = req.query[colName];

      if (value !== undefined && value !== "") {
        const type = col.Type.toLowerCase();

        if (
          type.includes("char") ||
          type.includes("text") ||
          type.includes("blob")
        ) {
          filters.push(`\`${colName}\` LIKE ?`);
          values.push(`${value}%`);
        } else if (type.includes("date") || type.includes("timestamp")) {
          filters.push(`DATE(\`${colName}\`) = ?`);
          values.push(value);
        } else {
          filters.push(`\`${colName}\` = ?`);
          values.push(value);
        }
      }
    }

    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT
        id,
        wood_name,
        price_per_sqft,
        is_active,
        created_at,
        updated_at
      FROM woods
      ${whereClause}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...values, limit, offset]);

    const [[{ totalCount }]] = await db.query(
      `SELECT COUNT(*) AS totalCount FROM woods ${whereClause}`,
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
    console.error("GET /admin/product/wood/get/filter failed:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * POST /admin/product/wood/bulk-update
 * Bulk update woods (name / price / is_active)
 */
router.post(
  "/wood/bulk-update",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
    try {
      let { ids, filters, data } = req.body;

      if (!data || typeof data !== "object") {
        return res.status(400).json({
          success: false,
          message: "No update data provided.",
        });
      }

      const allowedColumns = ["wood_name", "price_per_sqft", "is_active"];

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

      // manually handle updated_at
      setClauses.push("updated_at = NOW()");

      const whereParts = [];
      const whereValues = [];

      // by IDs
      if (Array.isArray(ids) && ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        whereParts.push(`id IN (${placeholders})`);
        whereValues.push(...ids);
      } else {
        ids = null;
      }

      // by filters
      if (filters && typeof filters === "object") {
        const filterableColumns = [
          "id",
          "wood_name",
          "price_per_sqft",
          "is_active",
          "created_at",
          "updated_at",
        ];

        for (const [key, rawVal] of Object.entries(filters)) {
          if (!rawVal) continue;
          if (!filterableColumns.includes(key)) continue;

          const val = String(rawVal);

          if (["id", "price_per_sqft", "is_active"].includes(key)) {
            whereParts.push(`\`${key}\` = ?`);
            whereValues.push(val);
          } else if (
            key === "created_at" ||
            key === "updated_at"
          ) {
            whereParts.push(`DATE(\`${key}\`) = ?`);
            whereValues.push(val);
          } else {
            // partial match for wood_name by default
            whereParts.push(`\`${key}\` LIKE ?`);
            whereValues.push(`%${val}%`);
          }
        }
      }

      const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const sql = `
        UPDATE woods
        SET ${setClauses.join(", ")}
        ${whereClause}
      `;

      const params = [...setValues, ...whereValues];
      const [result] = await db.query(sql, params);

      return res.json({
        success: true,
        affectedRows: result.affectedRows,
        message: `Updated ${result.affectedRows} wood record(s).`,
      });
    } catch (err) {
      console.error("POST /admin/product/wood/bulk-update failed:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while updating woods.",
      });
    }
  }
);

/**
 * POST /admin/product/wood/upload
 * Create a new wood row (no file upload)
 */
router.post(
  "/wood/upload",
  verifyAdminToken,
  requireAdminOrSuperuser,
  async (req, res) => {
    try {
      const { wood_name, price, is_active } = req.body;

      if (!wood_name) {
        return res.status(400).json({
          success: false,
          message: "wood_name is required.",
        });
      }

      const numericPrice =
        price === "" || price === undefined || price === null
          ? null
          : Number(price);

      const activeFlag =
        is_active === "0" || is_active === 0 || is_active === false
          ? 0
          : 1;

      const sql = `
        INSERT INTO woods (wood_name, price_per_sqft, is_active)
        VALUES (?, ?, ?)
      `;

      const params = [wood_name, numericPrice, activeFlag];

      const [result] = await db.query(sql, params);

      res.json({
        success: true,
        id: result.insertId,
        message: "Wood created successfully",
      });
    } catch (err) {
      console.error("POST /admin/product/wood/upload failed:", err);
      res.status(500).json({
        success: false,
        message: "Server error while creating wood.",
      });
    }
  }
);


export default router;
