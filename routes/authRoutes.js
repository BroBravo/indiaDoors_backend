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
  const query = `SELECT first_name, phone, email, password_hash FROM users WHERE ${field} = ? LIMIT 1`;

  try {
    const [results] = await db.query(query, [username]);
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { username: user.first_name, identifier: isEmail ? user.email : user.phone },
      SECRET_KEY,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 60 * 60 * 1000,
    });

    return res.json({ success: true, message: "Login successful" });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// AUTH CHECK
router.get("/auth", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided", code: "TOKEN_MISSING" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Unauthorized: Invalid token", code: "TOKEN_EXPIRED" });
    }
    res.json({ username: decoded.username, identifier: decoded.identifier });
  });
});

// SIGNUP
router.post("/signup", async (req, res) => {
  const { firstName, lastName, signupPassword, phone, email, userType } = req.body;

  if (!firstName || !signupPassword || !phone || !userType) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE phone = ?", [phone]);

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "Phone number is already registered" });
    }

    const hashedPassword = await bcrypt.hash(signupPassword, 10);
    const insertQuery = `
      INSERT INTO users (first_name, last_name, password_hash, phone, email, user_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await db.query(insertQuery, [
      firstName,
      lastName || null,
      hashedPassword,
      phone,
      email || null,
      userType
    ]);

    return res.status(201).json({ success: true, message: "Signup successful" });

  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

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
