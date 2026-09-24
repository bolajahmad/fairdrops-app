"use client"

import { useEffect } from "react"
import { connectSocket, disconnectSocket } from "@/lib/websocket"
import { useGameStore } from "@/store/game-store"

export function useGameSocket(giveawayId: string, walletAddress: string, displayName?: string) {
  useEffect(() => {
    if (!walletAddress) return

    const serverUrl = process.env.NEXT_PUBLIC_WS_URL
      || process.env.NEXT_PUBLIC_SERVER_URL?.replace(/^http/, "ws")
      || "ws://localhost:3001"
    const ws = connectSocket(serverUrl)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "JOIN_GAME",
        giveawayId,
        walletAddress,
        displayName,
      }))
    }

    // If already open (reconnect case), send join immediately
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "JOIN_GAME",
        giveawayId,
        walletAddress,
        displayName,
      }))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      const store = useGameStore.getState()

      switch (msg.type) {
        case "JOINED_GAME":
          store.setGame({
            gameId: msg.gameId,
            giveawayId: msg.giveawayId,
            status: msg.status,
            round: msg.currentRound,
            gameType: msg.currentGame,
            nextGame: msg.nextGame,
            cooldownEndsAt: msg.cooldownEndsAt,
            onlineCount: msg.onlineCount,
            config: msg.config ?? null,
            // Derive phase from server status
            phase: msg.status === "active" ? "playing"
              : msg.status === "cooldown" ? "cooldown"
              : msg.status === "completed" ? "ended"
              : "lobby",
          })
          break

        case "GAME_STARTED":
          store.setGame({
            status: "active",
            phase: "lobby", // will switch to "playing" on ROUND_START
          })
          break

        case "ROUND_START":
          store.setGame({
            phase: "playing",
            status: "active",
            round: msg.round,
            gameType: msg.gameType,
            config: msg.config,
            cooldownEndsAt: null,
            currentState: null, // reset for new round
          })
          break

        case "ROUND_END":
          store.addRoundResult({
            round: msg.round,
            gameType: msg.gameType,
            winners: msg.winners,
            prizePerWinner: msg.prizePerWinner,
          })
          break

        case "COOLDOWN_START":
          store.setGame({
            phase: "cooldown",
            status: "cooldown",
            cooldownEndsAt: msg.cooldownEndsAt,
            nextGame: msg.nextGame,
          })
          break

        // Game-specific results — store in currentState
        case "DICE_RESULT":
        case "TAP_RESULT":
        case "TAP_COUNT":
        case "ANSWER_RESULT":
        case "GO_SIGNAL":
          store.updateState(msg)
          break

        case "STATE_UPDATE":
          store.updateState(msg.state)
          break

        case "PLAYER_JOINED":
          store.setOnlineCount(msg.onlineCount)
          break

        case "PLAYER_LEFT":
          store.setOnlineCount(msg.onlineCount)
          break

        case "PLAYER_ELIMINATED":
          store.eliminatePlayer(msg.playerId)
          break

        case "GAME_END":
          store.setGame({
            phase: "ended",
            status: "completed",
            finalWinners: msg.winners,
          })
          break
      }
    }

    return () => {
      disconnectSocket()
    }
  }, [giveawayId, walletAddress, displayName])
}