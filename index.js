const express = require('express');
const sqlroute=require('./routes/sqlroute')
const mysql = require('mysql2'); // Use 'mysql2' if installed
const cors = require('cors'); // Allows frontend to communicate with backend
const jwt = require('jsonwebtoken'); // ✅ Import JWT
 // ✅ Define a secret key
const app = express();
const PORT = 4000;


app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON request body
app.use('/',sqlroute);


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
