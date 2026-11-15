import { useEffect } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { SignIn } from './components/SignIn';
import { SyncBar } from './components/SyncBar';
import { TabIcon } from './components/TabIcon';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useSession } from './data/hooks';
import { AdvisoryPage } from './pages/AdvisoryPage';
import { GeofencePage } from './pages/GeofencePage';
import { LiveHistoryPage } from './pages/LiveHistoryPage';
import { SentryPage } from './pages/SentryPage';
import { RecordDetailPage } from './pages/RecordDetailPage';
import { EditRecordPage, NewRecordPage } from './pages/RecordFormPages';
import { ExpenseDetailPage } from './pages/ExpenseDetailPage';
import { EditExpensePage, NewExpensePage } from './pages/ExpenseFormPages';
import { ExpensesPage } from './pages/ExpensesPage';
import { TyreEventDetailPage } from './pages/TyreEventDetailPage';
import { EditTyreEventPage, NewTyreEventPage } from './pages/TyreEventFormPages';
import { TyresPage } from './pages/TyresPage';
import { CompleteServicePage } from './pages/CompleteServicePage';
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
import { ThemePicker } from './components/ThemePicker';
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
      <a
        href="#main"
        className="absolute -left-[999px] z-50 rounded-lg bg-background p-2 text-foreground focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <UpdatePrompt />
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/82 px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 backdrop-blur-lg backdrop-saturate-180">
        <p className="m-0 flex items-center gap-2 font-semibold text-foreground">
          <Logo size={26} />
          <span>Zeekr Companion</span>
        </p>
        <div className="flex items-center gap-2">
          <ThemePicker />
          {session.signedIn ? <AccountMenu /> : null}
        </div>
      </header>
      <SyncBar />
      <main id="main" className="mx-auto max-w-2xl px-4 py-3">
        {!session.signedIn ? (
          // Signed out: only the sign-in form. No page, tab or saved data is shown (owner decision 2026-11-07).
          <SignIn
            reason={
              session.needsLogin
                ? 'Your session ended. Sign in to continue. Changes waiting to sync are safe on this device.'
                : 'Sign in to see your vehicle data.'
            }
          />
        ) : (
          <Routes>
            <Route path="/" element={<RecordsPage />} />
            <Route path="/records/new" element={<NewRecordPage />} />
            <Route path="/records/:id" element={<RecordDetailPage />} />
            <Route path="/records/:id/edit" element={<EditRecordPage />} />
            <Route path="/sentry" element={<SentryPage />} />
            <Route path="/geofence" element={<GeofencePage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/reminders/new" element={<NewReminderPage />} />
            <Route path="/reminders/template" element={<ReminderTemplatePage />} />
            <Route path="/reminders/:id" element={<ReminderDetailPage />} />
            <Route path="/reminders/:id/edit" element={<EditReminderPage />} />
            <Route path="/reminders/:id/complete" element={<CompleteServicePage />} />
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
            <Route path="/vehicle/tyres" element={<TyresPage />} />
            <Route path="/vehicle/tyres/new" element={<NewTyreEventPage />} />
            <Route path="/vehicle/tyres/:id" element={<TyreEventDetailPage />} />
            <Route path="/vehicle/tyres/:id/edit" element={<EditTyreEventPage />} />
            <Route path="*" element={<p className="my-4">Page not found.</p>} />
          </Routes>
        )}
      </main>
      {session.signedIn ? <TabBar /> : null}
    </>
  );
}

/** One tab: icon over a label, sized so all seven fit on a 320 px screen. The current tab is tinted. */
const TAB =
  'flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 pt-2 pb-2 text-center font-semibold text-[0.5rem] text-muted-foreground no-underline min-[22.5rem]:text-[0.56rem] min-[26rem]:text-[0.7rem] min-[30rem]:text-[0.85rem] sm:p-3.5 sm:text-base [&.active]:bg-accent [&.active]:text-foreground';

function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background/82 px-0.5 pt-0.5 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg backdrop-saturate-180"
      aria-label="Main"
    >
      <NavLink className={TAB} to="/" end>
        <TabIcon name="service" />
        <span>Service</span>
      </NavLink>
      <NavLink className={TAB} to="/reminders">
        <TabIcon name="reminders" />
        <span>Reminders</span>
      </NavLink>
      <NavLink className={TAB} to="/expenses">
        <TabIcon name="expenses" />
        <span>Expenses</span>
      </NavLink>
      <NavLink className={TAB} to="/warranty">
        <TabIcon name="warranty" />
        <span>Warranty</span>
      </NavLink>
      <NavLink className={TAB} to="/sentry">
        <TabIcon name="sentry" />
        <span>Sentry</span>
      </NavLink>
      <NavLink className={TAB} to="/geofence">
        <TabIcon name="geofence" />
        <span>Geofence</span>
      </NavLink>
      <NavLink className={TAB} to="/vehicle">
        <TabIcon name="vehicle" />
        <span>Vehicle</span>
      </NavLink>
    </nav>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
