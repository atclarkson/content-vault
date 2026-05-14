export async function getHealth() {
  const response = await fetch('/api/health');

  if (!response.ok) {
    throw new Error('Failed to fetch health status');
  }

  return response.json();
}
