import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./components/AuthProvider";

const ChangePasswordPage = lazy(() =>
  import("./pages/ChangePasswordPage").then((module) => ({
    default: module.ChangePasswordPage,
  })),
);
const SubscriptionPage = lazy(() =>
  import("./pages/SubscriptionPage").then((module) => ({
    default: module.SubscriptionPage,
  })),
);
const DemoLeadsPage = lazy(() =>
  import("./pages/DemoLeadsPage").then((module) => ({
    default: module.DemoLeadsPage,
  })),
);
const AccountingPage = lazy(() =>
  import("./pages/AccountingPage").then((module) => ({
    default: module.AccountingPage,
  })),
);
const CustomersPage = lazy(() =>
  import("./pages/CustomersPage").then((module) => ({
    default: module.CustomersPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const DemoPage = lazy(() =>
  import("./pages/DemoPage").then((module) => ({ default: module.DemoPage })),
);
const ExpensesPage = lazy(() =>
  import("./pages/ExpensesPage").then((module) => ({
    default: module.ExpensesPage,
  })),
);
const InventoryPage = lazy(() =>
  import("./pages/InventoryPage").then((module) => ({
    default: module.InventoryPage,
  })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const OperationsPage = lazy(() =>
  import("./pages/OperationsPage").then((module) => ({
    default: module.OperationsPage,
  })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage").then((module) => ({
    default: module.ProductsPage,
  })),
);
const PurchasesPage = lazy(() =>
  import("./pages/PurchasesPage").then((module) => ({
    default: module.PurchasesPage,
  })),
);
const ReconciliationPage = lazy(() =>
  import("./pages/ReconciliationPage").then((module) => ({
    default: module.ReconciliationPage,
  })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((module) => ({
    default: module.ReportsPage,
  })),
);
const SalesPage = lazy(() =>
  import("./pages/SalesPage").then((module) => ({ default: module.SalesPage })),
);
const StaffPage = lazy(() =>
  import("./pages/StaffPage").then((module) => ({ default: module.StaffPage })),
);
const StationsPage = lazy(() =>
  import("./pages/StationsPage").then((module) => ({
    default: module.StationsPage,
  })),
);

function LoadingScreen({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="loading">
      <span />
      <p>{message}</p>
    </div>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen message="Preparing your petrol pump…" />;
  if (!user) return <Navigate to="/demo" replace />;
  return user.mustChangePassword ? <ChangePasswordPage /> : <AppShell />;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route element={<Protected />}>
          <Route index element={<DashboardPage />} />
          <Route path="stations" element={<StationsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="operations" element={<OperationsPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="reconciliation" element={<ReconciliationPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="accounting" element={<AccountingPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="demo-leads" element={<DemoLeadsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
