import { serverUrl } from "@/lib/utils"

export const fetchPlayerByWallet = async (wallet: string) => {
  return fetch(`${serverUrl}/api/players/${wallet}`).then((res) => res.json())
}