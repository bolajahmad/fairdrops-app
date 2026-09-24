"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useWeb3AuthUser } from "@web3auth/modal/react";
import { Coins, Trophy, User, Zap } from "lucide-react";

export default function PlayerProfilePage() {
    const { userInfo } = useWeb3AuthUser()
  return (
    <div key="profile" className="space-y-8">
      <div className="flex flex-col items-center space-y-4 text-center">
        <Avatar className="h-32 w-32 border-4 border-primary shadow-2xl">
          <AvatarImage src={userInfo?.profileImage} />
          <AvatarFallback className="text-4xl font-black">U</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-3xl font-black tracking-tighter">
            {userInfo?.name || "Guest Player"}
          </h2>
          <p className="text-muted-foreground">Level 12 • Pro Player</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="font-bold">
            24 Wins
          </Badge>
          <Badge variant="secondary" className="font-bold">
            1.2k MON Won
          </Badge>
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="text-lg font-black">ACHIEVEMENTS</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { name: "First Win", icon: Trophy, color: "text-yellow-500" },
            { name: "High Roller", icon: Coins, color: "text-primary" },
            { name: "Speed Demon", icon: Zap, color: "text-orange-500" },
            { name: "Social Star", icon: User, color: "text-blue-500" },
          ].map((ach) => (
            <Card key={ach.name} className="flex items-center gap-3 p-4">
              <ach.icon className={ach.color} size={24} />
              <span className="text-sm font-bold">{ach.name}</span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
