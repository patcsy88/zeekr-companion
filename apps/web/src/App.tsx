import { useEffect } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { SignIn } from './components/SignIn';
import { SyncBar } from './components/SyncBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useSession } from './data/hooks';
import { RecordDetailPage } from './pages/RecordDetailPage';
import { EditRecordPage, NewRecordPage } from './pages/RecordFormPages';
import { ReminderDetailPage } from './pages/ReminderDetailPage';
import { EditReminderPage, NewReminderPage } from './pages/ReminderFormPages';
import { ReminderTemplatePage } from './pages/ReminderTemplatePage';
import { RemindersPage } from './pages/RemindersPage';
import { RecordsPage } from './pages/RecordsPage';
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
          <Route path="/vehicle" element={<VehiclePage />} />
          <Route path="/vehicle/edit" element={<VehicleEditPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <nav className="tabs" aria-label="Main">
        <NavLink to="/" end>
          Service
        </NavLink>
        <NavLink to="/reminders">Reminders</NavLink>
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
