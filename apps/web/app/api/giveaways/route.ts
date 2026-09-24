import { GiveawayContractABI, GiveawayContractAddress } from "@/lib/contracts/giveaway"
import { TOKENS } from "@/lib/mocks"
import { GIVEAWAY_QUERY, graphqlClient } from "@/lib/queries/client"
import { createPublicClient, formatUnits, getContract, hexToString, http, parseUnits } from "viem"
import { monadTestnet } from "viem/chains";

const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get("page") || "1"
  const limit = searchParams.get("limit") || "20"
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const data = await graphqlClient.request(GIVEAWAY_QUERY, {
    first: parseInt(limit),
    skip: skip,
  })

  const giveaways = data.giveawayCreateds.map(async (g: any) => {
    const token = TOKENS.find(({ address }) => address === g.token) || TOKENS[0]

    const contract = getContract({
      address: GiveawayContractAddress,
      abi: GiveawayContractABI,
      client: { public: publicClient },
    })
    const giveaway = await contract.read.giveaways([g.idParam])

    const game = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/games/giveaway/${g.idParam}`)
      .then((res) => res.json())
      .catch(() => null)

    const metadata = JSON.parse(hexToString(g.metadata))
    return {
      token,
      amount: formatUnits(g.amount, token.decimals),
      host: g.host,
      id: g.idParam,
      metadata,
      startTime: Number(giveaway[3]),
      transactionHash: g.transactionHash_,
      timestamp: g.timestamp_,
      idParam: g.idParam,
      game
    }
  })

  return Response.json(await Promise.all(giveaways))
}
