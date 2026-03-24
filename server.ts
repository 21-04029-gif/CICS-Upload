import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

let firebaseConfig: any;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log("Firebase config loaded successfully.");
  } else {
    console.warn("firebase-applet-config.json not found in root.");
  }
} catch (error) {
  console.error("Error loading firebase-applet-config.json:", error);
}

// Initialize Firebase Admin
if (firebaseConfig && !admin.apps.length) {
  try {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log("Firebase Admin initialized.");
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
  }
}

const db = firebaseConfig ? getFirestore(firebaseConfig.firestoreDatabaseId) : null;
const app = express();
const PORT = 3000;

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";
const authHeader = `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`;

async function startServer() {
  console.log("Starting server...");
  // API routes FIRST
  app.use(bodyParser.json());

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      if (!db) throw new Error("Firestore not initialized");
      await db.collection("health").doc("check").set({ lastCheck: Date.now() });
      res.json({ status: "ok", firestore: "connected", timestamp: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // Paymongo Checkout Session
  app.post("/api/create-checkout-session", async (req, res) => {
    if (!PAYMONGO_SECRET_KEY) {
      return res.status(500).json({ error: "PAYMONGO_SECRET_KEY is not configured." });
    }
    const { liabilityId, fileName, amount, uid, destination, studentEmail, studentName, origin } = req.body;
    console.log(`Creating checkout session for ${studentEmail} (${uid}). Amount: ${amount}. Liability: ${liabilityId}`);

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
                  amount: Math.round(amount * 100), // Amount in cents
                  description: `Liability ID: ${liabilityId} | Destination: ${destination === "deans_office" ? "Dean's Office" : (destination === "both" ? "Dean's Office & Student Org" : "Student Org")}`,
                  name: `Liability Payment: ${fileName}`,
                  quantity: 1,
                },
              ],
              payment_method_types: ["card", "gcash", "paymaya"],
              success_url: `${origin || process.env.APP_URL || "http://localhost:3000"}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${origin || process.env.APP_URL || "http://localhost:3000"}/payment-cancel?session_id={CHECKOUT_SESSION_ID}`,
              description: `Liability Payment for: ${fileName}`,
              metadata: {
                liabilityId: liabilityId || "",
                uid: uid || "",
                studentEmail: studentEmail || "",
                studentName: studentName || "",
                destination: destination || "",
                amount: amount ? amount.toString() : "0",
              },
            },
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
        }
      );

      const session = response.data.data;
      const sessionId = session.id;

      // Record Pending Payment in Firestore
      if (db) {
        try {
          await db.collection("payments").add({
            uid: uid || null,
            studentEmail: studentEmail || null,
            studentName: studentName || null,
            liabilityId: liabilityId || null,
            destination: destination || "deans_office",
            amount: amount ? parseFloat(amount.toString()) : 0,
            currency: "PHP",
            purpose: "Liability Payment",
            status: "pending",
            paymentSessionId: sessionId,
            createdAt: Date.now(),
          });
          console.log(`Pending payment record created for session: ${sessionId}`);
        } catch (fsError) {
          console.error("Error recording pending payment:", fsError);
        }
      }

      res.json({ id: sessionId, url: session.attributes.checkout_url });
    } catch (error: any) {
      console.error("Paymongo error:", error.response?.data || error.message);
      res.status(500).json({ error: error.response?.data?.errors?.[0]?.detail || error.message });
    }
  });

  // Verify Payment Status
  app.get("/api/verify-payment", async (req, res) => {
    if (!db) {
      console.error("Verification error: Firestore is not initialized.");
      return res.status(500).json({ error: "Firestore is not initialized." });
    }
    const { session_id, force_status } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: "Missing session_id" });
    }

    // Check if session_id is the literal placeholder string
    if (session_id === "{CHECKOUT_SESSION_ID}") {
      console.error("Verification error: session_id is still the literal placeholder {CHECKOUT_SESSION_ID}");
      return res.status(400).json({ error: "Invalid session ID. Paymongo did not replace the placeholder correctly." });
    }

    console.log(`Verifying payment for session: ${session_id}. Force status: ${force_status || 'none'}`);

    try {
      // Clean the session_id just in case
      const cleanSessionId = (session_id as string).trim();
      
      const response = await axios.get(`https://api.paymongo.com/v1/checkout_sessions/${cleanSessionId}?expand=payment_intent`, {
        headers: {
          Authorization: authHeader,
        },
      });

      const session = response.data.data;
      const status = session.attributes.status;
      const metadata = session.attributes.metadata || {};
      
      // With expand=payment_intent, payment_intent is in attributes
      const paymentIntent = session.attributes.payment_intent;

      console.log(`Paymongo session status for ${cleanSessionId}: ${status}`);
      
      // Determine if it's paid
      // status can be 'open', 'paid', 'expired'
      const isPaid = status === "paid";
      
      // Check payment intent status if available
      let piStatus = null;
      if (paymentIntent && typeof paymentIntent === 'object') {
        // If expanded, it has attributes
        piStatus = paymentIntent.attributes?.status || paymentIntent.status;
        console.log(`Associated Payment Intent: ${paymentIntent.id} (Status: ${piStatus})`);
      } else if (paymentIntent && typeof paymentIntent === 'string') {
        // If not expanded (fallback), we only have the ID
        console.log(`Associated Payment Intent ID: ${paymentIntent} (Not expanded)`);
      }

      const isSucceeded = isPaid || piStatus === "succeeded";
      const isFailed = status === "expired" || piStatus === "failed";
      const isCancelled = force_status === "cancelled";

      if (isSucceeded || isFailed || isCancelled) {
        const { liabilityId, uid, studentEmail, studentName, destination, amount } = metadata;
        
        const finalLiabilityId = liabilityId;
        const finalUid = uid;
        const finalAmount = amount;
        const finalDest = destination;

        console.log(`Processing session (${status}). Final Data:`, { finalLiabilityId, finalUid, finalAmount, finalDest });

        const paymentsRef = db.collection("payments");
        const querySnapshot = await paymentsRef.where("paymentSessionId", "==", cleanSessionId).get();

        const finalStatus = isSucceeded ? "pending" : (isCancelled ? "cancelled" : "failed");

        if (querySnapshot.empty) {
          console.log(`Recording new payment for session: ${cleanSessionId} with status: ${finalStatus}`);
          // Update Liability if paid
          if (isSucceeded && finalLiabilityId) {
            const liabilityRef = db.collection("liabilities").doc(finalLiabilityId as string);
            const liabilityDoc = await liabilityRef.get();
            if (liabilityDoc.exists) {
              // Change from 'paid' to 'pending_validation' per user request
              // Staff will manually clear it after validating the transaction
              await liabilityRef.update({ status: "pending_validation" });
              console.log(`Liability ${finalLiabilityId} marked as pending_validation.`);
            }
          }

          // Record Payment
          await paymentsRef.add({
            uid: finalUid || null,
            studentEmail: studentEmail || null,
            studentName: studentName || null,
            liabilityId: finalLiabilityId || null,
            destination: finalDest || "deans_office",
            amount: finalAmount ? parseFloat(finalAmount as string) : 0,
            currency: "PHP",
            purpose: "Liability Payment",
            status: finalStatus,
            paymentSessionId: cleanSessionId,
            createdAt: Date.now(),
          });
        } else {
          // Update existing record
          const docId = querySnapshot.docs[0].id;
          const currentData = querySnapshot.docs[0].data();
          
          // Only update if status is changing to a final state or if it's currently pending
          if (currentData.status === "pending" || (currentData.status !== "completed" && isSucceeded)) {
            console.log(`Updating existing payment ${docId} to status: ${finalStatus}`);
            await paymentsRef.doc(docId).update({ 
              status: finalStatus,
              updatedAt: Date.now()
            });

            if (isSucceeded && finalLiabilityId) {
              const liabilityRef = db.collection("liabilities").doc(finalLiabilityId as string);
              const liabilityDoc = await liabilityRef.get();
              if (liabilityDoc.exists) {
                // Change from 'paid' to 'pending_validation' per user request
                // Staff will manually clear it after validating the transaction
                await liabilityRef.update({ status: "pending_validation" });
                console.log(`Liability ${finalLiabilityId} marked as pending_validation.`);
              }
            }
          }
        }
        
        return res.json({ success: isSucceeded, status: finalStatus, piStatus });
      }

      res.json({ success: false, status: status, piStatus, error: status === "open" ? "Payment is still processing. Please wait a moment." : `Payment status is ${status}` });
    } catch (error: any) {
      const paymongoError = error.response?.data?.errors?.[0]?.detail || error.message;
      console.error("Verification error:", paymongoError);
      res.status(500).json({ error: `Failed to verify payment: ${paymongoError}` });
    }
  });

  // Paymongo Webhook
  app.post("/api/paymongo-webhook", async (req, res) => {
    if (!db) {
      return res.status(500).json({ error: "Firestore is not initialized." });
    }
    const event = req.body.data;
    if (!event) return res.status(400).json({ error: "Invalid webhook payload" });
    const type = event.attributes.type;
    console.log(`Webhook received: ${type}`);

    const isSuccess = type === "checkout_session.paid" || type === "checkout_session.authorized" || type === "checkout_session.payment_success";
    const isExpired = type === "checkout_session.expired";
    const isFailed = type === "checkout_session.payment_failed";
    const isCancelled = type === "checkout_session.cancelled";

    if (isSuccess || isExpired || isFailed || isCancelled) {
      const session = event.attributes.data;
      const sessionId = session.id;
      const metadata = session.attributes.metadata || {};

      try {
        const { liabilityId, uid, studentEmail, studentName, destination, amount } = metadata;
        const paymentIntent = session.attributes.payment_intent;
        const piStatus = paymentIntent?.attributes?.status;

        console.log(`Webhook: Processing session (${type}). SessionId: ${sessionId}. PI Status: ${piStatus}. Metadata:`, metadata);

        // Check if payment already recorded
        const paymentsRef = db.collection("payments");
        const querySnapshot = await paymentsRef.where("paymentSessionId", "==", sessionId).get();

        const finalStatus = isSuccess ? "pending" : (isCancelled ? "cancelled" : "failed");

        if (querySnapshot.empty) {
          console.log(`Webhook: Recording new payment for session: ${sessionId} with status: ${finalStatus}`);
          // Update Liability
          if (isSuccess && liabilityId) {
            const liabilityRef = db.collection("liabilities").doc(liabilityId);
            const liabilityDoc = await liabilityRef.get();
            if (liabilityDoc.exists) {
              // Change from 'paid' to 'pending_validation' per user request
              // Staff will manually clear it after validating the transaction
              await liabilityRef.update({ status: "pending_validation" });
              console.log(`Webhook: Liability ${liabilityId} marked as pending_validation.`);
            }
          }

          // Record Payment
          await paymentsRef.add({
            uid: uid || null,
            studentEmail: studentEmail || null,
            studentName: studentName || null,
            liabilityId: liabilityId || null,
            destination: destination || "deans_office",
            amount: amount ? parseFloat(amount) : 0,
            currency: "PHP",
            purpose: "Liability Payment",
            status: finalStatus,
            paymentSessionId: sessionId,
            createdAt: Date.now(),
          });
        } else {
          // Update existing record
          const docId = querySnapshot.docs[0].id;
          const currentData = querySnapshot.docs[0].data();
          
          if (currentData.status === "pending" || (currentData.status !== "completed" && isSuccess)) {
            console.log(`Webhook: Updating existing payment ${docId} to status: ${finalStatus}`);
            await paymentsRef.doc(docId).update({ 
              status: finalStatus,
              updatedAt: Date.now()
            });

            if (isSuccess && liabilityId) {
              const liabilityRef = db.collection("liabilities").doc(liabilityId);
              const liabilityDoc = await liabilityRef.get();
              if (liabilityDoc.exists) {
                // Change from 'paid' to 'pending_validation' per user request
                // Staff will manually clear it after validating the transaction
                await liabilityRef.update({ status: "pending_validation" });
              }
            }
          }
        }
      } catch (error) {
        console.error("Webhook processing error:", error);
      }
    }

    res.json({ received: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("Running in development mode with Vite middleware.");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Running in production mode, serving static files from dist.");
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.error("dist folder not found! Make sure to run 'npm run build' first.");
      app.get("*", (req, res) => {
        res.status(500).send("Application is not built yet. Please check server logs.");
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
});
