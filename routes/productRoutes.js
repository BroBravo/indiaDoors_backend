
const express = require('express');
const router = express.Router();
const db = require('../config/connection1'); // mysql2/promise pool

// Get all products with joined laminates images
router.get("/productList", async (req, res) => {
  const query = `
    SELECT 
      p.name, p.image, p.mrp, p.price, 
      fw.image AS front_wrap, 
      bw.image AS back_wrap, 
      p.width_in, p.height_in 
    FROM products p 
    LEFT JOIN laminates fw ON p.front_wrap = fw.name 
    LEFT JOIN laminates bw ON p.back_wrap = bw.name
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

module.exports = router;
