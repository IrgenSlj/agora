export function formatNumber(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

/** @deprecated Use formatNumber instead */
export const formatStars = formatNumber;
/** @deprecated Use formatNumber instead */
export const formatInstalls = formatNumber;
