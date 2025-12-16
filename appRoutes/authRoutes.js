
import dotenv from "dotenv";
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import validator from "validator";
import crypto from "crypto";                                
import { RSA_PRIVATE_KEY, RSA_PUBLIC_KEY } from "../config/rsaKeys.js";
import db from "../config/connection1.js"; // mysql2/promise pool

dotenv.config();

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET;

// PUBLIC KEY ENDPOINT
router.get("/public-key", (req, res) => {
  return res.json({ publicKey: RSA_PUBLIC_KEY });
});

// LOGIN (with RSA-OAEP encrypted payload)
router.post("/login", async (req, res) => {
  try {
    const { encrypted } = req.body || {};

    if (!encrypted) {
      return res
        .status(400)
        .json({ success: false, message: "Encrypted payload is required" });
    }

    // 1️⃣ Decrypt using RSA private key (OAEP + SHA-256)
    let username, password;
    try {
      const buffer = Buffer.from(encrypted, "base64");

      const decrypted = crypto.privateDecrypt(
        {
          key: RSA_PRIVATE_KEY,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        buffer
      );

      const parsed = JSON.parse(decrypted.toString("utf8"));
      username = parsed.username;
      password = parsed.password;
    } catch (err) {
      console.error("RSA decrypt failed (login):", err);
      return res
        .status(400)
        .json({ success: false, message: "Invalid encrypted payload" });
    }

    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Username and password are required" });
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

    const [userRows] = await db.query(userQuery, [username]);

    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const { id: userId, password_hash, user_type } = userRows[0];

    // Step 2: Validate password
    const isMatch = await bcrypt.compare(password, password_hash);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid Password" });
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
      return res
        .status(404)
        .json({ success: false, message: "User details not found" });
    }

    const userDetails = detailsRows[0];

    // Step 4: Issue token
    const tokenPayload = {
      id: userId,
      userType: user_type,
      firstName: userDetails.first_name,
    };

    const token = jwt.sign(tokenPayload, SECRET_KEY, { expiresIn: "1h" });

    res.cookie("user_token", token, {
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
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// AUTH CHECK
router.get("/auth", async(req, res) => {
  const token = req.cookies.user_token;
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

// SIGNUP (with RSA-OAEP encrypted payload)
router.post("/signup", async (req, res) => {
  const { encrypted } = req.body || {};

  if (!encrypted) {
    return res
      .status(400)
      .json({ success: false, message: "Encrypted payload is required" });
  }

  let firstName, lastName, signupPassword, phone, email, userType;

  try {
    const buffer = Buffer.from(encrypted, "base64");

    const decrypted = crypto.privateDecrypt(
      {
        key: RSA_PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      buffer
    );

    const parsed = JSON.parse(decrypted.toString("utf8"));

    // Pull the fields you expect
    ({
      firstName,
      lastName,
      signupPassword,
      phone,
      email,
      userType,
    } = parsed);
  } catch (err) {
    console.error("RSA decrypt failed (signup):", err);
    return res
      .status(400)
      .json({ success: false, message: "Invalid encrypted payload" });
  }

  if (!firstName || !signupPassword || !phone || !userType) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Check if user with same phone already exists
    const [existing] = await conn.query(
      "SELECT id FROM users WHERE phone = ?",
      [phone]
    );
    if (existing.length > 0) {
      await conn.release();
      return res
        .status(409)
        .json({
          success: false,
          message: "Phone number is already registered",
        });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(signupPassword, 10);

    // Insert into users table
    const user_type = userType === "Customer" ? "Customer" : "Business Partner";
    const [userResult] = await conn.query(
      `INSERT INTO users (password_hash, phone, user_type, email) VALUES (?, ?, ?, ?)`,
      [hashedPassword, phone, user_type, email || null]
    );

    const userId = userResult.insertId;

    // Insert into respective table
    if (userType === "Customer") {
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

    await conn.commit();
    conn.release();
    return res
      .status(201)
      .json({ success: true, message: "Signup successful" });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error("Signup transaction failed:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//Logout
router.post('/logout', async (req, res) => {
  res.clearCookie('user_token', {
    httpOnly: true,
    secure: true,       // set true if using HTTPS
    sameSite: 'Strict'  // or 'Lax', depending on your setup
  });
  res.json({ message: 'Logged out' });
});

export default router;
