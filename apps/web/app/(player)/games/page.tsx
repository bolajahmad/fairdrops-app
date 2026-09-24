import { AppLayout } from "@/components/layout/root-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { IGiveaway, PlayerStatus } from "@/lib/models"
import { baseUrl, truncateString } from "@/lib/utils"
import { motion } from "framer-motion"
import { ChevronRight, Gamepad2 } from "lucide-react"

export default async function AllGamesPage() {
  const data = await fetch(`${baseUrl}/api/giveaways?page=1&limit=20`).then(
    (res) => res.json()
  )
  const giveaways = (data || []) as IGiveaway[]

  return (
    <AppLayout>
      <div key="games" className="space-y-6">
        <h1 className="text-3xl font-black tracking-tighter">ALL GAMES</h1>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {giveaways.map(({ id, ...g }, i) => (
            <Card
              key={id}
              className="group cursor-pointer overflow-hidden transition-all hover:border-primary/50 active:scale-[0.98]"
            >
              <div className="relative flex h-32 items-center justify-center bg-muted">
                <div className="absolute inset-0 bg-linear-to-br from-primary/20 to-secondary/20 transition-opacity group-hover:opacity-100" />
                <Gamepad2
                  size={48}
                  className="text-primary/40 transition-transform group-hover:scale-110"
                />
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="bg-background/80 backdrop-blur-sm"
                  >
                    {g.game?.players?.filter(
                      ({ status }) => status === PlayerStatus.Online
                    ).length || 0}{" "}
                    playing
                  </Badge>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <h3 className="text-lg leading-tight font-bold">
                      {g.metadata.title}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      by {truncateString(g.host)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-primary">
                      {Number(g.amount).toLocaleString()} {g.token.symbol}
                    </p>
                    <p className="text-[10px] font-bold tracking-widest uppercase opacity-50">
                      Prize Pool
                    </p>
                  </div>
                </div>
                <Button
                  // onClick={() => joinGame(g.idParam, g.game?.id ?? "")}
                  className="mt-2 w-full transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                >
                  {/* {loading || isPending ? <Spinner /> : null} */}
                  Join Now {/* {loading || isPending ? null : ( */}
                  <ChevronRight size={16} className="ml-1" />
                  {/* )} */}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
