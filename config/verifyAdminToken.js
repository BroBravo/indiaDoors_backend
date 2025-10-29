// const jwt = require("jsonwebtoken");
// require('dotenv').config();
// const secret = process.env.JWT_SECRET;
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const secret = process.env.JWT_SECRET;

const verifyAdminToken = (req, res, next) => {
  const token = req.cookies?.admin_token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ 
      message: "Access denied. No token provided.",
      code: "TOKEN_MISSING" 
    });
   }
  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // Attach user payload to request
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token." , code: "TOKEN_EXPIRED"});
  }
};

export default verifyAdminToken;