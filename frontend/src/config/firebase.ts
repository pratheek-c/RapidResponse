import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingConfig = Object.values(firebaseConfig).some((value) => !value);

export const hasFirebaseConfig = !missingConfig;

export const firebaseApp = initializeApp({
  apiKey: firebaseConfig.apiKey ?? "demo",
  authDomain: firebaseConfig.authDomain ?? "demo.firebaseapp.com",
  projectId: firebaseConfig.projectId ?? "demo-project",
  storageBucket: firebaseConfig.storageBucket ?? "demo.appspot.com",
  messagingSenderId: firebaseConfig.messagingSenderId ?? "0",
  appId: firebaseConfig.appId ?? "1:0:web:demo",
});

export const firebaseAuth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
