import { LiveVehicleCard } from '../components/LiveVehicleCard';

export function DrivingPage() {
  return (
    <section aria-labelledby="driving-title">
      <h1 id="driving-title">Driving</h1>
      <LiveVehicleCard part="driving" />
    </section>
  );
}
