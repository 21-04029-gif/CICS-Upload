import { getDb } from "./_lib/firebaseAdmin";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();
    await db.collection("health").doc("check").set({ lastCheck: Date.now() });
    return res.status(200).json({
      status: "ok",
      firestore: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      status: "error",
      message: error?.message || "Health check failed",
    });
  }
}
