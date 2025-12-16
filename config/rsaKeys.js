// backend/config/rsaKeys.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const privateKeyPath = path.join(__dirname, "rsa_private.pem");
const publicKeyPath = path.join(__dirname, "rsa_public.pem");

export const RSA_PRIVATE_KEY = fs.readFileSync(privateKeyPath, "utf8");
export const RSA_PUBLIC_KEY = fs.readFileSync(publicKeyPath, "utf8");
