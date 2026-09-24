import { ALL_GIVEAWAY_FROM_HOST, GET_ALL_HOSTS, graphqlClient } from "@/lib/queries/client"
import { formatUnits, hexToString, zeroAddress } from "viem"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get("page") || "1"
  const limit = searchParams.get("limit") || "20"
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const data = await graphqlClient.request(GET_ALL_HOSTS, {
    first: parseInt(limit),
    skip: skip,
  })

  const host = (data.hostProfileUpdateds || []).map(async (h: any) => {
    const metadata = JSON.parse(hexToString(h.metadataURI))
    const giveawayData = await graphqlClient.request(ALL_GIVEAWAY_FROM_HOST, {
      host: h.host,
    })
    const giveaways = giveawayData.giveawayCreateds || []
    const totalPrize = giveaways.reduce((acc: number, g: any) => {
      return acc + Number(formatUnits(BigInt(g.amount), g.token === zeroAddress ? 18 : 6));
    }, 0)

    return {
      id: h.id,
      host: h.host,
      blockNumber: h.block_number,
      contractId: h.contractId_,
      timestamp: h.timestamp_,
      transactionHash: h.transactionHash_,
      ...metadata,
      totalPrize: totalPrize.toLocaleString() + " MON",
      totalGiveaways: giveaways.length,
    }
  })

  return Response.json(await Promise.all(host))
}
