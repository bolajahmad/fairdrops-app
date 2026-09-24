import { connection } from "next/server";
import { fetchApiHealth } from "@/lib/api";

export default async function HomePage() {
  await connection();
  const health = await fetchApiHealth();

  return (
    <main>
      <h1>FairDrops</h1>
      <p>API status: {health ? `${health.status} (version ${health.version})` : "unreachable"}</p>
    </main>
  );
}
