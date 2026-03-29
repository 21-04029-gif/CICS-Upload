import { getDb } from "./_lib/firebaseAdmin";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const event = req.body?.data;
  if (!event) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  const type = event?.attributes?.type;
  const isSuccess = type === "checkout_session.paid" || type === "checkout_session.authorized" || type === "checkout_session.payment_success";
  const isExpired = type === "checkout_session.expired";
  const isFailed = type === "checkout_session.payment_failed";
  const isCancelled = type === "checkout_session.cancelled";

  if (!isSuccess && !isExpired && !isFailed && !isCancelled) {
    return res.status(200).json({ received: true });
  }

  try {
    const db = getDb();
    const session = event.attributes.data;
    const sessionId = session?.id;
    const metadata = session?.attributes?.metadata || {};

    if (!sessionId) {
      return res.status(400).json({ error: "Missing session id in webhook payload" });
    }

    const paymentsRef = db.collection("payments");
    const existing = await paymentsRef.where("paymentSessionId", "==", sessionId).get();
    const finalStatus = isSuccess ? "completed" : isCancelled ? "cancelled" : "failed";

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
        paymentSessionId: sessionId,
        createdAt: Date.now(),
      });
    } else {
      const docRef = paymentsRef.doc(existing.docs[0].id);
      const current = existing.docs[0].data();
      if (current.status === "pending" || (current.status !== "completed" && isSuccess)) {
        await docRef.update({
          status: finalStatus,
          updatedAt: Date.now(),
        });
      }
    }

    if (isSuccess && metadata.liabilityId) {
      const liabilityRef = db.collection("liabilities").doc(String(metadata.liabilityId));
      const liabilityDoc = await liabilityRef.get();
      if (liabilityDoc.exists) {
        await liabilityRef.update({ status: "pending", paidAt: Date.now() });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({ error: error?.message || "Webhook processing failed" });
  }
}
