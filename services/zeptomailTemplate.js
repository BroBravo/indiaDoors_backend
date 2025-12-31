import axios from "axios";

export async function sendZeptoTemplateEmail({
  templateKey,
  from,
  to,              // array of { address, name? }
  subject,
  mergeInfo = {},  // object of template variables
  clientReference,
  cc,
  bcc,
}) {
  const token = process.env.ZEPTOMAIL_SENDMAIL_TOKEN;
  const bounceAddress = process.env.ZEPTOMAIL_BOUNCE_ADDRESS;
  const baseUrl = process.env.ZEPTOMAIL_BASE_URL || "https://api.zeptomail.com";

  if (!token) throw new Error("Missing ZEPTOMAIL_SENDMAIL_TOKEN");
  if (!templateKey) throw new Error("Missing templateKey");
  if (!bounceAddress) throw new Error("Missing ZEPTOMAIL_BOUNCE_ADDRESS");

  const url = `${baseUrl}/v1.1/email/template`; // Templates API - Single Email :contentReference[oaicite:6]{index=6}

  const payload = {
    template_key: templateKey,           // or template_alias instead :contentReference[oaicite:7]{index=7}
    bounce_address: bounceAddress,       // required in request body :contentReference[oaicite:8]{index=8}
    from: { address: from.address, name: from.name },
    to: to.map((r) => ({
      email_address: { address: r.address, name: r.name || undefined },
    })),
    subject,                             // required per docs :contentReference[oaicite:9]{index=9}
    merge_info: mergeInfo,               // dynamic placeholders :contentReference[oaicite:10]{index=10}
    ...(clientReference ? { client_reference: clientReference } : {}),
    ...(cc?.length
      ? {
          cc: cc.map((r) => ({ email_address: { address: r.address, name: r.name || undefined } })),
        }
      : {}),
    ...(bcc?.length
      ? {
          bcc: bcc.map((r) => ({ email_address: { address: r.address, name: r.name || undefined } })),
        }
      : {}),
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `${token}`, // :contentReference[oaicite:11]{index=11}
    },
    timeout: 15000,
  });

  return resp.data;
}
