import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CallerView } from "@/pages/CallerView";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardView } from "@/pages/DashboardView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CallerView />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
