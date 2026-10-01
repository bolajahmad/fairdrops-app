/* @ds-bundle: {"format":4,"namespace":"FairDrops","components":[{"name":"Logo"},{"name":"Button"},{"name":"IconButton"},{"name":"StatusChip"},{"name":"Countdown"},{"name":"PrizeAmount"},{"name":"FairBadge"},{"name":"GiveawayCard"},{"name":"LeaderboardRow"},{"name":"ClaimCard"},{"name":"GameStage"},{"name":"TapTarget"},{"name":"Field"},{"name":"Segmented"},{"name":"ThemeSwitch"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(" ");
  }

  /* ---------- icons: Lucide geometry, 24 grid, 1.75 stroke ---------- */
  var ICONS = {
    check: ["M20 6 9 17l-5-5"],
    clock: ["c12,12,10", "M12 6v6l4 2"],
    users: [
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      "c9,7,4",
      "M22 21v-2a4 4 0 0 0-3-3.87",
      "M16 3.13a4 4 0 0 1 0 7.75",
    ],
    gift: [
      "M3 9h18v4H3z",
      "M12 9v12",
      "M19 13v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6",
      "M7.5 9a2.5 2.5 0 0 1 0-5C10 4 12 9 12 9s2-5 4.5-5a2.5 2.5 0 0 1 0 5",
    ],
    volume: ["M11 5 6 9H2v6h4l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
    mute: ["M11 5 6 9H2v6h4l5 4V5z", "M22 9l-6 6", "M16 9l6 6"],
    sun: [
      "c12,12,4",
      "M12 2v2",
      "M12 20v2",
      "m4.93 4.93 1.41 1.41",
      "m17.66 17.66 1.41 1.41",
      "M2 12h2",
      "M20 12h2",
      "m6.34 17.66-1.41 1.41",
      "m19.07 4.93-1.41 1.41",
    ],
    moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
    monitor: [
      "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M8 21h8",
      "M12 17v4",
    ],
    arrow: ["M5 12h14", "m12 5 7 7-7 7"],
    spinner: ["M21 12a9 9 0 1 1-6.22-8.56"],
    alert: [
      "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      "M12 9v4",
      "M12 17h.01",
    ],
    shield: [
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      "m9 12 2 2 4-4",
    ],
    lock: [
      "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
      "M7 11V7a5 5 0 0 1 10 0v4",
    ],
    x: ["M18 6 6 18", "m6 6 12 12"],
    share: ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13"],
    dice: [
      "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M8 8h.01",
      "M16 8h.01",
      "M12 12h.01",
      "M8 16h.01",
      "M16 16h.01",
    ],
    quiz: ["c12,12,10", "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3", "M12 17h.01"],
    tap: [
      "M9 11V6a2 2 0 0 1 4 0v5",
      "M13 10a2 2 0 0 1 4 0v2",
      "M17 12a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-2a7 7 0 0 1-5.6-2.8L4 16a2 2 0 0 1 3-2.6l2 1.6",
    ],
    puzzle: [
      "M15.4 8.6a2.5 2.5 0 1 1 3.3 3.3L22 15.3V19a3 3 0 0 1-3 3h-3.7l-3.4-3.3a2.5 2.5 0 1 0-3.3-3.3L5.3 12H2V9a3 3 0 0 1 3-3h3.7l3.4 3.3a2.5 2.5 0 1 1 3.3-3.3z",
    ],
  };

  function Icon(props) {
    var paths = ICONS[props.name] || [];
    var size = props.size || 20;
    return h(
      "svg",
      {
        className: cx("fd-icon", props.spin && "fd-spin", props.className),
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.75,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
      paths.map(function (d, i) {
        if (d.charAt(0) === "c") {
          var n = d.slice(1).split(",");
          return h("circle", { key: i, cx: n[0], cy: n[1], r: n[2] });
        }
        return h("path", { key: i, d: d });
      }),
    );
  }

  /* ---------- Logo: a drop landing in cupped hands ---------- */
  function Mark(props) {
    var size = props.size || 32;
    return h(
      "svg",
      {
        className: "fd-mark",
        width: size,
        height: size,
        viewBox: "0 0 48 48",
        "aria-hidden": "true",
      },
      h("path", {
        className: "fd-mark-hands",
        d: "M9 27a15 15 0 0 0 30 0",
        fill: "none",
        strokeWidth: 7,
        strokeLinecap: "round",
      }),
      h("path", {
        className: "fd-mark-drop",
        d: "M24 3.5s-8.5 10-8.5 16.2a8.5 8.5 0 0 0 17 0C32.5 13.5 24 3.5 24 3.5z",
      }),
      h("circle", { className: "fd-mark-shine", cx: 20.6, cy: 19.4, r: 2.1 }),
    );
  }

  function Logo(props) {
    var size = props.size || 32;
    var mark = h(Mark, { size: size });
    if (props.variant === "mark") {
      return h("span", { className: "fd-logo", role: "img", "aria-label": "FairDrops" }, mark);
    }
    if (props.variant === "app") {
      return h(
        "span",
        {
          className: "fd-logo-app",
          role: "img",
          "aria-label": "FairDrops",
          style: { width: size * 1.5, height: size * 1.5 },
        },
        mark,
      );
    }
    return h(
      "span",
      { className: "fd-logo", role: "img", "aria-label": "FairDrops" },
      mark,
      h(
        "span",
        { className: "fd-logo-word", style: { fontSize: Math.round(size * 0.72) } },
        "FairDrops",
      ),
    );
  }

  /* ---------- Button ---------- */
  function Button(props) {
    var variant = props.variant || "primary";
    var size = props.size || "md";
    var rest = {};
    for (var k in props) {
      if (
        [
          "variant",
          "size",
          "icon",
          "iconAfter",
          "loading",
          "block",
          "children",
          "className",
        ].indexOf(k) === -1
      )
        rest[k] = props[k];
    }
    rest.className = cx(
      "fd-btn",
      "fd-btn-" + variant,
      "fd-btn-" + size,
      props.block && "fd-btn-block",
      props.loading && "is-loading",
      props.className,
    );
    rest.disabled = props.disabled || props.loading;
    rest["aria-busy"] = props.loading ? "true" : undefined;
    if (!rest.type) rest.type = "button";
    return h(
      "button",
      rest,
      props.loading
        ? h(Icon, { name: "spinner", spin: true })
        : props.icon
          ? h(Icon, { name: props.icon })
          : null,
      h("span", null, props.children),
      props.iconAfter && !props.loading ? h(Icon, { name: props.iconAfter }) : null,
    );
  }

  function IconButton(props) {
    return h(
      "button",
      {
        type: "button",
        className: cx("fd-iconbtn", props.tone === "stage" && "fd-iconbtn-stage", props.className),
        "aria-label": props.label,
        "aria-pressed": props.pressed,
        title: props.label,
        onClick: props.onClick,
      },
      h(Icon, { name: props.icon, size: 20 }),
    );
  }

  /* ---------- StatusChip: every giveaway / session phase, in player words ---------- */
  var STATUS = {
    upcoming: { tone: "neutral", icon: "clock", label: "Starts soon" },
    live: { tone: "live", dot: true, label: "Live" },
    ending: { tone: "live", dot: true, label: "Ending soon" },
    settling: { tone: "neutral", icon: "spinner", spin: true, label: "Counting results" },
    results: { tone: "good", icon: "check", label: "Results in" },
    claimable: { tone: "solid", icon: "gift", label: "Prize ready" },
    claimed: { tone: "good", icon: "check", label: "Collected" },
    ended: { tone: "neutral", label: "Ended" },
    cancelled: { tone: "bad", icon: "x", label: "Cancelled · refunded" },
    failed: { tone: "bad", icon: "alert", label: "Game void" },
  };

  function StatusChip(props) {
    var s = STATUS[props.status] || STATUS.ended;
    return h(
      "span",
      { className: cx("fd-chip", "fd-chip-" + s.tone, props.onStage && "fd-chip-onstage") },
      s.dot
        ? h("span", { className: "fd-dot", "aria-hidden": "true" })
        : s.icon
          ? h(Icon, { name: s.icon, size: 14, spin: s.spin })
          : null,
      props.label || s.label,
    );
  }

  /* ---------- Countdown ---------- */
  function fmt(total, compact) {
    total = Math.max(0, Math.floor(total));
    var d = Math.floor(total / 86400);
    var hr = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function p(n) {
      return (n < 10 ? "0" : "") + n;
    }
    if (d > 0) return d + "d " + p(hr) + "h";
    if (hr > 0) return hr + ":" + p(m) + ":" + p(s);
    return compact ? m + ":" + p(s) : p(m) + ":" + p(s);
  }

  function Countdown(props) {
    var start = props.seconds || 0;
    var st = React.useState(start);
    var left = st[0];
    var setLeft = st[1];
    React.useEffect(
      function () {
        setLeft(start);
      },
      [start],
    );
    React.useEffect(
      function () {
        if (!props.running || left <= 0) return undefined;
        var t = setTimeout(function () {
          setLeft(left - 1);
        }, 1000);
        return function () {
          clearTimeout(t);
        };
      },
      [left, props.running],
    );
    var urgent = left <= (props.urgentAt == null ? 10 : props.urgentAt) && left > 0;
    return h(
      "span",
      {
        className: cx(
          "fd-countdown",
          "fd-countdown-" + (props.size || "m"),
          urgent && "is-urgent",
          left === 0 && "is-done",
          props.onStage && "fd-countdown-onstage",
        ),
        role: "timer",
        "aria-live": urgent ? "assertive" : "off",
      },
      props.label ? h("span", { className: "fd-countdown-label" }, props.label) : null,
      h(
        "span",
        { className: "fd-countdown-digits", key: urgent ? left : "d" },
        left === 0 && props.doneLabel ? props.doneLabel : fmt(left),
      ),
    );
  }

  /* ---------- PrizeAmount ---------- */
  function PrizeAmount(props) {
    return h(
      "span",
      { className: cx("fd-amount", "fd-amount-" + (props.size || "m"), props.muted && "is-muted") },
      h("span", { className: "fd-amount-value" }, props.amount),
      h("span", { className: "fd-amount-symbol" }, props.symbol || "USDC"),
      props.note ? h("span", { className: "fd-amount-note" }, props.note) : null,
    );
  }

  /* ---------- FairBadge ---------- */
  var FAIR = {
    pending: { tone: "neutral", icon: "shield", label: "Checked after the game" },
    checking: { tone: "neutral", icon: "spinner", spin: true, label: "Checking results…" },
    verified: { tone: "good", icon: "shield", label: "Verified fair" },
    failed: { tone: "bad", icon: "alert", label: "Results don't match" },
  };

  function FairBadge(props) {
    var f = FAIR[props.state || "verified"];
    return h(
      "button",
      {
        type: "button",
        className: cx("fd-fair", "fd-fair-" + f.tone),
        onClick: props.onClick,
        "aria-label": f.label + ". Show how this was checked",
      },
      h(Icon, { name: f.icon, size: 16, spin: f.spin }),
      h("span", null, props.label || f.label),
      props.detail ? h("span", { className: "fd-fair-detail" }, props.detail) : null,
    );
  }

  /* ---------- Avatar (internal) ---------- */
  function Avatar(props) {
    var initials = (props.name || "?")
      .replace(/^@/, "")
      .split(/\s+/)
      .map(function (w) {
        return w.charAt(0);
      })
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return h(
      "span",
      {
        className: cx("fd-avatar", "fd-avatar-" + ((props.hue || 0) % 4)),
        style: { width: props.size || 32, height: props.size || 32 },
        "aria-hidden": "true",
      },
      initials,
    );
  }

  /* ---------- GiveawayCard ---------- */
  var GAME_ICON = { dice: "dice", quiz: "quiz", tap: "tap", custom: "puzzle" };

  function GiveawayCard(props) {
    var g = props.giveaway || {};
    return h(
      "a",
      { className: "fd-gcard", href: props.href || "#", onClick: props.onClick },
      h(
        "div",
        { className: "fd-gcard-top" },
        h(Avatar, { name: g.host, hue: g.hue, size: 28 }),
        h("span", { className: "fd-gcard-host" }, g.host),
        h(StatusChip, { status: g.status }),
      ),
      h("h3", { className: "fd-gcard-title" }, g.title),
      h(
        "div",
        { className: "fd-gcard-prize" },
        h(PrizeAmount, { amount: g.pool, symbol: g.symbol, size: "l" }),
        h("span", { className: "fd-gcard-split" }, g.winners + " winners"),
      ),
      h(
        "div",
        { className: "fd-gcard-meta" },
        h(
          "span",
          { className: "fd-gcard-games" },
          (g.games || []).map(function (k) {
            return h(
              "span",
              { key: k, className: "fd-gcard-game fd-stage-" + k, title: k },
              h(Icon, { name: GAME_ICON[k] || "puzzle", size: 14 }),
            );
          }),
        ),
        h("span", null, h(Icon, { name: "users", size: 14 }), " ", g.players),
        g.seconds != null
          ? h(Countdown, {
              seconds: g.seconds,
              running: true,
              size: "s",
              label: g.status === "upcoming" ? "Starts in" : "Ends in",
            })
          : null,
      ),
    );
  }

  /* ---------- LeaderboardRow ---------- */
  function LeaderboardRow(props) {
    return h(
      "li",
      {
        className: cx(
          "fd-lrow",
          props.you && "is-you",
          props.rank <= 3 && "is-podium",
          props.onStage && "fd-lrow-onstage",
        ),
        style: props.delay ? { animationDelay: props.delay + "ms" } : undefined,
      },
      h("span", { className: "fd-lrow-rank" }, props.rank),
      h(Avatar, { name: props.name, hue: props.hue, size: 32 }),
      h(
        "span",
        { className: "fd-lrow-name" },
        props.name,
        props.you ? h("span", { className: "fd-lrow-you" }, "You") : null,
      ),
      h("span", { className: "fd-lrow-score" }, props.score),
      props.prize
        ? h(PrizeAmount, { amount: props.prize, symbol: props.symbol, size: "s" })
        : h("span", { className: "fd-lrow-noprize" }, "—"),
    );
  }

  /* ---------- ClaimCard ---------- */
  function ClaimCard(props) {
    var state = props.state || "ready";
    var title = {
      waiting: "Results are being counted",
      ready: "Your prize for #" + props.rank,
      collecting: "Sending your prize…",
      collected: "Prize collected",
      expired: "Collection window closed",
      none: "No prize this time",
    }[state];
    var body = {
      waiting: "Prizes unlock once every score is checked. This usually takes a couple of minutes.",
      ready:
        "Collect before " +
        (props.deadline || "the deadline") +
        ". Unclaimed prizes go back to the host.",
      collecting: "Keep this page open. It's on its way to your wallet.",
      collected: "It's in your wallet. You can check the payment any time.",
      expired:
        "Prizes had to be collected by " +
        (props.deadline || "the deadline") +
        ". Unclaimed funds went back to the host.",
      none:
        "You finished #" +
        props.rank +
        ". Winners were the top " +
        (props.winners || 3) +
        ". There are more drops coming.",
    }[state];
    return h(
      "section",
      { className: cx("fd-claim", "fd-claim-" + state), "aria-live": "polite" },
      h(
        "div",
        { className: "fd-claim-head" },
        h("p", { className: "fd-claim-title" }, title),
        state === "ready" || state === "collecting" || state === "collected"
          ? h(PrizeAmount, {
              amount: props.amount,
              symbol: props.symbol,
              size: "xl",
              note: props.note,
            })
          : null,
      ),
      h("p", { className: "fd-claim-body" }, body),
      state === "ready"
        ? h(
            Button,
            { size: "lg", block: true, icon: "gift", onClick: props.onCollect },
            "Collect prize",
          )
        : state === "collecting"
          ? h(Button, { size: "lg", block: true, loading: true }, "Collecting")
          : state === "collected"
            ? h(
                "div",
                { className: "fd-claim-actions" },
                h(
                  Button,
                  { variant: "secondary", icon: "share", onClick: props.onShare },
                  "Share win",
                ),
                h(FairBadge, { state: "verified" }),
              )
            : state === "waiting"
              ? h(FairBadge, { state: "checking" })
              : null,
    );
  }

  /* ---------- GameStage ---------- */
  var GAME_NAME = { dice: "Dice", quiz: "Quiz", tap: "Tap Rush", custom: "Game" };

  function GameStage(props) {
    var game = props.game || "dice";
    var snd = React.useState(props.sound !== false);
    return h(
      "section",
      {
        className: cx("fd-stage", "fd-stage-" + game, props.className),
        "aria-label": (props.title || GAME_NAME[game]) + " game",
      },
      h(
        "header",
        { className: "fd-stage-head" },
        h("span", { className: "fd-stage-icon" }, h(Icon, { name: GAME_ICON[game], size: 20 })),
        h(
          "div",
          { className: "fd-stage-titles" },
          h("span", { className: "fd-stage-title" }, props.title || GAME_NAME[game]),
          props.round ? h("span", { className: "fd-stage-round" }, props.round) : null,
        ),
        props.seconds != null
          ? h(Countdown, {
              seconds: props.seconds,
              running: props.running !== false,
              size: "m",
              onStage: true,
            })
          : null,
        h(IconButton, {
          tone: "stage",
          icon: snd[0] ? "volume" : "mute",
          label: snd[0] ? "Mute game sounds" : "Turn game sounds on",
          pressed: !snd[0],
          onClick: function () {
            snd[1](!snd[0]);
            if (props.onSoundChange) props.onSoundChange(!snd[0]);
          },
        }),
      ),
      h("div", { className: "fd-stage-body" }, props.children),
    );
  }

  /* ---------- TapTarget ---------- */
  function TapTarget(props) {
    var st = React.useState(props.count || 0);
    var pop = React.useState(0);
    return h(
      "div",
      { className: "fd-tap" },
      h("span", { className: "fd-tap-count", key: pop[0], "aria-live": "polite" }, st[0]),
      h(
        "button",
        {
          type: "button",
          className: "fd-tap-btn",
          disabled: props.disabled,
          onPointerDown: function (e) {
            e.preventDefault();
            st[1](st[0] + 1);
            pop[1](pop[0] + 1);
            if (props.onTap) props.onTap(st[0] + 1);
          },
          onKeyDown: function (e) {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              st[1](st[0] + 1);
              pop[1](pop[0] + 1);
            }
          },
        },
        props.label || "TAP",
      ),
      props.hint ? h("span", { className: "fd-tap-hint" }, props.hint) : null,
    );
  }

  /* ---------- Field ---------- */
  function Field(props) {
    var id =
      props.id || "fd-field-" + (props.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    var input = {};
    for (var k in props) {
      if (["label", "hint", "error", "suffix", "prefix", "id", "className"].indexOf(k) === -1)
        input[k] = props[k];
    }
    input.id = id;
    input.className = "fd-input";
    input["aria-invalid"] = props.error ? "true" : undefined;
    input["aria-describedby"] = props.hint || props.error ? id + "-desc" : undefined;
    return h(
      "div",
      { className: cx("fd-field", props.error && "has-error", props.className) },
      h("label", { className: "fd-field-label", htmlFor: id }, props.label),
      h(
        "div",
        { className: "fd-input-wrap" },
        props.prefix ? h("span", { className: "fd-affix" }, props.prefix) : null,
        h("input", input),
        props.suffix ? h("span", { className: "fd-affix" }, props.suffix) : null,
      ),
      props.error || props.hint
        ? h(
            "p",
            { id: id + "-desc", className: "fd-field-desc" },
            props.error ? h(Icon, { name: "alert", size: 14 }) : null,
            props.error || props.hint,
          )
        : null,
    );
  }

  /* ---------- Segmented ---------- */
  function Segmented(props) {
    var st = React.useState(props.value != null ? props.value : props.options[0].value);
    var value = props.onChange && props.value != null ? props.value : st[0];
    return h(
      "div",
      {
        className: cx("fd-seg", props.stacked && "fd-seg-stacked"),
        role: "radiogroup",
        "aria-label": props.label,
      },
      props.options.map(function (o) {
        var on = o.value === value;
        return h(
          "button",
          {
            key: o.value,
            type: "button",
            role: "radio",
            "aria-checked": on ? "true" : "false",
            className: cx("fd-seg-opt", on && "is-on"),
            onClick: function () {
              st[1](o.value);
              if (props.onChange) props.onChange(o.value);
            },
          },
          o.icon ? h(Icon, { name: o.icon, size: 18 }) : null,
          h(
            "span",
            { className: "fd-seg-text" },
            h("span", { className: "fd-seg-label" }, o.label),
            o.hint ? h("span", { className: "fd-seg-hint" }, o.hint) : null,
          ),
        );
      }),
    );
  }

  /* ---------- ThemeSwitch ---------- */
  function ThemeSwitch(props) {
    var root = document.documentElement;
    var initial = props.value || root.getAttribute("data-theme-choice") || "system";
    var st = React.useState(initial);
    function apply(v) {
      st[1](v);
      root.setAttribute("data-theme-choice", v);
      if (v === "system") {
        var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        root.setAttribute("data-theme", dark ? "dark" : "light");
      } else {
        root.setAttribute("data-theme", v);
      }
      if (props.onChange) props.onChange(v);
    }
    return h(Segmented, {
      label: "Theme",
      value: st[0],
      onChange: apply,
      options: [
        { value: "system", label: "Auto", icon: "monitor" },
        { value: "light", label: "Light", icon: "sun" },
        { value: "dark", label: "Dark", icon: "moon" },
      ],
    });
  }

  var api = {
    Icon: Icon,
    Logo: Logo,
    Button: Button,
    IconButton: IconButton,
    StatusChip: StatusChip,
    Countdown: Countdown,
    PrizeAmount: PrizeAmount,
    FairBadge: FairBadge,
    GiveawayCard: GiveawayCard,
    LeaderboardRow: LeaderboardRow,
    ClaimCard: ClaimCard,
    GameStage: GameStage,
    TapTarget: TapTarget,
    Field: Field,
    Segmented: Segmented,
    ThemeSwitch: ThemeSwitch,
  };
  window.FairDrops = Object.assign(window.FairDrops || {}, api);
})();
