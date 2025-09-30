const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../config/connection1");  
const SECRET_KEY = process.env.JWT_SECRET || "your_secret_key";

// Admin login route
router.post("/login", async (req, res) => {
  const { loginId, password } = req.body; 
  // `loginId` can be either username or phone

  if (!loginId || !password) {
    return res.status(400).json({ success: false, message: "Username/Phone and password are required" });
  }

  try {
    // Step 1: Detect whether input is phone or username
    const field = /^\d+$/.test(loginId) ? "phone" : "username";

    // Step 2: Fetch user from admin_users table
    const query = `
      SELECT id, username, phone, password_hash, role, is_active
      FROM admin_users
      WHERE ${field} = ?
      LIMIT 1
    `;
    const [rows] = await db.query(query, [loginId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    // Step 3: Check if account is active
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Account is disabled" });
    }

    // Step 4: Validate password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    // Step 5: Issue JWT token
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: "1h" });

    // Step 6: Set token in cookie
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    return res.json({
      success: true,
      message: "Login successful",
      role: user.role,
    });

  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Admin panel signup route(will only be used by admin)
router.post("/signup", async (req, res) => {
  const { username, password, usertype } = req.body;

  if (!username || !password || !usertype) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  const validRoles = ["admin", "superuser", "user"];
  if (!validRoles.includes(usertype)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  try {
    // If usertype is admin, check if an admin already exists
    if (usertype === "admin") {
      const [rows] = await db.query(
        "SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1"
      );

      if (rows.length > 0) {
        return res.status(403).json({
          success: false,
          message: "An admin account already exists. Only one admin allowed."
        });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert into DB
    const insertQuery = `
      INSERT INTO admin_users (username, phone, password_hash, role)
      VALUES (?, ?, ?, ?)
    `;

    const [result] = await db.query(insertQuery, [
      username,
      username, // mapping username → phone (since phone NOT NULL)
      password_hash,
      usertype
    ]);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      userId: result.insertId
    });
  } catch (err) {
    console.error(err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Username/phone already exists"
      });
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Verify Admin Auth 
router.get("/auth", async (req, res) => {
  try {
    const token = req.cookies?.admin_token;
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    // Verify token
    const decoded = jwt.verify(token, SECRET_KEY);

    // Optionally fetch latest user info from DB (to check active/role status)
    const [rows] = await db.query(
      "SELECT id, username, phone, role, is_active FROM admin_users WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ success: false, message: "Invalid or inactive user" });
    }

    return res.json({
      success: true,
      message: "Authenticated",
      user: {
        id: rows[0].id,
        username: rows[0].username,
        role: rows[0].role,
      },
    });
  } catch (err) {
    console.error("Auth verify error:", err);
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
});


module.exports = router;
