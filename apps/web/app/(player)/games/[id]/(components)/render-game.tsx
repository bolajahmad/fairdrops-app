"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Description,
  DialogBackdrop,
} from "@headlessui/react"
import { GameStatus, IGiveaway, PlayerStatus } from "@/lib/models"
import { getSocket } from "@/lib/websocket"
import { useGameSocket } from "@/hooks/use-game-socket"
import { useGameStore } from "@/store/game-store"
import { useQuery } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { useCallback, useEffect, useRef, useState } from "react"
import { useConnection } from "wagmi"
import { useWeb3AuthUser } from "@web3auth/modal/react"
import { Progress } from "@/components/ui/progress"
import { sendAnswer } from "@/lib/websocket/send-action"
import { formatUnits } from "viem"
import { serverUrl } from "@/lib/utils"

type Props = {
  giveawayId: string
}

export const RenderGamePage = ({ giveawayId }: Props) => {
  const { address } = useConnection()
  const { userInfo } = useWeb3AuthUser()
  const displayName = userInfo?.name || userInfo?.email || undefined

  useGameSocket(giveawayId, address || "", displayName)

  const phase = useGameStore((s) => s.phase)

  const { data: giveaway } = useQuery<IGiveaway>({
    queryKey: ["game-by-id", giveawayId],
    queryFn: async () =>
      fetch(`/api/giveaways/${giveawayId}`).then((res) => res.json()),
    refetchInterval: 5000,
  })

  if (phase === "playing") {
    return <GameScreen giveaway={giveaway} />
  }

  if (phase === "ended") {
    return <GameEnded giveaway={giveaway} />
  }

  // lobby + cooldown + idle all show the lobby
  return <GameLobby gid={giveawayId} giveaway={giveaway} />
}

const GameScreen = ({ giveaway }: { giveaway?: IGiveaway }) => {
  const round = useGameStore((s) => s.round)
  const gameType = useGameStore((s) => s.gameType)
  const config = useGameStore((s) => s.config)
  const currentState = useGameStore((s) => s.currentState)
  const gameId = useGameStore((s) => s.gameId)

  // Fallback: fetch config via REST if WS didn't deliver it
  useEffect(() => {
    if (config || !gameId) return
    fetch(
      `${serverUrl}/api/games/${giveaway?.game?.id}/round-config`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.config) {
          useGameStore.getState().setGame({
            config: data.config,
            round: data.round ?? round,
            gameType: data.gameType ?? gameType,
          })
        }
      })
      .catch(() => {})
  }, [config, gameId, round, gameType, giveaway])

  return (
    <div className="fixed inset-0 z-60 flex flex-col items-center justify-center bg-background p-6 text-center">
      <div className="w-full max-w-md space-y-6">
        <Badge className="border-none bg-primary/20 px-4 py-1 text-lg text-primary">
          ROUND {round}
        </Badge>
        <h1 className="text-4xl font-black tracking-tighter">
          {gameType?.replace(/_/g, " ").toUpperCase()}
        </h1>
        <p className="text-muted-foreground">
          {giveaway?.metadata?.title} — Game in progress
        </p>

        <AnimatePresence mode="wait">
          {gameType === "quiz" && config?.questions && (
            <QuizRound
              key="quiz"
              questions={config.questions}
              timePerQuestion={config.timePerQuestion ?? 10}
              lastResult={
                currentState?.type === "ANSWER_RESULT" ? currentState : null
              }
            />
          )}
        </AnimatePresence>
        {/* Other game types will be added here */}
      </div>
    </div>
  )
}

type QuizQuestion = {
  index: number
  question: string
  options: string[]
}

type AnswerResult = {
  type: string
  questionIndex: number
  correct: boolean
  correctAnswer: number
  yourScore: number
}

const QuizRound = ({
  questions,
  timePerQuestion,
  lastResult,
}: {
  questions: QuizQuestion[]
  timePerQuestion: number
  lastResult: AnswerResult | null
}) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(timePerQuestion)
  const [answered, setAnswered] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [finished, setFinished] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answeredRef = useRef(false)

  const score = lastResult?.yourScore ?? 0

  const question = questions[currentIndex]
  const isLastQuestion = currentIndex >= questions.length - 1

  // Derive showFeedback: timed out, or answered + server responded
  const hasServerResult =
    answered && lastResult != null && lastResult.questionIndex === currentIndex
  const showFeedback = timedOut || hasServerResult

  // Advance to next question, or mark finished on last
  const goToNext = useCallback(() => {
    if (isLastQuestion) {
      setFinished(true)
      return
    }
    setCurrentIndex((i) => i + 1)
    setSelectedOption(null)
    setAnswered(false)
    setTimedOut(false)
    setTimeLeft(timePerQuestion)
    answeredRef.current = false
  }, [isLastQuestion, timePerQuestion])

  // When all questions done, transition back to lobby/cooldown
  useEffect(() => {
    if (!finished) return
    const store = useGameStore.getState()
    // Server will send COOLDOWN_START or GAME_END — set phase to cooldown
    // so the player sees the lobby while waiting for the round to end
    store.setGame({ phase: "cooldown", currentState: null })
  }, [finished])

  // Countdown timer — handles timeout directly in callback
  useEffect(() => {
    if (answered) return
    answeredRef.current = false

    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!)
          if (!answeredRef.current) {
            answeredRef.current = true
            // Use setTimeout(0) to batch state updates outside this callback
            setTimeout(() => {
              setAnswered(true)
              setTimedOut(true)
            }, 0)
          }
          return 0
        }
        return t - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [currentIndex, answered])

  // Auto-advance after feedback is shown
  useEffect(() => {
    if (!showFeedback) return

    advanceRef.current = setTimeout(goToNext, 1500)
    return () => {
      if (advanceRef.current) clearTimeout(advanceRef.current)
    }
  }, [showFeedback, goToNext])

  const handleSelect = (optionIndex: number) => {
    if (answered) return
    setSelectedOption(optionIndex)
    setAnswered(true)
    answeredRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    sendAnswer(currentIndex, optionIndex)
  }

  return (
    <motion.div
      key={currentIndex}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      className="space-y-6 text-center"
    >
      <div className="flex items-center justify-between text-xs font-bold text-muted-foreground uppercase">
        <span>
          Question {currentIndex + 1}/{questions.length}
        </span>
        <span>Score: {score}</span>
      </div>

      <div className="mb-8 text-2xl font-black tracking-tight">
        {question?.question}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {question?.options.map((opt: string, optIdx: number) => {
          return (
            <Button
              key={opt}
              onClick={() => handleSelect(optIdx)}
              disabled={answered}
              className={`h-16 rounded-2xl border-2 text-lg font-bold transition-all ${
                selectedOption === optIdx
                  ? "border-white bg-white text-purple-800"
                  : "border-white/20 bg-transparent text-primary hover:bg-white/10"
              }`}
            >
              {opt}
            </Button>
          )
        })}
      </div>

      <div className="mt-8">
        <Progress
          value={(timeLeft / timePerQuestion) * 100}
          className="h-2 bg-white/20"
        />
        <p className="mt-2 text-sm font-bold">
          {timeLeft > 0 ? `${timeLeft}s remaining` : "Time's up!"}
        </p>
      </div>
    </motion.div>
  )
}

const GameEnded = ({ giveaway }: { giveaway?: IGiveaway }) => {
  const finalWinners = useGameStore((s) => s.finalWinners)
  const roundResults = useGameStore((s) => s.roundResults)

  return (
    <div className="fixed inset-0 z-60 flex flex-col items-center justify-center bg-background p-6 text-center">
      <div className="w-full max-w-md space-y-6">
        <Badge className="border-none bg-green-500/20 px-4 py-1 text-lg text-green-400">
          GAME OVER
        </Badge>
        <h1 className="text-4xl font-black tracking-tighter">
          {giveaway?.metadata?.title}
        </h1>
        <p className="text-muted-foreground">
          {finalWinners.length} winner{finalWinners.length !== 1 ? "s" : ""}{" "}
          across {roundResults.length} round
          {roundResults.length !== 1 ? "s" : ""}
        </p>
        <div className="space-y-2 text-left">
          {finalWinners.map((w) => {
            const amount = formatUnits(BigInt(w.amount), 18)
            return (
            <div key={w.address} className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-2">
              <span className="font-mono text-sm">
              </span>
              <span className="font-semibold text-green-400">
                {amount} MON
              </span>
            </div>
          )})}
        </div>
      </div>
    </div>
  )
}

const GameLobby = ({
  gid,
  giveaway,
}: {
  gid: string
  giveaway?: IGiveaway
}) => {
  const phase = useGameStore((s) => s.phase)
  const cooldownEndsAt = useGameStore((s) => s.cooldownEndsAt)
  const nextGame = useGameStore((s) => s.nextGame)
  const onlineCount = useGameStore((s) => s.onlineCount)

  const [countdown, setCountdown] = useState<number | null>(null)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)

  console.log({ showLeaveDialog });
  // Cooldown countdown (between rounds)
  useEffect(() => {
    if (phase !== "cooldown" || !cooldownEndsAt) return

    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(cooldownEndsAt).getTime() - Date.now()) / 1000)
      )
      setCountdown(remaining)
    }, 200)

    return () => clearInterval(interval)
  }, [phase, cooldownEndsAt])

  // Lobby countdown — uses startTime for initial join, or cooldownEndsAt
  // when returning from a finished quiz round (phase set to cooldown locally)
  useEffect(() => {
    if (phase !== "lobby" && phase !== "idle" && phase !== "cooldown") return
    // Cooldown phase is handled by the effect above
    if (phase === "cooldown" && cooldownEndsAt) return
    if (!giveaway) return

    const startTime = giveaway.startTime
      ? new Date(
          typeof giveaway.startTime === "number"
            ? giveaway.startTime * 1000
            : giveaway.startTime
        ).getTime()
      : null

    const tick = () => {
      if (startTime && startTime > Date.now()) {
        setCountdown(Math.max(0, Math.ceil((startTime - Date.now()) / 1000)))
      } else {
        // Game already started or no startTime — just show 0
        setCountdown(0)
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [phase, giveaway, cooldownEndsAt])

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background p-6 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="space-y-2">
          <Badge className="border-none bg-primary/20 px-4 py-1 text-lg text-primary">
            {phase === "cooldown"
              ? `NEXT: ${nextGame?.replace(/_/g, " ").toUpperCase() ?? "..."}`
              : "LOBBY"}
          </Badge>
          <h1 className="text-4xl font-black tracking-tighter">
            {giveaway?.metadata?.title}
          </h1>
          <p className="text-muted-foreground">Hosted by {giveaway?.host}</p>
        </div>

        <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
          <svg
            viewBox="0 0 192 192"
            className="inset-0 h-full w-full -rotate-90"
          >
            <circle
              cx="96"
              cy="96"
              r="88"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-muted"
            />
            <motion.circle
              cx="96"
              cy="96"
              r="88"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeDasharray="553"
              animate={{
                strokeDashoffset:
                  countdown === null
                    ? 553
                    : phase === "cooldown"
                      ? 553 - (553 * Math.min(countdown, 15)) / 15
                      : 553 - (553 * Math.min(countdown, 60)) / 60,
              }}
              className="text-primary"
            />
          </svg>
          <span className="absolute text-5xl font-black">
            {countdown !== null ? `${countdown}s` : "..."}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="overflow-hidden rounded-2xl bg-muted p-4">
            <p className="text-[10px] font-bold uppercase opacity-50">
              Remaining Funds
            </p>
            <p className="text-xl font-black text-primary">
              {Number(
                Number(giveaway?.game?.totalRewards ?? 0) -
                  Number(giveaway?.game?.rewardsDisbursed ?? 0) ||
                  giveaway?.amount
              ).toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-[10px] font-bold uppercase opacity-50">
              Players
            </p>
            <p className="text-xl font-black">
              {onlineCount ||
                (giveaway?.game?.players?.filter(
                  ({ status }) => status === PlayerStatus.Online
                ).length ??
                  0)}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            {phase === "cooldown"
              ? "Next round starting soon..."
              : (giveaway?.game?.currentRound ?? 0) > 1
                ? "Waiting for next round to start..."
                : "Waiting for other players..."}
          </div>
          <Button
            variant="outline"
            className="text-muted-foreground"
            onClick={() => setShowLeaveDialog(true)}
          >
            Leave Arena
          </Button>

          <Dialog
            open={showLeaveDialog}
            onClose={() => setShowLeaveDialog(false)}
            className="relative z-50"
          >
            <DialogBackdrop
              className="fixed inset-0 bg-background/30"
              aria-hidden="true"
            />

            <div className="fixed inset-0 flex justify-center p-4">
              <DialogPanel className="max-w-lg space-y-4 rounded-2xl bg-background p-6">
                <DialogTitle className="text-lg font-bold">
                  Leave the arena?
                </DialogTitle>
                <Description className="text-sm text-muted-foreground">
                  You will be marked as offline and miss the next round. You can
                  rejoin later as long as the game is still active.
                </Description>
                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowLeaveDialog(false)}
                  >
                    Stay
                  </Button>
                  <Button
                    onClick={() => {
                      const ws = getSocket()
                      if (ws?.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "LEAVE_GAME" }))
                      }
                      setShowLeaveDialog(false)
                      window.history.back()
                    }}
                  >
                    Okay
                  </Button>
                </div>
              </DialogPanel>
            </div>
          </Dialog>
        </div>
      </motion.div>
    </div>
  )
}
