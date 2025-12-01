
// const express = require('express');
// const router = express.Router();
// const db = require('../config/connection1'); // mysql2/promise pool

import express from "express";
import db from "../config/connection1.js"; // mysql2/promise pool

const router = express.Router();

// Get all products with joined laminates images
router.get("/productList", async (req, res) => {
  const query = `
    SELECT 
      p.product_id,            -- ✅ so React key works
      p.name,
      p.mrp,
      p.price,
      p.wood_type,             -- optional, in case you want it in UI
      fw.image_path AS front_wrap,  -- ✅ this is now the image used on card
      bw.image_path AS back_wrap,   -- (kept in case you need it later)
      p.width_in,
      p.height_in
    FROM products p
    LEFT JOIN laminates fw ON p.front_wrap = fw.name 
    LEFT JOIN laminates bw ON p.back_wrap = bw.name
    WHERE p.active = 1              -- ✅ only active products
    ORDER BY p.product_id ASC;
  `;

  try {
    const [results] = await db.query(query);
    res.json(results);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ error: "Database error" });
  }
});


// Get distinct dimensions (height and width)
router.get("/dimensions", async (req, res) => {
  try {
    const [heightResults] = await db.query("SELECT DISTINCT height_in FROM dimensions");
    const [widthResults] = await db.query("SELECT DISTINCT width_in FROM dimensions");

    const heightOptions = heightResults.map(row => ({
      value: row.height_in,
      label: row.height_in.toString(),
    }));

    const widthOptions = widthResults.map(row => ({
      value: row.width_in,
      label: row.width_in.toString(),
    }));

    res.json({ heightOptions, widthOptions });
  } catch (err) {
    console.error("Error fetching dimensions:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get all laminatess
router.get("/laminates", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM laminates");
    res.json(results);
  } catch (err) {
    console.error("Error fetching laminates:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get all carvings
router.get("/carvings", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM carvings");
    res.json(results);
  } catch (err) {
    console.error("Error fetching carvings:", err);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
