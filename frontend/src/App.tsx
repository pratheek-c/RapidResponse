import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CallerView } from "@/pages/CallerView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CallerView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
