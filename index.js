require('dotenv').config();
const express = require('express');
const userRoutes=require('./routes/userRoutes')
const authRoutes=require('./routes/authRoutes')
const productRoutes=require('./routes/productRoutes')
const paymentRoute=require('./routes/paymentRoute')
const mysql = require('mysql2'); 
const cors = require('cors'); // Allows frontend to communicate with backend
const jwt = require('jsonwebtoken'); 
const cookieParser = require('cookie-parser');
const app = express();
const PORT = 4000;


app.use(cors({
  origin: process.env.ORIGIN, // or your frontend domain
  credentials: true,               // 👈 Allow cookies
}));
app.use(cookieParser());
app.use(express.json()); // Parse JSON request body
app.use('/user',userRoutes);
app.use('/api',authRoutes);
app.use('/product',productRoutes);
app.use('/pay',paymentRoute);

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
