const express = require('express');
const router =express.Router();
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const SECRET_KEY = "your_secret_key";

// MySQL Connection
const db = mysql.createConnection({
  host: 'localhost',       // Your database host
  user: 'root',   // Your MySQL username
  password: 'root',// Your MySQL password
  database: 'doors_for_all'// Your database name
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to MySQL');
});

// Routes
router.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Get all records
router.get('/users', (req, res) => {
  const sql = 'SELECT * FROM users';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching users:', err);
      res.status(500).send('Database error');
      return;
    }
    res.json(results);
  });
});
//login route
router.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const query = "SELECT id,username,password_hash FROM users WHERE username = ?";
  db.query(query, [username], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const storedPassword = results[0].password_hash; // Assuming stored passwords are in plain text

    if (password === storedPassword) {
      // Create JWT Token
      const token = jwt.sign(
        { id: results[0].id, username: username },
        SECRET_KEY,
        { expiresIn: "1h" } // Token expires in 1 hour
      );

      return res.json({ success: true, message: "Login successful", token });
    } else {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  
  });
});

router.get("/auth", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]; // Extract token

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Unauthorized: Invalid token" });
    }
    res.json({ username: decoded.username }); // Send username back
  });
});

module.exports=router