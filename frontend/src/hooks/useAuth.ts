import { useCallback, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { firebaseAuth, googleProvider, hasFirebaseConfig } from "@/config/firebase";
import type { Department } from "@/types/dashboard";

const DEPT_KEY = "rr_dispatch_department";
const DEV_BYPASS_KEY = "rr_dev_bypass";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [devBypass, setDevBypass] = useState(() => localStorage.getItem(DEV_BYPASS_KEY) === "1");
  const [loading, setLoading] = useState(true);
  const [department, setDepartmentState] = useState<Department | null>(() => {
    const stored = localStorage.getItem(DEPT_KEY);
    if (
      stored === "patrol" ||
      stored === "fire" ||
      stored === "medical" ||
      stored === "hazmat"
    ) {
      return stored;
    }
    return null;
  });

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const setDepartment = useCallback((next: Department) => {
    setDepartmentState(next);
    localStorage.setItem(DEPT_KEY, next);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!hasFirebaseConfig || !firebaseAuth) {
      throw new Error("Missing Firebase config in VITE_FIREBASE_* environment variables.");
    }
    try {
      await signInWithPopup(firebaseAuth, googleProvider);
    } catch (err) {
      // Popup blocked or COOP issue — re-throw so LoginPage can show the error
      throw err;
    }
  }, []);

  const signInDev = useCallback(() => {
    localStorage.setItem(DEV_BYPASS_KEY, "1");
    setDevBypass(true);
    setLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEV_BYPASS_KEY);
    setDevBypass(false);
    if (firebaseAuth) await firebaseSignOut(firebaseAuth);
  }, []);

  const isAuthenticated = useMemo(() => devBypass || Boolean(user), [devBypass, user]);

  return {
    user,
    loading,
    isAuthenticated,
    department,
    setDepartment,
    signInWithGoogle,
    signInDev,
    signOut,
    hasFirebaseConfig,
  };
}
