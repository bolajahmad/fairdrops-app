import { z } from "zod";
import { dice } from "./games/dice.js";
import { quiz, quizBankKind } from "./games/quiz.js";
import { createRoundsGame } from "./games/rounds.js";
import type { AnyHostedGame, ResourceKind } from "./types.js";

/** Games a round can play: every hosted game except rounds itself. */
const roundGames: readonly AnyHostedGame[] = [quiz, dice];

export const rounds = createRoundsGame((id, version) =>
  roundGames.find((game) => game.id === id && game.version === version),
);

/** Games FairDrops can run. A giveaway can only use one that also has an approved definition. */
export const hostedGames: readonly AnyHostedGame[] = [...roundGames, rounds];

export const resourceKinds: readonly ResourceKind<unknown>[] = [quizBankKind];

export function findHostedGame(id: string, version: string): AnyHostedGame | undefined {
  return hostedGames.find((game) => game.id === id && game.version === version);
}

export function findResourceKind(kind: string): ResourceKind<unknown> | undefined {
  return resourceKinds.find((k) => k.kind === kind);
}

/** The JSON Schema to register as the game definition's `configSchema`. */
export function configJsonSchema(game: AnyHostedGame): Record<string, unknown> {
  return z.toJSONSchema(game.config, { io: "input" });
}
