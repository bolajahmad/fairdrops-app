import { getSocket } from "."

export function sendAction(action: string, payload?: any) {
  const ws = getSocket()
  if (!ws) return

  ws.send(JSON.stringify({
    type: "PLAYER_ACTION",
    action,
    payload
  }))
}

export function sendRollDice() {
  const ws = getSocket()
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: "ROLL_DICE" }))
}

export function sendTap() {
  const ws = getSocket()
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: "TAP", payload: { timestamp: Date.now() } }))
}

export function sendAnswer(questionIndex: number, answer: number) {
  const ws = getSocket()
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: "ANSWER", payload: { questionIndex, answer } }))
}