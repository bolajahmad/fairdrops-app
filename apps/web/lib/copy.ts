/** English UI copy. Later locales replace this module; do not scatter strings through components. */
export const copy = {
  join: "Join giveaway",
  joinNow: "Join now",
  playNow: "Play now",
  toLobby: "Go to the lobby",
  youreIn: "You're in. We'll start right on time.",
  joiningClosed: "Joining closed",
  youAreIn: "You're in",
  goToLobby: "Go to lobby",
  freeToJoin: "Free to join. No crypto needed.",
  continueGoogle: "Continue with Google",
  continueEmail: "Continue with email",
  haveWallet: "I already have a wallet",
  providerLater: "Google and email sign-in need a wallet provider that is not set up yet.",
  walletCreated: "We create a secure wallet for your prizes. You won't need to buy anything.",
  signInReason: "Sign in so we know where to send your prize.",
  noWallet: "No wallet found in this browser.",
  share: "Share",
  back: "Back",
  mute: "Mute game sounds",
  unmute: "Turn game sounds on",
  soundsOn: "Game sounds are on",
  soundsOff: "Game sounds are off",
  roll: "Roll the dice",
  rolling: "Rolling",
  doneNext: "Done · next game",
  scoresLock: "Scores lock when time is up",
  fairnessNote: "Top places across the games win. Scores are checked afterwards.",
  faster: "Faster right answers score more",
  right: "Right!",
  wrong: "Not this time.",
  collect: "Collect prize",
  collecting: "Collecting",
  shareWin: "Share win",
  discover: "Discover",
  prizes: "My prizes",
  wallet: "Wallet",
  hosting: "Hosting",
  developers: "Developers",
  hostGiveaway: "Host a giveaway",
  createGiveaway: "Create giveaway",
  emptyDiscover: "Nothing live right now.",
  emptyBoards: "Top gifters and top earners will show here once that list exists.",
  previewNote: "This is a local preview of the game order. Scores here are not recorded.",
  menu: "Menu",
  theme: "Theme",
  comingSoon: "Coming soon",
  signIn: {
    wallet: "Connect a wallet",
    useWallet: "Use a wallet instead",
    continueWith: {
      google: "Continue with Google",
      email: "Continue with email",
      passkey: "Continue with a passkey",
    },
    socialNote:
      "No password and nothing to install. We set up a wallet for your prizes; you never need to touch it.",
    continueAs: (wallet: string) => `Continue as ${wallet}`,
    note: "Signing in only asks your wallet to sign a message. It never sends money or costs a fee.",
    developersTitle: "Sign in to manage your games",
    developersReason: "Register games, create API keys and see how your games are used.",
    hostingTitle: "Sign in to see your giveaways",
    hostingReason: "Track the giveaways you've hosted, add to prizes and withdraw what's left.",
    prizesTitle: "Sign in to see your prizes",
    prizesReason: "See what you've won, collect prizes and choose where they're sent.",
    signOut: "Sign out",
    socialLater: "Google and email sign-in are coming soon.",
  },
} as const;

/** The host's create-giveaway flow. Functions take the values they describe. */
export const create = {
  title: "New giveaway",
  step: (n: number, total: number) => `Step ${n} of ${total}`,
  audience: {
    heading: "Who's it for?",
    lead: "Pick one and we'll set everything up. You can change it on the next step.",
    community: {
      label: "My community",
      hint: "Meetups and groups · 10 winners · tonight",
    },
    followers: {
      label: "My followers",
      hint: "Social giveaway · 3 winners · starts in 15 min",
    },
    custom: { label: "Something else", hint: "Start small and set it up yourself" },
  },
  next: { prize: "Next", review: "Review" },
  prize: {
    heading: "The prize",
    name: "Giveaway name",
    amount: "Prize",
    token: "Paid in",
    runsOn: (chain: string) => `Runs on ${chain}. We pick the network from the token.`,
    unverifiedTitle: "FairDrops hasn't verified this token",
    listedTitle: "FairDrops hasn't reviewed this token",
    viewContract: "View contract",
    acknowledge: (symbol: string) =>
      `I've checked this is the ${symbol} I mean. Players will see it's unverified.`,
    winners: "Winners",
    fewer: "Fewer winners",
    more: "More winners",
  },
  reward: {
    heading: "How the prize is shared",
    balanced: { label: "Balanced", hint: "Every winner gets the same" },
    weighted: { label: "Weighted", hint: "Higher on the leaderboard, bigger prize" },
    random: { label: "Random", hint: "A surprise share for each place" },
    describeBalanced: (winners: number, each: string) =>
      `The top ${winners} players each get ${each}. Everyone who makes the cut is paid the same.`,
    describeWeighted: (winners: number, first: string, last: string) =>
      `The top ${winners} players win, and higher places win more: 1st gets ${first}, down to ${last} for ${ordinal(winners)}.`,
    describeRandom: (winners: number) =>
      `The top ${winners} players win, but each place gets a surprise share, so 1st isn't guaranteed the most. The shares are drawn when you publish and shown to everyone, so nobody can change them later.`,
    reshuffle: "Draw again",
    morePlaces: (n: number) => `+${n} more ${n === 1 ? "place" : "places"}`,
  },
  games: {
    heading: "The game",
    auto: { label: "Let FairDrops choose", hint: "A quick game that suits a big crowd" },
    pick: { label: "I'll choose", hint: "Pick a FairDrops game or one of your own" },
    builtIn: "FairDrops games",
    yours: "Your and partner games",
    noneYours: "Games you register under Developers show up here once approved.",
    multiHint: "Pick more than one to take turns: each round plays the next game.",
    externalAlone: "Your own games run on their own, so they can't take turns in rounds yet.",
    order: (n: number) => `Round order ${n}`,
    describeAuto:
      "We'll run Dice: each player rolls two dice three times within 20 seconds, and the highest total wins. It's fast, needs no knowledge, and works for any crowd.",
    describe: {
      dice: "Each player rolls two dice three times within 20 seconds. The highest total wins, and ties go to the best single roll.",
      quiz: "Timed multiple-choice questions, drawn at random from the question bank below. Most right answers wins; ties go to whoever answered fastest.",
    } as Record<string, string>,
    questionsFrom: "Questions from",
    bankHint: (total: number, asked: number, builtin: boolean) =>
      `${asked} of ${total} questions, picked at random for each game${builtin ? " · by FairDrops" : ""}`,
    describeExternal: (name: string) =>
      `Players play ${name} in its own app. Its server reports the scores, and they're checked like any other game.`,
  },
  rounds: {
    heading: "How winners are found",
    once: { label: "One game", hint: "Everyone plays once and the leaderboard decides" },
    rounds: { label: "Rounds", hint: "Back-to-back rounds until every prize is won" },
    needed: "Several games take turns, so they're played in rounds.",
    perRound: "Winners each round",
    fewerPerRound: "Fewer winners each round",
    morePerRound: "More winners each round",
    maxWins: "Most prizes per person",
    fewerWins: "Fewer prizes per person",
    moreWins: "More prizes per person",
    noLimit: "No limit",
    breakSeconds: "Break between rounds (seconds, up to 30)",
    playsFor: "Plays for",
    describe: (o: {
      perRound: number;
      winners: number;
      rounds: number;
      playTime: string;
      games: string;
      maxWins: number | null;
      breakSeconds: number;
    }) =>
      `Rounds of ${o.games} for ${o.playTime} (${o.rounds} ${o.rounds === 1 ? "round" : "rounds"}), ${o.breakSeconds} seconds apart. Each round, the best ${o.perRound === 1 ? "player wins" : `${o.perRound} players win`} the next prizes. It ends early once all ${o.winners} are won; anything still unwon after ${o.playTime} comes back to you. ` +
      (o.maxWins === null
        ? "Anyone can win more than once. "
        : `Nobody can win more than ${o.maxWins}. `) +
      "It starts on time even if nobody has joined yet: people can join or leave between rounds.",
    summary: (playTime: string, rounds: number, perRound: number) =>
      `${playTime} · ${rounds} ${rounds === 1 ? "round" : "rounds"} · ${perRound} ${perRound === 1 ? "winner" : "winners"} each`,
    tooShort: "That's shorter than one round. Pick a longer play time or a shorter game.",
  },
  start: {
    heading: "Starts",
    soon: "In 15 min",
    later: "In 2 hours",
    tonight: "Tonight",
    tomorrow: "Tomorrow evening",
    pick: "Pick a time",
    at: (time: string) => `Starts ${time}`,
    inTime: (span: string) => `in ${span}`,
    pastPick: "Pick a time in the future, at least 2 minutes from now.",
  },
  startAt: "Start time",
  advanced: {
    toggle: "Advanced settings",
    lead: "Fine-tune the game. The defaults suit most giveaways.",
    rolls: "Rolls per player",
    window: "Play time (seconds, 10 to 30)",
    questions: "Questions",
    secondsPerQuestion: "Seconds per question (5 to 30)",
    minScore: "Minimum score to win",
    minScoreHint: "Players below this never win, even if there are spare places.",
  },
  network: {
    notConnected: (network: string) =>
      `When you lock, your wallet opens on ${network}. Here's what it will ask, in order:`,
    ready: (network: string) => `Your wallet is on ${network}. Ready to lock.`,
    willSwitch: (from: string | null, to: string) =>
      from
        ? `Your wallet is on ${from}. When you lock, it'll ask to switch to ${to} first.`
        : `When you lock, your wallet will ask to switch to ${to} first.`,
    askConnect: "Connect your wallet",
    askSwitch: (network: string) => `Switch to ${network}`,
    askAllow: (symbol: string) => `Allow FairDrops to use your ${symbol}`,
    askLock: "Lock the prize and publish",
    askGasFree: (symbol: string) =>
      `Sign once. FairDrops locks the prize and publishes it, and pays the network for you; a small fee in ${symbol} covers it.`,
    progressTitle: "Locking your prize",
    stepSwitch: (network: string) => `Switch your wallet to ${network}`,
    stepAllow: (amount: string) => `Allow FairDrops to use ${amount}`,
    stepLock: "Lock the prize and publish",
    already: (network: string) => `Already on ${network}`,
    alreadyAllowed: "Already allowed",
    gasFreeNetwork: "FairDrops sends it for you",
    gasFreeAllow: "Part of the same signature",
    notNeeded: (symbol: string) => `Not needed for ${symbol}`,
    confirmInWallet: "Confirm in your wallet",
    waitingFor: (network: string) => `Waiting for ${network} to confirm…`,
    stopped: "Stopped here. Nothing after this step happened.",
    doneLabel: "Done",
    next: "Next",
    noteSwitch: (network: string) => `Approve the switch to ${network} in your wallet.`,
  },
  review: {
    heading: "Review and lock",
    summary: (o: { winners: number; amount: string; game: string; when: string; share: string }) =>
      `Up to ${o.winners} players share ${o.amount}. They play ${o.game}, starting ${o.when}. ${o.share}`,
    shareBalanced: "Every winner gets the same.",
    shareWeighted: "Higher places get more.",
    shareRandom: "Each place gets the surprise share shown below.",
    rows: {
      prize: "Prize",
      network: "Network",
      token: "Token",
      contract: "Contract",
      winners: "Winners",
      game: "Game",
      rounds: "Rounds",
      maxWins: "Most prizes per person",
      starts: "Starts",
      leftovers: "Unclaimed prizes",
      leftoversValue: "Come back to you",
    },
    trust:
      "Your prize is locked in a public contract, so players can see it's real. Nobody, including us, can move it except to pay the winners or refund you. You can cancel for a full refund until it starts.",
    payHeading: "How you'll pay",
    wallet: { label: "Connect a wallet", hint: "Approve and lock from your browser wallet" },
    card: { label: "Card", hint: "Pay with a debit or credit card" },
    send: { label: "Send from any wallet", hint: "Get an address and send the prize to it" },
    lock: (amount: string) => `Lock ${amount}`,
    locking: "Locking",
    confirm: "Confirm in your wallet when asked.",
    cancelled: "You cancelled in your wallet. Nothing was locked.",
    needBank: "Pick where the quiz questions come from.",
  },
} as const;

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
