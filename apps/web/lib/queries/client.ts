import { gql, GraphQLClient } from "graphql-request"

const URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_PUBLIC_URL || "http://localhost:4350/graphql"

export const graphqlClient = new GraphQLClient(URL, {
  headers: {
    "Content-Type": "application/json",
  },
})

export const ONGOING_GIVEAWAYS = gql`
  query GetOngoing($now: BigInt!, $first: Int!, $skip: Int!) {
    giveawayCreateds(
      first: $first
      skip: $skip
      where: { endTime_gt: $now }
      orderBy: endTime_
      orderDirection: asc
    ) {
      amount
      host
      id
      metadata
      transactionHash_
      timestamp_
      idParam
    }
  }
`

export const GIVEAWAY_QUERY = gql`
  query MyQuery($first: Int!, $skip: Int!) {
    giveawayCreateds(first: $first, skip: $skip) {
      amount
      host
      id
      metadata
      transactionHash_
      timestamp_
      idParam
    }
  }
`

export const GET_GIVEAWAY_BY_ID = gql`
  query GetGiveawayById($id: String!) {
    giveawayCreateds(where: { idParam: $id }) {
      amount
      host
      id
      metadata
      transactionHash_
      timestamp_
      idParam
      token
    }
  }
`

export const ALL_GIVEAWAY_FROM_HOST = gql`
  query GetGiveawaysByHost($host: String!) {
    giveawayCreateds(
      where: { host: $host }
    ) {
      amount
      token
      host
      id
      idParam
    }
  }
`

export const GET_HOST_BY_ID = gql`
  query GetHostByWallet($id: String!) {
    hostProfileUpdateds(where: { host: $id }, first: 1) {
      id
      host
      metadataURI
      block_number
      contractId_
      timestamp_
      transactionHash_
    }
  }
`

export const GET_ALL_HOSTS = gql`
  query GetAllHosts($first: Int = 10, $skip: Int = 0) {
    hostProfileUpdateds(
      first: $first
      skip: $skip
    ) {
      host
      id
      transactionHash_
      timestamp_
      metadataURI
      contractId_
      block_number
    }
  }
`
