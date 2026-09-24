import { RenderGamePage } from "./(components)/render-game"

export default async function GameByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: giveawayId } = await params
  return <RenderGamePage giveawayId={giveawayId} />
}
