const express = require('express');
const router = express.Router();
const db = require('../config/connection1'); 
const verifyToken = require('../config/verifyToken');
const jwt = require('jsonwebtoken');
const validator = require("validator");
require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY || "your_default_secret";

//Add item
router.post("/cart/add",verifyToken, async (req, res) => {
  const token=req.cookies.token;
  if (!token) return res.status(401).json({ message: "Unauthorized: No token" });
  
  const {
    item_name,
    width_in,
    height_in,
    front_wrap,
    back_wrap,
    front_wrap_price ,
    back_wrap_price ,
    front_carving,
    back_carving,
    front_carving_price ,
    back_carving_price ,
    item_amount,
    quantity ,
   // identifier // phone or email
  } = req.body;

  if (!item_name || !width_in || !height_in ) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    // // Step 1: Find customer_id from users table using identifier
    // const [userRows] = await db.query(
    //   `SELECT id FROM users WHERE phone = ? OR email = ? LIMIT 1`,
    //   [identifier, identifier]
    // );

    // if (userRows.length === 0) {
    //   return res.status(404).json({ success: false, message: "User not found" });
    // }
    const decoded=jwt.verify(token,SECRET_KEY);
    const customer_id = decoded.id;

    // Step 2: Insert into cart_items
    
    
      const insertQuery = `
      INSERT INTO cart_items 
      (customer_id, item_amount, item_name, width_in, height_in, 
       front_wrap, back_wrap, front_wrap_price, back_wrap_price, 
       front_carving, back_carving, front_carving_price, back_carving_price, 
       quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const [result] = await db.query(insertQuery, [
        customer_id, item_amount, item_name, width_in, height_in,
        front_wrap || null, back_wrap || null,
        front_wrap_price, back_wrap_price,
        front_carving || null, back_carving || null,
        front_carving_price, back_carving_price,
        quantity
      ]);
      res.status(201).json({ success: true, message: "Item added to cart", insertedId: result.insertId });
  } catch (err) {
    console.error("Error adding item:", err.message, err.stack);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

//Update item
router.post("/cart/update",verifyToken, async (req, res) =>{

  const {
    id,
    item_name,
    width_in,
    height_in,
    front_wrap,
    back_wrap,
    front_wrap_price ,
    back_wrap_price ,
    front_carving,
    back_carving,
    front_carving_price ,
    back_carving_price ,
    item_amount,
    quantity ,
    identifier // phone or email
  } = req.body;

  if (!item_name || !width_in || !height_in || !identifier) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    // Step 1: Find customer_id from users table using identifier
    const [userRows] = await db.query(
      `SELECT id FROM users WHERE phone = ? OR email = ? LIMIT 1`,
      [identifier, identifier]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const customer_id = userRows[0].id;

    // Step 2: Update items
    
      const updateQuery = `
      UPDATE cart_items
      SET 
        customer_id = ?, 
        item_amount = ?, 
        item_name = ?, 
        width_in = ?, 
        height_in = ?, 
        front_wrap = ?, 
        back_wrap = ?, 
        front_wrap_price = ?, 
        back_wrap_price = ?, 
        front_carving = ?, 
        back_carving = ?, 
        front_carving_price = ?, 
        back_carving_price = ?, 
        quantity = ?
      WHERE id = ?
    `;

    const [result] = await db.query(updateQuery, [
      customer_id, item_amount, item_name, width_in, height_in,
      front_wrap || null, back_wrap || null,
      front_wrap_price, back_wrap_price,
      front_carving || null, back_carving || null,
      front_carving_price, back_carving_price,
      quantity,
      id 
    ]);
    res.status(201).json({ success: true, message: "Item updated in cart", insertedId: result.insertId });
  }catch (err) {
    console.error("Error updating item:", err.message, err.stack);
    res.status(500).json({ success: false, message: "Server error" });
  }  

});

//Remove item
router.delete('/cart/remove/:id', verifyToken, async (req, res) => {
  const itemId = req.params.id;
  const userId = req.user.id; 
 
  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID missing in token" });
  }
 
  
  try {

    const [result] = await db.query(
      'DELETE FROM cart_items WHERE id = ? AND customer_id = ?',
      [itemId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Item not found or unauthorized' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting cart item:', err);
    res.status(500).json({ success: false, message: 'Failed to delete item' });
  }
});

//Get items from cart
router.get('/cart/items', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: "Unauthorized: No token" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const customerId = decoded.id;

    // Get user ID by email or phone
    // const [userRows] = await db.query(
    //   'SELECT id FROM users WHERE email = ? OR phone = ?',
    //   [identifier, identifier]
    // );
    // if (userRows.length === 0) {
    //   return res.status(404).json({ message: "User not found" });
    // }

    // const customerId = userRows[0].id;

    // Fetch cart items with joined images
    const [rows] = await db.query(
      `SELECT 
        ci.*,
        fw.image_path AS front_wrap_image,
        bw.image_path AS back_wrap_image,
        fc.image_path AS front_carving_image,
        bc.image_path AS back_carving_image
      FROM cart_items ci
      LEFT JOIN laminates fw ON ci.front_wrap = fw.name
      LEFT JOIN laminates bw ON ci.back_wrap = bw.name
      LEFT JOIN carvings fc ON ci.front_carving = fc.name
      LEFT JOIN carvings bc ON ci.back_carving = bc.name
      WHERE ci.customer_id = ? AND ci.status = 'Pending'`,
      [customerId]
    );

    res.json(rows);
  } catch (error) {
    console.error("JWT or DB error:", error);
    res.status(500).json({ message: "Error fetching cart" });
  }
});

//Clear cart
router.put('/cart/clear',verifyToken, async (req, res) => {
  
    const userIdentifier = req.user.identifier; // assuming user is authenticated via middleware
    const isEmail = validator.isEmail(userIdentifier);
    const field = isEmail ? "email" : "phone";
    
    try{ 
      const [userRows] = await db.query(`SELECT id FROM users WHERE ${field} = ? LIMIT 1`, [userIdentifier]);

    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

      const userId = userRows[0].id;
      await db.query("UPDATE cart_items SET status = ? WHERE user_id = ? AND status = ?",['completed',userId,'pending']);
      res.json({ success: true ,message: "cart cleared"});
    } 
    catch (err) {
    console.error("Error clearing cart:", err);
    res.status(500).json({ error: "Failed to clear cart" });
  }
});

router.get("/info", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get base user info
    const [userRows] = await db.query(
      "SELECT phone, email, user_type FROM users WHERE id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userRows[0];

    let profileDataQuery = "";
    if (user.user_type === "Customer") {
      profileDataQuery = "SELECT first_name, last_name, gender, email, phone_number AS phone FROM retail_customers WHERE user_id = ?";
    } else if (user.user_type === "Business Partner") {
      profileDataQuery = "SELECT first_name, last_name, gender, email, phone_number AS phone FROM business_partners WHERE user_id = ?";
    } else {
      return res.status(400).json({ message: "Invalid user type" });
    }

    const [profileRows] = await db.query(profileDataQuery, [userId]);

    if (profileRows.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json({
      ...profileRows[0],
      user_type: user.user_type,
    });

  } catch (err) {
    console.error("Error fetching user profile:", err);
    res.status(500).json({ message: "Error fetching user profile" });
  }
});


module.exports = router;
