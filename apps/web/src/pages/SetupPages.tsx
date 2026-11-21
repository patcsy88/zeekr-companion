import { PushCard } from '../components/PushCard';
import { VehicleProfile } from './VehiclePage';

export function SetupPage() {
  return (
    <section aria-labelledby="setup-title">
      <h1 id="setup-title">Setup</h1>
      <VehicleProfile />
    </section>
  );
}

export function NotificationsPage() {
  return (
    <section aria-labelledby="notif-title">
      <h1 id="notif-title">Notifications</h1>
      <PushCard />
    </section>
  );
}
