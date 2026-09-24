export interface IToken {
  name: string
  symbol: string
  address: `0x${string}`
  decimals: number
}

export type GameStyle = "quick" | "skill" | "luck"

export interface IMetadata {
  version: string
  title: string
  description: string
  gameStyle: GameStyle[]
  requireSocial: boolean
  customRules: string
}

export interface IGiveaway {
  token: IToken
  amount: string
  host: `0x${string}`
  id: string
  startTime: number
  metadata: IMetadata
  transactionHash: string
  timestamp: string
  idParam: string
  totalRegistered?: string
  game?: IGame
}

export interface IHost {
  id: string
  host: `0x${string}`
  avatar: string
  username: string
  twitter: string
  ig: string
  bio: string
  blockNumber: string
  contractId: `0x${string}`
  timestamp: string
  transactionHash: `0x${string}`
  totalPrize: string
  totalGiveaways: number
}

export enum GameStatus {
  Upcoming = "upcoming",
  Active = "active",
  Cooldown = "cooldown",
  Completed = "completed",
  Cancelled = "cancelled",
}

export interface IGame {
  id: string
  giveawayId: string
  hostAddress: `0x${string}`
  title: string
  description: string
  token: `0x${string}`
  totalRewards: string
  rewardsDisbursed: string
  numWinners: number
  status: GameStatus
  startTime: string
  endTime: string | null
  currentRound: number
  totalRoundsPlayed: number
  allowedGames: string[]
  currentGame: string
  nextGame: string
  cooldownEndsAt: string | null
  winners: `0x${string}`[]
  resultHash: string | null
  createdAt: string
  updatedAt: string
  players: IGamePlayer[]
}

export enum PlayerStatus {
  Online = "online",
  Offline = "offline",
}

export interface IGamePlayer {
  id: string
  playerId: string
  gameId: string
  status: PlayerStatus
  eliminated: boolean
  placement: number | null
  prize: string | null
  joinedAt: string
  player: {
    id: string
    walletAddress: `0x${string}`
    displayName: string
    createdAt: string
  }
}

export interface IPlayer {
    id: string,
    walletAddress: `0x${string}`,
    displayName: string,
    createdAt: string,
    games: IGame[]
}