import { LiveVehicleCard } from '../components/LiveVehicleCard';

export function EnergyPage() {
  return (
    <section aria-labelledby="energy-title">
      <h1 id="energy-title">Energy</h1>
      <LiveVehicleCard part="energy" />
    </section>
  );
}
