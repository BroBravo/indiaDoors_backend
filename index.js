require('dotenv').config();
const express = require('express');
const userRoutes=require('./appRoutes/userRoutes');
const authRoutes=require('./appRoutes/authRoutes');
const productRoutes=require('./appRoutes/productRoutes');
const paymentRoute=require('./appRoutes/paymentRoute');
const adminAuthRoute=require('./adminRoutes/authRoutes');
const cors = require('cors'); // Allows frontend to communicate with backend
const cookieParser = require('cookie-parser');
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
app.use('/user',userRoutes);
app.use('/api',authRoutes);
app.use('/product',productRoutes);
app.use('/pay',paymentRoute);

//Admin specif routes
app.use('/admin/user',adminAuthRoute);

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
