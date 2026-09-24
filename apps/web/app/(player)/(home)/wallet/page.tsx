import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { UserWalletHeader } from "./(components)/wallet-header"
import { LogOut, Trophy } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function WalletPage() {
  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <h1 className="text-3xl font-black tracking-tighter">WALLET</h1>

      <div className="space-y-4">
        <UserWalletHeader />
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-black">TRANSACTION HISTORY</h3>
        <ScrollArea className="h-75 rounded-xl border bg-card p-4">
          {[
            {
              type: "WIN",
              amount: "+500 MON",
              game: "Speed Tap",
              date: "2h ago",
            },
            {
              type: "WITHDRAW",
              amount: "-200 MON",
              status: "Completed",
              date: "5h ago",
            },
            {
              type: "WIN",
              amount: "+250 MON",
              game: "Memory Matrix",
              date: "1d ago",
            },
            {
              type: "WIN",
              amount: "+500 MON",
              game: "Color Rush",
              date: "2d ago",
            },
          ].map((tx, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b py-3 last:border-0"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    tx.type === "WIN"
                      ? "bg-green-100 text-green-600"
                      : "bg-orange-100 text-orange-600"
                  }`}
                >
                  {tx.type === "WIN" ? (
                    <Trophy size={18} />
                  ) : (
                    <LogOut size={18} />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold">
                    {tx.type === "WIN" ? `Won ${tx.game}` : "Withdrawal"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{tx.date}</p>
                </div>
              </div>
              <p
                className={`font-black ${tx.type === "WIN" ? "text-green-600" : "text-orange-600"}`}
              >
                {tx.amount}
              </p>
            </div>
          ))}
        </ScrollArea>
      </section>
    </div>
  )
}
