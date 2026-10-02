import {
  rewardPlaces,
  rewardPolicyOf,
  type GameChoice,
  type GiveawayMetadata,
} from "@fairdrops/shared";
import { ROUNDS_GAME_ID, ROUNDS_GAME_VERSION, type RoundsConfig } from "./games/rounds.js";

/**
 * The game a giveaway's session runs, derived from its metadata alone. With rounds, that is the
 * rounds game over the host's rotation, with the paid places and minimum score taken from the
 * reward policy. The planner starts sessions with it and verifiers check transcripts against
 * it, so both always agree.
 */
export function sessionGameOf(metadata: GiveawayMetadata, maxWinners: number): GameChoice {
  if (metadata.v !== 2 || !metadata.rounds) return metadata.game;
  const policy = rewardPolicyOf(metadata, maxWinners);
  const { rounds } = metadata;
  const config: RoundsConfig = {
    games: [metadata.game, ...rounds.next],
    places: rewardPlaces(policy),
    winnersPerRound: rounds.winnersPerRound,
    playSeconds: rounds.playSeconds,
    cooldownSeconds: rounds.cooldownSeconds,
    maxWinsPerPlayer: rounds.maxWinsPerPlayer ?? null,
    minScore: policy.minScore,
  };
  return { id: ROUNDS_GAME_ID, version: ROUNDS_GAME_VERSION, config };
}
