import { connection } from "next/server";
import { Discover } from "@/components/discover";
import { serverFairDrops } from "@/lib/fairdrops";

export default async function HomePage() {
  await connection();
  let items: Awaited<ReturnType<ReturnType<typeof serverFairDrops>["giveaways"]["list"]>>["items"] =
    [];
  let error = false;
  try {
    items = (await serverFairDrops().giveaways.list({ status: "ACTIVE", limit: 24 })).items;
  } catch {
    error = true;
  }
  return <Discover items={items} error={error} />;
}
