/**
 * Hearth temperature formatting. The wire unit is Celsius (what the
 * MAX6675 reports and the backend stores); the operator-facing UI renders
 * Fahrenheit. Single source of truth for the conversion so the dashboard,
 * chef widget, demo harness, and idle screen all agree.
 */

/** Convert a Celsius reading to Fahrenheit. */
export function celsiusToFahrenheit(tempC: number): number {
  return tempC * 9 / 5 + 32;
}

/**
 * Format a hearth reading as a rounded Fahrenheit label, e.g. "450°F".
 * Returns an em-dash placeholder when there is no reading.
 */
export function formatHearthTempF(tempC: number | null): string {
  return tempC === null ? "—" : `${Math.round(celsiusToFahrenheit(tempC))}°F`;
}
