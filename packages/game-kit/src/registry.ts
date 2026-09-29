import { z } from "zod";
import { dice } from "./games/dice.js";
import { quiz, quizBankKind } from "./games/quiz.js";
import type { AnyHostedGame, ResourceKind } from "./types.js";

/** Games FairDrops can run. A giveaway can only use one that also has an approved definition. */
export const hostedGames: readonly AnyHostedGame[] = [quiz, dice];

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
