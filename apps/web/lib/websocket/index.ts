let socket: WebSocket | null = null

export function connectSocket(url: string) {
  if (socket && socket.readyState !== WebSocket.CLOSED) return socket

  socket = new WebSocket(url)

  socket.addEventListener("close", () => {
    socket = null
  })

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.close()
    socket = null
  }
}