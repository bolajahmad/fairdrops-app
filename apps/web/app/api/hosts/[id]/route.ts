import { GET_HOST_BY_ID, graphqlClient } from "@/lib/queries/client"
import { hexToString } from "viem"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params // The host's address

  const data = await graphqlClient.request(GET_HOST_BY_ID, {
    id: id.toLowerCase(),
  })

  const host = (data.hostProfileUpdateds || []).map((h: any) => {
    const metadata = JSON.parse(hexToString(h.metadataURI))
    return {
      id: h.id,
      host: h.host,
      blockNumber: h.block_number,
      contractId: h.contractId_,
      timestamp: h.timestamp_,
      transactionHash: h.transactionHash_,
      ...metadata
    }
  })[0]

  return Response.json(host)
}
