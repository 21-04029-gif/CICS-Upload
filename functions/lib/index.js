import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
const app = express();
const DEFAULT_PAYMENT_METHODS = ["card", "gcash", "paymaya"];
if (!admin.apps.length) {
    admin.initializeApp();
}
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "ai-studio-2f6ca112-61c9-47c0-bdbf-78874120c2d6";
const db = getFirestore(admin.app(), FIRESTORE_DATABASE_ID);
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Enable CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    if (req.method === "OPTIONS") {
        res.sendStatus(200);
    }
    else {
        next();
    }
});
// Health check endpoints (direct function URL and hosting rewrite path)
const healthHandler = (req, res) => {
    res.json({ status: "ok" });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
// Checkout endpoints (direct function URL and hosting rewrite path)
const createCheckoutSession = async (req, res) => {
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";
    if (!PAYMONGO_SECRET_KEY) {
        return res.status(500).json({ error: "PAYMONGO_SECRET_KEY is not configured." });
    }
    const authHeader = `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`;
    const { liabilityId, fileName, amount, uid, destination, studentEmail, studentName, origin, paymentMethodTypes, taggingType, } = req.body;
    const numericAmount = Number(amount);
    const appOrigin = origin || process.env.APP_URL || "https://cics-upload-490705.web.app";
    const selectedPaymentMethods = Array.isArray(paymentMethodTypes) && paymentMethodTypes.length > 0
        ? paymentMethodTypes
        : DEFAULT_PAYMENT_METHODS;
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: "Invalid amount." });
    }
    try {
        const response = await axios.post("https://api.paymongo.com/v1/checkout_sessions", {
            data: {
                attributes: {
                    send_email_receipt: true,
                    show_description: true,
                    show_line_items: true,
                    line_items: [
                        {
                            currency: "PHP",
                            amount: Math.round(numericAmount * 100),
                            description: `Liability ID: ${liabilityId} | Destination: ${destination === "deans_office"
                                ? "Dean's Office"
                                : destination === "both"
                                    ? "Dean's Office & Student Org"
                                    : "Student Org"}`,
                            name: `Liability Payment: ${fileName}`,
                            quantity: 1,
                        },
                    ],
                    payment_method_types: selectedPaymentMethods,
                    success_url: `${appOrigin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${appOrigin}/payment-cancel?session_id={CHECKOUT_SESSION_ID}`,
                    description: `Liability Payment for: ${fileName}`,
                    metadata: {
                        liabilityId: liabilityId || "",
                        uid: uid || "",
                        studentEmail: studentEmail || "",
                        studentName: studentName || "",
                        destination: destination || "",
                        taggingType: taggingType || "",
                        amount: amount ? amount.toString() : "0",
                    },
                },
            },
        }, {
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
        });
        if (!response.data.data) {
            throw new Error("Invalid PayMongo response: no data object");
        }
        const session = response.data.data;
        const sessionId = session.id;
        if (!sessionId) {
            throw new Error("PayMongo session has no ID");
        }
        if (!session.attributes?.checkout_url) {
            throw new Error("PayMongo session has no checkout_url");
        }
        res.json({
            id: sessionId,
            url: session.attributes.checkout_url,
            status: session.attributes.status,
        });
    }
    catch (error) {
        console.error("PayMongo checkout error");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
            const errorDetail = error.response.data?.errors?.[0]?.detail || JSON.stringify(error.response.data);
            return res.status(500).json({
                error: "Failed to create checkout session",
                details: errorDetail,
                paymongo_error: error.response.data,
            });
        }
        else if (error.request) {
            console.error("Request made but no response received");
            console.error(error.request);
            return res.status(500).json({
                error: "No response from PayMongo",
                details: "Payment gateway is not responding",
            });
        }
        else {
            console.error("Error message:", error.message);
            return res.status(500).json({
                error: "Failed to create checkout session",
                details: error.message,
            });
        }
    }
};
app.post("/create-checkout-session", createCheckoutSession);
app.post("/api/create-checkout-session", createCheckoutSession);
const verifyPayment = async (req, res) => {
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";
    if (!PAYMONGO_SECRET_KEY) {
        return res.status(500).json({ error: "PAYMONGO_SECRET_KEY is not configured." });
    }
    const rawSessionId = String(req.query.session_id || "").trim();
    const forceStatus = String(req.query.force_status || "").trim().toLowerCase();
    if (!rawSessionId || rawSessionId.includes("{CHECKOUT_SESSION_ID}")) {
        return res.status(400).json({ error: "Invalid session_id" });
    }
    if (forceStatus === "cancelled") {
        return res.json({ success: false, status: "cancelled" });
    }
    const authHeader = `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`;
    try {
        const sessionCandidates = rawSessionId.startsWith("cs_")
            ? [rawSessionId]
            : [rawSessionId, `cs_${rawSessionId}`];
        let response = null;
        let resolvedSessionId = rawSessionId;
        for (const candidate of sessionCandidates) {
            try {
                response = await axios.get(`https://api.paymongo.com/v1/checkout_sessions/${candidate}`, {
                    headers: {
                        Authorization: authHeader,
                        Accept: "application/json",
                    },
                });
                resolvedSessionId = candidate;
                break;
            }
            catch (err) {
                const code = err?.response?.data?.errors?.[0]?.code;
                if (code !== "resource_not_found") {
                    throw err;
                }
            }
        }
        if (!response) {
            return res.status(404).json({ error: "Checkout session not found" });
        }
        const session = response.data?.data;
        const attributes = session?.attributes || {};
        const metadata = attributes.metadata || {};
        const paymongoPayments = Array.isArray(attributes.payments) ? attributes.payments : [];
        const hasPaidPayment = paymongoPayments.some((p) => p?.attributes?.status === "paid");
        // Treat completed PayMongo payments as real payments in the system.
        if (hasPaidPayment) {
            const liabilityId = String(metadata.liabilityId || "");
            const destination = String(metadata.destination || "deans_office");
            const paymentAmount = Number(metadata.amount || 0);
            const existingPaymentSnap = await db
                .collection("payments")
                .where("paymentSessionId", "==", resolvedSessionId)
                .limit(1)
                .get();
            if (existingPaymentSnap.empty) {
                await db.collection("payments").add({
                    uid: metadata.uid || null,
                    studentEmail: metadata.studentEmail || null,
                    studentName: metadata.studentName || null,
                    liabilityId: liabilityId || null,
                    destination,
                    amount: Number.isFinite(paymentAmount) ? paymentAmount : 0,
                    currency: "PHP",
                    purpose: "Liability Payment",
                    status: "pending",
                    paymentSessionId: resolvedSessionId,
                    createdAt: Date.now(),
                    source: "paymongo",
                });
            }
            else {
                await existingPaymentSnap.docs[0].ref.update({
                    status: "pending",
                    updatedAt: Date.now(),
                });
            }
            if (liabilityId) {
                const liabilityRef = db.collection("liabilities").doc(liabilityId);
                const liabilityDoc = await liabilityRef.get();
                if (liabilityDoc.exists) {
                    await liabilityRef.update({
                        status: "pending",
                        updatedAt: Date.now(),
                    });
                }
            }
            return res.json({ success: true, status: "completed", sessionId: resolvedSessionId });
        }
        // Unpaid/expired sessions remain open or failed.
        if (attributes.status === "expired") {
            return res.json({ success: false, status: "failed", sessionId: resolvedSessionId });
        }
        return res.json({ success: false, status: "open", sessionId: resolvedSessionId });
    }
    catch (error) {
        const detail = error?.response?.data?.errors?.[0]?.detail || error?.message || "Verification failed";
        return res.status(500).json({ error: detail });
    }
};
app.get("/verify-payment", verifyPayment);
app.get("/api/verify-payment", verifyPayment);
// Export the Express app as a Cloud Function
export const api = onRequest({ secrets: ["PAYMONGO_SECRET_KEY"] }, app);
//# sourceMappingURL=index.js.map