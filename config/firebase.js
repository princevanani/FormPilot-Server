import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');

let db = null;
let isFirebaseActive = false;

// Ensure local fallback data dir exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadLocalStore() {
  try {
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    }
  } catch (err) {
    console.warn('[Storage] Error reading local store:', err.message);
  }
  return { users: {}, otps: {} };
}

function saveLocalStore(data) {
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Storage] Error saving local store:', err.message);
  }
}

// Initialize Firebase Admin if credentials are present
try {
  const serviceAccountKeyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  let resolvedPath = null;
  if (serviceAccountKeyPath) {
    if (fs.existsSync(serviceAccountKeyPath)) {
      resolvedPath = serviceAccountKeyPath;
    } else if (fs.existsSync(path.resolve(__dirname, '..', serviceAccountKeyPath))) {
      resolvedPath = path.resolve(__dirname, '..', serviceAccountKeyPath);
    }
  }

  if (resolvedPath) {
    const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    isFirebaseActive = true;
    console.log(`[Firebase] Connected to Firestore using ${path.basename(resolvedPath)} (${serviceAccount.project_id}).`);
  } else if (projectId && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    db = admin.firestore();
    isFirebaseActive = true;
    console.log('[Firebase] Connected to Firestore with environment credentials.');
  } else {
    console.log('[Storage] Firebase credentials not found. Using local JSON store (server/data/store.json).');
  }
} catch (err) {
  console.warn('[Firebase] Initialization error, falling back to local store:', err.message);
  db = null;
  isFirebaseActive = false;
}

/**
 * Unified data access layer supporting both Firestore and Local Store fallback
 */
export const dataStore = {
  isFirebaseActive: () => isFirebaseActive,

  async getUserByEmail(email) {
    const normalized = email.toLowerCase().trim();
    if (isFirebaseActive && db) {
      try {
        const doc = await db.collection('users').doc(normalized).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
      } catch (err) {
        console.warn('[Firebase] Firestore read failed, using local store fallback:', err.message);
      }
    }
    const store = loadLocalStore();
    return store.users[normalized] || null;
  },

  async saveUser(email, userData) {
    const normalized = email.toLowerCase().trim();
    const record = {
      email: normalized,
      ...userData,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseActive && db) {
      try {
        await db.collection('users').doc(normalized).set(record, { merge: true });
        return record;
      } catch (err) {
        console.warn('[Firebase] Firestore write failed, using local store fallback:', err.message);
      }
    }

    const store = loadLocalStore();
    store.users[normalized] = {
      ...(store.users[normalized] || {}),
      ...record,
    };
    saveLocalStore(store);
    return record;
  },

  async saveOtp(email, otp, expiresAt) {
    const normalized = email.toLowerCase().trim();
    const otpRecord = {
      email: normalized,
      otp,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    if (isFirebaseActive && db) {
      try {
        await db.collection('trial_otps').doc(normalized).set(otpRecord);
        return otpRecord;
      } catch (err) {
        console.warn('[Firebase] Firestore saveOtp failed, using local store fallback:', err.message);
      }
    }

    const store = loadLocalStore();
    store.otps[normalized] = otpRecord;
    saveLocalStore(store);
    return otpRecord;
  },

  async getOtp(email) {
    const normalized = email.toLowerCase().trim();
    if (isFirebaseActive && db) {
      try {
        const doc = await db.collection('trial_otps').doc(normalized).get();
        return doc.exists ? doc.data() : null;
      } catch (err) {
        console.warn('[Firebase] Firestore getOtp failed, using local store fallback:', err.message);
      }
    }
    const store = loadLocalStore();
    return store.otps[normalized] || null;
  },

  async deleteOtp(email) {
    const normalized = email.toLowerCase().trim();
    if (isFirebaseActive && db) {
      try {
        await db.collection('trial_otps').doc(normalized).delete();
        return;
      } catch (err) {
        console.warn('[Firebase] Firestore deleteOtp failed, using local store fallback:', err.message);
      }
    }
    const store = loadLocalStore();
    delete store.otps[normalized];
    saveLocalStore(store);
  },
};
