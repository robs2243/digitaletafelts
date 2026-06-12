/**
 * Wählt zur Hintergrundfarbe eine gut lesbare Textfarbe
 * (dunkel auf hellen, weiß auf dunklen Flächen) per Luminanz-Formel.
 */
export function ink(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 158 ? '#1a1a1a' : '#ffffff';
}
