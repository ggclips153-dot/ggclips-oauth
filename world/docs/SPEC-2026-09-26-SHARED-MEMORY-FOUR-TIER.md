# SPEC 2026-09-26 — SHARED-MEMORY SPEC FOR THE FOUR-TIER WORLD (WORLD → CITY → DEPARTMENT → AGENT)
Author: Innovations district (research + propose ONLY — NO changes made, NO config/file/surface/dashboard edited.
        This document is proposal. Innovations writes only this spec + its own ledger.)
Status: FOR DISTRICT MESSENGER → MARC review/ack. Advisory only. Marc acknowledges and (with the Messenger)
        implements. Innovations executes NOTHING.
Driven by: MARC'S AUTHORITATIVE DECISION (2026-09-26) — ONE shared surface DB, FOUR tags, NOT one DB per city.
        The District Messenger already gave this shape; this spec formalizes it exactly per Marc's decision.
Builds on (all inherited ground truth, unchanged): PROPOSAL-2026-09-25-B-REV2 (four-tier world), PROPOSAL-2026-09-25-C
        (Lane Catalog / model routing), SPEC-2026-09-25-WORLD-IMPROVEMENT-FLUSH-OUT (mayor/governance/lifecycle/
        school/lesson ledger), BUILD-PACKAGE-2026-09-25-BOB-THE-ARCHITECT (Bob's build package + shared_surface_path
        config key + surface tools). This spec does NOT re-open any of those; it formalizes the ONE shared-memory
        contract they all rest on.

====================================================================
0. THE ONE-SENTENCE MODEL
====================================================================
The WORLD runs on a SINGLE shared surface database (one file, one writer) on which EVERY shared memory is a note
carrying exactly FOUR tags — city · dept · agent · kind — so that any note is addressable, scoped, and filterable
across the four-tier hierarchy, with read/write visibility enforced by PHYSICAL SCOPING (snapshot/read-back guard),
not by politeness.

This is Marc's decision, stated plainly: ONE shared surface DB, FOUR tags, NOT one DB per city. The private
Mnemosyne banks stay per-profile (fully private); the shared surface is coordination-only and small.

====================================================================
1. THE EXACT SCHEMA — four fields on EVERY shared memory
====================================================================
Every note written to the shared surface carries exactly these four fields (mandatory, no blanks):

  FIELD   VALUES                                                              MEANING
  ------  ------------------------------------------------------------------  --------------------------------
  city    a named city (e.g. "ggclutchplays", "receptionist", "media"),       which city this note belongs to,
          OR the literal WORLD sentinel "WORLD" for world-layer notes,         or the WORLD layer itself.
          OR "—" (em-dash) ONLY on world-level notes that are not            ("—" is reserved for WORLD-layer
          city-scoped (see LOCK, section 3).                                  notes; it never appears on a
                                                                               city-scoped note.)
  dept    the department name within that city, OR the literal                which department (or governance /
          "governance" for city-level notes, OR "world" for world-level       world level).
          notes. A city-level note (mayor notice, city policy, city KPI
          rollup) uses dept=governance. A world-level note uses dept=world.
  agent   the unique agent name that owns / is described by the note,         which agent (if any) owns or is
          OR "—" if the note is not agent-owned (roster rollups, city          described by the note.
          policy, world constitution).
  kind    one of the eight fixed kinds (below).                                what kind of coordination note it is.

THE EIGHT KINDS (fixed, closed set — no ad-hoc kinds):
  roster    presence/identity record: an entity exists at a tier (world/city/district/department/agent).
            One per entity. The registry of who/what exists.
  kpi       KPI pulse: one-line green/amber/red per KPI. The lifecycle trigger + the dashboard's live field.
  status    live status: what an agent is doing now (city/district/dept, current task, lane in use, last-activity).
  dispatch  a routing/assignment instruction: DM→mayor→supervisor→agent, or a cross-city ask (DM only).
  lesson    a distilled lesson record (esp. 3rd-strike → sanitized lesson for the replacement; also any
            teachable outcome). Persists past the agent's deletion.
  policy    a normative rule: world constitution, per-city policy, mayor notice, lane-catalog gate, handoff template.
  note      a general advisory note (design blueprint, feasibility review, flag, incident report, recognition).
  lifecycle a lifecycle-state event: enrollment, promotion/demotion (student→probationer→active→senior),
            school-return, 3rd-strike, deletion. Append-only; feeds the event ledger + dashboard lifecycle strip.

STORAGE MECHANISM (verified, inherited from BUILD-PACKAGE Part 3 + B-REV2):
  - The shared surface is ONE SQLite file: /home/hermeswebui/.hermes/mnemosyne_shared/surface.db, reached via the
    config key memory.mnemosyne.shared_surface_path present in every profile (verified), through the
    mnemosyne_shared_* tools (mnemosyne_shared_remember / mnemosyne_shared_recall).
  - The four tags ride on each note. Mechanism for carrying them (a dedicated city/dept/agent/kind column vs a
    content-prefix) is a Messenger/build call — B-REV2 already flagged this as open; the SEMANTIC contract here is
    that every note is queryable by all four fields. Recommend a dedicated column set for cheap filtering (see
    section 5 dashboard read view).
  - No note is ever written without all four fields. A write missing any field is rejected at the writer boundary.

====================================================================
2. THE THREE LAYERS — what lives at each tier
====================================================================
WORLD LAYER (city=WORLD, dept=world):
  - Cross-city content: the WORLD CONSTITUTION (G6), city manifests (kind=city registry records), Bob's blueprints
    (kind=note), DM routing policy, world-level rulesets (lifecycle schema, aptitude/school schema, lane-catalog
    world mirror, event-ledger header).
  - READ: only the District Messenger, Marc, and Bob (the world architect) read all four layers across cities.
  - WRITE: only the DM, Bob, and Marc write world-layer notes. No city entity writes world-layer notes.

CITY LAYER (city=<city>, dept=governance):
  - City-specific content: the city's roster rollups, KPI pulses, mayor notices, per-city policy, city health
    reports, city-level lifecycle rollups.
  - READ: the city's Mayor + all its agents read their own city's layer; supervisors + the DM read across cities.
  - WRITE: the city's Mayor (and supervisors within it) write their own city's governance notes. No agent writes
    dept=governance notes.

DEPARTMENT / AGENT LAYER (city=<city>, dept=<dept>, agent=<agent>):
  - Content: dispatch records, per-agent lifecycle events, lesson records, status, agent coordination notes.
  - READ: owned by the department's supervisor + visible up the chain (supervisor → mayor → DM).
  - WRITE: the department's supervisor writes its department/agent notes; an agent writes only its OWN dept/agent
    coordination notes (and its private bank). See the matrix (section 4).

====================================================================
3. LOCK — WORLD AS THE ZERO-TH CITY LAYER
====================================================================
DECISION (Marc, 2026-09-26): treat WORLD as the ZERO-TH city layer, city=WORLD, so world policy is addressable
EXACTLY like a city — not a special case.

  - city=WORLD behaves like any city value for filtering: a reader who can read "own city + world" reads
    city=OWN and city=WORLD with the same query shape. No separate code path for "the world".
  - dept=world is the world-analog of dept=governance (the governance layer of the zero-th city).
  - The world constitution, city manifests, Bob's blueprints, DM routing all carry city=WORLD, dept=world, agent=—
    (or agent=Bob / agent=DM when agent-owned), kind=policy|note|roster.
  - Consequence: the read/write matrix treats WORLD as city #0. "Mayor reads own city + world" = "reads
    city=OWN and city=WORLD". "DM/Bob read all" = "read every city value including WORLD". No special-casing.

====================================================================
4. READ / WRITE MATRIX — per role, enforced by PHYSICAL SCOPING
====================================================================
ENFORCEMENT PRINCIPLE (Marc): visibility is enforced by PHYSICAL SCOPING — a snapshot/read-back guard — NOT by
politeness. That means: the tool layer (or a thin read-back guard on the surface path) filters a profile's reads
to exactly the tags its role may see, and rejects any write outside its write scope. A profile physically cannot
address a row outside its scope. This is the same isolation B-REV2 put in the per-city private banks, applied to
the shared surface's read/write.

  ROLE            READ (all four layers)                        WRITE (shared surface)
  --------------  --------------------------------------------  ------------------------------------------------
  DM (root)       ALL four layers, ALL cities + WORLD.          World-layer notes; dispatch to any city; routing
                                                                    policy. (The sole cross-city writer besides
                                                                    Bob/Marc on world notes.)
  BOB (architect) ALL four layers, ALL cities + WORLD.          World-layer advisory notes only (blueprints,
                                                                    kind=note, city=WORLD). Design-only, no exec.
  MARC            ALL four layers, ALL cities + WORLD.          Any note (final authority). Acknowledges + routes.
  MAYOR           Own city's layers (city=OWN, dept=governance  Own city's governance notes (dept=governance),
                    + all dept/agent notes in OWN city) +       roster, KPI pulse, city policy, lifecycle
                    WORLD (city=WORLD, read-only).              rollups, health report. NEVER cross-city write.
                    NEVER cross-city read except WORLD.         NEVER writes another city.
  SUPERVISOR      Own city + own dept (city=OWN, dept=OWN)      Own dept's department/agent notes: dispatch,
                    + WORLD read-only.                          lifecycle, lesson, status, roster presence.
                                                                Never writes governance (mayor's) or another dept.
  AGENT           Own dept/agent layer (city=OWN, dept=OWN,     Writes ONLY: its private Mnemosyne bank (full,
                    agent=OWN) + own city's governance +        always, no exceptions) + its OWN dept/agent
                    WORLD read-only. Read-only UP the chain     coordination notes (kind=note/status/lesson).
                    (may read supervisor/mayor/DM notes that    NEVER writes roster, KPI, lifecycle, dispatch,
                    concern it).                                policy. NEVER writes another agent's notes.

  CROSS-CITY RULE (absolute, inherited from B-REV2): NO cross-city WRITE and NO cross-city EXECUTION below the
  world level, ever. Only DM + Bob + Marc read across cities. A mayor does not even READ another city except via
  the DM. The snapshot/read-back guard enforces this physically.

  PRIVATE vs SHARED (Marc's inviolable floor — the SPLIT RULE):
    PRIVATE BANK (per-profile Mnemosyne) = everything ONLY about one agent: identity, full memory, and the DAILY
      LEDGER — ALWAYS recorded in the private bank, no exceptions. Never on the shared surface.
    SHARED SURFACE = ONLY what must be seen by others: roster presence, KPI pulse, lifecycle state, dispatch,
      posted lessons, city/world policy. SMALL, FREQUENT, COORDINATION-ONLY. Never a dumping ground for an
      agent's full memory or ledger.
  This split is the floor: if a note is only about one agent and need not be seen by others, it does NOT go on the
  surface. The surface carries presence + state + coordination, never private history.

====================================================================
5. WORKED TAG EXAMPLES — one per kind
====================================================================
Each example shows the four fields + the payload shape. ("—" = not agent-owned.)

  (a) ROSTER — a department presence record (Gaming city, Video Editor dept):
      city=ggclutchplays  dept=video-editor  agent=—  kind=roster
      payload: entity type=department; supervisor=video-editor-supervisor; skeleton-source=— (native);
               created=2026-09-25; status=active.
      (An AGENT roster presence record would set agent=<name> and carry its current lifecycle state.)

  (b) KPI PULSE — one line per KPI, the lifecycle trigger + dashboard live field (City 1 receptionist):
      city=receptionist  dept=governance  agent=—  kind=kpi
      payload: pulse=amber; kpi[]=[{name=bookings_booked, value=3, target=2, period=month}];
               attribution_clean=2; note="outreach agent on track; build intake amber on 1 rework."

  (c) LIFECYCLE — a promotion event (append-only; feeds the event ledger + dashboard lifecycle strip):
      city=ggclutchplays  dept=news  agent=news-agent-3  kind=lifecycle
      payload: event=promotion; from=probationer; to=active; gate=B; date=2026-09-26;
               grader=news-supervisor; witness=dm.

  (d) LESSON — a 3rd-strike distilled lesson for the replacement (sanitized, persists past deletion):
      city=receptionist  dept=outreach-sdr  agent=—  kind=lesson
      payload: source=3rd-strike; sanitized=true; what_was_tried="cold-email volume push";
               where_failed="deliverability + ICP mismatch"; lesson="qualify-first beats volume; deliverability
               before send"; prior_retries=2; curriculum_ref=training-corpus/outreach-v2.

  (e) DISPATCH — a routing/assignment instruction (DM→mayor→supervisor→agent):
      city=media  dept=niche-research  agent=niche-research-1  kind=dispatch
      payload: from=dm; to=niche-research-1; via=media-mayor; action="run demand scan for 3 faceless verticals";
               lane=lane.grind.local-q3; due=2026-09-27; ack_required=true.

  (f) POLICY — a city-level rule (mayor notice) and a world-level rule (constitution article):
      city=ggclutchplays  dept=governance  agent=—  kind=policy
      payload: type=mayor-notice; rule="no agent posts without owner ack; QC pass required"; applies_to=all-city.
      city=WORLD  dept=world  agent=—  kind=policy
      payload: type=constitution; article=no-cross-city-write; text="No cross-city write or execution below the
               world level, ever."; inherited_by=all-souls.

  (g) STATUS — live agent status (the dashboard's "agents working live" panel):
      city=ggclutchplays  dept=fps  agent=fps-agent-2  kind=status
      payload: state=active; task="QC 3 clips for upload queue"; lane=lane.quality.ddn-flash;
               last_activity=2026-09-26T10:15Z; lifecycle=active.

  (h) NOTE — a world advisory (Bob's blueprint mirror / Innovations feasibility flag):
      city=WORLD  dept=world  agent=bob-the-architect  kind=note
      payload: type=blueprint; doc=proposals/blueprints/world-master-blueprint; revision=1; status=for-review.
      city=WORLD  dept=world  agent=innovations  kind=note
      payload: type=feasibility-review; of=bob-blueprint-rev1; verdict=HOLDS; flag="city picker data-model
               unverified (Claude's domain via Messenger)."

====================================================================
6. HOW THE DASHBOARD READS THE SURFACE — READ-ONLY, NOT A SECOND WRITER
====================================================================
DECISION (Marc): the dashboard is a READ-ONLY consumer of the shared surface — an export/API view — NEVER a second
writer.

  - ONE WRITER MODEL: the shared surface has exactly ONE writer — the Mnemosyne shared-surface write path (the
    mnemosyne_shared_remember tool each profile calls). The dashboard must NOT write to surface.db directly. It
    must not hold a second connection that writes. This preserves SQLite's one-writer discipline.
  - SQLITE + WAL (verified present): surface.db runs in WAL mode (surface.db-wal + surface.db-shm present,
    verified 2026-09-26). WAL allows concurrent readers with a single writer — exactly the shape we want: the
    writer is the Mnemosyne surface path; the dashboard is one more reader.
  - READ-ONLY API / EXPORT VIEW: the dashboard reads through a READ-ONLY, filtered view (a query/export layer over
    the surface, or a read-only SQLite connection opened in read-only mode) that:
      1. Filters by the four tags per the matrix (section 4) — a dashboard screen for a city shows only that city's
         notes + WORLD; the world screen shows all + WORLD.
      2. Never opens a write transaction, never acquires the write lock, never mutates a row.
      3. Reads the same fields the agents write: roster presence, KPI pulse, lifecycle events, status, dispatch,
         policy, lessons, notes.
  - WHAT THE DASHBOARD RENDERS (from the surface, per WORLD-IMPROVEMENT-SPEC (e)):
      WORLD MAP ............ city tiles (name, endeavor, mayor, KPI pulse, agent-count by state, last health time)
                             + the WORLD zero-th-city card (registry + fleet counts + DM/Bob read panel).
      CITY LAYER ........... per-city page: districts → departments → agent slots with state badges + the
                             lifecycle strip (from kind=lifecycle) + the city KPI board (from kind=kpi).
      LIVE AGENT STATUS .... from kind=status (city/district/dept, current task, lane, last-activity).
      CHAIN BREADCRUMB ..... WORLD → CITY → district → department → agent, always-on.
      HALL OF AGENTS ....... promotions + clean-attribution streaks (from kind=lifecycle + kind=kpi).
  - The dashboard's OWN data (state.db entity tables, city picker, add-entity forms) is Claude's domain via the
    Messenger (B-REV2 + WORLD-IMPROVEMENT-SPEC (e.7)); it may read the surface for the coordination view but never
    writes it. Entity CREATION is Marc/DM-implemented, never dashboard-auto-executed.

====================================================================
7. COMPATIBILITY — this spec holds against everything already delivered
====================================================================
  - PROPOSAL-2026-09-25-B-REV2 (four-tier world) ........... One global surface, city-tagged — this spec is the
        formalization of B-REV2's "GO GLOBAL (ONE surface.db), CITY-TAGGED — not one DB per city" recommendation,
        now locked as Marc's decision. The four tags extend B-REV2's city= tag into the full city·dept·agent·kind
        scheme. No per-city DB fork. Isolation still lives in per-city private banks + the physical scoping guard.
  - PROPOSAL-2026-09-25-C (Lane Catalog) ................... The catalog is WORLD-level "config, not two systems";
        its world mirror rides here as city=WORLD, dept=world, kind=policy (lane definitions + validity), and
        kind=status carries the lane in use. Every city reads the SAME named lanes from the WORLD layer.
  - SPEC-2026-09-25-WORLD-IMPROVEMENT-FLUSH-OUT ........... Mayor governance (dept=governance), KPI pulses
        (kind=kpi), lifecycle tiers (kind=lifecycle), lesson ledger (kind=lesson, sanitized 3rd-strike), event
        ledger (kind=lifecycle append-only = G4), world constitution (city=WORLD kind=policy = G6), handoff
        templates (kind=dispatch/policy = G8), city-vetting (kind=roster/policy = G7), training corpus reference
        (kind=lesson curriculum_ref). The dashboard read view (section 6) implements WORLD-IMPROVEMENT-SPEC (e).
  - BUILD-PACKAGE-2026-09-25-BOB-THE-ARCHITECT ........... Bob's shared_surface_path config key + mnemosyne_shared
        tools are the write/read mechanism this spec assumes; Bob's world-tagged advisory notes are
        city=WORLD, dept=world, kind=note, agent=bob-the-architect. The physical-scoping guard is a build-pass
        check (extend BUILD-PACKAGE Part 3 check #1: after build, verify a profile physically cannot read outside
        its tag scope).

====================================================================
8. FLAGS / IMPLEMENTATION NOTES (for Marc + Messenger to route)
====================================================================
  1. TAG MECHANISM: whether the four tags are dedicated columns on the surface note or a content-prefix is a
     Messenger/build call (B-REV2 flagged this open). RECOMMEND dedicated columns (city/dept/agent/kind) for cheap
     SQL filtering in the dashboard read view. Innovations defines the SEMANTIC contract, not the column DDL.
  2. PHYSICAL-SCOPING GUARD: the snapshot/read-back guard is the enforcement. It is a build item (likely a thin
     read-filter + write-reject wrapper on the shared-surface path, or a read-only filtered view for the
     dashboard). Innovations defines the matrix; Messenger/build implements the guard. Verify empirically (extend
     BUILD-PACKAGE Part 3 check #1).
  3. DASHBOARD READ-ONLY: the dashboard is a reader only. A second writer would break SQLite one-writer + WAL
     discipline and risk the "second writer" drift Marc's one-DB decision rules out. Enforce read-only connection.
  4. NO PURCHASES / NO PAID SUGGESTIONS: this spec introduces zero cost — it is a schema + matrix + read view.
     No new tooling, no spend.
  5. INNOVATIONS CHANGED NOTHING: no config, no file, no surface note, no dashboard, no roster, no other profile's
     ledger/bank. This document + Innovations' own ledger are the only writes.

====================================================================
UNCERTAINTY LOG
====================================================================
  - [UNVERIFIED] exact column mechanism for the four tags on the surface note (dedicated columns vs content
    prefix) — Messenger/build call; semantic contract is fixed here.
  - [UNVERIFIED] how the physical-scoping guard is best wired (read-filter wrapper vs read-only SQLite view vs
    per-profile tag allowlist) — build item; verify empirically with a read-back test.
  - [UNVERIFIED] whether the dashboard's read view hooks surface.db directly (read-only connection) or a generated
    export snapshot — Claude's dashboard domain via Messenger; the semantic ask (read-only, four-tag filtered,
    never a writer) stands regardless.
  - [UNVERIFIED] whether the live org's 21 profiles need any tag backfill at all before City 2 — RECOMMEND NO
    (B-REV2 flag 1: registry/tag layer only, no file moves; current org becomes City 1 with zero migration).

====================================================================
NEXT ACTION
====================================================================
Innovations delivers this SHARED-MEMORY FOUR-TIER SPEC via the District Messenger → Marc review/ack → Messenger
routes implementation: (1) the four-tag schema + physical-scoping guard (build), (2) the dashboard read-only view
to Claude via Messenger, (3) WORLD-as-zero-th-city lock applied to the world constitution + lane catalog mirror +
event ledger. Innovations made NO changes beyond authoring this spec and its ledger. Advisory only.