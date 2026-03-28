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

// Normalize GOOGLE_APPLICATION_CREDENTIALS from .env so Firebase Admin gets a valid file path.
const rawCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (rawCredentialsPath) {
  let normalizedCredentialsPath = rawCredentialsPath.trim().replace(/^['\"]|['\"]$/g, "");
  const homeDir = process.env.HOME || "";

  if (normalizedCredentialsPath.startsWith("$HOME/")) {
    normalizedCredentialsPath = path.join(homeDir, normalizedCredentialsPath.slice("$HOME/".length));
  } else if (normalizedCredentialsPath.startsWith("~/")) {
    normalizedCredentialsPath = path.join(homeDir, normalizedCredentialsPath.slice(2));
  } else if (!path.isAbsolute(normalizedCredentialsPath)) {
    normalizedCredentialsPath = path.resolve(process.cwd(), normalizedCredentialsPath);
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = normalizedCredentialsPath;
}

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
    const initConfig: any = {
      projectId: firebaseConfig.projectId,
    };
    
    // Try to load service account credentials if available
    const serviceAccountPath = path.join(process.cwd(), "firebase-service-account.json");
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
      initConfig.credential = admin.credential.cert(serviceAccount);
      console.log("Firebase Admin initialized with service account credentials.");
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      // Already set via environment variable, SDK will pick it up automatically
      console.log("Firebase Admin initialized with GOOGLE_APPLICATION_CREDENTIALS environment variable.");
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn(`⚠️  GOOGLE_APPLICATION_CREDENTIALS path not found: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
      console.warn("   Please set GOOGLE_APPLICATION_CREDENTIALS to an absolute path of your JSON key file.");
    } else {
      console.warn("⚠️  No service account credentials found. Firestore write operations may fail.");
      console.warn("   Please set GOOGLE_APPLICATION_CREDENTIALS or place firebase-service-account.json in the root directory.");
    }
    
    admin.initializeApp(initConfig);
    console.log("Firebase Admin SDK initialized for project:", firebaseConfig.projectId);
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
  
  // Verify PayMongo configuration
  if (!PAYMONGO_SECRET_KEY) {
    console.error("❌ ERROR: PAYMONGO_SECRET_KEY is not configured!");
  } else {
    console.log(`✅ PayMongo API Key loaded: ${PAYMONGO_SECRET_KEY.substring(0, 10)}...`);
  }
  
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
    console.log(`\n===== CREATE CHECKOUT REQUEST =====`);
    console.log(`Student: ${studentEmail} (${uid})`);
    console.log(`Amount: PHP ${amount}`);
    console.log(`Liability ID: ${liabilityId}`);
    console.log(`===================================\n`);

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
              success_url: `${origin || process.env.APP_URL || "http://localhost:3000"}/payment-success`,
              cancel_url: `${origin || process.env.APP_URL || "http://localhost:3000"}/payment-cancel`,
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

      console.log("\n===== PAYMONGO FULL RESPONSE =====");
      console.log(JSON.stringify(response.data, null, 2));
      console.log("====================================\n");

      if (!response.data.data) {
        throw new Error("Invalid PayMongo response: no data object");
      }

      const session = response.data.data;
      const sessionId = session.id;
      const appUrl = origin || process.env.APP_URL || "http://localhost:3000";
      
      if (!sessionId) {
        throw new Error("PayMongo session has no ID");
      }

      if (!session.attributes?.checkout_url) {
        throw new Error("PayMongo session has no checkout_url");
      }

      // PayMongo returns checkout_url with {CHECKOUT_SESSION_ID} placeholder - we need to replace it
      let checkoutUrl = session.attributes.checkout_url;
      if (checkoutUrl.includes("{CHECKOUT_SESSION_ID}")) {
        console.log("ℹ️  PayMongo returned URL with placeholder, replacing with actual session ID...");
        checkoutUrl = checkoutUrl.replace(/{CHECKOUT_SESSION_ID}/g, sessionId);
      }
      
      console.log("\n========== CHECKOUT SESSION CREATED ==========");
      console.log(`Session ID: ${sessionId}`);
      console.log(`Status: ${session.attributes.status}`);
      console.log(`Original URL: ${session.attributes.checkout_url}`);
      console.log(`Final Checkout URL: ${checkoutUrl}`);
      console.log(`Payment Methods: ${JSON.stringify(session.attributes.payment_method_types)}`);
      console.log(`Amount: ₱${amount} (${Math.round(amount * 100)} cents)`);
      console.log("==========================================\n");

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
        } catch (fsError: any) {
          console.warn(`⚠️  Warning: Could not record pending payment to Firestore: ${fsError.message}`);
          console.warn("This is non-critical - payment verification will work from PayMongo API.");
        }
      } else {
        console.warn("⚠️  Firestore not initialized - skipping pending payment record. This is non-critical.");
      }

      // Return the actual session ID along with checkout URL for frontend to use
      res.json({ 
        id: sessionId, 
        url: checkoutUrl,
        metadata: {
          liabilityId,
          destination,
          amount
        }
      });
    } catch (error: any) {
      console.error("\n❌ PAYMONGO ERROR");
      console.error("Status:", error.response?.status);
      console.error("Error Response:", JSON.stringify(error.response?.data, null, 2));
      console.error("Message:", error.message);
      console.error("============================\n");
      
      const errorMessage = error.response?.data?.errors?.[0]?.detail || error.message || "Failed to create checkout session";
      res.status(error.response?.status || 500).json({ error: errorMessage });
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

    // Check if session_id is valid
    if (!session_id || session_id === "{CHECKOUT_SESSION_ID}" || typeof session_id !== "string") {
      console.error("Verification error: Invalid or missing session_id", session_id);
      return res.status(400).json({ error: "Invalid session ID. Please ensure you were redirected correctly from PayMongo." });
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

        const finalStatus = isSucceeded ? "completed" : (isCancelled ? "cancelled" : "failed");

        // Try to update Firestore if available
        if (db) {
          try {
            const paymentsRef = db.collection("payments");
            const querySnapshot = await paymentsRef.where("paymentSessionId", "==", cleanSessionId).get();

            const syncLiabilityToPending = async () => {
              if (!isSucceeded || !finalLiabilityId) return;

              const liabilityRef = db.collection("liabilities").doc(finalLiabilityId as string);
              const liabilityDoc = await liabilityRef.get();
              if (!liabilityDoc.exists) {
                console.error(`❌ Liability document not found: ${finalLiabilityId}`);
                return;
              }

              const currentLiabilityData = liabilityDoc.data() || {};
              // Keep approved liabilities as paid; otherwise mark as pending after payment.
              if (currentLiabilityData.status !== "paid" && currentLiabilityData.status !== "pending") {
                const updateData = { status: "pending", paidAt: Date.now() };
                await liabilityRef.update(updateData);
                console.log(`✅ Liability ${finalLiabilityId} successfully updated to pending. Update data:`, updateData);
                console.log(`Destination: ${finalDest} - Approvers: ${finalDest === "both" ? "Student Org & Dean's Office" : "Dean's Office only"}`);
              }
            };

            if (querySnapshot.empty) {
              console.log(`Recording new payment for session: ${cleanSessionId} with status: ${finalStatus}`);
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
              }
            }

            // Always attempt liability sync for successful payments, even when payment doc is already completed.
            await syncLiabilityToPending();
          } catch (fsError: any) {
            console.warn(`⚠️  Could not update Firestore records: ${fsError.message}`);
            console.warn("Payment status will still be verified from PayMongo API.");
          }
        } else {
          console.warn("⚠️  Firestore not initialized - skipping database updates. Payment status verified via PayMongo API.");
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
        if (!db) {
          console.warn(`Warning: Firestore not initialized - skipping payment processing for session ${sessionId}.`);
          return res.json({ received: true, warning: "Firestore not initialized" });
        }

        const { liabilityId, uid, studentEmail, studentName, destination, amount } = metadata;
        const paymentIntent = session.attributes.payment_intent;
        const piStatus = paymentIntent?.attributes?.status;

        console.log(`Webhook: Processing session (${type}). SessionId: ${sessionId}. PI Status: ${piStatus}. Metadata:`, metadata);

        // Check if payment already recorded
        const paymentsRef = db.collection("payments");
        const querySnapshot = await paymentsRef.where("paymentSessionId", "==", sessionId).get();

        const finalStatus = isSuccess ? "completed" : (isCancelled ? "cancelled" : "failed");

        if (querySnapshot.empty) {
          console.log(`Webhook: Recording new payment for session: ${sessionId} with status: ${finalStatus}`);
          // Update Liability
          if (isSuccess && liabilityId) {
            const liabilityRef = db.collection("liabilities").doc(liabilityId);
            const liabilityDoc = await liabilityRef.get();
            if (liabilityDoc.exists) {
              // Mark as pending - awaiting approval
              // If destination is "both" (from dropdown): both student org and dean's office can approve
              // If destination is "deans_office" (from free text): only dean's office can approve
              const dest = liabilityDoc.data().destination || destination;
              await liabilityRef.update({ status: "pending", paidAt: Date.now() });
              console.log(`Webhook: Liability ${liabilityId} marked as pending. Destination: ${dest} - Approvers: ${dest === "both" ? "Student Org & Dean's Office" : "Dean's Office only"}`);
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
                // Mark as pending - awaiting approval
                // If destination is "both" (from dropdown): both student org and dean's office can approve
                // If destination is "deans_office" (from free text): only dean's office can approve
                const dest = liabilityDoc.data().destination || destination;
                await liabilityRef.update({ status: "pending", paidAt: Date.now() });
                console.log(`Webhook: Liability ${liabilityId} marked as pending. Destination: ${dest} - Approvers: ${dest === "both" ? "Student Org & Dean's Office" : "Dean's Office only"}`);
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
