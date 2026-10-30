import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

export interface Listening {
  readonly origin: string
  readonly close: () => Promise<void>
}

export const listenLocally = async (server: Server): Promise<Listening> => {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
