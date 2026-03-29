import axios from "axios";
import { getDb } from "./_lib/firebaseAdmin";
import { getPaymongoAuthHeader, getPaymongoSecretKey } from "./_lib/paymongo";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const paymongoKey = getPaymongoSecretKey();
  if (!paymongoKey) {
    return res.status(500).json({ error: "PAYMONGO_SECRET_KEY is not configured." });
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { liabilityId, fileName, amount, uid, destination, studentEmail, studentName, origin } = payload;

  const numericAmount = Number(amount || 0);
  const appUrl = origin || process.env.APP_URL || "http://localhost:3000";

  try {
    const response = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            line_items: [
              {
                currency: "PHP",
                amount: Math.round(numericAmount * 100),
                description: `Liability ID: ${liabilityId} | Destination: ${destination === "deans_office" ? "Dean's Office" : destination === "both" ? "Dean's Office & Student Org" : "Student Org"}`,
                name: `Liability Payment: ${fileName}`,
                quantity: 1,
              },
            ],
            payment_method_types: ["card", "gcash", "paymaya"],
            success_url: `${appUrl}/payment-success`,
            cancel_url: `${appUrl}/payment-cancel`,
            description: `Liability Payment for: ${fileName}`,
            metadata: {
              liabilityId: liabilityId || "",
              uid: uid || "",
              studentEmail: studentEmail || "",
              studentName: studentName || "",
              destination: destination || "",
              amount: numericAmount.toString(),
            },
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: getPaymongoAuthHeader(),
        },
      }
    );

    const session = response.data?.data;
    if (!session?.id || !session?.attributes?.checkout_url) {
      throw new Error("Invalid PayMongo response: missing session id or checkout url");
    }

    let checkoutUrl = String(session.attributes.checkout_url);
    if (checkoutUrl.includes("{CHECKOUT_SESSION_ID}")) {
      checkoutUrl = checkoutUrl.replace(/{CHECKOUT_SESSION_ID}/g, session.id);
    }

    try {
      const db = getDb();
      await db.collection("payments").add({
        uid: uid || null,
        studentEmail: studentEmail || null,
        studentName: studentName || null,
        liabilityId: liabilityId || null,
        destination: destination || "deans_office",
        amount: numericAmount,
        currency: "PHP",
        purpose: "Liability Payment",
        status: "pending",
        paymentSessionId: session.id,
        createdAt: Date.now(),
      });
    } catch (dbError: any) {
      console.warn("Skipping pending payment write:", dbError?.message || dbError);
    }

    return res.status(200).json({
      id: session.id,
      url: checkoutUrl,
      metadata: {
        liabilityId,
        destination,
        amount: numericAmount,
      },
    });
  } catch (error: any) {
    const message =
      error?.response?.data?.errors?.[0]?.detail ||
      error?.message ||
      "Failed to create checkout session";
    return res.status(error?.response?.status || 500).json({ error: message });
  }
}
