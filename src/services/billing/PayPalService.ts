import { config } from "../../config.js";

const paypalBaseUrl = config.PAYPAL_ENVIRONMENT === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

type PayPalResponse = {
  id?: string;
  status?: string;
  links?: Array<{ href: string; rel: string; method?: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payments?: { captures?: Array<{ id?: string; status?: string }> };
  }>;
};

async function accessToken() {
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET)
    throw new Error("PayPal is not configured");
  const response = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !body?.access_token) throw new Error("PayPal authentication failed");
  return body.access_token;
}

async function paypalRequest<T>(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const response = await fetch(`${paypalBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null) as T & { name?: string; message?: string } | null;
  if (!response.ok || !body) throw new Error(body?.message ?? "PayPal request failed");
  return body;
}

export function createPayPalOrder(amount: number, currency: string, userId: string, planId: string) {
  return paypalRequest<PayPalResponse>("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        custom_id: userId,
        reference_id: planId,
        amount: { currency_code: currency, value: amount.toFixed(2) },
      }],
      application_context: {
        return_url: `${config.FRONTEND_ORIGIN}/billing?paypal=success`,
        cancel_url: `${config.FRONTEND_ORIGIN}/billing?paypal=cancelled`,
      },
    }),
  });
}

export function capturePayPalOrder(orderId: string) {
  return paypalRequest<PayPalResponse>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    body: "{}",
  });
}

export type { PayPalResponse };
