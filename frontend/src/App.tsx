import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DispatcherDashboard } from "@/pages/DispatcherDashboard";
import { CallerView } from "@/pages/CallerView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DispatcherDashboard />} />
        <Route path="/call" element={<CallerView />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
