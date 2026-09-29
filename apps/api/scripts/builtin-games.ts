/**
 * Prints the `POST /games` request body for every game FairDrops hosts, so the built-in games
 * are registered, submitted and approved through the API like any other game.
 *
 *   pnpm --filter @fairdrops/api games:builtin
 */
import { configJsonSchema, hostedGames } from "@fairdrops/game-kit";

const bodies = hostedGames.map((game) => ({
  id: game.id,
  version: game.version,
  mode: "HOSTED",
  name: game.name,
  description: game.description,
  configSchema: configJsonSchema(game),
}));
process.stdout.write(`${JSON.stringify(bodies, null, 2)}\n`);
