require('dotenv').config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const router = express.Router();
const db = require("../config/connection1"); // your mysql2/promise pool
const SECRET_KEY = process.env.JWT_SECRET ; // Set securely in .env

// LOGIN
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required" });
  }

  const isEmail = validator.isEmail(username);
  const field = isEmail ? "email" : "phone";

  // Step 1: Get user credentials and type
  const userQuery = `
    SELECT id, password_hash, user_type
    FROM users
    WHERE ${field} = ?
    LIMIT 1
  `;

  try {
    const [userRows] = await db.query(userQuery, [username]);

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { id: userId, password_hash, user_type } = userRows[0];

    // Step 2: Validate password
    const isMatch = await bcrypt.compare(password, password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid Password" });
    }

    // Step 3: Fetch user info from correct table
    let userDetailsQuery = "";
    if (user_type === "Customer") {
      userDetailsQuery = `
        SELECT first_name, last_name, email, phone_number
        FROM retail_customers
        WHERE user_id = ?
        LIMIT 1
      `;
    } else {
      userDetailsQuery = `
        SELECT first_name, last_name, email, phone_number, partner_type
        FROM business_partners
        WHERE user_id = ?
        LIMIT 1
      `;
    }

    const [detailsRows] = await db.query(userDetailsQuery, [userId]);
    if (detailsRows.length === 0) {
      return res.status(404).json({ success: false, message: "User details not found" });
    }

    const userDetails = detailsRows[0];

    // Step 4: Issue token
    const tokenPayload = {
      id: userId,
      userType: user_type,
      firstName: userDetails.first_name,
    };

    const token = jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: "1h" });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "Login successful",
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// AUTH CHECK
router.get("/auth", async(req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided", code: "TOKEN_MISSING" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Unauthorized: Invalid token", code: "TOKEN_EXPIRED" });
    }
    res.json({ userId: decoded.id, username: decoded.firstName, userType: decoded.userType });
  });
});

// SIGNUP
router.post("/signup", async (req, res) => {
  const {
    firstName,
    lastName,
    signupPassword,
    phone,
    email,
    userType
  } = req.body;

  if (!firstName || !signupPassword || !phone || !userType) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const conn = await db.getConnection(); // Get a connection from pool

  try {
    await conn.beginTransaction(); // Start transaction

    // Check if user with same phone already exists
    const [existing] = await conn.query("SELECT id FROM users WHERE phone = ?", [phone]);
    if (existing.length > 0) {
      await conn.release(); // Important to release the connection
      return res.status(409).json({ success: false, message: "Phone number is already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(signupPassword, 10);

    // Insert into users table
    const user_type = userType === 'Customer' ? 'Customer' : 'Business Partner';
    const [userResult] = await conn.query(
      `INSERT INTO users (password_hash, phone, user_type, email) VALUES (?, ?, ?, ?)`,
      [hashedPassword, phone, user_type, email || null]
    );

    const userId = userResult.insertId;

    // Insert into respective table
    if (userType === 'Customer') {
      await conn.query(
        `INSERT INTO retail_customers (user_id, first_name, last_name, email, phone_number)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, firstName, lastName || null, email || null, phone]
      );
    } else {
      await conn.query(
        `INSERT INTO business_partners (user_id, first_name, last_name, email, phone_number, partner_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, firstName, lastName || null, email || null, phone, userType]
      );
    }

    await conn.commit(); // ✅ Both inserts succeeded
    conn.release();
    return res.status(201).json({ success: true, message: "Signup successful" });

  } catch (err) {
    await conn.rollback(); // ❌ Roll back user insert if second insert fails
    conn.release();
    console.error("Signup transaction failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});


// router.post("/signup", async (req, res) => {
//   const { firstName, lastName, signupPassword, phone, email, userType } = req.body;

//   if (!firstName || !signupPassword || !phone || !userType) {
//     return res.status(400).json({ success: false, message: "Missing required fields" });
//   }

//   try {
//     const [existing] = await db.query("SELECT id FROM users WHERE phone = ?", [phone]);

//     if (existing.length > 0) {
//       return res.status(409).json({ success: false, message: "Phone number is already registered" });
//     }

//     const hashedPassword = await bcrypt.hash(signupPassword, 10);
//     const insertQuery = `
//       INSERT INTO users (first_name, last_name, password_hash, phone, email, user_type)
//       VALUES (?, ?, ?, ?, ?, ?)
//     `;
//     await db.query(insertQuery, [
//       firstName,
//       lastName || null,
//       hashedPassword,
//       phone,
//       email || null,
//       userType
//     ]);

//     return res.status(201).json({ success: true, message: "Signup successful" });

//   } catch (err) {
//     console.error("Signup error:", err);
//     return res.status(500).json({ success: false, message: "Internal server error" });
//   }
// });

//Logout
router.post('/logout', async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,       // set true if using HTTPS
    sameSite: 'Strict'  // or 'Lax', depending on your setup
  });
  res.json({ message: 'Logged out' });
});

module.exports = router;
