import { healthResponseSchema, type HealthResponse } from "@fairdrops/shared";

const apiUrl = process.env.API_URL ?? "http://localhost:3001";

export async function fetchApiHealth(): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/health`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = healthResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
