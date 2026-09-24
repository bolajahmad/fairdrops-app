import { create } from "zustand"

type Player = {
  id: string
  name: string
  eliminated: boolean
}

type RoundResult = {
  round: number
  gameType: string
  winners: string[]
  prizePerWinner: string
}

type WinnerPayout = {
  address: string
  amount: string
}

type GamePhase = "idle" | "lobby" | "playing" | "cooldown" | "ended"

type GameState = {
  gameId: string | null
  giveawayId: string | null
  phase: GamePhase
  status: string | null // raw server status: upcoming/active/cooldown/completed
  round: number
  gameType: string | null
  nextGame: string | null
  config: any
  cooldownEndsAt: string | null

  players: Record<string, Player>
  onlineCount: number
  currentState: any
  roundResults: RoundResult[]
  finalWinners: WinnerPayout[]

  // actions
  setGame: (data: Partial<GameState>) => void
  updateState: (state: any) => void
  addPlayer: (player: Player) => void
  eliminatePlayer: (id: string) => void
  setOnlineCount: (count: number) => void
  addRoundResult: (result: RoundResult) => void
  reset: () => void
}

export const useGameStore = create<GameState>((set) => ({
  gameId: null,
  giveawayId: null,
  phase: "idle",
  status: null,
  round: 0,
  gameType: null,
  nextGame: null,
  config: null,
  cooldownEndsAt: null,

  players: {},
  onlineCount: 0,
  currentState: null,
  roundResults: [],
  finalWinners: [],

  setGame: (data) =>
    set((state) => ({
      ...state,
      ...data
    })),

  updateState: (currentState) =>
    set(() => ({
      currentState
    })),

  addPlayer: (player) =>
    set((state) => ({
      players: {
        ...state.players,
        [player.id]: player
      }
    })),

  eliminatePlayer: (id) =>
    set((state) => ({
      players: {
        ...state.players,
        [id]: {
          ...state.players[id],
          eliminated: true
        }
      }
    })),

  setOnlineCount: (onlineCount) =>
    set(() => ({ onlineCount })),

  addRoundResult: (result) =>
    set((state) => ({
      roundResults: [...state.roundResults, result]
    })),

  reset: () =>
    set({
      gameId: null,
      giveawayId: null,
      phase: "idle",
      status: null,
      round: 0,
      gameType: null,
      nextGame: null,
      config: null,
      cooldownEndsAt: null,
      players: {},
      onlineCount: 0,
      currentState: null,
      roundResults: [],
      finalWinners: [],
    })
}))