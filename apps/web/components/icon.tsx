import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  CreditCard,
  Menu,
  Minus,
  Plus,
  Scale,
  Search,
  Send,
  Repeat,
  Shuffle,
  Sparkles,
  Trophy,
  Wallet,
  Check,
  CircleHelp,
  Clock,
  Dices,
  Gift,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Pointer,
  Puzzle,
  Share2,
  Shield,
  Sun,
  TriangleAlert,
  Users,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { IconName, IconProps } from "./types";

const ICONS: Record<IconName, LucideIcon> = {
  check: Check,
  clock: Clock,
  users: Users,
  gift: Gift,
  volume: Volume2,
  mute: VolumeX,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  arrow: ArrowRight,
  spinner: Loader2,
  alert: TriangleAlert,
  shield: Shield,
  lock: Lock,
  x: X,
  share: Share2,
  dice: Dices,
  quiz: CircleHelp,
  tap: Pointer,
  puzzle: Puzzle,
  back: ArrowLeft,
  menu: Menu,
  wallet: Wallet,
  card: CreditCard,
  send: Send,
  sparkles: Sparkles,
  scale: Scale,
  trophy: Trophy,
  repeat: Repeat,
  shuffle: Shuffle,
  chevron: ChevronDown,
  minus: Minus,
  plus: Plus,
  copy: Copy,
  search: Search,
};

export function Icon({ name, size = 20, spin = false, className }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      aria-hidden
      className={cn("shrink-0", spin && "motion-safe:animate-spin", className)}
    />
  );
}
