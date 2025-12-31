import express from "express";
import verifyUserToken from "../config/verifyUserToken.js";
import { getDelhiveryShippingQuote } from "../services/delhiveryQuote.js";

const router = express.Router();

router.post("/delhivery/quote", verifyUserToken, async (req, res) => {
  try {
    const { cartItems, shipping_address } = req.body || {};
    const quote = await getDelhiveryShippingQuote({ cartItems, shipping_address });
    res.json({ ok: true, quote });
  } catch (err) {
    console.error("Delhivery quote failed:", err?.response?.data || err.message);
    res.status(400).json({
      ok: false,
      message: err?.message || "Failed to fetch shipping quote",
    });
  }
});

export default router;
