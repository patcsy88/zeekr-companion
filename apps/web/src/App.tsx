import { useEffect } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { SignIn } from './components/SignIn';
import { SyncBar } from './components/SyncBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useSession } from './data/hooks';
import { AdvisoryPage } from './pages/AdvisoryPage';
import { LiveHistoryPage } from './pages/LiveHistoryPage';
import { RecordDetailPage } from './pages/RecordDetailPage';
import { EditRecordPage, NewRecordPage } from './pages/RecordFormPages';
import { ExpenseDetailPage } from './pages/ExpenseDetailPage';
import { EditExpensePage, NewExpensePage } from './pages/ExpenseFormPages';
import { ExpensesPage } from './pages/ExpensesPage';
import { ReminderDetailPage } from './pages/ReminderDetailPage';
import { EditReminderPage, NewReminderPage } from './pages/ReminderFormPages';
import { ReminderTemplatePage } from './pages/ReminderTemplatePage';
import { RemindersPage } from './pages/RemindersPage';
import { RecordsPage } from './pages/RecordsPage';
import { CoverageDetailPage } from './pages/CoverageDetailPage';
import {
  EditClaimPage,
  EditCoveragePage,
  NewClaimPage,
  NewCoveragePage,
} from './pages/WarrantyFormPages';
import { WarrantyPage } from './pages/WarrantyPage';
import { WarrantyTemplatePage } from './pages/WarrantyTemplatePage';
import { VehicleEditPage, VehiclePage } from './pages/VehiclePage';
import { AccountMenu } from './components/AccountMenu';
import { probeApi } from './api/health';
import { getSession } from './auth/session';
import { watchBrowserConnectivity } from './lib/connectivity';
import { startSyncTriggers, syncAll } from './sync/engine';

function Layout() {
  const session = useSession();
  useEffect(() => {
    const stopConn = watchBrowserConnectivity();
    const stopSync = startSyncTriggers();
    // Signed out there is no request that would reveal a dead server, so ask /health.
    if (!getSession().signedIn) void probeApi();
    void syncAll(); // app start: flushes if signed in, otherwise asks for the password if work waits
    return () => {
      stopConn();
      stopSync();
    };
  }, []);

  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <UpdatePrompt />
      <header className="top">
        <p className="brand">Zeekr Companion</p>
        {session.signedIn ? <AccountMenu /> : null}
      </header>
      <SyncBar />
      <main id="main">
        {!session.signedIn ? (
          <SignIn
            reason={
              session.needsLogin
                ? 'Your session ended. Sign in to continue syncing. Changes waiting to sync are safe on this device.'
                : 'Sign in to sync. Data saved on this device is shown below.'
            }
          />
        ) : null}
        <Routes>
          <Route path="/" element={<RecordsPage />} />
          <Route path="/records/new" element={<NewRecordPage />} />
          <Route path="/records/:id" element={<RecordDetailPage />} />
          <Route path="/records/:id/edit" element={<EditRecordPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/reminders/new" element={<NewReminderPage />} />
          <Route path="/reminders/template" element={<ReminderTemplatePage />} />
          <Route path="/reminders/:id" element={<ReminderDetailPage />} />
          <Route path="/reminders/:id/edit" element={<EditReminderPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/expenses/new" element={<NewExpensePage />} />
          <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="/expenses/:id/edit" element={<EditExpensePage />} />
          <Route path="/warranty" element={<WarrantyPage />} />
          <Route path="/warranty/new" element={<NewCoveragePage />} />
          <Route path="/warranty/template" element={<WarrantyTemplatePage />} />
          <Route path="/warranty/claims/:claimId/edit" element={<EditClaimPage />} />
          <Route path="/warranty/:id" element={<CoverageDetailPage />} />
          <Route path="/warranty/:id/edit" element={<EditCoveragePage />} />
          <Route path="/warranty/:id/claims/new" element={<NewClaimPage />} />
          <Route path="/advisory" element={<AdvisoryPage />} />
          <Route path="/vehicle" element={<VehiclePage />} />
          <Route path="/vehicle/live" element={<LiveHistoryPage />} />
          <Route path="/vehicle/edit" element={<VehicleEditPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <nav className="tabs" aria-label="Main">
        <NavLink to="/" end>
          Service
        </NavLink>
        <NavLink to="/reminders">Reminders</NavLink>
        <NavLink to="/expenses">Expenses</NavLink>
        <NavLink to="/warranty">Warranty</NavLink>
        <NavLink to="/advisory">Advisory</NavLink>
        <NavLink to="/vehicle">Vehicle</NavLink>
      </nav>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
