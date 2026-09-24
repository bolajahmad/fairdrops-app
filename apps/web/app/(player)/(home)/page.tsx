import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronRight, Clock, Gamepad2, Trophy, Zap } from "lucide-react"
import { DisplayHostLeaderboardSample, DisplayOngoingGames, DisplayUpcomingGames } from "./(components)/ongoing-games-section"

export default function HomePage() {
  return (
    <div className="space-y-8 pb-24 md:pb-8">
     {false &&  <section className="relative overflow-hidden rounded-3xl bg-primary px-6 py-12 text-primary-foreground">
        <div className="absolute top-0 right-0 -mt-20 -mr-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 max-w-2xl space-y-4">
          <Badge className="border-none bg-white/20 text-white">
            Featured Giveaway
          </Badge>
          <h1 className="text-4xl leading-none font-black tracking-tighter md:text-6xl">
            WIN 5,000 MON <br /> IN 10 MINUTES
          </h1>
          <p className="max-w-md text-primary-foreground/80">
            Join the Mega Monad Clash. No wallet needed to play. Just your
            skills and speed.
          </p>
          <div className="flex gap-3">
            <Button
              size="lg"
              variant="secondary"
              className="font-bold"
            >
              Enter Arena
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 bg-transparent hover:bg-white/10"
            >
              View Schedule
            </Button>
          </div>
        </div>
      </section>}

      <section className="space-y-4 mt-5">
       <DisplayOngoingGames />
      </section>

      <section className="space-y-4">
        <DisplayUpcomingGames />
      </section>

      <section>
        <DisplayHostLeaderboardSample />
      </section>
    </div>
  )
}
