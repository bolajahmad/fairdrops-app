import {
  GiveawayContractABI,
  GiveawayContractAddress,
} from "@/lib/contracts/giveaway"
import { TOKENS } from "@/lib/mocks"
import { GET_GIVEAWAY_BY_ID, graphqlClient } from "@/lib/queries/client"
import { monadTestnet } from "@/lib/wallet/wagmi"
import {
  createPublicClient,
  formatUnits,
  getContract,
  hexToString,
  http,
} from "viem"

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gid: string }> }
) {
  const { gid } = await params
  const data = await graphqlClient.request(GET_GIVEAWAY_BY_ID, {
    id: gid,
  })

  const g = data.giveawayCreateds?.[0]

  if (!g) {
    return Response.json(undefined)
  }

  const token = TOKENS.find(({ address }) => address === g.token) || TOKENS[0]

  const contract = getContract({
    address: GiveawayContractAddress,
    abi: GiveawayContractABI,
    client: { public: publicClient },
  })
  const giveaway = await contract.read.giveaways([g.idParam])

  const game = await fetch(
    `${process.env.NEXT_PUBLIC_SERVER_URL}/api/games/giveaway/${g.idParam}`
  )
    .then((res) => res.json())
    .catch(() => null)

  const metadata = JSON.parse(hexToString(g.metadata))

  return Response.json({
    token,
    amount: formatUnits(g.amount, token.decimals),
    host: g.host,
    id: g.idParam,
    metadata,
    startTime: Number(giveaway[3]),
    transactionHash: g.transactionHash_,
    timestamp: g.timestamp_,
    idParam: g.idParam,
    game,
  })
}
