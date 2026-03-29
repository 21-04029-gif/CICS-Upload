import axios from "axios";
import { getDb } from "./_lib/firebaseAdmin";
import { getPaymongoAuthHeader, getPaymongoSecretKey } from "./_lib/paymongo";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const paymongoKey = getPaymongoSecretKey();
  if (!paymongoKey) {
    return res.status(500).json({ error: "PAYMONGO_SECRET_KEY is not configured." });
  }

  const sessionIdRaw = req.query?.session_id;
  const forceStatus = req.query?.force_status;
  const sessionId = Array.isArray(sessionIdRaw) ? sessionIdRaw[0] : sessionIdRaw;

  if (!sessionId || sessionId === "{CHECKOUT_SESSION_ID}") {
    return res.status(400).json({ error: "Invalid session ID." });
  }

  try {
    const response = await axios.get(
      `https://api.paymongo.com/v1/checkout_sessions/${String(sessionId).trim()}?expand=payment_intent`,
      {
        headers: {
          Authorization: getPaymongoAuthHeader(),
        },
      }
    );

    const session = response.data?.data;
    const status = session?.attributes?.status;
    const metadata = session?.attributes?.metadata || {};
    const paymentIntent = session?.attributes?.payment_intent;
    const piStatus = paymentIntent?.attributes?.status || paymentIntent?.status || null;

    const isSucceeded = status === "paid" || piStatus === "succeeded";
    const isFailed = status === "expired" || piStatus === "failed";
    const isCancelled = forceStatus === "cancelled";

    if (isSucceeded || isFailed || isCancelled) {
      const db = getDb();
      const finalStatus = isSucceeded ? "completed" : isCancelled ? "cancelled" : "failed";
      const cleanSessionId = String(sessionId).trim();

      const paymentsRef = db.collection("payments");
      const existing = await paymentsRef.where("paymentSessionId", "==", cleanSessionId).get();

      if (existing.empty) {
        await paymentsRef.add({
          uid: metadata.uid || null,
          studentEmail: metadata.studentEmail || null,
          studentName: metadata.studentName || null,
          liabilityId: metadata.liabilityId || null,
          destination: metadata.destination || "deans_office",
          amount: metadata.amount ? parseFloat(String(metadata.amount)) : 0,
          currency: "PHP",
          purpose: "Liability Payment",
          status: finalStatus,
          paymentSessionId: cleanSessionId,
          createdAt: Date.now(),
        });
      } else {
        const docRef = paymentsRef.doc(existing.docs[0].id);
        const current = existing.docs[0].data();
        if (current.status === "pending" || (current.status !== "completed" && isSucceeded)) {
          await docRef.update({
            status: finalStatus,
            updatedAt: Date.now(),
          });
        }
      }

      if (isSucceeded && metadata.liabilityId) {
        const liabilityRef = db.collection("liabilities").doc(String(metadata.liabilityId));
        const liabilityDoc = await liabilityRef.get();
        if (liabilityDoc.exists) {
          const currentLiability = liabilityDoc.data() || {};
          if (currentLiability.status !== "paid" && currentLiability.status !== "pending") {
            await liabilityRef.update({ status: "pending", paidAt: Date.now() });
          }
        }
      }

      return res.status(200).json({ success: isSucceeded, status: finalStatus, piStatus });
    }

    return res.status(200).json({
      success: false,
      status,
      piStatus,
      error: status === "open" ? "Payment is still processing. Please wait a moment." : `Payment status is ${status}`,
    });
  } catch (error: any) {
    const message = error?.response?.data?.errors?.[0]?.detail || error?.message || "Failed to verify payment";
    return res.status(500).json({ error: `Failed to verify payment: ${message}` });
  }
}
