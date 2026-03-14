import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CallerView } from "@/pages/CallerView";
import { DispatcherDashboard } from "@/pages/DispatcherDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CallerView />} />
        <Route path="/dashboard" element={<DispatcherDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
