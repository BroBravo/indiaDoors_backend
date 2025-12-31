import axios from "axios";

const DELHIVERY_INVOICE_URL =
  "https://track.delhivery.com/api/kinko/v1/invoice/charges/.json";

// Small in-memory cache to avoid hitting rate limits
const cache = new Map(); // key -> { value, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ✅ You MUST calibrate this based on your real packaging.
// For now, estimate door weight from area (sqft) * kg_per_sqft.
const KG_PER_SQFT = 1.5; // <-- tune this after 2-3 real shipments
function estimateItemWeightGrams(item) {
  const w = Number(item.width_in || 0);
  const h = Number(item.height_in || 0);
  const qty = Number(item.quantity || 1);

  // area in sqft (inches -> sqft)
  const areaSqft = (w * h) / 144;
  const kg = areaSqft * KG_PER_SQFT;

  const grams = Math.max(0, Math.round(kg * 1000));
  return grams * qty;
}

function calcChargeableWeightGrams(cartItems = []) {
  // If later you store exact weight per product, use that instead.
  const grams = cartItems.reduce((sum, it) => sum + estimateItemWeightGrams(it), 0);

  // Round up to next 500g for safer estimates
  const step = 500;
  const rounded = Math.ceil(grams / step) * step;

  return Math.max(0, rounded);
}

function pickPin(addr) {
  if (!addr || typeof addr !== "object") return null;
  return (
    addr.postal_code ||
    addr.pincode ||
    addr.pin ||
    addr.zip ||
    null
  );
}

export async function getDelhiveryShippingQuote({ cartItems, shipping_address }) {
  const token = process.env.DELHIVERY_TOKEN;
  const o_pin = process.env.DELHIVERY_ORIGIN_PIN;
  const md = process.env.DELHIVERY_MODE || "S";

  if (!token) throw new Error("DELHIVERY_TOKEN missing");
  if (!o_pin) throw new Error("DELHIVERY_ORIGIN_PIN missing");

  const d_pin = String(pickPin(shipping_address) || "").trim();
  if (!/^\d{6}$/.test(d_pin)) throw new Error("Invalid destination pincode");

  const cgm = calcChargeableWeightGrams(cartItems);
  const ss = "Delivered"; // per Delhivery doc accepted values include Delivered/RTO/DTO :contentReference[oaicite:3]{index=3}

  const cacheKey = `${o_pin}|${d_pin}|${md}|${cgm}|${ss}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Delhivery docs: token via Authorization header "Token XXXX" :contentReference[oaicite:4]{index=4}
  const resp = await axios.get(DELHIVERY_INVOICE_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
    },
    params: { md, cgm, o_pin, d_pin, ss },
    timeout: 15000,
  });

  // Response structure can vary by account; try common shapes
  const raw = resp.data;
  const total =
    Number(raw?.total_amount) ||
    Number(raw?.Total_amount) ||
    Number(raw?.data?.total_amount) ||
    Number(raw?.[0]?.total_amount);

  if (!Number.isFinite(total)) {
    throw new Error(`Unexpected Delhivery response: ${JSON.stringify(raw).slice(0, 300)}`);
  }

  const result = {
    provider: "delhivery",
    o_pin,
    d_pin,
    md,
    cgm,
    currency: "INR",
    shipping_fee: Number(total.toFixed(2)), // approximate :contentReference[oaicite:5]{index=5}
    raw,
  };

  cacheSet(cacheKey, result);
  return result;
}
