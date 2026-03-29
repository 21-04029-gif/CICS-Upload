import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

type FirebaseAppletConfig = {
  projectId?: string;
  firestoreDatabaseId?: string;
};

let cachedConfig: FirebaseAppletConfig | null = null;

function readFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) {
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    cachedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return cachedConfig || {};
  } catch (error) {
    console.error("Failed to parse firebase-applet-config.json", error);
    cachedConfig = {};
    return cachedConfig;
  }
}

function getServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID || readFirebaseConfig().projectId;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (keyJson) {
    try {
      const parsed = JSON.parse(keyJson);
      if (parsed.private_key) {
        parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (error) {
      console.error("Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON", error);
    }
  }

  if (projectId && privateKey && clientEmail) {
    return {
      project_id: projectId,
      private_key: privateKey,
      client_email: clientEmail,
    };
  }

  return null;
}

function ensureAdminApp() {
  if (admin.apps.length > 0) return admin.app();

  const config = readFirebaseConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || config.projectId;
  const serviceAccount = getServiceAccount();

  if (serviceAccount) {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId,
    });
  }

  return admin.initializeApp({ projectId });
}

export function getDb() {
  const app = ensureAdminApp();
  const config = readFirebaseConfig();
  const dbId = process.env.FIRESTORE_DATABASE_ID || config.firestoreDatabaseId;
  return dbId ? getFirestore(app, dbId) : getFirestore(app);
}
