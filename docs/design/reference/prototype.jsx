const { useState, useEffect, useRef } = React;
const {
  Logo,
  Button,
  IconButton,
  StatusChip,
  Countdown,
  PrizeAmount,
  FairBadge,
  GiveawayCard,
  LeaderboardRow,
  ClaimCard,
  GameStage,
  TapTarget,
  Field,
  Segmented,
  Icon,
} = window.FairDrops;

/* ------------------------------------------------------------------ data */
const GA = {
  host: "Lagos Devs Meetup",
  hue: 0,
  title: "Friday Night Drop",
  pool: "250",
  symbol: "USDC",
  naira: "≈ ₦385,000",
  winners: 10,
  players: "1,204",
  places: ["60", "40", "30", "25", "20", "20", "15", "15", "15", "10"],
  games: [
    { kind: "dice", name: "Dice", mins: "3 min", how: "Roll three times. Your best roll counts." },
    { kind: "tap", name: "Tap Rush", mins: "15 sec", how: "Tap as fast as you can." },
    {
      kind: "quiz",
      name: "Quiz",
      mins: "5 min",
      how: "10 questions. Faster right answers score more.",
    },
  ],
};
const BOARD = [
  { rank: 1, name: "@amaka", hue: 1, score: "2,480", prize: "60" },
  { rank: 2, name: "You", hue: 3, score: "2,310", prize: "40", you: true },
  { rank: 3, name: "Tunde O.", hue: 0, score: "2,190", prize: "30" },
  { rank: 4, name: "@kemi_x", hue: 2, score: "2,050", prize: "25" },
  { rank: 5, name: "Chidi", hue: 1, score: "1,990", prize: "20" },
  { rank: 6, name: "@bayo.dev", hue: 0, score: "1,870", prize: "20" },
  { rank: 7, name: "0x9f3c…a21b", hue: 2, score: "1,850", prize: "15" },
];
const FEED = [
  {
    host: "Lagos Devs Meetup",
    hue: 0,
    title: "Friday Night Drop",
    pool: "250",
    symbol: "USDC",
    winners: 10,
    players: "1,204",
    status: "live",
    seconds: 2700,
    games: ["dice", "tap", "quiz"],
  },
  {
    host: "@tobi.creates",
    hue: 1,
    title: "50k followers thank-you 🎉",
    pool: "100",
    symbol: "USDC",
    winners: 3,
    players: "312",
    status: "upcoming",
    seconds: 5400,
    games: ["tap"],
  },
  {
    host: "Monad Builders",
    hue: 3,
    title: "Community quiz night",
    pool: "500",
    symbol: "MON",
    winners: 5,
    players: "88",
    status: "ending",
    seconds: 420,
    games: ["quiz", "custom"],
  },
  {
    host: "@ada_bakes",
    hue: 2,
    title: "Cake money for 5 lucky people",
    pool: "40",
    symbol: "USDC",
    winners: 5,
    players: "967",
    status: "upcoming",
    seconds: 86400 * 2,
    games: ["tap", "dice"],
  },
  {
    host: "Abuja Tech Circle",
    hue: 0,
    title: "October meetup raffle",
    pool: "150",
    symbol: "USDC",
    winners: 6,
    players: "140",
    status: "results",
    games: ["quiz"],
  },
  {
    host: "@femi.films",
    hue: 1,
    title: "Birthday giveaway",
    pool: "75",
    symbol: "USDC",
    winners: 5,
    players: "2,431",
    status: "claimable",
    games: ["dice"],
  },
];

/* ------------------------------------------------------------------ sound */
const Sound = {
  on: true,
  ctx: null,
  blip(freq = 660, dur = 0.06, type = "square", gain = 0.04) {
    if (!this.on) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + dur);
    } catch (e) {}
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.14, "triangle", 0.06), i * 110),
    );
  },
};

/* ------------------------------------------------------------------ bits */
function AppBar({ title, onBack, right, logo }) {
  return (
    <header className="p-appbar">
      {onBack ? (
        <IconButton icon="arrow" label="Back" onClick={onBack} className="p-back" />
      ) : logo ? (
        <Logo size={24} />
      ) : (
        <span className="p-appbar-spacer" />
      )}
      {title ? <span className="p-appbar-title">{title}</span> : <span className="p-appbar-fill" />}
      {right || <span className="p-appbar-spacer" />}
    </header>
  );
}

function Sticky({ children, note }) {
  return (
    <div className="p-sticky">
      {children}
      {note ? <p className="p-sticky-note">{note}</p> : null}
    </div>
  );
}

function Die({ n, rolling }) {
  const on = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  }[n];
  return (
    <span className={"p-die" + (rolling ? " is-rolling" : "")} aria-label={"Die showing " + n}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={on.includes(i) ? "p-pip" : ""} />
      ))}
    </span>
  );
}

function Stack({ n = 5, label }) {
  return (
    <span className="p-stack">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={"p-stack-av fd-avatar fd-avatar-" + (i % 4)}>
          {"ATKCB"[i]}
        </span>
      ))}
      <span className="p-stack-label">{label}</span>
    </span>
  );
}

function Places({ places, symbol, max = 3 }) {
  const top = Number(places[0]);
  return (
    <ol className="p-places">
      {places.slice(0, max).map((p, i) => (
        <li key={i}>
          <span className="p-places-rank">#{i + 1}</span>
          <span className="p-places-bar">
            <span style={{ width: (Number(p) / top) * 100 + "%" }} />
          </span>
          <PrizeAmount amount={p} symbol={symbol} size="s" />
        </li>
      ))}
      {places.length > max ? (
        <li className="p-places-more">+{places.length - max} more places</li>
      ) : null}
    </ol>
  );
}

function Confetti() {
  return (
    <div className="p-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          style={{
            left: ((i * 37) % 100) + "%",
            animationDelay: (i % 7) * 70 + "ms",
            "--dx": ((i * 53) % 60) - 30 + "px",
            "--r": ((i * 47) % 360) + "deg",
          }}
          className={"c" + (i % 3)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ player screens */
function GiveawayScreen({ go, joined }) {
  return (
    <div className="p-screen">
      <AppBar logo right={<IconButton icon="share" label="Share giveaway" />} />
      <div className="p-body">
        <div className="p-hero">
          <div className="p-hostrow">
            <span className="fd-avatar fd-avatar-0" style={{ width: 36, height: 36 }}>
              LD
            </span>
            <div className="p-hostrow-text">
              <span className="label">{GA.host}</span>
              <span className="caption p-muted">Hosting their 4th giveaway</span>
            </div>
          </div>
          <h1 className="display-l p-title">{GA.title}</h1>
          <div className="p-row">
            <StatusChip status="upcoming" label="Starts 8:30pm" />
            <Countdown seconds={754} running label="in" size="m" />
          </div>
        </div>

        <section className="p-card p-prize">
          <span className="overline p-muted">Prize pool</span>
          <PrizeAmount
            amount={GA.pool}
            symbol={GA.symbol}
            size="xl"
            note={GA.naira + " · locked until winners collect"}
          />
          <p className="caption p-muted p-mt0">
            Top {GA.winners} players win. Bigger prizes for higher places.
          </p>
          <Places places={GA.places} symbol={GA.symbol} />
        </section>

        <section className="p-section">
          <h2 className="title-m">3 games, about 9 minutes</h2>
          <ol className="p-games">
            {GA.games.map((g, i) => (
              <li key={g.kind}>
                <span className={"p-gicon fd-stage-" + g.kind}>
                  <Icon name={{ dice: "dice", tap: "tap", quiz: "quiz" }[g.kind]} size={20} />
                </span>
                <span className="p-games-text">
                  <span className="body-strong">
                    {i + 1}. {g.name} <span className="caption p-muted">· {g.mins}</span>
                  </span>
                  <span className="caption p-muted">{g.how}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="p-section p-row p-between">
          <Stack label={GA.players + " joined"} />
        </section>

        <section className="p-section p-fairnote">
          <FairBadge state="pending" />
          <p className="caption p-muted">
            Scores are recorded by the game server and checked by independent checkers before anyone
            is paid. You can check it yourself afterwards.
          </p>
        </section>
      </div>
      <Sticky note="Free to join. No crypto needed.">
        {joined ? (
          <Button size="lg" block variant="secondary" icon="check">
            You're in
          </Button>
        ) : (
          <Button size="lg" block iconAfter="arrow" onClick={() => go("signin")}>
            Join giveaway
          </Button>
        )}
      </Sticky>
    </div>
  );
}

function SignInScreen({ go }) {
  return (
    <div className="p-screen">
      <div className="p-dim">
        <GiveawayScreen go={() => {}} />
      </div>
      <div className="p-sheet" role="dialog" aria-label="Join Friday Night Drop">
        <span className="p-grab" />
        <h2 className="title-l">Join {GA.title}</h2>
        <p className="p-muted p-mt0">Sign in so we know where to send your prize.</p>
        <div className="p-stackbtns">
          <Button size="lg" block variant="secondary" onClick={() => go("lobby")}>
            <span className="p-g">G</span> Continue with Google
          </Button>
          <Button size="lg" block variant="secondary" onClick={() => go("lobby")}>
            Continue with email
          </Button>
          <Button block variant="ghost" onClick={() => go("lobby")}>
            I already have a wallet
          </Button>
        </div>
        <p className="caption p-muted p-center">
          We create a secure wallet for your prizes. You won't need to buy anything.
        </p>
      </div>
    </div>
  );
}

function LobbyScreen({ go, still }) {
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => go("dice"), 6000);
    return () => clearTimeout(t);
  }, [still]);
  return (
    <div className="p-screen">
      <AppBar onBack={() => go("giveaway")} title={GA.title} />
      <div className="p-body p-lobby">
        <span className="overline p-lagoon">You're in</span>
        <h1 className="display-l p-title">Get ready</h1>
        <div className="p-bigtimer">
          <Countdown seconds={still ? 42 : 6} running={!still} size="l" urgentAt={5} />
          <span className="caption p-muted">until the first game</span>
        </div>
        <ol className="p-lineup">
          {GA.games.map((g, i) => (
            <li key={g.kind} className={i === 0 ? "is-next" : ""}>
              <span className={"p-gicon fd-stage-" + g.kind}>
                <Icon name={{ dice: "dice", tap: "tap", quiz: "quiz" }[g.kind]} size={18} />
              </span>
              <span className="body-strong">{g.name}</span>
              {i === 0 ? <span className="p-firstup caption">First up</span> : null}
            </li>
          ))}
        </ol>
        <div className="p-card p-row p-between">
          <span className="p-row">
            <Icon name="volume" /> <span>Game sounds are on</span>
          </span>
          <Button size="sm" variant="secondary">
            Mute
          </Button>
        </div>
        <p className="caption p-muted p-center">
          Keep this screen open. The first game starts on its own.
        </p>
        <Stack label={GA.players + " players waiting"} />
      </div>
    </div>
  );
}

function DiceScreen({ go, still }) {
  const [dice, setDice] = useState([5, 3]);
  const [rolls, setRolls] = useState(still ? 2 : 0);
  const [best, setBest] = useState(still ? 11 : 0);
  const [rolling, setRolling] = useState(false);
  function roll() {
    if (rolls >= 3 || rolling) return;
    setRolling(true);
    let n = 0;
    const iv = setInterval(() => {
      setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      Sound.blip(300 + n * 40, 0.03);
      if (++n > 7) {
        clearInterval(iv);
        const d = [3 + Math.floor(Math.random() * 4), 2 + Math.floor(Math.random() * 5)];
        setDice(d);
        setBest((b) => Math.max(b, d[0] + d[1]));
        setRolls((r) => r + 1);
        setRolling(false);
        Sound.blip(880, 0.1, "triangle");
      }
    }, 70);
  }
  return (
    <div className="p-screen p-onstage fd-stage-dice">
      <GameStage
        game="dice"
        round={"Game 1 of 3 · Roll " + Math.min(rolls + 1, 3) + " of 3"}
        seconds={still ? 42 : 45}
        running={!still}
        className="p-fullstage"
        onSoundChange={(on) => (Sound.on = on)}
      >
        <div className="p-dice">
          <Die n={dice[0]} rolling={rolling} />
          <Die n={dice[1]} rolling={rolling} />
        </div>
        <div className="p-stagestats">
          <span>
            <span className="caption">Best roll</span>
            <span className="score">{best || "–"}</span>
          </span>
          <span>
            <span className="caption">Your place</span>
            <span className="score">#14</span>
          </span>
          <span>
            <span className="caption">Players</span>
            <span className="score">1,204</span>
          </span>
        </div>
        <div className="p-stageaction">
          {rolls < 3 ? (
            <Button size="lg" block onClick={roll} loading={rolling}>
              {rolling ? "Rolling" : "Roll the dice"}
            </Button>
          ) : (
            <Button
              size="lg"
              block
              variant="secondary"
              iconAfter="arrow"
              onClick={() => go("next")}
            >
              Done · next game
            </Button>
          )}
          <span className="caption p-onstage-muted">
            Top 10 across all games win. Scores are checked afterwards.
          </span>
        </div>
      </GameStage>
    </div>
  );
}

function NextScreen({ go, still }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (still) return;
    if (n === 0) {
      go("tap");
      return;
    }
    Sound.blip(520, 0.08, "triangle");
    const t = setTimeout(() => setN(n - 1), 800);
    return () => clearTimeout(t);
  }, [n, still]);
  return (
    <div className="p-screen p-onstage fd-stage-tap p-nextgame">
      <span className="overline p-onstage-muted">Game 2 of 3</span>
      <Icon name="tap" size={56} />
      <h1 className="display-xl">Tap Rush</h1>
      <p className="body-l p-onstage-muted p-center">
        Tap the big button as fast as you can for 15 seconds.
      </p>
      <span className="p-count" key={n}>
        {still ? 3 : n || "Go"}
      </span>
    </div>
  );
}

function TapScreen({ go, still }) {
  const [left, setLeft] = useState(still ? 9 : 15);
  const [taps, setTaps] = useState(still ? 64 : 0);
  useEffect(() => {
    if (still) return;
    if (left === 0) {
      const t = setTimeout(() => go("settling"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, still]);
  return (
    <div className="p-screen p-onstage fd-stage-tap">
      <GameStage
        game="tap"
        title="Tap Rush"
        round="Game 2 of 3"
        seconds={left}
        running={false}
        className="p-fullstage"
        onSoundChange={(on) => (Sound.on = on)}
      >
        <div className="p-tapwrap">
          <TapTarget
            count={taps}
            disabled={left === 0}
            hint={left === 0 ? "Time! Saving your score…" : "Use one finger or both thumbs"}
            onTap={(c) => {
              setTaps(c);
              Sound.blip(700 + (c % 5) * 30, 0.03);
            }}
          />
        </div>
        <div className="p-stagestats">
          <span>
            <span className="caption">Seconds left</span>
            <span className="score">{left}</span>
          </span>
          <span>
            <span className="caption">Your place</span>
            <span className="score">#{Math.max(2, 40 - Math.floor(taps / 3))}</span>
          </span>
        </div>
      </GameStage>
    </div>
  );
}

function QuizScreen({ still }) {
  const [pick, setPick] = useState(still ? 2 : null);
  const answers = ["Jupiter", "Saturn", "Uranus", "Neptune"];
  return (
    <div className="p-screen p-onstage fd-stage-quiz">
      <GameStage
        game="quiz"
        round="Game 3 of 3 · Question 4 of 10"
        seconds={8}
        running={!still}
        className="p-fullstage"
      >
        <div className="p-quiz">
          <h2 className="title-l">Which planet has the most known moons?</h2>
          <div className="p-answers">
            {answers.map((a, i) => (
              <button
                key={a}
                type="button"
                className={
                  "p-answer" +
                  (pick === i ? " is-picked" : "") +
                  (pick != null && i === 1 ? " is-right" : "")
                }
                onClick={() => {
                  setPick(i);
                  Sound.blip(i === 1 ? 880 : 220, 0.12, "triangle");
                }}
              >
                <span className="p-answer-key">{"ABCD"[i]}</span>
                {a}
                {pick != null && i === 1 ? <Icon name="check" /> : null}
              </button>
            ))}
          </div>
          <span className="caption p-onstage-muted">
            {pick == null
              ? "Faster right answers score more"
              : pick === 1
                ? "Right! +340"
                : "Not this time. It's Saturn."}
          </span>
        </div>
      </GameStage>
    </div>
  );
}

function SettlingScreen({ go, still }) {
  const [step, setStep] = useState(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    if (step >= 3) {
      const t = setTimeout(() => go("results"), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(step + 1), 1000);
    return () => clearTimeout(t);
  }, [step, still]);
  const steps = ["Scores locked", "Checking every score", "Unlocking prizes"];
  return (
    <div className="p-screen">
      <AppBar title={GA.title} logo />
      <div className="p-body p-settle">
        <StatusChip status="settling" />
        <h1 className="display-l p-title">That's a wrap</h1>
        <p className="body-l p-muted p-mt0">
          Your score: <b className="p-ink">2,310</b>. We're counting results from all {GA.players}{" "}
          players.
        </p>
        <ol className="p-steps">
          {steps.map((s, i) => (
            <li key={s} className={i < step ? "is-done" : i === step ? "is-now" : ""}>
              <span className="p-stepdot">
                {i < step ? (
                  <Icon name="check" size={16} />
                ) : i === step ? (
                  <Icon name="spinner" size={16} spin />
                ) : null}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <p className="caption p-muted">
          This usually takes a minute or two. You can close the app; we'll let you know when results
          are in.
        </p>
      </div>
    </div>
  );
}

function ResultsScreen({ go, still }) {
  useEffect(() => {
    if (!still) Sound.win();
  }, []);
  return (
    <div className="p-screen">
      {!still ? <Confetti /> : null}
      <AppBar
        title="Results"
        onBack={() => go("giveaway")}
        right={<IconButton icon="share" label="Share results" />}
      />
      <div className="p-body p-results">
        <div className="p-win">
          <span className="overline p-lagoon">You placed</span>
          <span className="p-winrank">#2</span>
          <span className="body p-muted">out of {GA.players} players</span>
        </div>
        <ol className="p-board">
          {BOARD.map((r, i) => (
            <LeaderboardRow key={r.rank} {...r} symbol="USDC" delay={still ? 0 : 300 + i * 80} />
          ))}
        </ol>
        <div className="p-row p-center">
          <FairBadge state="verified" detail="by 3 checkers" onClick={() => go("verify")} />
        </div>
      </div>
      <Sticky>
        <ClaimCard
          state="ready"
          rank={2}
          amount="40.00"
          symbol="USDC"
          note="≈ ₦61,600"
          deadline="Fri, Oct 10"
          onCollect={() => go("collecting")}
        />
      </Sticky>
    </div>
  );
}

function CollectingScreen({ go, still }) {
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => go("collected"), 2200);
    return () => clearTimeout(t);
  }, [still]);
  return (
    <div className="p-screen">
      <AppBar title="Collect prize" onBack={() => go("results")} />
      <div className="p-body p-center-col">
        <ClaimCard state="collecting" amount="40.00" symbol="USDC" note="≈ ₦61,600" />
        <ol className="p-steps">
          <li className="is-done">
            <span className="p-stepdot">
              <Icon name="check" size={16} />
            </span>
            Prize found in the winners list
          </li>
          <li className="is-now">
            <span className="p-stepdot">
              <Icon name="spinner" size={16} spin />
            </span>
            Sending to your wallet
          </li>
          <li>
            <span className="p-stepdot" />
            Done
          </li>
        </ol>
        <p className="caption p-muted p-center">It's free. FairDrops covers the network cost.</p>
      </div>
    </div>
  );
}

function CollectedScreen({ go, still }) {
  useEffect(() => {
    if (!still) Sound.win();
  }, []);
  return (
    <div className="p-screen">
      {!still ? <Confetti /> : null}
      <AppBar title="Prize collected" onBack={() => go("results")} />
      <div className="p-body">
        <div className="p-wincard">
          <div className="p-row p-between">
            <Logo size={20} />
            <span className="caption">Friday Night Drop</span>
          </div>
          <span className="overline">I placed #2 and won</span>
          <PrizeAmount amount="40" symbol="USDC" size="xl" />
          <span className="caption">Hosted by {GA.host} · verified fair</span>
        </div>
        <div className="p-stackbtns">
          <Button size="lg" block icon="share">
            Share my win
          </Button>
          <Button size="lg" block variant="secondary" onClick={() => go("prizes")}>
            See my prizes
          </Button>
        </div>
        <div className="p-row p-center">
          <FairBadge state="verified" detail="How we checked" onClick={() => go("verify")} />
        </div>
      </div>
    </div>
  );
}

function VerifyScreen({ go, still }) {
  const [open, setOpen] = useState(!!still);
  const [done, setDone] = useState(still ? 4 : 0);
  useEffect(() => {
    if (done >= 4) return;
    const t = setTimeout(() => setDone(done + 1), 450);
    return () => clearTimeout(t);
  }, [done]);
  const checks = [
    ["Every score replayed", "All 3,612 game moves were replayed and gave the same scores."],
    ["Winners match the leaderboard", "The top 10 on the board are the 10 people who got paid."],
    ["Prize split matches the host's", "Place 1 to 10 got exactly what the giveaway promised."],
    ["Payment recorded publicly", "3 of 3 independent checkers signed off before any money moved."],
  ];
  return (
    <div className="p-screen">
      <AppBar title="How we checked" onBack={() => go("collected")} />
      <div className="p-body">
        <div className="p-row">
          {done >= 4 ? <FairBadge state="verified" /> : <FairBadge state="checking" />}
        </div>
        <p className="body p-muted p-mt0">
          This check just ran on your phone. You don't have to take our word for it.
        </p>
        <ol className="p-checks">
          {checks.map(([t, d], i) => (
            <li key={t} className={i < done ? "is-done" : ""}>
              <span className="p-stepdot">
                {i < done ? (
                  <Icon name="check" size={16} />
                ) : (
                  <Icon name="spinner" size={16} spin />
                )}
              </span>
              <span>
                <span className="body-strong">{t}</span>
                <span className="caption p-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="p-disclosure"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="lock" size={18} /> Technical proof{" "}
          <span className="p-chev">{open ? "–" : "+"}</span>
        </button>
        {open ? (
          <dl className="p-proof">
            <dt>Giveaway</dt>
            <dd>#42 on Monad Testnet</dd>
            <dt>Contract</dt>
            <dd>0x40e7…60ca</dd>
            <dt>Payout root</dt>
            <dd>0x8c1f…d9e2</dd>
            <dt>Game log hash</dt>
            <dd>0x2b77…a04c</dd>
            <dt>Random seed</dt>
            <dd>revealed · matches commitment</dd>
            <dt>Your payment</dt>
            <dd>
              <a href="#verify">0x51d0…7f13 ↗</a>
            </dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function PrizesScreen({ go }) {
  const rows = [
    { t: "Friday Night Drop", h: GA.host, r: 2, a: "40", s: "claimed" },
    { t: "50k followers thank-you 🎉", h: "@tobi.creates", r: 1, a: "25", s: "claimable" },
    { t: "Community quiz night", h: "Monad Builders", r: 14, s: "results" },
  ];
  return (
    <div className="p-screen">
      <AppBar title="My prizes" onBack={() => go("collected")} />
      <div className="p-body">
        <div className="p-card p-total">
          <span className="overline p-muted">Won so far</span>
          <PrizeAmount amount="65" symbol="USDC" size="xl" note="across 3 giveaways · ≈ ₦100,100" />
        </div>
        <ul className="p-list">
          {rows.map((r) => (
            <li key={r.t} className="p-listrow">
              <span className="p-listmain">
                <span className="body-strong">{r.t}</span>
                <span className="caption p-muted">
                  {r.h} · #{r.r}
                </span>
              </span>
              {r.a ? (
                <PrizeAmount amount={r.a} symbol="USDC" size="m" />
              ) : (
                <span className="caption p-muted">No prize</span>
              )}
              {r.s === "claimable" ? (
                <Button size="sm">Collect</Button>
              ) : (
                <StatusChip status={r.s} label={r.s === "results" ? "Played" : undefined} />
              )}
            </li>
          ))}
        </ul>
        <div className="p-card p-row p-between">
          <span className="p-listmain">
            <span className="label">Prizes go to</span>
            <span className="caption p-muted">Your FairDrops wallet · 0x9f3c…a21b</span>
          </span>
          <Button size="sm" variant="ghost">
            Change
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ host screens */
const PRESETS = {
  community: { winners: 10, split: "top", when: "tonight", games: ["quiz", "tap"], pool: "250" },
  followers: { winners: 3, split: "equal", when: "soon", games: ["tap"], pool: "100" },
  custom: { winners: 5, split: "equal", when: "pick", games: ["dice"], pool: "50" },
};
function splitOf(pool, n, split) {
  const p = Number(pool) || 0;
  if (split === "equal")
    return Array.from({ length: n }, () => (p / n).toFixed(p / n < 10 ? 2 : 0));
  const w = Array.from({ length: n }, (_, i) => n - i);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => ((p * x) / sum).toFixed((p * x) / sum < 10 ? 2 : 0));
}

function HostSteps({ n }) {
  return (
    <div className="p-hsteps" aria-label={"Step " + n + " of 3"}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "is-on" : ""} />
      ))}
      <span className="caption p-muted">Step {n} of 3</span>
    </div>
  );
}

function HostAudience({ go, host, setHost }) {
  return (
    <div className="p-screen">
      <AppBar onBack={() => go("h-home")} title="New giveaway" />
      <div className="p-body">
        <HostSteps n={1} />
        <h1 className="title-l">Who's it for?</h1>
        <p className="p-muted p-mt0">
          Pick one and we'll fill in the rest. You can change anything on the next step.
        </p>
        <Segmented
          label="Audience"
          stacked
          value={host.audience}
          onChange={(v) => setHost({ ...host, audience: v, ...PRESETS[v] })}
          options={[
            {
              value: "community",
              label: "My community",
              hint: "Meetups and groups · 10 winners · tonight",
              icon: "users",
            },
            {
              value: "followers",
              label: "My followers",
              hint: "Social giveaway · 3 winners · starts in 15 min",
              icon: "share",
            },
            {
              value: "custom",
              label: "Something else",
              hint: "Start small and set it up yourself",
              icon: "puzzle",
            },
          ]}
        />
      </div>
      <Sticky>
        <Button size="lg" block iconAfter="arrow" onClick={() => go("h-prize")}>
          Next: the prize
        </Button>
      </Sticky>
    </div>
  );
}

function HostPrize({ go, host, setHost }) {
  const places = splitOf(host.pool, host.winners, host.split);
  const toggle = (g) =>
    setHost({
      ...host,
      games: host.games.includes(g) ? host.games.filter((x) => x !== g) : [...host.games, g],
    });
  return (
    <div className="p-screen">
      <AppBar onBack={() => go("h-audience")} title="New giveaway" />
      <div className="p-body">
        <HostSteps n={2} />
        <h1 className="title-l">The prize</h1>
        <Field
          label="Name"
          id="h-name"
          defaultValue={
            host.audience === "community" ? "Friday Night Drop" : "@tobi.creates 50k giveaway"
          }
        />
        <Field
          label="Prize pool"
          id="h-pool"
          inputMode="decimal"
          value={host.pool}
          onChange={(e) => setHost({ ...host, pool: e.target.value.replace(/[^0-9.]/g, "") })}
          suffix="USDC"
          hint="You have 540.00 USDC"
          error={Number(host.pool) > 540 ? "That’s more than you have (540.00 USDC)" : undefined}
        />
        <div className="fd-field">
          <span className="fd-field-label">Winners</span>
          <div className="p-stepper">
            <button
              type="button"
              className="p-stepbtn"
              aria-label="Fewer winners"
              onClick={() => setHost({ ...host, winners: Math.max(1, host.winners - 1) })}
            >
              −
            </button>
            <span className="p-stepper-n" aria-live="polite">
              {host.winners}
            </span>
            <button
              type="button"
              className="p-stepbtn"
              aria-label="More winners"
              onClick={() => setHost({ ...host, winners: Math.min(50, host.winners + 1) })}
            >
              +
            </button>
          </div>
        </div>
        <Segmented
          label="Split"
          value={host.split}
          onChange={(v) => setHost({ ...host, split: v })}
          options={[
            { value: "equal", label: "Equal" },
            { value: "top", label: "Top gets more" },
          ]}
        />
        <Places places={places} symbol="USDC" max={3} />
        <div className="fd-field">
          <span className="fd-field-label">Games</span>
          <div className="p-chips">
            {[
              ["tap", "Tap Rush"],
              ["quiz", "Quiz"],
              ["dice", "Dice"],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={"p-gchip" + (host.games.includes(k) ? " is-on" : "")}
                aria-pressed={host.games.includes(k)}
                onClick={() => toggle(k)}
              >
                <span className={"p-gicon fd-stage-" + k}>
                  <Icon name={k === "tap" ? "tap" : k} size={16} />
                </span>
                {l}
              </button>
            ))}
          </div>
        </div>
        <Segmented
          label="Starts"
          value={host.when}
          onChange={(v) => setHost({ ...host, when: v })}
          options={[
            { value: "soon", label: "In 15 min" },
            { value: "tonight", label: "Tonight 8:30" },
            { value: "pick", label: "Pick time" },
          ]}
        />
      </div>
      <Sticky>
        <Button
          size="lg"
          block
          iconAfter="arrow"
          onClick={() => go("h-review")}
          disabled={Number(host.pool) > 540 || !host.games.length}
        >
          Next: review
        </Button>
      </Sticky>
    </div>
  );
}

function HostReview({ go, host }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (phase === 0 || phase >= 3) return;
    const t = setTimeout(() => (phase === 2 ? go("h-live") : setPhase(phase + 1)), 1300);
    return () => clearTimeout(t);
  }, [phase]);
  return (
    <div className="p-screen">
      <AppBar onBack={() => go("h-prize")} title="New giveaway" />
      <div className="p-body">
        <HostSteps n={3} />
        <h1 className="title-l">Review and lock</h1>
        <dl className="p-summary p-card">
          <dt>Prize pool</dt>
          <dd>
            <PrizeAmount amount={host.pool} symbol="USDC" size="m" />
          </dd>
          <dt>Winners</dt>
          <dd>
            {host.winners} · {host.split === "equal" ? "equal split" : "top gets more"}
          </dd>
          <dt>Games</dt>
          <dd>
            {host.games.map((g) => ({ tap: "Tap Rush", quiz: "Quiz", dice: "Dice" })[g]).join(", ")}
          </dd>
          <dt>Starts</dt>
          <dd>
            {
              { soon: "In 15 minutes", tonight: "Today, 8:30pm", pick: "Sat, Oct 4, 6:00pm" }[
                host.when
              ]
            }
          </dd>
          <dt>Unclaimed prizes</dt>
          <dd>Come back to you after 7 days</dd>
        </dl>
        <p className="caption p-muted">
          Your prize is locked in a public contract, so players can see it's real. Nobody, including
          us, can move it except to pay the winners or refund you.
        </p>
        {phase > 0 ? (
          <ol className="p-steps">
            <li className={phase > 1 ? "is-done" : "is-now"}>
              <span className="p-stepdot">
                {phase > 1 ? (
                  <Icon name="check" size={16} />
                ) : (
                  <Icon name="spinner" size={16} spin />
                )}
              </span>
              Allow FairDrops to use {host.pool} USDC
            </li>
            <li className={phase > 2 ? "is-done" : phase === 2 ? "is-now" : ""}>
              <span className="p-stepdot">
                {phase === 2 ? <Icon name="spinner" size={16} spin /> : null}
              </span>
              Lock the prize and publish
            </li>
          </ol>
        ) : null}
      </div>
      <Sticky
        note={
          phase
            ? "Confirm in your wallet when asked."
            : "You can cancel for a full refund until it starts."
        }
      >
        <Button size="lg" block icon="lock" loading={phase > 0} onClick={() => setPhase(1)}>
          {phase ? "Locking prize" : "Lock " + host.pool + " USDC and publish"}
        </Button>
      </Sticky>
    </div>
  );
}

function HostLive({ go }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-screen">
      {!copied ? <Confetti /> : null}
      <AppBar title="Published" logo />
      <div className="p-body">
        <span className="overline p-lagoon">Your giveaway is live</span>
        <h1 className="display-l p-title">Now share it</h1>
        <div className="p-sharecard">
          <div className="p-sharecard-art">
            <span className="fd-stage-quiz" />
            <span className="fd-stage-tap" />
            <span className="p-sharecard-mark">
              <Logo variant="mark" size={28} />
            </span>
          </div>
          <span className="title-m">Friday Night Drop</span>
          <span className="caption p-muted">
            Play 2 games · top 10 share 250 USDC · starts 8:30pm
          </span>
        </div>
        <div className="p-copy">
          <span className="mono-s">fairdrops.app/g/friday-night-drop</span>
          <Button
            size="sm"
            variant={copied ? "secondary" : "primary"}
            icon={copied ? "check" : undefined}
            onClick={() => setCopied(true)}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="p-sharegrid">
          {["WhatsApp", "X", "Instagram story", "More"].map((s) => (
            <Button key={s} variant="secondary" size="sm">
              {s}
            </Button>
          ))}
        </div>
      </div>
      <Sticky>
        <Button
          size="lg"
          block
          variant="secondary"
          iconAfter="arrow"
          onClick={() => go("h-manage")}
        >
          Manage giveaway
        </Button>
      </Sticky>
    </div>
  );
}

function HostManage({ go }) {
  const [live, setLive] = useState(false);
  return (
    <div className="p-screen">
      <AppBar
        onBack={() => go("h-live")}
        title="Manage"
        right={<IconButton icon="share" label="Share giveaway" />}
      />
      <div className="p-body">
        <div className="p-row p-between">
          <StatusChip
            status={live ? "live" : "upcoming"}
            label={live ? "Live · Game 1 of 2" : "Starts 8:30pm"}
          />
          <Countdown seconds={live ? 212 : 2280} running label={live ? "Ends in" : "in"} size="m" />
        </div>
        <h1 className="title-l p-mt0">Friday Night Drop</h1>
        <div className="p-stats">
          <div>
            <span className="caption p-muted">Players</span>
            <span className="score">{live ? "1,204" : "318"}</span>
          </div>
          <div>
            <span className="caption p-muted">Prize pool</span>
            <PrizeAmount amount="250" symbol="USDC" size="m" />
          </div>
          <div>
            <span className="caption p-muted">Winners</span>
            <span className="score">10</span>
          </div>
        </div>
        <Segmented
          label="View"
          value={live ? "live" : "before"}
          onChange={(v) => setLive(v === "live")}
          options={[
            { value: "before", label: "Before start" },
            { value: "live", label: "During game" },
          ]}
        />
        {live ? (
          <>
            <h2 className="title-m">Live leaderboard</h2>
            <ol className="p-board">
              {BOARD.slice(0, 5).map((r) => (
                <LeaderboardRow
                  key={r.rank}
                  {...r}
                  you={false}
                  name={r.you ? "@sade" : r.name}
                  symbol="USDC"
                />
              ))}
            </ol>
          </>
        ) : (
          <div className="p-stackbtns">
            <Button block variant="secondary" icon="gift">
              Add to the prize
            </Button>
            <Button block variant="secondary" icon="share">
              Share again
            </Button>
            <Button block variant="ghost" className="p-dangerlink">
              Cancel and refund
            </Button>
            <p className="caption p-muted p-center">
              You can add to the prize or cancel until 8:30pm. After that the giveaway runs on its
              own.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function HostHome({ go }) {
  return (
    <div className="p-screen">
      <AppBar
        logo
        right={
          <span className="fd-avatar fd-avatar-1" style={{ width: 32, height: 32 }}>
            TC
          </span>
        }
      />
      <div className="p-body">
        <h1 className="display-l p-title">Hosting</h1>
        <div className="p-card p-row p-between">
          <span className="p-listmain">
            <span className="overline p-muted">Given away</span>
            <PrizeAmount amount="1,250" symbol="USDC" size="l" />
          </span>
          <span className="p-listmain p-right">
            <span className="overline p-muted">Players</span>
            <span className="score">4,380</span>
          </span>
        </div>
        <ul className="p-list">
          {[
            ["Friday Night Drop", "upcoming", "318 joined", "250"],
            ["Sept community quiz", "results", "8 of 10 collected", "200"],
            ["Launch week drop", "cancelled", "Refunded", "50"],
          ].map(([t, s, m, a]) => (
            <li key={t} className="p-listrow">
              <span className="p-listmain">
                <span className="body-strong">{t}</span>
                <span className="caption p-muted">{m}</span>
              </span>
              <PrizeAmount amount={a} symbol="USDC" size="s" muted />
              <StatusChip
                status={s}
                label={
                  s === "upcoming" ? "Starts 8:30pm" : s === "results" ? "Finished" : undefined
                }
              />
            </li>
          ))}
        </ul>
      </div>
      <Sticky>
        <Button size="lg" block icon="gift" onClick={() => go("h-audience")}>
          Create giveaway
        </Button>
      </Sticky>
    </div>
  );
}

/* ------------------------------------------------------------------ desktop artboards */
function DesktopNav({ active }) {
  return (
    <aside className="d-nav">
      <Logo size={26} />
      <nav>
        {[
          ["Discover", "gift"],
          ["My prizes", "check"],
          ["Hosting", "users"],
          ["Developers", "puzzle"],
        ].map(([l, i]) => (
          <a key={l} href="#screens" className={l === active ? "is-on" : ""}>
            <Icon name={i} size={18} />
            {l}
          </a>
        ))}
      </nav>
      <div className="d-nav-foot">
        <span className="fd-avatar fd-avatar-1" style={{ width: 32, height: 32 }}>
          TC
        </span>
        <span className="label">@tobi.creates</span>
      </div>
    </aside>
  );
}

function DesktopDiscover() {
  return (
    <div className="d-app">
      <DesktopNav active="Discover" />
      <main className="d-main">
        <div className="d-head">
          <div>
            <span className="overline p-flare">1,896 people playing now</span>
            <h1 className="display-l p-mt0">Discover giveaways</h1>
          </div>
          <Button icon="gift">Host a giveaway</Button>
        </div>
        <div className="p-chips">
          {["All", "Live now", "Starting soon", "Ending soon", "Finished"].map((c, i) => (
            <button type="button" key={c} className={"p-filter" + (i === 0 ? " is-on" : "")}>
              {c}
            </button>
          ))}
        </div>
        <div className="d-split">
          <div className="d-grid">
            {FEED.map((g) => (
              <GiveawayCard key={g.title} giveaway={g} />
            ))}
          </div>
          <div className="d-side">
            <section className="p-card">
              <h2 className="title-m p-mt0">Top gifters · October</h2>
              <ol className="p-board">
                {[
                  ["Monad Builders", 3, "2,400"],
                  ["Lagos Devs Meetup", 0, "1,250"],
                  ["@tobi.creates", 1, "600"],
                  ["@femi.films", 2, "420"],
                ].map(([n, h, a], i) => (
                  <LeaderboardRow
                    key={n}
                    rank={i + 1}
                    name={n}
                    hue={h}
                    score=""
                    prize={a}
                    symbol="USDC"
                  />
                ))}
              </ol>
            </section>
            <section className="p-card">
              <h2 className="title-m p-mt0">Top earners · October</h2>
              <ol className="p-board">
                {[
                  ["@amaka", 1, "310"],
                  ["Tunde O.", 0, "185"],
                  ["@kemi_x", 2, "140"],
                ].map(([n, h, a], i) => (
                  <LeaderboardRow
                    key={n}
                    rank={i + 1}
                    name={n}
                    hue={h}
                    score=""
                    prize={a}
                    symbol="USDC"
                  />
                ))}
              </ol>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function DesktopHosting() {
  const rows = [
    ["Friday Night Drop", "upcoming", "Starts 8:30pm", "250", "318", "—", "Manage"],
    ["50k followers thank-you 🎉", "live", "Live · ends 9:05pm", "100", "2,016", "—", "Watch"],
    [
      "Sept community quiz",
      "results",
      "Finished Sep 26",
      "200",
      "140",
      "8 of 10",
      "Withdraw 40 USDC",
    ],
    ["Launch week drop", "cancelled", "Cancelled Sep 12", "50", "0", "Refunded", "View"],
  ];
  return (
    <div className="d-app">
      <DesktopNav active="Hosting" />
      <main className="d-main">
        <div className="d-head">
          <div>
            <span className="overline p-muted">Hosting</span>
            <h1 className="display-l p-mt0">Your giveaways</h1>
          </div>
          <Button icon="gift">Create giveaway</Button>
        </div>
        <div className="d-kpis">
          <div className="p-card">
            <span className="caption p-muted">Given away</span>
            <PrizeAmount amount="1,250" symbol="USDC" size="l" />
          </div>
          <div className="p-card">
            <span className="caption p-muted">Players reached</span>
            <span className="score-xl-s">4,380</span>
          </div>
          <div className="p-card">
            <span className="caption p-muted">Prizes collected</span>
            <span className="score-xl-s">96%</span>
          </div>
          <div className="p-card">
            <span className="caption p-muted">Leftover to withdraw</span>
            <PrizeAmount amount="40" symbol="USDC" size="l" muted />
          </div>
        </div>
        <div className="d-tablewrap p-card">
          <table className="d-table">
            <thead>
              <tr>
                <th>Giveaway</th>
                <th>Status</th>
                <th className="num">Prize</th>
                <th className="num">Players</th>
                <th>Collected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(([t, s, when, a, p, c, act]) => (
                <tr key={t}>
                  <td>
                    <span className="body-strong">{t}</span>
                    <br />
                    <span className="caption p-muted">{when}</span>
                  </td>
                  <td>
                    <StatusChip
                      status={s}
                      label={
                        s === "results" ? "Finished" : s === "upcoming" ? "Scheduled" : undefined
                      }
                    />
                  </td>
                  <td className="num">
                    <PrizeAmount amount={a} symbol="USDC" size="s" muted />
                  </td>
                  <td className="num">{p}</td>
                  <td>{c}</td>
                  <td className="num">
                    <Button size="sm" variant={act.startsWith("Withdraw") ? "primary" : "ghost"}>
                      {act}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function DesktopDevelopers() {
  return (
    <div className="d-app">
      <DesktopNav active="Developers" />
      <main className="d-main">
        <div className="d-head">
          <div>
            <span className="overline p-muted">Developers</span>
            <h1 className="display-l p-mt0">Your games</h1>
          </div>
          <Button icon="puzzle">Register a game</Button>
        </div>
        <div className="d-split">
          <div className="p-stackcol">
            <ul className="p-list p-card">
              {[
                [
                  "Trivia Blitz",
                  "trivia-blitz@1.2.0",
                  "results",
                  "Approved · used in 14 giveaways",
                ],
                ["Snake Dash", "snake-dash@0.3.1", "settling", "In review · usually 1–2 days"],
              ].map(([n, v, s, m]) => (
                <li key={n} className="p-listrow">
                  <span className="p-gicon fd-stage-custom">
                    <Icon name="puzzle" size={18} />
                  </span>
                  <span className="p-listmain">
                    <span className="body-strong">{n}</span>
                    <span className="caption p-muted mono-inline">{v}</span>
                  </span>
                  <span className="caption p-muted">{m}</span>
                  <StatusChip status={s} label={s === "results" ? "Live" : "In review"} />
                </li>
              ))}
            </ul>
            <section className="p-card">
              <h2 className="title-m p-mt0">API keys</h2>
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Score server</td>
                    <td className="mono-s">fd_test_••••••••4f2a</td>
                    <td>2 min ago</td>
                    <td className="num">
                      <Button size="sm" variant="ghost">
                        Revoke
                      </Button>
                    </td>
                  </tr>
                  <tr>
                    <td>Staging</td>
                    <td className="mono-s">fd_test_••••••••91c0</td>
                    <td>Sep 21</td>
                    <td className="num">
                      <Button size="sm" variant="ghost">
                        Revoke
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
          <section className="p-card d-code">
            <h2 className="title-m p-mt0">Report scores from your game</h2>
            <p className="caption p-muted">
              Your game keeps its own UI. FairDrops handles players, prizes and proof.
            </p>
            <pre className="mono-s">{`import { ScoreReporter } from "@fairdrops/sdk/server"

const reporter = new ScoreReporter({
  apiUrl: process.env.FAIRDROPS_API,
  apiKey: process.env.FAIRDROPS_KEY,
})

await reporter.report(sessionId, {
  player, score: 2310, moves,
})`}</pre>
            <Button variant="secondary" size="sm" iconAfter="arrow">
              Read the SDK guide
            </Button>
          </section>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ flows */
const PLAYER = [
  [
    "giveaway",
    "Giveaway page",
    "Where a shared link lands. Prize first, then the games and how fairness works. One action: Join.",
    GiveawayScreen,
  ],
  [
    "signin",
    "Join sheet",
    "Google, email or an existing wallet. No crypto words. A wallet is created quietly for the prize.",
    SignInScreen,
  ],
  [
    "lobby",
    "Lobby",
    "The countdown to the first game (server clock), the game line-up and a sound check.",
    LobbyScreen,
  ],
  [
    "dice",
    "Game 1 · Dice",
    "The stage takes the whole screen in the Dice colour. Roll three times; live place and best roll.",
    DiceScreen,
  ],
  [
    "next",
    "Next game",
    "Between games the ground changes colour with a 3-2-1, so the switch is obvious.",
    NextScreen,
  ],
  [
    "tap",
    "Game 2 · Tap Rush",
    "The speed game: a big thumb-height key that fires on touch-down. 15 seconds.",
    TapScreen,
  ],
  [
    "settling",
    "Counting results",
    "Settlement in player words: scores locked → checked → prizes unlocked.",
    SettlingScreen,
  ],
  [
    "results",
    "Results",
    "The one orchestrated moment: your place, the board rising in, and the prize sheet.",
    ResultsScreen,
  ],
  [
    "collecting",
    "Collecting",
    "Gasless claim through the relayer. The button stays busy, and the copy says it's free.",
    CollectingScreen,
  ],
  ["collected", "Collected", "A shareable win card, and the proof one tap away.", CollectedScreen],
  [
    "verify",
    "How we checked",
    "verifyGiveaway() runs in the browser: 4 plain checks, with the technical proof folded away.",
    VerifyScreen,
  ],
  [
    "prizes",
    "My prizes",
    "Everything you've won, what's still to collect, and where prizes go.",
    PrizesScreen,
  ],
];
const HOST = [
  [
    "h-home",
    "Hosting home",
    "Your giveaways and totals. The main action is always Create.",
    HostHome,
  ],
  [
    "h-audience",
    "1 · Who's it for?",
    "One tap picks a preset that fills in winners, split, games and start time.",
    HostAudience,
  ],
  [
    "h-prize",
    "2 · The prize",
    "Everything editable on one screen; the split preview updates as you type.",
    HostPrize,
  ],
  [
    "h-review",
    "3 · Review and lock",
    "Plain summary, then approve and lock in two wallet steps.",
    HostReview,
  ],
  ["h-live", "Published", "Share straight away: link, share card and the usual apps.", HostLive],
  [
    "h-manage",
    "Manage",
    "Before the start: add to the prize, share, cancel. During the game: the live board.",
    HostManage,
  ],
];

function Phone({ children, label }) {
  return (
    <div className="phone" aria-label={label}>
      <div className="phone-status">
        <span>9:41</span>
        <span className="phone-notch" />
        <span>100%</span>
      </div>
      <div className="phone-screen">{children}</div>
    </div>
  );
}

function Prototype() {
  const [flow, setFlow] = useState("player");
  const [step, setStep] = useState("giveaway");
  const [host, setHost] = useState({ audience: "community", ...PRESETS.community });
  const list = flow === "player" ? PLAYER : HOST;
  const cur = list.find((s) => s[0] === step) || list[0];
  const Screen = cur[3];
  const scroller = useRef(null);
  const go = (s) => {
    setStep(s);
    if (scroller.current) scroller.current.scrollTop = 0;
  };
  useEffect(() => {
    const el = document.querySelector(".proto .phone-screen");
    if (el) el.scrollTop = 0;
  }, [step]);
  return (
    <div className="proto">
      <div className="proto-stage">
        <Phone label={cur[1]}>
          <Screen key={step} go={go} host={host} setHost={setHost} />
        </Phone>
      </div>
      <aside className="proto-side">
        <Segmented
          label="Flow"
          value={flow}
          onChange={(v) => {
            setFlow(v);
            go(v === "player" ? "giveaway" : "h-home");
          }}
          options={[
            { value: "player", label: "Player", icon: "tap" },
            { value: "host", label: "Host", icon: "gift" },
          ]}
        />
        <div className="proto-now">
          <span className="overline p-muted">On screen</span>
          <h2 className="title-l p-mt0">{cur[1]}</h2>
          <p className="p-muted">{cur[2]}</p>
        </div>
        <ol className="proto-steps">
          {list.map(([id, name]) => (
            <li key={id}>
              <button type="button" className={id === step ? "is-on" : ""} onClick={() => go(id)}>
                {name}
              </button>
            </li>
          ))}
        </ol>
        <p className="caption p-muted">
          Tap through inside the phone. Timers auto-advance the lobby, the 3-2-1 and results
          counting. Sounds play after your first tap; mute them in any game header.
        </p>
      </aside>
    </div>
  );
}

function Board() {
  const extra = [
    [
      "quiz",
      "Game 3 · Quiz",
      "Answer tiles are press-edge keys. Right and wrong always show a word and an icon, not just a colour.",
      QuizScreen,
    ],
  ];
  const player = PLAYER.slice(0, 6).concat(extra, PLAYER.slice(6));
  return (
    <div className="board">
      <section>
        <h2 className="title-l">Player · mobile</h2>
        <p className="p-muted">
          From a shared link to a collected prize, in order. Static frames of the prototype screens.
        </p>
        <div className="board-row">
          {player.map(([id, name, note, S]) => (
            <figure key={id} className="board-frame">
              <div className="board-phone">
                <Phone label={name}>
                  <S
                    go={() => {}}
                    still
                    host={{ audience: "community", ...PRESETS.community }}
                    setHost={() => {}}
                  />
                </Phone>
              </div>
              <figcaption>
                <span className="label">{name}</span>
                <span className="caption p-muted">{note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="title-l">Claim card · every state</h2>
        <div className="board-states">
          {[
            ["waiting", "Results being counted"],
            ["ready", "Won, not collected"],
            ["collecting", "Sending"],
            ["collected", "Done"],
            ["expired", "Missed the deadline"],
            ["none", "Played, didn't win"],
          ].map(([s, l]) => (
            <figure key={s} className="board-state">
              <ClaimCard
                state={s}
                rank={s === "none" ? 14 : 2}
                amount="40.00"
                symbol="USDC"
                note="≈ ₦61,600"
                deadline="Fri, Oct 10"
                winners={10}
              />
              <figcaption className="caption p-muted">{l}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="title-l">Host · mobile</h2>
        <p className="p-muted">
          Create in three screens with audience presets, then share and manage.
        </p>
        <div className="board-row">
          {HOST.map(([id, name, note, S]) => (
            <figure key={id} className="board-frame">
              <div className="board-phone">
                <Phone label={name}>
                  <S
                    go={() => {}}
                    still
                    host={{ audience: "community", ...PRESETS.community }}
                    setHost={() => {}}
                  />
                </Phone>
              </div>
              <figcaption>
                <span className="label">{name}</span>
                <span className="caption p-muted">{note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="title-l">Desktop</h2>
        <p className="p-muted">
          Discovery with the top-gifter and top-earner boards, the host dashboard, and developer
          tools for third-party games.
        </p>
        <div className="board-desk">
          {[
            ["Discover", DesktopDiscover],
            ["Hosting dashboard", DesktopHosting],
            ["Developers", DesktopDevelopers],
          ].map(([n, D]) => (
            <figure key={n} className="board-frame">
              <div className="desk-scale">
                <div className="desk">
                  <D />
                </div>
              </div>
              <figcaption>
                <span className="label">{n}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}

function ThemePick() {
  const read = () => {
    try {
      return localStorage.getItem("fd-theme") || "system";
    } catch (e) {
      return "system";
    }
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const r = document.documentElement;
    if (v === "system") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", v);
    try {
      localStorage.setItem("fd-theme", v);
    } catch (e) {}
  }, [v]);
  return (
    <Segmented
      label="Theme"
      value={v}
      onChange={setV}
      options={[
        { value: "system", label: "Auto", icon: "monitor" },
        { value: "light", label: "Light", icon: "sun" },
        { value: "dark", label: "Dark", icon: "moon" },
      ]}
    />
  );
}

function App() {
  const [tab, setTab] = useState(location.hash === "#screens" ? "screens" : "prototype");
  return (
    <div className="shell">
      <header className="shell-head">
        <Logo size={28} />
        <div className="shell-tabs" role="tablist">
          {[
            ["prototype", "Prototype"],
            ["screens", "All screens"],
          ].map(([k, l]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              className={tab === k ? "is-on" : ""}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="shell-theme">
          <ThemePick />
        </div>
      </header>
      {tab === "prototype" ? <Prototype /> : <Board />}
    </div>
  );
}

/* Screenshot mode for docs: ?shot=<screen id>&theme=light|dark renders one screen with no chrome. Local only. */
function Shot({ id }) {
  const desk = {
    "d-discover": DesktopDiscover,
    "d-hosting": DesktopHosting,
    "d-developers": DesktopDevelopers,
  }[id];
  if (desk) {
    const D = desk;
    return (
      <div className="shot-desk">
        <D />
      </div>
    );
  }
  const all = PLAYER.concat(HOST, [["quiz", "Quiz", "", QuizScreen]]);
  const hit = all.find((s) => s[0] === id);
  if (!hit) return <p>Unknown screen {id}</p>;
  const S = hit[3];
  return (
    <div className="shot-phone phone-screen">
      <S
        go={() => {}}
        still
        host={{ audience: "community", ...PRESETS.community }}
        setHost={() => {}}
      />
    </div>
  );
}
const shotParams = new URLSearchParams(location.search);
if (shotParams.get("shot")) {
  document.documentElement.setAttribute("data-theme", shotParams.get("theme") || "light");
  document.body.classList.add("shot");
}
ReactDOM.createRoot(document.getElementById("app")).render(
  shotParams.get("shot") ? <Shot id={shotParams.get("shot")} /> : <App />,
);
