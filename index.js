// require('dotenv').config();
// const express = require('express');
// const userRoutes=require('./appRoutes/userRoutes');
// const authRoutes=require('./appRoutes/authRoutes');
// const productRoutes=require('./appRoutes/productRoutes');
// const paymentRoute=require('./appRoutes/paymentRoute');
// const adminAuthRoute=require('./adminRoutes/authRoutes');
// const adminOrderRoute=require('./adminRoutes/orderRoutes');
// const adminProductRoute=require('./adminRoutes/productRoutes');
// const cors = require('cors'); // Allows frontend to communicate with backend
// const cookieParser = require('cookie-parser');
// const app = express();
// const PORT = process.env.PORT || 5000;
// const noCache = require("./config/noCache");
// import path from "path";
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import userRoutes from "./appRoutes/userRoutes.js";
import authRoutes from "./appRoutes/authRoutes.js";
import productRoutes from "./appRoutes/productRoutes.js";
import paymentRoute from "./appRoutes/paymentRoute.js";
import adminAuthRoute from "./adminRoutes/authRoutes.js";
import adminOrderRoute from "./adminRoutes/orderRoutes.js";
import adminProductRoute from "./adminRoutes/productRoutes.js";
import noCache from "./config/noCache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  process.env.ORIGIN,        
  process.env.ADMIN_ORIGIN,  
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json()); // Parse JSON request body

//App specific routes
app.use('/user',noCache,userRoutes);
app.use('/api',authRoutes);
app.use('/product',productRoutes);
app.use('/pay',paymentRoute);

//Admin specif routes
app.use('/admin/user',noCache,adminAuthRoute);
app.use('/admin/order',noCache,adminOrderRoute);
app.use('/admin/product',noCache,adminProductRoute);
//test comment
//Static files and uploads
app.use("/assets", express.static(path.join(__dirname, "assets")));
// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
