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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
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
    if (!hasFirebaseConfig) {
      throw new Error("Missing Firebase config in VITE_FIREBASE_* environment variables.");
    }
    await signInWithPopup(firebaseAuth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(firebaseAuth);
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  return {
    user,
    loading,
    isAuthenticated,
    department,
    setDepartment,
    signInWithGoogle,
    signOut,
    hasFirebaseConfig,
  };
}
