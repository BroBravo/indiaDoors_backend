import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../config/connection1.js";

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET || "your_secret_key";

// ================== Admin auth middleware ==================
const verifyAdmin = (req, res, next) => {
  try {
    const token =
      req.cookies?.admin_token || req.headers["authorization"]?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const payload = jwt.verify(token, SECRET_KEY);

    if (payload.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    req.user = payload;
    next();
  } catch (err) {
    console.error("verifyAdmin error:", err);
    return res.status(401).json({ message: "Invalid token" });
  }
};

/* ==================================================================
   MIDDLEWARE — ONLY ADMIN CAN SIGNUP OTHERS (WITH FIRST-ADMIN BOOTSTRAP)
   ================================================================== */
async function requireAdminForSignup(req, res, next) {
  const { usertype } = req.body;

  try {
    // Check if an admin already exists
    const [adminRows] = await db.query(
      "SELECT id, role, is_active FROM admin_users WHERE role = 'admin' LIMIT 1"
    );
    const adminExists = adminRows.length > 0;

    // 1️⃣ No admin exists yet: allow *only* creation of first admin, no auth
    if (!adminExists) {
      if (usertype !== "admin") {
        return res.status(403).json({
          success: false,
          message:
            "Initial admin account must be created first before creating other roles.",
        });
      }
      // allow through -> /signup will handle insert + single-admin constraint
      return next();
    }

    // 2️⃣ Admin already exists: require logged-in admin to create new users
    const token = req.cookies?.admin_token;
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Admin authentication required to create users.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      console.error("Signup auth token verify failed:", err);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired admin token.",
      });
    }

    // Fetch the current user to ensure they are still an active admin
    const [rows] = await db.query(
      "SELECT id, role, is_active FROM admin_users WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(403).json({
        success: false,
        message: "Inactive or non-existent admin user.",
      });
    }

    if (rows[0].role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admin can create new superusers or users.",
      });
    }

    // ✅ Authenticated active admin → can proceed to /signup handler
    next();
  } catch (err) {
    console.error("requireAdminForSignup error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error while checking admin." });
  }
}

/* ==================================================================
   ADMIN LOGIN
   ================================================================== */

// Admin login route
router.post("/login", async (req, res) => {
  const { loginId, password } = req.body; // `loginId` can be either username or phone

  if (!loginId || !password) {
    return res.status(400).json({
      success: false,
      message: "Username/Phone and password are required",
    });
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
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = rows[0];

    // Step 3: Check if account is active
    if (!user.is_active) {
      return res
        .status(403)
        .json({ success: false, message: "Account is disabled" });
    }

    // Step 4: Validate password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });
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
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

/* ==================================================================
   ADMIN PANEL SIGNUP
   ================================================================== */
// Only admin can create new superuser/user,
// and only first admin can be created when there is no admin in DB.
router.post("/signup", requireAdminForSignup, async (req, res) => {
  const { username, password, usertype } = req.body;

  if (!username || !password || !usertype) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
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
          message: "An admin account already exists. Only one admin allowed.",
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
      usertype,
    ]);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      userId: result.insertId,
    });
  } catch (err) {
    console.error(err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Username/phone already exists",
      });
    }

    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
});

/* ==================================================================
   VERIFY ADMIN AUTH
   ================================================================== */

router.get("/auth", async (req, res) => {
  try {
    const token = req.cookies?.admin_token;
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    // Verify token
    const decoded = jwt.verify(token, SECRET_KEY);

    // Fetch latest user info from DB (to check active/role status)
    const [rows] = await db.query(
      "SELECT id, username, phone, role, is_active FROM admin_users WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or inactive user" });
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
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token" });
  }
});

/* ==================================================================
   ADMIN LOGOUT
   ================================================================== */

router.post("/logout", (req, res) => {
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
  });

  return res.json({ success: true, message: "Logged out successfully" });
});

/* ==================================================================
   ADMIN LIST USERS WITH PAGINATION
   ================================================================== */

router.get("/list", verifyAdmin, async (req, res) => {
  try {
    let { role, offset = 0, limit = 10 } = req.query;

    // Frontend calls this with role = "user" or "superuser"
    if (!role || !["user", "superuser"].includes(role)) {
      return res.status(400).json({ message: "Invalid or missing role" });
    }

    offset = Number(offset) || 0;
    limit = Number(limit) || 10;

    // Fetch (limit + 1) to detect "hasMore"
    const [rows] = await db.query(
      `
        SELECT 
          id,
          username,
          phone,
          email,
          is_active
        FROM admin_users
        WHERE role = ?
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `,
      [role, limit + 1, offset]
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // Note: we intentionally do NOT send the password hash
    res.json({ items, hasMore });
  } catch (err) {
    console.error("Error fetching users list:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ================== POST /admin/user/bulk-update ==================
router.post("/bulk-update", verifyAdmin, async (req, res) => {
  try {
    const { ids, filters, data } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids array is required" });
    }

    if (!data || typeof data !== "object") {
      return res.status(400).json({ message: "data object is required" });
    }

    const setClauses = [];
    const params = [];

    if (data.username !== undefined) {
      setClauses.push("username = ?");
      params.push(data.username);
    }

    if (data.phone !== undefined) {
      setClauses.push("phone = ?");
      params.push(data.phone);
    }

    if (data.email !== undefined) {
      setClauses.push("email = ?");
      params.push(data.email);
    }

    if (data.is_active !== undefined) {
      let isActiveNumeric;

      if (typeof data.is_active === "boolean") {
        isActiveNumeric = data.is_active ? 1 : 0;
      } else if (typeof data.is_active === "number") {
        isActiveNumeric = data.is_active ? 1 : 0;
      } else if (typeof data.is_active === "string") {
        const val = data.is_active.toLowerCase().trim();
        isActiveNumeric = val === "1" || val === "true" ? 1 : 0;
      } else {
        isActiveNumeric = 0;
      }

      setClauses.push("is_active = ?");
      params.push(isActiveNumeric);
    }

    if (data.password !== undefined && data.password !== "") {
      const hashed = await bcrypt.hash(data.password, 10);
      setClauses.push("password_hash = ?");
      params.push(hashed);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const idPlaceholders = ids.map(() => "?").join(",");
    const sql = `
      UPDATE admin_users
      SET ${setClauses.join(", ")}
      WHERE id IN (${idPlaceholders})
    `;

    params.push(...ids);

    const [result] = await db.query(sql, params);

    res.json({
      success: true,
      affectedRows: result.affectedRows,
      message: "User(s) updated successfully",
    });
  } catch (err) {
    console.error("Error in bulk-update users:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


export default router;
