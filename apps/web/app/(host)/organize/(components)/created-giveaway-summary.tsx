import { Badge } from "@/components/ui/badge"
import { GiveawayFormValues } from "@/lib/schemas/giveaway"
import { motion } from "framer-motion"
import { Clock, Shuffle, Zap } from "lucide-react"
import { Control, useWatch } from "react-hook-form"
import { GAME_STYLES } from "./organize-giveaway-form"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { useConnection } from "wagmi"

dayjs.extend(relativeTime)

type Props = {
  control: Control<GiveawayFormValues>
  isMobile?: boolean
}

export const SummaryCard = ({ control, isMobile = false }: Props) => {
  const values = useWatch({
    control,
    name: ["title", "prizePool", "numWinners", "gameStyle", "startTime"],
  })
  const [title, prizePool, numWinners, gameStyle, startTime] = values

  return (
    <motion.div
      layout
      className={`group relative overflow-hidden rounded-[2.5rem] bg-primary p-8 text-primary-foreground shadow-2xl shadow-primary/20 ${isMobile ? "w-full" : ""}`}
    >
      {/* Animated Background Elements */}
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full opacity-20">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-white blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.5, 1],
            x: [0, 50, 0],
          }}
          transition={{ duration: 15, repeat: Infinity }}
          className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-white blur-3xl"
        />
      </div>

      <div className="relative z-10 space-y-8">
        <div className="flex items-start justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-md">
            <Zap size={24} fill="currentColor" />
          </div>
          <Badge className="border-none bg-white/20 font-black text-white backdrop-blur-md">
            {isMobile ? "GIVEAWAY SUMMARY" : "LIVE PREVIEW"}
          </Badge>
        </div>

        <div className="space-y-1">
          <h2 className="text-3xl font-black tracking-tighter italic">
            {title || "N/A"}
          </h2>
          <p className="font-bold text-white/70">Hosted by You</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-md">
            <p className="mb-1 text-[10px] font-black uppercase opacity-60">
              Total Prize
            </p>
            <p className="text-2xl font-black">
              {prizePool.toLocaleString()} USDT
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-md">
            <p className="mb-1 text-[10px] font-black uppercase opacity-60">
              Winners
            </p>
            <p className="text-2xl font-black">{numWinners}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 pt-4">
          <div className="flex items-center gap-2">
            {gameStyle.length ? (
              gameStyle.map(() => {
                const style = GAME_STYLES.find((s) => s.id === gameStyle[0])
                const Icon = style?.icon

                return (
                  <div key={style?.id}>
                    {Icon ? <Icon size={16} /> : null}
                    <span className="text-xs font-black tracking-wider uppercase">
                      {GAME_STYLES.find((s) => s.id === gameStyle[0])?.name}{" "}
                      Mode
                    </span>
                  </div>
                )
              })
            ) : (
              <div>
                <Shuffle size={16} />
                <span className="text-xs font-black tracking-wider uppercase">
                  Random Mode
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Clock size={16} />
            <span className="text-xs font-black tracking-wider uppercase">
              ~
              {dayjs(startTime).isAfter(dayjs())
                ? dayjs().add(1, "minute").fromNow()
                : dayjs(startTime).fromNow()}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
