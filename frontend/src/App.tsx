import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/auth/auth-context'
import { SilverRateProvider } from '@/lib/silver-rate-context'
import { AppShell } from '@/components/layout/app-shell'
import { RequireAuth, RequireModule } from '@/components/RequirePermission'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { EmptyState } from '@/components/ui/empty-state'
import { FileQuestion } from 'lucide-react'
import LoginPage from '@/pages/Login'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const OwnerInsightsPage = lazy(() => import('@/pages/OwnerInsights'))
const SilverRatePage = lazy(() => import('@/pages/SilverRate'))
const SalesInvoicesPage = lazy(() => import('@/pages/SalesInvoices'))
const InvoiceDetailPage = lazy(() => import('@/pages/InvoiceDetail'))
const SalesOrdersPage = lazy(() => import('@/pages/SalesOrders'))
const OrderBoardPage = lazy(() => import('@/pages/OrderBoard'))
const DispatchPage = lazy(() => import('@/pages/Dispatch'))
const BookingsPage = lazy(() => import('@/pages/Bookings'))
const CustomersPage = lazy(() => import('@/pages/Customers'))
const ReturnsPage = lazy(() => import('@/pages/Returns'))
const PurchaseOrdersPage = lazy(() => import('@/pages/PurchaseOrders'))
const PurchaseInvoicesPage = lazy(() => import('@/pages/PurchaseInvoices'))
const SuppliersPage = lazy(() => import('@/pages/Suppliers'))
const PurchaseReturnsPage = lazy(() => import('@/pages/PurchaseReturns'))
const ProductsPage = lazy(() => import('@/pages/Products'))
const ProductDetailPage = lazy(() => import('@/pages/ProductDetail'))
const StockOverviewPage = lazy(() => import('@/pages/StockOverview'))
const StockTransfersPage = lazy(() => import('@/pages/StockTransfers'))
const BarcodeLabelsPage = lazy(() => import('@/pages/BarcodeLabels'))
const LowStockAlertPage = lazy(() => import('@/pages/LowStockAlert'))
const StockRunningPage = lazy(() => import('@/pages/StockRunning'))
const ShopifyDashboardPage = lazy(() => import('@/pages/ShopifyDashboard'))
const ShopifyOrdersPage = lazy(() => import('@/pages/ShopifyOrders'))
const ShopifyProductsPage = lazy(() => import('@/pages/ShopifyProducts'))
const SyncComparePage = lazy(() => import('@/pages/SyncCompare'))
const ShopifyInventoryPage = lazy(() => import('@/pages/ShopifyInventory'))
const ShopifyCustomersPage = lazy(() => import('@/pages/ShopifyCustomers'))
const ShopifyPricePage = lazy(() => import('@/pages/ShopifyPrice'))
const ShopifySyncLogsPage = lazy(() => import('@/pages/ShopifySyncLogs'))
const ShopifyDataImportPage = lazy(() => import('@/pages/ShopifyDataImport'))
const ExpensesPage = lazy(() => import('@/pages/Expenses'))
const PaymentsPage = lazy(() => import('@/pages/Payments'))
const BankAccountsPage = lazy(() => import('@/pages/BankAccounts'))
const LedgerPage = lazy(() => import('@/pages/Ledger'))
const BusinessReportsPage = lazy(() => import('@/pages/BusinessReports'))
const GstReportsPage = lazy(() => import('@/pages/GstReports'))
const SalesAnalysisPage = lazy(() => import('@/pages/SalesAnalysis'))
const InventoryReportsPage = lazy(() => import('@/pages/InventoryReports'))
const DuesPage = lazy(() => import('@/pages/Dues'))
const NotificationSettingsPage = lazy(() => import('@/pages/NotificationSettings'))
const NotificationLogPage = lazy(() => import('@/pages/NotificationLog'))
const SupplierDuesPage = lazy(() => import('@/pages/SupplierDues'))
const UsersPage = lazy(() => import('@/pages/Users'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const BackupRestorePage = lazy(() => import('@/pages/BackupRestore'))
const AuditLogsPage = lazy(() => import('@/pages/AuditLogs'))
const ActivityLogsPage = lazy(() => import('@/pages/ActivityLogs'))

function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 lg:px-6">
      <div className="rounded-lg border bg-card shadow-card">
        <EmptyState
          icon={FileQuestion}
          title="Page not found"
          description="The page you are looking for does not exist or has been moved."
        />
      </div>
    </div>
  )
}

function guarded(module: string, element: React.ReactNode) {
  return (
    <RequireModule module={module}>
      {element}
    </RequireModule>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SilverRateProvider>
          <ErrorBoundary>
            <Suspense fallback={<div className="flex h-full min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
            <Route path="/" element={guarded('dashboard', <DashboardPage />)} />
            <Route path="/owner-insights" element={guarded('dashboard', <OwnerInsightsPage />)} />
            <Route path="/silver-rate" element={guarded('silver-rate', <SilverRatePage />)} />

            <Route path="/sales/invoices" element={guarded('sales', <SalesInvoicesPage />)} />
            <Route path="/sales/invoices/:id" element={guarded('sales', <InvoiceDetailPage />)} />
            <Route path="/sales/orders" element={guarded('sales', <SalesOrdersPage />)} />
            <Route path="/sales/pipeline" element={guarded('sales', <OrderBoardPage />)} />
            <Route path="/sales/dispatch" element={guarded('sales', <DispatchPage />)} />
            <Route path="/sales/customers" element={guarded('sales', <CustomersPage />)} />
            <Route path="/sales/returns" element={guarded('sales', <ReturnsPage />)} />
            <Route path="/sales/bookings" element={guarded('sales', <BookingsPage />)} />

            <Route path="/purchase/orders" element={guarded('purchase', <PurchaseOrdersPage />)} />
            <Route path="/purchase/invoices" element={guarded('purchase', <PurchaseInvoicesPage />)} />
            <Route path="/purchase/suppliers" element={guarded('purchase', <SuppliersPage />)} />
            <Route path="/purchase/returns" element={guarded('purchase', <PurchaseReturnsPage />)} />

            <Route path="/inventory/products" element={guarded('inventory', <ProductsPage />)} />
            <Route path="/inventory/products/:id" element={guarded('inventory', <ProductDetailPage />)} />
            <Route path="/inventory/stock" element={guarded('inventory', <StockOverviewPage />)} />
            <Route path="/inventory/transfers" element={guarded('inventory', <StockTransfersPage />)} />
            <Route path="/inventory/barcode" element={guarded('inventory', <BarcodeLabelsPage />)} />
            <Route path="/inventory/low-stock" element={guarded('inventory', <LowStockAlertPage />)} />
            <Route path="/inventory/stock-running" element={guarded('inventory', <StockRunningPage />)} />

            <Route path="/accounts/expenses" element={guarded('accounts', <ExpensesPage />)} />
            <Route path="/accounts/payments" element={guarded('accounts', <PaymentsPage />)} />
            <Route path="/accounts/bank" element={guarded('accounts', <BankAccountsPage />)} />
            <Route path="/accounts/ledger" element={guarded('accounts', <LedgerPage />)} />

            <Route path="/reports/business" element={guarded('reports', <BusinessReportsPage />)} />
            <Route path="/reports/gst" element={guarded('reports', <GstReportsPage />)} />
            <Route path="/reports/sales" element={guarded('reports', <SalesAnalysisPage />)} />
            <Route path="/reports/inventory" element={guarded('reports', <InventoryReportsPage />)} />
            <Route path="/reports/dues" element={guarded('sales', <DuesPage />)} />
            <Route path="/reports/supplier-dues" element={guarded('purchase', <SupplierDuesPage />)} />

            <Route path="/shopify/dashboard" element={guarded('shopify', <ShopifyDashboardPage />)} />
            <Route path="/shopify/orders" element={guarded('shopify', <ShopifyOrdersPage />)} />
            <Route path="/shopify/products" element={guarded('shopify', <ShopifyProductsPage />)} />
            <Route path="/shopify/compare" element={guarded('shopify', <SyncComparePage />)} />
            <Route path="/shopify/inventory" element={guarded('shopify', <ShopifyInventoryPage />)} />
            <Route path="/shopify/customers" element={guarded('shopify', <ShopifyCustomersPage />)} />
            <Route path="/shopify/price" element={guarded('shopify', <ShopifyPricePage />)} />
            <Route path="/shopify/logs" element={guarded('shopify', <ShopifySyncLogsPage />)} />
            <Route path="/shopify/data-import" element={guarded('shopify', <ShopifyDataImportPage />)} />

            <Route path="/system/users" element={guarded('system', <UsersPage />)} />
            <Route path="/system/backup" element={guarded('system', <BackupRestorePage />)} />
            <Route path="/system/settings" element={guarded('system', <SettingsPage />)} />
            <Route path="/system/notifications" element={guarded('system', <NotificationSettingsPage />)} />
            <Route path="/system/notification-log" element={guarded('system', <NotificationLogPage />)} />
            <Route path="/system/audit" element={guarded('system', <AuditLogsPage />)} />
            <Route path="/system/activity" element={guarded('system', <ActivityLogsPage />)} />

            <Route path="*" element={<NotFound />} />
          </Route>
          </Routes>
            </Suspense>
          </ErrorBoundary>
        </SilverRateProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
