import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Dashboard } from "./pages/Dashboard";
import { EnvelopeDetail } from "./pages/EnvelopeDetail";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { ScheduledTransactions } from "./pages/ScheduledTransactions";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="safe-x safe-t safe-b flex min-h-[100dvh] items-center justify-center bg-paper">
        <p className="font-display text-lg text-muted">Loading…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/envelope/:id"
          element={
            <Protected>
              <EnvelopeDetail />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route path="/manage" element={<Navigate to="/settings" replace />} />
        <Route
          path="/schedules"
          element={
            <Protected>
              <ScheduledTransactions />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
