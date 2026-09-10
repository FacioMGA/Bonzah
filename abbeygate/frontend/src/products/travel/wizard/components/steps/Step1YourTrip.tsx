import { Step1Eligibility } from './Step1Eligibility';
import { Step2Travellers } from './Step2Travellers';

/**
 * ABY-519 — combine eligibility + traveller questions on the first wizard
 * page to match the legacy abbeygatetravel.com "Your Trip" journey.
 * ADR-0025 objective-expat inputs stay intact; only the surface layout
 * changes so customers see both sections before advancing.
 */
export function Step1YourTrip() {
  return (
    <div className="space-y-2">
      <Step1Eligibility />
      <Step2Travellers />
    </div>
  );
}
